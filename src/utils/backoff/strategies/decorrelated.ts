import type { BackoffResult, DecorrelatedOptions } from '../types.js';

const DEFAULT_MULTIPLIER = 3;

export function decorrelatedStrategy(options: DecorrelatedOptions): BackoffResult {
  const {
    baseDelayMs,
    maxDelayMs,
    multiplier = DEFAULT_MULTIPLIER,
    previousDelay = baseDelayMs,
  } = options;

  const upperBound = Math.max(baseDelayMs, previousDelay * multiplier);
  const delay = baseDelayMs + Math.random() * (upperBound - baseDelayMs);

  return {
    delayMs: Math.min(delay, maxDelayMs),
    metadata: {
      strategy: 'decorrelated',
      previousDelay,
      baseDelayMs,
      multiplier,
    },
  };
}
