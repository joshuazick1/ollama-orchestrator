/**
 * Unified backoff calculation for recovery testing
 * Consolidates logic from circuit-breaker.ts and health-check-scheduler.ts
 */

export type ErrorType = 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited';

export interface BackoffOptions {
  /** Current attempt number (0-indexed) */
  attempt: number;
  /** Error type for determining backoff strategy */
  errorType?: ErrorType;
  /** Failure reason for specific handling */
  failureReason?: string;
  /** Base delay in ms (default: 30000) */
  baseDelay?: number;
  /** Maximum delay in ms (default: 1800000 = 30min) */
  maxDelay?: number;
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
  const { attempt, maxDelay = 1800000 } = options;

  const category = categorizeError(options);

  // Define delays per category
  const delays: Record<string, number[]> = {
    model_capability: [30000, 30000], // 2 attempts, then stop
    model_file: [60000, 300000, 600000], // 3 attempts
    permanent: [300000, 600000, 1200000, 2400000, 3600000], // 5 attempts, up to 1h
    standard: [
      30000, // 30s
      60000, // 1m
      120000, // 2m
      240000, // 4m
      480000, // 8m
      900000, // 15m
      1800000, // 30m
      1800000, // 30m (max)
    ],
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
  baseTimeout: number = 60000,
  failureReason?: string,
  errorType?: string
): number {
  const reason = (failureReason || '').toLowerCase();

  // Quick timeouts for errors that fail immediately
  if (
    reason.includes('does not support generate') ||
    reason.includes('does not support chat') ||
    reason.includes('unsupported operation')
  ) {
    return 5000;
  }

  if (
    reason.includes('unable to load model') ||
    reason.includes('invalid file magic') ||
    reason.includes('unsupported model format')
  ) {
    return 10000;
  }

  if (errorType === 'non-retryable' || errorType === 'permanent') {
    return 15000;
  }

  if (reason.includes('memory') || reason.includes('oom')) {
    return 10000;
  }

  // Progressive timeout doubling
  const multiplier = Math.pow(2, Math.min(attempt, 10));
  const maxTimeout = 15 * 60 * 1000; // 15 minutes
  return Math.min(baseTimeout * multiplier, maxTimeout);
}

/**
 * Calculate backoff for circuit breaker open->half-open transition
 * Uses longer delays than active test backoff
 */
export function calculateCircuitBreakerBackoff(
  errorType: ErrorType,
  failureReason?: string,
  consecutiveFailures: number = 0
): number {
  switch (errorType) {
    case 'permanent':
      return 24 * 60 * 60 * 1000; // 24 hours
    case 'non-retryable':
      return 48 * 60 * 60 * 1000; // 48 hours
    case 'retryable':
      return 12 * 60 * 60 * 1000; // 12 hours
    case 'rateLimited':
      // Exponential backoff for rate limits: 5min, 15min, 45min, 60min
      return Math.min(300000 * Math.pow(3, consecutiveFailures), 3600000);
    case 'transient':
    default:
      // Default 2 minutes for network/transient errors
      return 2 * 60 * 1000;
  }
}
