import type { BackoffResult, BackoffStrategyType, StrategyOptions } from './types.js';
import { exponentialStrategy } from './strategies/exponential.js';
import { decorrelatedStrategy } from './strategies/decorrelated.js';
import { fixedStrategy } from './strategies/fixed.js';

const strategies: Record<BackoffStrategyType, (opts: StrategyOptions) => BackoffResult> = {
  exponential: exponentialStrategy,
  decorrelated: decorrelatedStrategy,
  fixed: fixedStrategy,
};

export function calculateBackoff(
  strategyType: BackoffStrategyType,
  options: StrategyOptions
): BackoffResult {
  const strategy = strategies[strategyType];
  if (!strategy) {
    throw new Error(`Unknown backoff strategy: ${strategyType}`);
  }
  return strategy(options);
}

export { exponentialStrategy, decorrelatedStrategy, fixedStrategy };
export type { StrategyOptions, BackoffResult, BackoffStrategyType } from './types.js';
