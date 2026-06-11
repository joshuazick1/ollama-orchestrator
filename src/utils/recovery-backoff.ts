/**
 * Unified backoff calculation for recovery testing
 * Consolidates logic from circuit-breaker.ts and health-check-scheduler.ts
 */

import { calculateBackoff } from './backoff/calculator.js';
import type { ErrorType } from './error-classifier.js';

export const DEFAULT_RECOVERY_BACKOFF = {
  modelCapability: [30000, 30000],
  modelFile: [60000, 300000, 600000],
  permanent: [300000, 600000, 1200000, 2400000, 3600000],
  standard: [30000, 60000, 120000, 240000, 480000, 900000, 1800000, 1800000],
};

export interface BackoffOptions {
  attempt: number;
  errorType?: ErrorType;
  failureReason?: string;
  baseDelay?: number;
  maxDelay?: number;
  recoveryBackoff?: typeof DEFAULT_RECOVERY_BACKOFF;
}

export interface BackoffResult {
  /** Delay in ms before next attempt */
  delayMs: number;
  /** Whether to stop testing entirely */
  shouldStop: boolean;
  /** Reason for stopping (if shouldStop is true) */
  stopReason?: string;
}

function categorizeError(options: BackoffOptions): {
  category: 'model_capability' | 'model_file' | 'permanent' | 'standard';
  priority: number;
} {
  const reason = options.failureReason?.toLowerCase() || '';
  const errorType = options.errorType;

  // Model capability errors - will never succeed
  if (
    reason.includes('does not support generate') ||
    reason.includes('does not support chat') ||
    reason.includes('unsupported operation')
  ) {
    return { category: 'model_capability', priority: 1 };
  }

  // Model file errors - need manual intervention
  if (
    reason.includes('unable to load model') ||
    reason.includes('invalid file magic') ||
    reason.includes('unsupported model format') ||
    reason.includes('model file not found') ||
    (reason.includes('blob') && reason.includes('sha256'))
  ) {
    return { category: 'model_file', priority: 2 };
  }

  // Permanent errors
  if (errorType === 'non-retryable' || errorType === 'permanent') {
    return { category: 'permanent', priority: 3 };
  }

  return { category: 'standard', priority: 4 };
}

/**
 * Calculate unified backoff delay
 * Consolidates backoff logic from circuit-breaker.ts and health-check-scheduler.ts
 */
export function calculateRecoveryBackoff(options: BackoffOptions): BackoffResult {
  const { attempt, maxDelay = 1800000, recoveryBackoff } = options;

  const category = categorizeError(options);

  const config = recoveryBackoff ?? DEFAULT_RECOVERY_BACKOFF;

  const delays: Record<string, number[]> = {
    model_capability: config.modelCapability,
    model_file: config.modelFile,
    permanent: config.permanent,
    standard: config.standard,
  };

  const categoryDelays = delays[category.category] || delays.standard;

  // Check if we should stop
  const maxAttempts = categoryDelays.length;
  if (attempt >= maxAttempts) {
    return {
      delayMs: 0,
      shouldStop: true,
      stopReason: `Max attempts (${maxAttempts}) reached for ${category.category} errors`,
    };
  }

  const delayMs = Math.min(
    categoryDelays[attempt] || categoryDelays[categoryDelays.length - 1],
    maxDelay
  );

  return {
    delayMs,
    shouldStop: false,
  };
}

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
      return calculateBackoff('exponential', {
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
