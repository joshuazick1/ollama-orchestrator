/**
 * probe/recovery-driver.ts
 *
 * RecoveryDriver subsystem for the probe state machine.
 *
 * Task 10: BackoffSchedule — per-tuple exponential backoff for recovery probes.
 * Task 11: RecoveryDriver — probe scheduling + execution (separate task).
 *
 * ## Backoff Algorithm
 *
 * The backoff schedule determines when to run the next recovery probe after a
 * tuple transitions to UNHEALTHY (or after a failed recovery probe attempt).
 *
 * - recoveryAttempts 0–4: use `config.recoveryBackoffMs[recoveryAttempts]` directly
 * - recoveryAttempts 5+: exponential doubling, capped at 1 hour (3,600,000 ms)
 *   - attempt 5: max(1_800_000, recoveryBackoffMs[4] * 2) = 1_800_000 ms (30 min)
 *   - attempt 6: max(3_600_000, 1_800_000 * 2) = 3_600_000 ms (1 h, capped)
 *   - attempt 7+: 3_600_000 ms (remains capped)
 *
 * The schedule is fully deterministic (no jitter). Per-tuple state is held in
 * an in-memory Map and is NOT persisted — it is recovered from the WAL by the
 * ProbeOrchestrator on startup.
 */

import type { ProbeConfig, Tuple, TupleKey } from './types.js';
import { tupleKey } from './types.js';

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
    const delay = this.#getDelay(recoveryAttempts);
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
   * - Attempts 0–4: indexed lookup from config.recoveryBackoffMs
   * - Attempts 5+: exponential doubling from the last config value, capped at 1 hour
   */
  #getDelay(recoveryAttempts: number): number {
    const schedule = this.config.recoveryBackoffMs;

    // Attempts 0–4: use the config schedule directly
    if (recoveryAttempts < schedule.length) {
      return schedule[recoveryAttempts]!;
    }

    // Attempts 5+: exponential doubling, capped at 1 hour
    // Start from the last schedule value and double once for each attempt beyond the last slot.
    // e.g. schedule.length=5, recoveryAttempts=5 → 1 doubling (5-4=1); 6 → 2 doublings (6-4=2)
    let delay = schedule[schedule.length - 1]!;
    const doublings = recoveryAttempts - (schedule.length - 1);
    for (let i = 0; i < doublings; i++) {
      delay = Math.min(ONE_HOUR_MS, delay * 2);
    }

    return delay;
  }
}
