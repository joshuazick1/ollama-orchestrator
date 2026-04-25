import type { BackoffResult, DecorrelatedOptions } from '../types.js';

const DEFAULT_MULTIPLIER = 3;

export function decorrelatedStrategy(options: DecorrelatedOptions): BackoffResult {
  const {
    attempt,
    baseDelayMs,
    maxDelayMs,
    multiplier = DEFAULT_MULTIPLIER,
    jitterFactor = 0,
  } = options;

  const previousDelay =
    attempt === 0 ? baseDelayMs : baseDelayMs * Math.pow(multiplier, attempt - 1);
  const delay = baseDelayMs * multiplier * (1 + Math.random());

  let finalDelay = delay;
  if (jitterFactor > 0) {
    const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
    finalDelay = delay + jitter;
  }

  return {
    delayMs: Math.min(finalDelay, maxDelayMs),
    metadata: {
      strategy: 'decorrelated',
      attempt,
      baseDelayMs,
      multiplier,
      previousDelay,
      jitterFactor,
    },
  };
}
