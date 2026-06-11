import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CircuitBreaker } from '../../src/circuit-breaker/circuit-breaker.js';

describe('CircuitBreaker - restoreState validates timestamps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should reject future halfOpenStartedAt (cap at Date.now() + 60000)', () => {
    const cb = new CircuitBreaker('srv-1:llama3');
    const futureTs = Date.now() + 120000; // 2 min in future

    cb.restoreState({
      state: 'half-open',
      halfOpenStartedAt: futureTs,
      failureCount: 5,
      successCount: 0,
      consecutiveSuccesses: 0,
    });

    // Should be capped to within 60 seconds tolerance
    expect(cb.getStats().halfOpenStartedAt).toBeLessThanOrEqual(Date.now() + 60000);
  });

  it('should reject future nextRetryAt by more than 1 hour', () => {
    const cb = new CircuitBreaker('srv-1:llama3');
    const farFutureTs = Date.now() + 2 * 60 * 60 * 1000; // 2 hours in future

    cb.restoreState({
      state: 'open',
      nextRetryAt: farFutureTs,
      failureCount: 5,
      successCount: 0,
      consecutiveSuccesses: 0,
    });

    // Should be capped to within 1 hour tolerance
    expect(cb.getStats().nextRetryAt).toBeLessThanOrEqual(Date.now() + 61 * 60 * 1000);
  });

  it('should accept reasonable past timestamps for halfOpenStartedAt', () => {
    const cb = new CircuitBreaker('srv-1:llama3');
    const pastTs = Date.now() - 60000; // 1 min ago

    cb.restoreState({
      state: 'half-open',
      halfOpenStartedAt: pastTs,
      failureCount: 5,
      successCount: 0,
      consecutiveSuccesses: 0,
    });

    expect(cb.getStats().halfOpenStartedAt).toBe(pastTs);
  });

  it('should accept reasonable past timestamps for nextRetryAt', () => {
    const cb = new CircuitBreaker('srv-1:llama3');
    const pastTs = Date.now() - 120000; // 2 min ago

    cb.restoreState({
      state: 'open',
      nextRetryAt: pastTs,
      failureCount: 5,
      successCount: 0,
      consecutiveSuccesses: 0,
    });

    expect(cb.getStats().nextRetryAt).toBe(pastTs);
  });

  it('should accept timestamp within tolerance for halfOpenStartedAt', () => {
    const cb = new CircuitBreaker('srv-1:llama3');
    const withinTolerance = Date.now() + 30000; // 30 seconds in future, within 60s tolerance

    cb.restoreState({
      state: 'half-open',
      halfOpenStartedAt: withinTolerance,
      failureCount: 5,
      successCount: 0,
      consecutiveSuccesses: 0,
    });

    expect(cb.getStats().halfOpenStartedAt).toBe(withinTolerance);
  });

  it('should accept timestamp within tolerance for nextRetryAt', () => {
    const cb = new CircuitBreaker('srv-1:llama3');
    const withinTolerance = Date.now() + 30 * 60 * 1000; // 30 min in future, within 1hr tolerance

    cb.restoreState({
      state: 'open',
      nextRetryAt: withinTolerance,
      failureCount: 5,
      successCount: 0,
      consecutiveSuccesses: 0,
    });

    expect(cb.getStats().nextRetryAt).toBe(withinTolerance);
  });

  it('should handle zero halfOpenStartedAt when entering half-open state', () => {
    const cb = new CircuitBreaker('srv-1:llama3');

    cb.restoreState({
      state: 'half-open',
      halfOpenStartedAt: 0,
      failureCount: 5,
      successCount: 0,
      consecutiveSuccesses: 0,
    });

    // Should set to current time when timestamp is 0 and state is half-open
    expect(cb.getStats().halfOpenStartedAt).toBe(Date.now());
  });

  it('should not restore halfOpenStartedAt for closed state circuits with no failures', () => {
    const cb = new CircuitBreaker('srv-1:llama3');
    const futureTs = Date.now() + 120000;

    cb.restoreState({
      state: 'closed',
      halfOpenStartedAt: futureTs,
      failureCount: 0,
      successCount: 10,
      consecutiveSuccesses: 10,
    });

    expect(cb.getStats().halfOpenStartedAt).toBe(0);
  });
});
