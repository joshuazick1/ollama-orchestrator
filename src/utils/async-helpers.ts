/**
 * async-helpers.ts
 * Async utility helpers for delays, timeouts, and concurrency
 */

import { featureFlags } from '../config/feature-flags.js';

/**
 * Sleep for specified milliseconds
 * Replaces scattered Promise/setTimeout patterns
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute promise with timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms)),
  ]);
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    multiplier?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000, maxDelay = 30000, multiplier = 2, onRetry } = options;

  let lastError: Error = new Error('All retries failed');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        onRetry?.(attempt, lastError);
        const delay = Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Throttle function calls
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let lastTime = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastTime >= ms) {
      lastTime = now;
      fn(...args);
    }
  };
}

/**
 * Sleep with feature flag support
 */
export function sleepWithFlag(ms: number): Promise<void> {
  if (!featureFlags.get('useAsyncHelpers')) {
    return sleep(ms);
  }
  return sleep(ms);
}
