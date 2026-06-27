import type { BackoffResult, FixedOptions } from '../types.js';

export function fixedStrategy(options: FixedOptions): BackoffResult {
  const { attempt, baseDelayMs, maxDelayMs, delaysMs } = options;

  if (delaysMs && delaysMs.length > 0) {
    const index = Math.min(attempt, delaysMs.length - 1);
    return {
      delayMs: Math.min(delaysMs[index], maxDelayMs),
      metadata: { strategy: 'fixed', attempt, delaysMs },
    };
  }

  return {
    delayMs: Math.min(baseDelayMs, maxDelayMs),
    metadata: { strategy: 'fixed', attempt, baseDelayMs },
  };
}
