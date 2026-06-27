/**
 * rate-limit-backoff.ts
 * Per-provider rate limit backoff calculation
 *
 * Implements provider-specific backoff strategies:
 * - OpenAI/Anthropic: Use Retry-After header if present and enabled, else exponential backoff
 * - Ollama: Simple exponential backoff (no Retry-After support)
 */

import type { RateLimitConfig } from '../config/schema.js';

import { calculateBackoff } from './backoff/calculator.js';
import { parseRetryAfter } from './retry-after.js';

export type ProviderType = 'openai' | 'anthropic' | 'ollama';

const DEFAULT_BACKOFF_MULTIPLIER = 2;

/**
 * Calculate delay in milliseconds for rate limit backoff
 *
 * @param provider - Provider type ('openai' | 'anthropic' | 'ollama')
 * @param retryAfterHeader - The Retry-After header value (may be undefined)
 * @param config - Rate limit configuration
 * @param attempt - Current attempt number (0-indexed), used for exponential backoff calculation
 * @returns Delay in milliseconds before the next retry
 */
export function calculateRateLimitBackoff(
  provider: ProviderType,
  retryAfterHeader: string | undefined,
  config: RateLimitConfig,
  attempt: number = 0
): number {
  if (provider === 'ollama') {
    if (retryAfterHeader) {
      const parsedDelay = parseRetryAfter(retryAfterHeader);
      if (parsedDelay !== null) {
        return Math.min(parsedDelay, config.maxRetryAfterMs);
      }
    }
    return calculateExponentialBackoff(
      attempt,
      config.defaultRetryAfterMs,
      config.maxRetryAfterMs,
      config.jitterFactor
    );
  }

  // OpenAI and Anthropic: Check for Retry-After header
  if (provider === 'openai' || provider === 'anthropic') {
    if (config.enableRetryAfterHeader && retryAfterHeader) {
      const parsedDelay = parseRetryAfter(retryAfterHeader);
      if (parsedDelay !== null) {
        // Honor the Retry-After header value, but cap at maxRetryAfterMs
        return Math.min(parsedDelay, config.maxRetryAfterMs);
      }
    }
  }

  // Fall back to exponential backoff
  return calculateExponentialBackoff(
    attempt,
    config.defaultRetryAfterMs,
    config.maxRetryAfterMs,
    config.jitterFactor
  );
}

/**
 * Calculate exponential backoff delay with optional jitter
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap in milliseconds
 * @param jitterFactor - Jitter factor (0-1, default 0.25 = ±25% randomization)
 * @returns Delay in milliseconds
 */
export function calculateExponentialBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number = 0.25
): number {
  const result = calculateBackoff('exponential', {
    attempt,
    baseDelayMs,
    maxDelayMs,
    multiplier: DEFAULT_BACKOFF_MULTIPLIER,
    jitterFactor,
  });
  return result.delayMs;
}
