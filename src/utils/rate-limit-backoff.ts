/**
 * rate-limit-backoff.ts
 * Per-provider rate limit backoff calculation
 *
 * Implements provider-specific backoff strategies:
 * - OpenAI/Anthropic: Use Retry-After header if present and enabled, else exponential backoff
 * - Ollama: Simple exponential backoff (no Retry-After support)
 */

import { parseRetryAfter } from './retry-after.js';
import type { RateLimitConfig } from '../config/schema.js';

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
  // Ollama doesn't support Retry-After header - always use exponential backoff
  if (provider === 'ollama') {
    return calculateExponentialBackoff(attempt, config.defaultRetryAfterMs, config.maxRetryAfterMs);
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
  return calculateExponentialBackoff(attempt, config.defaultRetryAfterMs, config.maxRetryAfterMs);
}

/**
 * Calculate exponential backoff delay
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap in milliseconds
 * @returns Delay in milliseconds
 */
export function calculateExponentialBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const delay = baseDelayMs * Math.pow(DEFAULT_BACKOFF_MULTIPLIER, attempt);
  return Math.min(delay, maxDelayMs);
}