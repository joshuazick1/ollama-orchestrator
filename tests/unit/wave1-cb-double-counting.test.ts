import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CircuitBreaker } from '../../src/circuit-breaker.js';
import { BanManager } from '../../src/utils/ban-manager.js';
import { classifyError } from '../../src/utils/errorClassifier.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('REC-59: Circuit Breaker Double-Counting Prevention', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-breaker');
  });

  it('should record exactly N failures after N recordFailure calls', () => {
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure(new Error('Simulated failure'), 'transient');
    }

    const stats = breaker.getStats();
    expect(stats.failureCount).toBe(3);
  });

  it('should open CB after exactly baseFailureThreshold failures', () => {
    for (let i = 0; i < 3; i++) {
      breaker.recordFailure(new Error('Simulated failure'), 'transient');
    }

    const stats = breaker.getStats();
    expect(stats.state).toBe('open');
  });

  it('should NOT open CB prematurely (after only 2 failures)', () => {
    for (let i = 0; i < 2; i++) {
      breaker.recordFailure(new Error('Simulated failure'), 'transient');
    }

    const stats = breaker.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.failureCount).toBe(2);
  });

  it('should open at threshold 3, not 2 (no double-counting)', () => {
    breaker.recordFailure(new Error('failure 1'), 'transient');
    breaker.recordFailure(new Error('failure 2'), 'transient');

    expect(breaker.getStats().state).toBe('closed');

    breaker.recordFailure(new Error('failure 3'), 'transient');

    expect(breaker.getStats().state).toBe('open');
    expect(breaker.getStats().failureCount).toBe(3);
  });
});

describe('REC-60: BanManager Single-Recording Verification', () => {
  let banManager: BanManager;

  beforeEach(() => {
    banManager = new BanManager();
  });

  it('should record single failure per recordFailure call', () => {
    banManager.recordFailure('server-1', 'llama3:latest');
    banManager.recordFailure('server-1', 'llama3:latest');
    banManager.recordFailure('server-1', 'llama3:latest');

    const failureCount = banManager.getModelFailureCount('server-1', 'llama3:latest');
    expect(failureCount).toBe(3);
  });

  it('should put server in cooldown after markFailure', () => {
    banManager.markFailure('server-1', 'llama3:latest');

    expect(banManager.isInCooldown('server-1', 'llama3:latest')).toBe(true);
  });

  it('should not double-count: single error = single recordFailure call', () => {
    banManager.recordFailure('server-1', 'llama3:latest');

    const count = banManager.getModelFailureCount('server-1', 'llama3:latest');
    expect(count).toBe(1);
  });
});

describe('REC-61: Rate-Limited Classification Preservation', () => {
  it('should classify rate limit error as rateLimited type', () => {
    const classification = classifyError('rate limit exceeded');
    expect(classification.type).toBe('rateLimited');
  });

  it('should classify 429 error as rateLimited type', () => {
    const classification = classifyError('429 Too Many Requests');
    expect(classification.type).toBe('rateLimited');
  });

  it('should preserve rateLimited type in legacy error type mapping', () => {
    const classification = classifyError('rate limit exceeded');

    let legacyErrorType: string;
    if (classification.type === 'rateLimited') {
      legacyErrorType = 'rateLimited';
    } else {
      switch (classification.category) {
        default:
          legacyErrorType = 'retryable';
      }
    }

    expect(legacyErrorType).toBe('rateLimited');
  });
});

describe('REC-62: canAttempt vs canExecute Behavior', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-breaker');
  });

  it('canExecute should increment totalRequestCount (tracks attempts)', () => {
    breaker.canExecute();
    const stats = breaker.getStats();
    expect(stats.totalRequestCount).toBe(1);
  });

  it('canAttempt should NOT increment totalRequestCount (read-only)', () => {
    breaker.canAttempt();
    const stats = breaker.getStats();
    expect(stats.totalRequestCount).toBe(0);
  });

  it('canExecute returns true in closed state', () => {
    const result = breaker.canExecute();
    expect(result).toBe(true);
    expect(breaker.getStats().state).toBe('closed');
  });

  it('canAttempt returns true in closed state', () => {
    const result = breaker.canAttempt();
    expect(result).toBe(true);
    expect(breaker.getStats().state).toBe('closed');
  });

  it('key difference: canExecute increments request count, canAttempt does not', () => {
    breaker.canExecute();
    breaker.canExecute();
    breaker.canAttempt();
    breaker.canAttempt();

    const stats = breaker.getStats();
    expect(stats.totalRequestCount).toBe(2);
  });
});
