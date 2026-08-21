/**
 * Unified backoff calculation for recovery testing
 * Consolidates logic from circuit-breaker.ts and health-check-scheduler.ts
 *
 * `calculateRecoveryBackoff` (and its `BackoffOptions` / `BackoffResult`
 * types / `DEFAULT_RECOVERY_BACKOFF` constant) now live in `./backoff.ts`.
 * This module re-exports them for backward compatibility with existing
 * callers and tests, and retains the other helpers
 * (`calculateActiveTestTimeout`, `calculateCircuitBreakerBackoff`).
 */

import { calculateBackoff as calculateBackoffStrategy } from './backoff/calculator.js';
import type { ErrorType } from './error-classifier.js';

export {
  calculateRecoveryBackoff,
  DEFAULT_RECOVERY_BACKOFF,
  type RecoveryBackoffOptions as BackoffOptions,
  type RecoveryBackoffResult as BackoffResult,
} from './backoff.js';

/**
 * Get timeout for active test based on attempt and error
 * Used by health-check-scheduler.ts and recovery-test-coordinator.ts
 */
export function calculateActiveTestTimeout(
  attempt: number,
  baseTimeout: number = 120000,
  failureReason?: string,
  errorType?: string
): number {
  const reason = (failureReason || '').toLowerCase();

  // Quick timeouts for errors that fail immediately (non-retryable client errors)
  if (
    reason.includes('does not support generate') ||
    reason.includes('does not support chat') ||
    reason.includes('unsupported operation')
  ) {
    return 5000;
  }

  // Non-retryable or permanent errors get a fixed timeout (no point waiting longer)
  if (errorType === 'non-retryable' || errorType === 'permanent') {
    return 15000;
  }

  // For all other errors (including "unable to load model", memory issues, etc.)
  // use gentle progressive increase to allow time for model loading
  // Gentle curve: 1x → 1.5x → 2x → 2.5x → 3x (capped)
  const multiplier = Math.min(1 + 0.5 * attempt, 3);
  const maxTimeout = 5 * 60 * 1000; // 5 minutes
  return Math.min(baseTimeout * multiplier, maxTimeout);
}

/**
 * Backoff delay configuration for circuit breaker open->half-open transitions
 */
export interface CircuitBreakerBackoffConfig {
  standardDelaysMs: number[];
  permanentDelaysMs: number[];
  rateLimitBaseMs: number;
  rateLimitMultiplier: number;
  rateLimitMaxMs: number;
}

/**
 * Calculate backoff for circuit breaker open->half-open transition
 * Uses longer delays than active test backoff
 */
export function calculateCircuitBreakerBackoff(
  errorType: ErrorType,
  failureReason?: string,
  consecutiveFailures: number = 0,
  retryAfterMs?: number,
  backoffConfig?: Partial<CircuitBreakerBackoffConfig>
): number {
  const rateLimitBase = backoffConfig?.rateLimitBaseMs ?? 300000;
  const rateLimitMultiplier = backoffConfig?.rateLimitMultiplier ?? 3;
  const rateLimitMax = backoffConfig?.rateLimitMaxMs ?? 3600000;

  switch (errorType) {
    case 'permanent':
      return 24 * 60 * 60 * 1000; // 24 hours
    case 'non-retryable':
      return 48 * 60 * 60 * 1000; // 48 hours
    case 'retryable':
      return 12 * 60 * 60 * 1000; // 12 hours
    case 'rateLimited':
      // Honor Retry-After header when provided (REC-45); otherwise exponential backoff
      if (retryAfterMs !== undefined) {
        return retryAfterMs;
      }
      // Use strategy system for exponential backoff
      return calculateBackoffStrategy('exponential', {
        attempt: consecutiveFailures,
        baseDelayMs: rateLimitBase,
        maxDelayMs: rateLimitMax,
        multiplier: rateLimitMultiplier,
      }).delayMs;
    case 'transient':
    default:
      // Default 2 minutes for network/transient errors
      return 2 * 60 * 1000;
  }
}
