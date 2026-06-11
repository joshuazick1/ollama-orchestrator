/**
 * types.ts
 * Core types for strategy-based backoff module
 *
 * Semantic separation maintained:
 * - rate-limit: jitter-based backoff for rate limit handling
 * - recovery: categorical delays for recovery testing
 * - generic: simple configurable backoff for general use
 */

/**
 * Strategy identifier types
 */
export type BackoffStrategyType = 'exponential' | 'decorrelated' | 'fixed';

/**
 * Base options for all backoff calculations
 */
export interface BackoffOptions {
  /** Current attempt number (0-indexed) */
  attempt: number;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
}

/**
 * Result from backoff calculation
 */
export interface BackoffResult {
  /** Delay in milliseconds before next retry */
  delayMs: number;
  /** Optional metadata about the calculation */
  metadata?: Record<string, unknown>;
}

/**
 * Strategy-specific options
 */
export interface ExponentialOptions extends BackoffOptions {
  /** Multiplier for exponential growth (default: 2) */
  multiplier?: number;
  /** Jitter factor 0-1 (default: 0, no jitter) */
  jitterFactor?: number;
}

export interface DecorrelatedOptions extends BackoffOptions {
  /** Previous delay for decorrelation (default: baseDelayMs) */
  previousDelay?: number;
  /** Multiplier for decorrelation (default: 3) */
  multiplier?: number;
}

export interface FixedOptions extends BackoffOptions {
  /** Custom delay sequence (overrides calculated delays) */
  delaysMs?: number[];
}

/**
 * Strategy options union
 */
export type StrategyOptions = ExponentialOptions | DecorrelatedOptions | FixedOptions;

/**
 * Strategy interface for backoff calculations
 */
export interface BackoffStrategy {
  /** Strategy identifier */
  readonly type: BackoffStrategyType;
  /** Calculate backoff delay */
  calculate(options: StrategyOptions): BackoffResult;
}

/**
 * Strategy factory type
 */
export type StrategyFactory = (options: StrategyOptions) => BackoffResult;
