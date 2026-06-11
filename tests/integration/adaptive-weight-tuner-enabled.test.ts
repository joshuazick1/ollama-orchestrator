import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { DecisionHistory } from '../../src/decision-history.js';
import {
  getAdaptiveWeightTuner,
  resetAdaptiveWeightTuner,
} from '../../src/load-balancer/adaptive-weight-tuner.js';
import type { LoadBalancer } from '../../src/load-balancer/load-balancer.js';

describe('AdaptiveWeightTuner - enabled by default', () => {
  const mockDecisionHistory = {
    getRecentEvents: vi.fn().mockReturnValue([]),
    getRecentFailoverAttempts: vi.fn().mockReturnValue([]),
    addDecision: vi.fn(),
    addFailoverAttempt: vi.fn(),
  } as unknown as DecisionHistory;

  const mockLoadBalancer = {
    selectServer: vi.fn(),
    updateConfig: vi.fn(),
    getScore: vi.fn(),
    recordLatency: vi.fn(),
    recordFailure: vi.fn(),
    recordSuccess: vi.fn(),
    getConfig: vi.fn(),
  } as unknown as LoadBalancer;

  beforeEach(() => {
    resetAdaptiveWeightTuner();
  });

  it('should be enabled by default', () => {
    const tuner = getAdaptiveWeightTuner(
      {},
      () => mockDecisionHistory,
      () => mockLoadBalancer
    );
    expect(tuner.isEnabled()).toBe(true);
  });

  it('should respect enabled=false override', () => {
    const tuner = getAdaptiveWeightTuner(
      { enabled: false },
      () => mockDecisionHistory,
      () => mockLoadBalancer
    );
    expect(tuner.isEnabled()).toBe(false);
  });

  it('should respect enabled=true override', () => {
    const tuner = getAdaptiveWeightTuner(
      { enabled: true },
      () => mockDecisionHistory,
      () => mockLoadBalancer
    );
    expect(tuner.isEnabled()).toBe(true);
  });
});
