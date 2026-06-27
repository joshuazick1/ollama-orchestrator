import type { RetryConfig, RateLimitConfig } from '../../config/schema.js';

import type { BackoffStrategyType, StrategyOptions } from './types.js';

export interface RetryConfigAdapter {
  strategyType: BackoffStrategyType;
  options: StrategyOptions;
}

export function fromRetryConfig(config: RetryConfig): RetryConfigAdapter {
  return {
    strategyType: 'exponential',
    options: {
      attempt: 0,
      baseDelayMs: config.retryDelayMs,
      maxDelayMs: config.maxRetryDelayMs,
      multiplier: config.backoffMultiplier,
      jitterFactor: config.jitterFactor,
    },
  };
}

export function fromRateLimitConfig(config: RateLimitConfig): RetryConfigAdapter {
  return {
    strategyType: 'exponential',
    options: {
      attempt: 0,
      baseDelayMs: config.defaultRetryAfterMs,
      maxDelayMs: config.maxRetryAfterMs,
      jitterFactor: config.jitterFactor,
    },
  };
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  multiplier: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export function createRetryOptions(
  config: RetryConfig,
  options?: Partial<RetryOptions>
): RetryOptions {
  return {
    maxAttempts: config.maxRetriesPerServer + 1,
    baseDelay: config.retryDelayMs,
    maxDelay: config.maxRetryDelayMs,
    multiplier: config.backoffMultiplier,
    ...options,
  };
}
