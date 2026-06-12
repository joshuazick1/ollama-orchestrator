/**
 * probe-orchestrator.ts
 * Core state machine for the probe subsystem.
 * Manages (server, model, endpoint) tuple states: HEALTHY / SUSPECT / UNHEALTHY / RECOVERING.
 *
 * Task 9: WAL integration for crash-safe state persistence.
 */

import type {
  ProbeState,
  Tuple,
  TupleKey,
  ProbeConfig,
  Classification,
  FailureKind,
} from './types.js';
import { tupleKey, DEFAULT_PROBE_CONFIG } from './types.js';
import type { WALStore, TupleSnapshotState } from './wal-store.js';

export interface TupleState {
  state: ProbeState;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  errorWindow: number[];
  lastTransition: number;
  lastProbeAt: number;
  nextProbeAt: number;
  recoveryAttempts: number;
  lastErrorKind: FailureKind | undefined;
}

export type StateChangeCallback = (
  tuple: Tuple,
  from: ProbeState,
  to: ProbeState,
  reason: string
) => void;

export class ProbeOrchestrator {
  private states = new Map<TupleKey, TupleState>();
  private stateChangeCallbacks: StateChangeCallback[] = [];

  constructor(private config: ProbeConfig = DEFAULT_PROBE_CONFIG) {}

  recordProbeResult(tuple: Tuple, success: boolean, classification?: Classification): ProbeState {
    const key = tupleKey(tuple);
    const now = Date.now();

    let ts = this.states.get(key);
    if (!ts) {
      ts = this._createInitialState();
      this.states.set(key, ts);
    }

    const fromState = ts.state;
    ts.lastProbeAt = now;

    if (success) {
      this._handleSuccess(ts, now);
    } else {
      this._handleFailure(ts, classification, now);
    }

    this._pruneErrorWindow(ts, now);
    const toState = ts.state;

    if (fromState !== toState) {
      ts.lastTransition = now;
      this._emitStateChange(
        tuple,
        fromState,
        toState,
        this._buildTransitionReason(fromState, success, classification)
      );
    }

    return toState;
  }

  getState(tuple: Tuple): ProbeState {
    return this.states.get(tupleKey(tuple))?.state ?? 'HEALTHY';
  }

  getTupleState(tuple: Tuple): TupleState | undefined {
    return this.states.get(tupleKey(tuple));
  }

  getAllStates(): Map<TupleKey, TupleState> {
    return new Map(this.states);
  }

  setStateForTesting(tuple: Tuple, state: ProbeState): void {
    const key = tupleKey(tuple);
    let ts = this.states.get(key);
    if (!ts) {
      ts = this._createInitialState();
      this.states.set(key, ts);
    }
    ts.state = state;
    ts.lastTransition = Date.now();
  }

  resetTuple(tuple: Tuple): void {
    this.states.set(tupleKey(tuple), this._createInitialState());
  }

  evictTuple(tuple: Tuple): void {
    this.states.delete(tupleKey(tuple));
  }

  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const idx = this.stateChangeCallbacks.indexOf(callback);
      if (idx !== -1) this.stateChangeCallbacks.splice(idx, 1);
    };
  }

  /**
   * Determines whether this tuple can serve traffic for a given caller.
   *
   * Rules (in priority order):
   * - 'admin' caller: ALWAYS true (force actions bypass state checks)
   * - 'probe' caller: true if state === 'RECOVERING' (for active recovery probes)
   * - 'routing' caller: true if state === 'HEALTHY' OR state === 'SUSPECT'
   *
   * The function is PURE: it does not mutate state, does not transition,
   * does not fire onStateChange. Multiple callers can call this concurrently
   * and get consistent results because Node.js is single-threaded.
   */
  canServe(tuple: Tuple, caller: 'routing' | 'probe' | 'admin'): boolean {
    const ts = this.states.get(tupleKey(tuple));
    if (!ts) return caller === 'admin'; // unknown tuple: only admin can force

    switch (caller) {
      case 'admin':
        return true;
      case 'probe':
        return ts.state === 'RECOVERING';
      case 'routing':
        return ts.state === 'HEALTHY' || ts.state === 'SUSPECT';
    }
  }

  /**
   * Determines whether the recovery driver can probe this tuple right now.
   * True only if state is UNHEALTHY AND nextProbeAt <= now.
   */
  canProbe(tuple: Tuple): boolean {
    const ts = this.states.get(tupleKey(tuple));
    if (!ts) return false;
    if (ts.state !== 'UNHEALTHY') return false;
    return ts.nextProbeAt <= Date.now();
  }

  /**
   * Atomic check-and-set: returns true if THIS caller successfully acquired
   * the probe slot for this tuple. Subsequent calls within the same probe
   * window return false.
   *
   * Implementation: reads nextProbeAt, checks UNHEALTHY + nextProbeAt <= now,
   * then sets nextProbeAt to far future (Number.MAX_SAFE_INTEGER) in a
   * single synchronous step — no await between read and write, so no
   * concurrent caller can also see canProbe() as true.
   */
  markProbing(tuple: Tuple): boolean {
    const key = tupleKey(tuple);
    const ts = this.states.get(key);
    if (!ts) return false;
    if (ts.state !== 'UNHEALTHY') return false;
    if (ts.nextProbeAt > Date.now()) return false;

    // Atomic: no await between read and write
    ts.nextProbeAt = Number.MAX_SAFE_INTEGER;
    return true;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _createInitialState(): TupleState {
    return {
      state: 'HEALTHY',
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      errorWindow: [],
      lastTransition: Date.now(),
      lastProbeAt: 0,
      nextProbeAt: 0,
      recoveryAttempts: 0,
      lastErrorKind: undefined,
    };
  }

  private _handleSuccess(ts: TupleState, now: number): void {
    ts.consecutiveSuccesses++;
    ts.consecutiveFailures = 0;

    switch (ts.state) {
      case 'HEALTHY':
        break;
      case 'SUSPECT':
        ts.state = 'HEALTHY';
        break;
      case 'UNHEALTHY':
        ts.state = 'RECOVERING';
        ts.nextProbeAt = now + this._getRecoveryBackoff(ts.recoveryAttempts);
        break;
      case 'RECOVERING':
        if (ts.consecutiveSuccesses >= this.config.recoverySuccessThreshold) {
          ts.state = 'HEALTHY';
          ts.recoveryAttempts = 0;
        }
        break;
    }
  }

  private _handleFailure(
    ts: TupleState,
    classification: Classification | undefined,
    now: number
  ): void {
    ts.consecutiveFailures++;
    ts.errorWindow.push(now);

    if (classification) {
      ts.lastErrorKind = classification.kind;
    }

    switch (ts.state) {
      case 'HEALTHY':
        ts.consecutiveSuccesses = 0;
        ts.state = 'SUSPECT';
        break;

      case 'SUSPECT':
        // consecutiveSuccesses is NOT reset on failure (only on success).
        // This preserves the pre-existing success count for error rate calculation.
        if (
          ts.consecutiveFailures >= this.config.unhealthyAfterFailures ||
          this._computeErrorRate(ts) >= this.config.errorRateUnhealthyThreshold
        ) {
          ts.state = 'UNHEALTHY';
          ts.nextProbeAt = now + this._getRecoveryBackoff(ts.recoveryAttempts);
        }
        break;

      case 'UNHEALTHY':
        // Already incremented consecutiveFailures above
        break;

      case 'RECOVERING':
        ts.state = 'UNHEALTHY';
        ts.recoveryAttempts++;
        ts.consecutiveSuccesses = 0;
        break;
    }
  }

  private _pruneErrorWindow(ts: TupleState, now: number): void {
    const cutoff = now - this.config.suspectWindowMs;
    ts.errorWindow = ts.errorWindow.filter(t => t > cutoff);
  }

  private _computeErrorRate(ts: TupleState): number {
    if (ts.errorWindow.length === 0) return 0;
    const total = ts.consecutiveSuccesses + ts.errorWindow.length;
    return ts.errorWindow.length / Math.max(1, total);
  }

  private _getRecoveryBackoff(recoveryAttempts: number): number {
    const schedule = this.config.recoveryBackoffMs;
    if (recoveryAttempts < schedule.length) {
      return schedule[recoveryAttempts];
    }
    const lastValue = schedule[schedule.length - 1];
    const excess = recoveryAttempts - schedule.length + 1;
    return Math.min(lastValue * Math.pow(2, excess), 3_600_000);
  }

  private _emitStateChange(tuple: Tuple, from: ProbeState, to: ProbeState, reason: string): void {
    for (const cb of this.stateChangeCallbacks) {
      cb(tuple, from, to, reason);
    }
  }

  private _buildTransitionReason(
    from: ProbeState,
    success: boolean,
    classification?: Classification
  ): string {
    if (success) return `${from} + success`;
    const kind = classification?.kind ?? 'unknown';
    return `${from} + failure(${kind})`;
  }
}
