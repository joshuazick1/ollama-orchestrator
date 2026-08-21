/**
 * probe/recovery-driver.ts
 *
 * RecoveryDriver subsystem for the probe state machine.
 *
 * Task 10: BackoffSchedule — per-tuple exponential backoff for recovery probes.
 * Task 11: RecoveryDriver — probe scheduling + execution (separate task).
 * Task 12: RecoveryDriver + ProbeOrchestrator integration.
 *
 * ## Backoff Algorithm
 *
 * The backoff schedule determines when to run the next recovery probe after a
 * tuple transitions to UNHEALTHY (or after a failed recovery probe attempt).
 *
 * The actual delay calculation is delegated to the canonical `calculateBackoff`
 * in `utils/backoff.ts`, which implements schedule-array lookup with exponential
 * doubling, capped at 1 hour (3,600,000 ms). Per the canonical implementation:
 *
 * - recoveryAttempts < schedule.length: use `config.recoveryBackoffMs[recoveryAttempts]`
 * - recoveryAttempts ≥ schedule.length: start from the last schedule value and
 *   double once per extra attempt, capped at 1 hour (3,600,000 ms).
 *
 * The schedule is fully deterministic (no jitter). Per-tuple state is held in
 * an in-memory Map and is NOT persisted — it is recovered from the WAL by the
 * ProbeOrchestrator on startup.
 *
 * ## RecoveryDriver Integration (Task 12)
 *
 * RecoveryDriver wires into ProbeOrchestrator's onStateChange event to keep the
 * BackoffSchedule counter in sync with the state machine:
 *
 * - On UNHEALTHY transition: backoff.recordRecoveryAttempt(tuple)
 * - On RECOVERING → HEALTHY transition: backoff.resetRecoveryAttempts(tuple)
 *
 * The ProbeOrchestrator independently sets nextProbeAt via the canonical
 * `calculateBackoff` (to avoid a synchronous dependency on BackoffSchedule
 * during state transitions). RecoveryDriver's BackoffSchedule is the
 * authoritative source for the recoveryAttempts counter used by the recovery
 * probe scheduler.
 */

import { calculateBackoff } from '../utils/backoff.js';

import type { EndpointRegistry } from './endpoint-registry.js';
import type { ProbeOrchestrator } from './probe-orchestrator.js';
import type { ProbeConfig, Tuple, TupleKey, Classification } from './types.js';
import { tupleKey, parseTupleKey } from './types.js';

/** 1 hour in milliseconds */
const ONE_HOUR_MS = 3_600_000;

/**
 * Per-tuple exponential backoff schedule for recovery probes.
 *
 * Each tuple tracks its own recovery attempt counter independently. When a tuple
 * transitions to UNHEALTHY (or a recovery probe fails), the counter is used to
 * compute the delay until the next probe.
 */
export class BackoffSchedule {
  /**
   * Per-tuple recovery attempt counters.
   * Key: TupleKey string ("serverId:model:endpoint")
   * Value: number of consecutive failed recovery attempts (0 = no attempts made yet)
   */
  #attempts = new Map<TupleKey, number>();

  constructor(private readonly config: ProbeConfig) {}

  /**
   * Get the next probe time for a tuple that just transitioned to UNHEALTHY
   * (or just had a failed recovery probe).
   *
   * @param tuple - the tuple being probed
   * @param recoveryAttempts - how many failed recovery attempts so far (0 for first attempt)
   * @returns timestamp (ms since epoch) when the next probe should run
   */
  getNextProbeTime(tuple: Tuple, recoveryAttempts: number): number {
    const delay = calculateBackoff({
      attempt: recoveryAttempts,
      schedule: this.config.recoveryBackoffMs,
      maxDelayMs: ONE_HOUR_MS,
    }).delayMs;
    return Date.now() + delay;
  }

  /**
   * Record that a recovery attempt was made (increments counter for that tuple).
   */
  recordRecoveryAttempt(tuple: Tuple): void {
    const key = tupleKey(tuple);
    const current = this.#attempts.get(key) ?? 0;
    this.#attempts.set(key, current + 1);
  }

  /**
   * Reset the recovery attempt counter for a tuple (called on successful recovery).
   */
  resetRecoveryAttempts(tuple: Tuple): void {
    this.#attempts.delete(tupleKey(tuple));
  }

  /**
   * Get the current recovery attempt count for a tuple.
   */
  getRecoveryAttempts(tuple: Tuple): number {
    return this.#attempts.get(tupleKey(tuple)) ?? 0;
  }

  /**
   * Compute the delay in milliseconds for a given recovery attempt count.
   *
   * Delegates to the canonical schedule-array backoff in `utils/backoff.ts`:
   *   - Attempts within the configured schedule: indexed lookup.
   *   - Attempts beyond the schedule: exponential doubling from the last value,
   *     capped at 1 hour.
   *
   * Inlined into `getNextProbeTime` to keep this class private-method-free with
   * respect to the canonical backoff algorithm.
   */
}

/**
 * Probe executor signature — injected by the caller (production = real HTTP probe,
 * tests = mock function).
 */
export type ProbeExecutor = (
  tuple: Tuple
) => Promise<{ success: boolean; classification?: Classification }>;

/**
 * RecoveryDriver — 1-second tick loop that finds UNHEALTHY tuples whose
 * nextProbeAt is due and fires a probe against each.
 *
 * Concurrency control: uses ProbeOrchestrator.markProbing() for atomic
 * check-and-set to prevent two drivers from probing the same tuple in the
 * same window. In-flight probes are tracked in a private Set.
 *
 * Backoff integration: after a failed probe, calls backoff.recordRecoveryAttempt.
 * After a successful probe that transitions the tuple to RECOVERING (and only
 * when it ultimately reaches HEALTHY), calls backoff.resetRecoveryAttempts.
 */
export class RecoveryDriver {
  private intervalHandle: NodeJS.Timeout | null = null;
  private probing = new Set<TupleKey>();
  private unsubscribe: () => void;

  constructor(
    private orchestrator: ProbeOrchestrator,
    private endpointRegistry: EndpointRegistry,
    private backoff: BackoffSchedule,
    private config: ProbeConfig,
    private probeExecutor?: ProbeExecutor
  ) {
    this.unsubscribe = orchestrator.onStateChange((tuple, from, to) => {
      if (to === 'UNHEALTHY') {
        this.backoff.recordRecoveryAttempt(tuple);
      } else if (from === 'RECOVERING' && to === 'HEALTHY') {
        this.backoff.resetRecoveryAttempts(tuple);
      }
    });
  }

  /**
   * Start the 1-second tick interval.
   * Clears any existing interval before setting a new one.
   */
  start(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
    }
    this.intervalHandle = setInterval(() => {
      // Fire-and-forget: tick() handles errors internally
      this.tick();
    }, 1000);
  }

  /**
   * Stop the tick interval and clear any in-flight probe tracking.
   */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.probing.clear();
    this.unsubscribe();
  }

  /**
   * Manually trigger a tick (for tests — does not use real timers).
   *
   * On each tick:
   * - Find all UNHEALTHY or RECOVERING tuples where nextProbeAt <= now
   * - For each, call markProbing (atomic); if false, skip (already probing)
   * - If true, fire executeProbe (fire-and-forget, don't await)
   */
  tick(): void {
    const now = Date.now();
    const allStates = this.orchestrator.getAllStates();

    for (const [tupleKey, ts] of allStates) {
      if (ts.state !== 'UNHEALTHY' && ts.state !== 'RECOVERING') {
        continue;
      }
      if (ts.nextProbeAt > now) {
        continue;
      }

      if (!tupleKey || typeof tupleKey !== 'string' || !tupleKey.includes(':')) {
        continue;
      }

      let tuple: Tuple;
      try {
        tuple = this.#parseTupleKey(tupleKey);
      } catch {
        continue;
      }

      // Atomic check-and-set — returns false if already being probed by someone else
      if (!this.orchestrator.markProbing(tuple)) {
        continue;
      }

      this.probing.add(tupleKey);
      // Fire-and-forget: execute probe without awaiting
      this.executeProbe(tuple).catch(() => {
        // Error is handled inside executeProbe — nothing to do here
      });
    }
  }

  /**
   * Execute a probe against a specific tuple.
   *
   * Calls probeExecutor (or no-op stub), then records the result with the
   * orchestrator. Updates backoff on success/failure.
   *
   * @param tuple - the tuple to probe
   */
  async executeProbe(tuple: Tuple): Promise<void> {
    const key = tupleKey(tuple);
    try {
      const result = await (this.probeExecutor ?? this.#defaultProbeExecutor)(tuple);
      void this.orchestrator.recordProbeResult(tuple, result.success, result.classification);

      if (result.success) {
        this.backoff.resetRecoveryAttempts(tuple);
      } else {
        this.backoff.recordRecoveryAttempt(tuple);
      }
    } catch (err) {
      // Probe executor threw — treat as a transient failure
      void this.orchestrator.recordProbeResult(tuple, false, {
        kind: 'transient',
        retryable: true,
      });
      this.backoff.recordRecoveryAttempt(tuple);
    } finally {
      this.probing.delete(key);
    }
  }

  /**
   * Inject a custom probe executor (dependency injection for tests).
   */
  setProbeExecutor(fn: ProbeExecutor): void {
    this.probeExecutor = fn;
  }

  /**
   * Check if a tuple is currently being probed.
   */
  isProbing(tuple: Tuple): boolean {
    return this.probing.has(tupleKey(tuple));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Default no-op probe executor used when none is injected.
   * Always returns success: true (healthy endpoint).
   */
  #defaultProbeExecutor: ProbeExecutor = async () => {
    // Needed to satisfy @typescript-eslint/require-await - type requires async
    await Promise.resolve();
    return { success: true };
  };

  /**
   * Parse a TupleKey string back into its component Tuple.
   * Delegates to the public parseTupleKey which handles both | and : separators.
   * @throws Error if the key does not contain a known endpoint
   */
  #parseTupleKey(k: TupleKey): Tuple {
    return parseTupleKey(k);
  }
}
