/**
 * probe-orchestrator.ts
 * Core state machine for the probe subsystem.
 * Manages (server, model, endpoint) tuple states: HEALTHY / SUSPECT / UNHEALTHY / RECOVERING.
 *
 * Task 9: WAL integration for crash-safe state persistence.
 */

import { calculateBackoff } from '../utils/backoff.js';
import { logger } from '../utils/logger.js';

import { getPsPollCoordinator } from './ps-poll-coordinator-instance.js';
import type {
  ProbeState,
  Tuple,
  TupleKey,
  ProbeConfig,
  Classification,
  FailureKind,
} from './types.js';
import { tupleKey, parseTupleKey, DEFAULT_PROBE_CONFIG } from './types.js';
import type { WALStore, TupleSnapshotState } from './wal-store.js';

/**
 * Pattern for test fixture server IDs that should be cleaned up on startup.
 * These are created by test suites and leaked into the production CB registry.
 */
const TEST_FIXTURE_PATTERN =
  /^(force-(recovering|halfopen-manual|reopen)|cycle-reopen|recovering-reopen)/;

/**
 * Counter for test fixtures cleaned up (exported for Prometheus).
 */
let testFixturesCleanedTotal = 0;

/**
 * Returns the total number of test fixtures cleaned up since process start.
 */
export function getTestFixturesCleanedTotal(): number {
  return testFixturesCleanedTotal;
}

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
  private cbPrematureOpenTotal = 0;

  constructor(
    private config: ProbeConfig = DEFAULT_PROBE_CONFIG,
    private wal: WALStore | null = null
  ) {}

  async recordProbeResult(
    tuple: Tuple,
    success: boolean,
    classification?: Classification
  ): Promise<ProbeState> {
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
      this._handleSuccess(ts, tuple, now);
    } else {
      this._handleFailure(ts, key, classification, now);
    }

    this._pruneErrorWindow(ts, now);
    const toState = ts.state;

    if (fromState !== toState) {
      ts.lastTransition = now;
      const reason = this._buildTransitionReason(fromState, success, classification);
      this._emitStateChange(tuple, fromState, toState, reason);

      if (this.wal) {
        this.wal.append({
          tupleKey: key,
          eventType: 'STATE_CHANGE',
          fromState,
          toState,
          reason,
          metadata: JSON.stringify({
            consecutiveSuccesses: ts.consecutiveSuccesses,
            consecutiveFailures: ts.consecutiveFailures,
            recoveryAttempts: ts.recoveryAttempts,
          }),
        });
      }
    }

    // Needed to satisfy @typescript-eslint/require-await since WAL operations are sync
    await Promise.resolve();
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

  /**
   * Reset all circuit breakers for a given server.
   * Iterates through all tuple states and resets any tuple whose key starts with `${serverId}:`.
   * Does NOT write WAL events - this is a bulk admin operation.
   */
  resetAllForServer(serverId: string): number {
    let resetCount = 0;
    const prefix = `${serverId}:`;
    for (const [key] of this.states) {
      if (key.startsWith(prefix)) {
        this.states.set(key, this._createInitialState());
        resetCount++;
      }
    }
    return resetCount;
  }

  /**
   * Reset all circuit breakers for a given model across every server and endpoint.
   * Tuple keys are formatted `serverId:model:endpoint`; this resets any key whose
   * `:model:` segment matches. Does NOT write WAL events - this is a bulk admin
   * operation intended to clear stale SUSPECT/UNHEALTHY state after fleet churn.
   */
  resetAllForModel(model: string): number {
    let resetCount = 0;
    for (const [key] of this.states) {
      const parsed = parseTupleKey(key);
      if (parsed.model === model) {
        this.states.set(key, this._createInitialState());
        resetCount++;
      }
    }
    return resetCount;
  }

  /**
   * Evict (delete) all circuit breakers for a given server.
   * Iterates through all tuple states and deletes any tuple whose key starts with `${serverId}:`.
   * Does NOT write WAL events - this is a bulk admin/cleanup operation.
   */
  evictAllForServer(serverId: string): number {
    let evictCount = 0;
    const prefix = `${serverId}:`;
    for (const [key] of this.states) {
      if (key.startsWith(prefix)) {
        this.states.delete(key);
        evictCount++;
      }
    }
    return evictCount;
  }

  evictTuple(tuple: Tuple): void {
    const key = tupleKey(tuple);
    const ts = this.states.get(key);

    if (this.wal && ts) {
      this.wal.append({
        tupleKey: key,
        eventType: 'EVICTED',
        fromState: ts.state,
        toState: null,
        reason: 'evictTuple',
        metadata: JSON.stringify({
          consecutiveSuccesses: ts.consecutiveSuccesses,
          consecutiveFailures: ts.consecutiveFailures,
          recoveryAttempts: ts.recoveryAttempts,
        }),
      });
    }

    this.states.delete(key);
  }

  /**
   * Remove all circuit breakers whose serverId matches the TEST_FIXTURE_PATTERN.
   * These are test fixtures leaked from previous test sessions.
   * Logs a warning before removing each one.
   * @returns The number of test fixture CBs removed
   */
  cleanupTestFixtures(): number {
    let cleaned = 0;
    for (const key of this.states.keys()) {
      let serverId: string;
      try {
        serverId = parseTupleKey(key).serverId;
      } catch {
        continue;
      }
      if (TEST_FIXTURE_PATTERN.test(serverId)) {
        const tuple = parseTupleKey(key);
        logger.warn(`[TestFixtureCleanup] Removing leaked test fixture: ${serverId}`);
        this.evictTuple(tuple);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info(`[TestFixtureCleanup] Cleaned ${cleaned} test fixture CBs`);
      testFixturesCleanedTotal += cleaned;
    }
    return cleaned;
  }

  async restoreFromWAL(): Promise<void> {
    if (!this.wal) {
      return;
    }

    this.restoreProbeStates();

    if (this.states.size > 0) {
      return;
    }

    const snapshot = this.wal.loadLatestSnapshot();
    if (snapshot) {
      for (const [key, snapState] of snapshot.data) {
        const ts: TupleState = {
          state: snapState.state as ProbeState,
          consecutiveSuccesses: snapState.consecutiveSuccesses,
          consecutiveFailures: snapState.consecutiveFailures,
          errorWindow: [],
          lastTransition: snapState.lastTransition,
          lastProbeAt: 0,
          nextProbeAt: 0,
          recoveryAttempts: snapState.recoveryAttempts,
          lastErrorKind: undefined,
        };
        this.states.set(key, ts);
      }
    }

    for await (const event of this.wal.replay()) {
      if (event.eventType === 'EVICTED') {
        this.states.delete(event.tupleKey);
        continue;
      }

      let ts = this.states.get(event.tupleKey);
      if (!ts) {
        ts = this._createInitialState();
        this.states.set(event.tupleKey, ts);
      }

      if (event.toState) {
        ts.state = event.toState as ProbeState;
      }
      if (event.fromState) {
        ts.lastTransition = event.createdAt;
      }

      if (event.metadata) {
        try {
          const meta = JSON.parse(event.metadata) as {
            consecutiveSuccesses: number;
            consecutiveFailures: number;
            recoveryAttempts: number;
          };
          ts.consecutiveSuccesses = meta.consecutiveSuccesses;
          ts.consecutiveFailures = meta.consecutiveFailures;
          ts.recoveryAttempts = meta.recoveryAttempts;
        } catch {
          // ignore parse errors
        }
      }
    }
  }

  createSnapshot(): void {
    if (!this.wal) {
      return;
    }

    const data = new Map<TupleKey, TupleSnapshotState>();
    for (const [key, ts] of this.states) {
      data.set(key, {
        state: ts.state,
        consecutiveSuccesses: ts.consecutiveSuccesses,
        consecutiveFailures: ts.consecutiveFailures,
        lastTransition: ts.lastTransition,
        recoveryAttempts: ts.recoveryAttempts,
      });
    }

    this.wal.saveSnapshot(data);
  }

  saveAllProbeStates(): void {
    if (!this.wal) {
      return;
    }

    for (const [key, ts] of this.states) {
      const parts = key.split(':');
      if (parts.length < 3) {
        continue;
      }
      const serverId = parts[0];
      const model = parts[1];
      const endpoint = parts.slice(2).join(':');

      this.wal.saveProbeTupleState({
        tupleKey: key,
        serverId,
        model,
        endpoint,
        state: ts.state,
        consecutiveSuccesses: ts.consecutiveSuccesses,
        consecutiveFailures: ts.consecutiveFailures,
        errorWindow: ts.errorWindow,
        lastTransition: ts.lastTransition,
        lastProbeAt: ts.lastProbeAt,
        nextProbeAt: ts.nextProbeAt,
        recoveryAttempts: ts.recoveryAttempts,
        lastErrorKind: ts.lastErrorKind,
      });
    }
  }

  restoreProbeStates(): void {
    if (!this.wal) {
      return;
    }

    const savedStates = this.wal.getAllProbeStates();
    for (const saved of savedStates) {
      const ts: TupleState = {
        state: saved.state as ProbeState,
        consecutiveSuccesses: saved.consecutiveSuccesses,
        consecutiveFailures: saved.consecutiveFailures,
        errorWindow: saved.errorWindow,
        lastTransition: saved.lastTransition,
        lastProbeAt: saved.lastProbeAt,
        nextProbeAt: saved.nextProbeAt,
        recoveryAttempts: saved.recoveryAttempts,
        lastErrorKind: saved.lastErrorKind as FailureKind | undefined,
      };
      this.states.set(saved.tupleKey, ts);
    }
  }

  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      const idx = this.stateChangeCallbacks.indexOf(callback);
      if (idx !== -1) {
        this.stateChangeCallbacks.splice(idx, 1);
      }
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
    if (!ts) {
      return caller === 'admin' || caller === 'routing';
    } // unknown tuple: routing/admin eligible; probe-only tuples stay blocked

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
   * True if state is UNHEALTHY or RECOVERING AND nextProbeAt <= now.
   */
  canProbe(tuple: Tuple): boolean {
    const ts = this.states.get(tupleKey(tuple));
    if (!ts) {
      return false;
    }
    if (ts.state !== 'UNHEALTHY' && ts.state !== 'RECOVERING') {
      return false;
    }
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
    if (!ts) {
      return false;
    }
    if (ts.state !== 'UNHEALTHY' && ts.state !== 'RECOVERING') {
      return false;
    }
    if (ts.nextProbeAt > Date.now()) {
      return false;
    }

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

  private _handleSuccess(ts: TupleState, tuple: Tuple, now: number): void {
    ts.consecutiveSuccesses++;
    ts.consecutiveFailures = 0;

    switch (ts.state) {
      case 'HEALTHY':
        break;
      case 'SUSPECT':
        // dry-run load: block HEALTHY transition if model not loaded
        if (this._dryRunLoad(tuple.serverId, tuple.model)) {
          ts.state = 'HEALTHY';
        }
        break;
      case 'UNHEALTHY':
        ts.state = 'RECOVERING';
        ts.nextProbeAt =
          now +
          calculateBackoff({
            attempt: ts.recoveryAttempts,
            schedule: this.config.recoveryBackoffMs,
            maxDelayMs: 3_600_000,
          }).delayMs;
        break;
      case 'RECOVERING': {
        // Rate-limit (429) recovery is cheap to confirm, so close after the
        // lower rate-limited threshold rather than the full success threshold.
        const closeThreshold =
          ts.lastErrorKind === 'rate_limited'
            ? this.config.rateLimitedRecoverySuccessThreshold
            : this.config.recoverySuccessThreshold;
        if (ts.consecutiveSuccesses >= closeThreshold) {
          // dry-run load: block HEALTHY transition if model not loaded
          if (this._dryRunLoad(tuple.serverId, tuple.model)) {
            ts.state = 'HEALTHY';
            ts.recoveryAttempts = 0;
          }
        }
        break;
      }
    }
  }

  private _handleFailure(
    ts: TupleState,
    tupleKey: TupleKey,
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
          // Warn if CB opened with failure count below the threshold (indicates
          // premature open, e.g. from a threshold change or historical state)
          if (ts.consecutiveFailures < this.config.unhealthyAfterFailures) {
            logger.warn(
              `[CircuitBreaker] Premature OPEN: ${tupleKey} has failureCount=${ts.consecutiveFailures} < threshold=${this.config.unhealthyAfterFailures}`
            );
            this.cbPrematureOpenTotal++;
          }
          ts.state = 'UNHEALTHY';
          const openDelayMs =
            ts.lastErrorKind === 'rate_limited'
              ? ProbeOrchestrator.RATE_LIMITED_BACKOFF_MS
              : calculateBackoff({
                  attempt: ts.recoveryAttempts,
                  schedule: this.config.recoveryBackoffMs,
                  maxDelayMs: 3_600_000,
                }).delayMs;
          ts.nextProbeAt = now + openDelayMs;
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

  // dry-run load: verifies model is loaded before allowing HEALTHY transition.
  // Why: probes check /api/tags health but don't verify model can be loaded.
  // A server with 24GB RAM failing to load a 24GB model still returns healthy
  // on /api/tags, causing premature circuit breaker opens.
  private _dryRunLoad(serverId: string, model: string): boolean {
    try {
      const psCoordinator = getPsPollCoordinator();
      // If never polled, fail open (allow transition until ps-poll runs)
      if (psCoordinator.getServerLastPollAt(serverId) === 0) {
        return true;
      }
      const loadedModels = psCoordinator.getModelsOnServer(serverId);
      if (!loadedModels.has(model)) {
        logger.debug(
          `[ProbeOrchestrator] dry-run load: model=${model} not loaded on server=${serverId}`
        );
        return false;
      }
      return true;
    } catch {
      return true; // fail open if ps-poll unavailable
    }
  }

  private _pruneErrorWindow(ts: TupleState, now: number): void {
    const cutoff = now - this.config.suspectWindowMs;
    ts.errorWindow = ts.errorWindow.filter(t => t > cutoff);
  }

  private _computeErrorRate(ts: TupleState): number {
    if (ts.errorWindow.length === 0) {
      return 0;
    }
    const total = ts.consecutiveSuccesses + ts.errorWindow.length;
    return ts.errorWindow.length / Math.max(1, total);
  }

  /**
   * Flat backoff for rate-limited (429) tuples. Receiving a 429 costs nothing
   * and a 200 only spends a few tokens, so we re-probe often to pick the
   * server back up the moment its quota resets — no climb to the 1h cap.
   */
  private static readonly RATE_LIMITED_BACKOFF_MS = 30_000;

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
    if (success) {
      return `${from} + success`;
    }
    const kind = classification?.kind ?? 'unknown';
    return `${from} + failure(${kind})`;
  }
}
