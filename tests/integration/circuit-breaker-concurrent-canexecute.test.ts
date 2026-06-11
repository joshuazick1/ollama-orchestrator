import { describe, it, expect } from 'vitest';

import { CircuitBreaker } from '../../src/circuit-breaker/circuit-breaker.js';

describe('CircuitBreaker - concurrent canExecute OPEN→HALF-OPEN', () => {
  it('should only allow ONE transition when called 100 times concurrently', async () => {
    const cb = new CircuitBreaker('srv-1:test-model');

    cb.forceOpen();
    expect(cb.getState()).toBe('open');
    (cb as any).nextRetryAt = Date.now() - 1000;

    const results = await Promise.all(Array.from({ length: 100 }, () => cb.canExecute()));

    const trueCount = results.filter(r => r === true).length;
    expect(trueCount).toBe(1);
    expect(cb.getState()).toBe('half-open');
  });

  it('should serialize transitions using withStateLock', async () => {
    const cb = new CircuitBreaker('srv-1:test-model');

    cb.forceOpen();
    expect(cb.getState()).toBe('open');
    (cb as any).nextRetryAt = Date.now() - 1000;

    const results = await Promise.all(Array.from({ length: 50 }, () => cb.canExecute()));

    const trueCount = results.filter(r => r === true).length;
    expect(trueCount).toBe(1);

    const stats = cb.getStats();
    expect(stats.halfOpenAttempts).toBe(1);
    expect(cb.getState()).toBe('half-open');
  });
});
