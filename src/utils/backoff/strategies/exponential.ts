import type { BackoffResult, ExponentialOptions } from '../types.js';

const DEFAULT_MULTIPLIER = 2;

export function exponentialStrategy(options: ExponentialOptions): BackoffResult {
  const {
    attempt,
    baseDelayMs,
    maxDelayMs,
    multiplier = DEFAULT_MULTIPLIER,
    jitterFactor = 0,
  } = options;

  const delay = baseDelayMs * Math.pow(multiplier, attempt);

  let finalDelay = delay;
  if (jitterFactor > 0) {
    const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
    finalDelay = delay + jitter;
  }

  return {
    delayMs: Math.min(finalDelay, maxDelayMs),
    metadata: { strategy: 'exponential', attempt, baseDelayMs, multiplier, jitterFactor },
  };
}
