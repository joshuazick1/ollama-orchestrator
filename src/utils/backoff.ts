/**
 * backoff.ts
 *
 * Canonical schedule-array backoff with exponential doubling and cap.
 *
 * Replaces the three near-duplicate implementations that previously lived in:
 *   - src/probe/probe-orchestrator.ts `_getRecoveryBackoff` (lines 620-631)
 *   - src/probe/recovery-driver.ts `BackoffSchedule.#getDelay` (lines 106-124)
 *   - src/utils/recovery-backoff.ts `calculateRecoveryBackoff` (lines 73-108)
 *
 * This file owns the canonical `calculateBackoff` (delay calculation) and the
 * higher-level `calculateRecoveryBackoff` wrapper (error-category dispatch +
 * `shouldStop` semantics). `recovery-backoff.ts` re-exports
 * `calculateRecoveryBackoff` for backward compatibility with existing callers
 * and tests; new code should import directly from `./backoff.js`.
 *
 * Algorithm (canonical `calculateBackoff`):
 *   1. If a `schedule` array is provided and the current `attempt` falls inside it,
 *      return `schedule[attempt]` clamped by `maxDelayMs`. This preserves the
 *      existing per-tuple schedule semantics for the probe subsystem
 *      (`config.recoveryBackoffMs`) and the per-category schedules used by
 *      `calculateRecoveryBackoff`.
 *   2. Once `attempt` exceeds the schedule length, double the last schedule value
 *      once per extra attempt, capped at `maxDelayMs`.
 *   3. When no `schedule` is provided, fall back to pure exponential growth from
 *      `baseDelayMs` with the given `multiplier`, capped at `maxDelayMs`.
 *
 * Defaults:
 *   - maxDelayMs  : 3,600,000 (1 hour) — per Metis+Oracle alignment.
 *   - baseDelayMs : 30,000    (30 seconds) — preserves the first value of the
 *     standard `[30s, 60s, 120s, 240s, 480s, 900s, 1800s, 1800s]` schedule that
 *     `calculateRecoveryBackoff` advertises at attempt 0.
 *   - multiplier  : 2 — standard exponential doubling, identical to the existing
 *     `_getRecoveryBackoff` and `#getDelay` algorithms.
 */

import type { ErrorType } from './error-classifier.js';

/** Default per-category recovery backoff schedule, mirroring the previous
 *  `DEFAULT_RECOVERY_BACKOFF` in `recovery-backoff.ts`. */
export const DEFAULT_RECOVERY_BACKOFF = {
  modelCapability: [30000, 30000],
  modelFile: [60000, 300000, 600000],
  permanent: [300000, 600000, 1200000, 2400000, 3600000],
  standard: [30000, 60000, 120000, 240000, 480000, 900000, 1800000, 1800000],
} as const;

export interface CalculateBackoffOptions {
  /** Current attempt number (0-indexed; 0 = first attempt). */
  attempt: number;
  /**
   * Optional explicit schedule. When provided, `schedule[attempt]` is used while
   * `attempt` is within the array; once `attempt` exceeds the length, the last
   * value is doubled once per extra attempt, capped at `maxDelayMs`.
   */
  schedule?: readonly number[];
  /** Maximum delay cap in milliseconds. Default: 3,600,000 (1 hour). */
  maxDelayMs?: number;
  /** Base delay in milliseconds (used when `schedule` is not provided). Default: 30,000. */
  baseDelayMs?: number;
  /** Multiplier for exponential growth (used when `schedule` is not provided). Default: 2. */
  multiplier?: number;
}

export interface CalculateBackoffResult {
  /** Delay in milliseconds before the next attempt. */
  delayMs: number;
}

const DEFAULT_MAX_DELAY_MS = 3_600_000; // 1 hour
const DEFAULT_BASE_DELAY_MS = 30_000; // 30 seconds
const DEFAULT_MULTIPLIER = 2;

export function calculateBackoff(options: CalculateBackoffOptions): CalculateBackoffResult {
  const { attempt, schedule } = options;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  if (schedule && schedule.length > 0) {
    if (attempt < schedule.length) {
      return { delayMs: Math.min(schedule[attempt], maxDelayMs) };
    }
    let delay = schedule[schedule.length - 1];
    const doublings = attempt - (schedule.length - 1);
    for (let i = 0; i < doublings; i++) {
      delay = Math.min(maxDelayMs, delay * 2);
    }
    return { delayMs: delay };
  }

  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const multiplier = options.multiplier ?? DEFAULT_MULTIPLIER;
  const delay = baseDelayMs * Math.pow(multiplier, attempt);
  return { delayMs: Math.min(delay, maxDelayMs) };
}

export interface RecoveryBackoffOptions {
  attempt: number;
  errorType?: ErrorType;
  failureReason?: string;
  baseDelay?: number;
  maxDelay?: number;
  recoveryBackoff?: typeof DEFAULT_RECOVERY_BACKOFF;
}

export interface RecoveryBackoffResult {
  /** Delay in ms before next attempt */
  delayMs: number;
  /** Whether to stop testing entirely */
  shouldStop: boolean;
  /** Reason for stopping (if shouldStop is true) */
  stopReason?: string;
}

type RecoveryCategory = 'model_capability' | 'model_file' | 'permanent' | 'standard';

function categorizeError(options: RecoveryBackoffOptions): {
  category: RecoveryCategory;
  priority: number;
} {
  const reason = options.failureReason?.toLowerCase() || '';
  const errorType = options.errorType;

  if (
    reason.includes('does not support generate') ||
    reason.includes('does not support chat') ||
    reason.includes('unsupported operation')
  ) {
    return { category: 'model_capability', priority: 1 };
  }

  if (
    reason.includes('unable to load model') ||
    reason.includes('invalid file magic') ||
    reason.includes('unsupported model format') ||
    reason.includes('model file not found') ||
    (reason.includes('blob') && reason.includes('sha256'))
  ) {
    return { category: 'model_file', priority: 2 };
  }

  if (errorType === 'non-retryable' || errorType === 'permanent') {
    return { category: 'permanent', priority: 3 };
  }

  return { category: 'standard', priority: 4 };
}

/**
 * Calculate unified recovery backoff delay.
 *
 * Thin wrapper over the canonical schedule-array backoff above. Adds two
 * pieces of higher-level semantics that the canonical function does not own:
 *
 *   1. Error-category → schedule mapping (model_capability / model_file /
 *      permanent / standard). The schedule is selected by `categorizeError`
 *      and passed to `calculateBackoff` via the `schedule` option.
 *   2. `shouldStop` / `stopReason` once `attempt` exceeds the category's schedule
 *      length. This is the higher-level "stop retrying" signal; the canonical
 *      function only returns a delay.
 *
 * Re-exported from `recovery-backoff.ts` for backward compatibility with
 * existing callers and tests.
 */
export function calculateRecoveryBackoff(options: RecoveryBackoffOptions): RecoveryBackoffResult {
  const { attempt, maxDelay = 1_800_000, recoveryBackoff } = options;

  const category = categorizeError(options);

  const config = recoveryBackoff ?? DEFAULT_RECOVERY_BACKOFF;

  const delays: Record<RecoveryCategory, readonly number[]> = {
    model_capability: config.modelCapability,
    model_file: config.modelFile,
    permanent: config.permanent,
    standard: config.standard,
  };

  const categoryDelays = delays[category.category] || delays.standard;

  const maxAttempts = categoryDelays.length;
  if (attempt >= maxAttempts) {
    return {
      delayMs: 0,
      shouldStop: true,
      stopReason: `Max attempts (${maxAttempts}) reached for ${category.category} errors`,
    };
  }

  const { delayMs } = calculateBackoff({
    attempt,
    schedule: categoryDelays,
    maxDelayMs: maxDelay,
  });

  return {
    delayMs,
    shouldStop: false,
  };
}
