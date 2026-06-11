import { describe, it, expect, vi } from 'vitest';

import {
  CircuitBreaker,
  type CircuitBreakerConfig,
} from '../../src/circuit-breaker/circuit-breaker.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('CircuitBreaker - forceClose resets all recovery state', () => {
  const defaultConfig: CircuitBreakerConfig = {
    baseFailureThreshold: 3,
    halfOpenMaxRequests: 3,
    halfOpenTimeout: 30000,
    openTimeout: 120000,
    errorRateThreshold: 0.5,
    errorWindowMs: 60000,
    maxConsecutiveFailedRecoveries: 3,
    recoverySuccessThreshold: 5,
  };

  it('should reset consecutiveFailedRecoveries via forceClose when in half-open', () => {
    const cb = new CircuitBreaker('test-fc-1', defaultConfig);

    cb.forceHalfOpen();
    cb.recordFailure(new Error('recovery fail 1'), 'transient');

    expect(cb.getStats().consecutiveFailedRecoveries).toBe(1);
    expect(cb.getStats().state).toBe('open');

    cb.forceClose();

    expect(cb.getStats().consecutiveFailedRecoveries).toBe(0);
  });

  it('should reset nextRetryAt via forceClose when in open state', () => {
    const cb = new CircuitBreaker('test-fc-2', defaultConfig);

    cb.forceOpen();
    cb.recordFailure(new Error('fail in open'), 'transient');

    const statsBefore = cb.getStats();
    expect(statsBefore.nextRetryAt).toBeGreaterThan(0);

    cb.forceClose();

    expect(cb.getStats().nextRetryAt).toBe(0);
  });

  it('should reset all failure tracking counters in forceClose', () => {
    const cb = new CircuitBreaker('test-fc-3', defaultConfig);

    cb.recordFailure(new Error('fail 1'), 'transient');
    cb.recordFailure(new Error('fail 2'), 'transient');
    cb.recordFailure(new Error('fail 3'), 'transient');

    cb.forceClose();

    const stats = cb.getStats();
    expect(stats.failureCount).toBe(0);
    expect(stats.consecutiveFailedRecoveries).toBe(0);
    expect(stats.nextRetryAt).toBe(0);
  });

  it('should be idempotent - calling forceClose twice works', () => {
    const cb = new CircuitBreaker('test-fc-4', defaultConfig);

    cb.forceOpen();
    cb.forceClose();
    cb.forceClose();

    const stats = cb.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.failureCount).toBe(0);
    expect(stats.consecutiveFailedRecoveries).toBe(0);
    expect(stats.nextRetryAt).toBe(0);
  });

  it('should reset consecutiveFailedRecoveries when calling forceClose from closed state', () => {
    const cb = new CircuitBreaker('test-fc-5', defaultConfig);

    cb.forceHalfOpen();
    cb.recordFailure(new Error('recovery fail'), 'transient');
    cb.forceClose();

    expect(cb.getStats().consecutiveFailedRecoveries).toBe(0);
    expect(cb.getStats().state).toBe('closed');
  });
});
