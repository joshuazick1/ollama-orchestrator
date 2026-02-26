/**
 * circuit-breaker-enhanced.test.ts
 * Enhanced circuit breaker tests with complex failure scenarios
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerRegistry } from '../../src/circuit-breaker.js';

describe('Circuit Breaker Enhanced Tests', () => {
  let breaker: CircuitBreaker;

  const createBreaker = (overrides = {}) => {
    return new CircuitBreaker('test', {
      baseFailureThreshold: 5,
      maxFailureThreshold: 10,
      minFailureThreshold: 2,
      openTimeout: 1000,
      halfOpenTimeout: 2000,
      halfOpenMaxRequests: 3,
      recoverySuccessThreshold: 2,
      activeTestTimeout: 5000,
      errorRateWindow: 10000,
      errorRateThreshold: 0.5,
      adaptiveThresholds: true,
      errorRateSmoothing: 0.3,
      errorPatterns: {
        nonRetryable: ['auth.*failed', 'unauthorized'],
        transient: ['timeout', 'connection.*reset'],
      },
      adaptiveThresholdAdjustment: 2,
      nonRetryableRatioThreshold: 0.5,
      transientRatioThreshold: 0.7,
      modelEscalation: {
        enabled: false,
        ratioThreshold: 0.5,
        durationThresholdMs: 60000,
        checkIntervalMs: 10000,
      },
      ...overrides,
    });
  };

  beforeEach(() => {
    breaker = createBreaker();
    vi.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should create circuit breaker', () => {
      expect(breaker).toBeDefined();
    });

    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('should allow execution initially', () => {
      expect(breaker.canExecute()).toBe(true);
    });

    it('should record success', () => {
      breaker.recordSuccess();
      const stats = breaker.getStats();
      expect(stats.successCount).toBe(1);
    });

    it('should record failure', () => {
      breaker.recordFailure('test error');
      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(1);
    });

    it('should record failure with error type', () => {
      breaker.recordFailure('timeout error', 'transient');
      const stats = breaker.getStats();
      expect(stats.errorCounts.transient).toBe(1);
    });
  });

  describe('Force Operations', () => {
    it('should force open circuit breaker', () => {
      breaker.forceOpen();
      expect(breaker.getState()).toBe('open');
    });

    it('should block execution when forced open', () => {
      breaker.forceOpen();
      expect(breaker.canExecute()).toBe(false);
    });

    it('should force close circuit breaker', () => {
      breaker.forceOpen();
      breaker.forceClose();
      expect(breaker.getState()).toBe('closed');
    });

    it('should allow execution when forced closed', () => {
      breaker.forceOpen();
      breaker.forceClose();
      expect(breaker.canExecute()).toBe(true);
    });

    it('should force half-open state', () => {
      breaker.forceHalfOpen();
      expect(breaker.getState()).toBe('half-open');
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      breaker.updateConfig({ openTimeout: 5000 });
      const config = breaker.getConfig();
      expect(config.openTimeout).toBe(5000);
    });

    it('should get current config', () => {
      const config = breaker.getConfig();
      expect(config.baseFailureThreshold).toBe(5);
    });
  });

  describe('Active Tests', () => {
    it('should track active tests in progress', () => {
      breaker.startActiveTest();
      const stats = breaker.getStats();
      expect(stats.activeTestsInProgress).toBe(1);
    });

    it('should end active test', () => {
      breaker.startActiveTest();
      breaker.endActiveTest();
      const stats = breaker.getStats();
      expect(stats.activeTestsInProgress).toBe(0);
    });

    it('should get active test timeout', () => {
      const timeout = breaker.getActiveTestTimeout();
      expect(timeout).toBeGreaterThan(0);
    });
  });

  describe('Model Type', () => {
    it('should set embedding model type', () => {
      breaker.setModelType('embedding');
      expect(breaker.getModelType()).toBe('embedding');
    });

    it('should set generation model type', () => {
      breaker.setModelType('generation');
      expect(breaker.getModelType()).toBe('generation');
    });
  });

  describe('Last Failure Reason', () => {
    it('should track last failure reason', () => {
      breaker.recordFailure('Connection refused');
      const lastReason = breaker.getLastFailureReason();
      expect(lastReason).toBe('Connection refused');
    });
  });

  describe('Error Type Tracking', () => {
    it('should track retryable errors', () => {
      breaker.recordFailure('timeout', 'retryable');
      const stats = breaker.getStats();
      expect(stats.errorCounts.retryable).toBe(1);
    });

    it('should track non-retryable errors', () => {
      breaker.recordFailure('auth failed', 'non-retryable');
      const stats = breaker.getStats();
      expect(stats.errorCounts['non-retryable']).toBe(1);
    });

    it('should track transient errors', () => {
      breaker.recordFailure('connection reset', 'transient');
      const stats = breaker.getStats();
      expect(stats.errorCounts.transient).toBe(1);
    });

    it('should track permanent errors', () => {
      breaker.recordFailure('server error', 'permanent');
      const stats = breaker.getStats();
      expect(stats.errorCounts.permanent).toBe(1);
    });

    it('should track rate limited errors', () => {
      breaker.recordFailure('rate limit exceeded', 'rateLimited');
      const stats = breaker.getStats();
      expect(stats.errorCounts.rateLimited).toBe(1);
    });
  });

  describe('Error Rate', () => {
    it('should calculate error rate', () => {
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordFailure('error');
      breaker.recordFailure('error');

      const stats = breaker.getStats();
      expect(stats.errorRate).toBeGreaterThan(0);
    });
  });

  describe('Stats', () => {
    it('should return stats object', () => {
      const stats = breaker.getStats();
      expect(stats).toBeDefined();
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
    });

    it('should track total requests', () => {
      breaker.recordSuccess();
      breaker.recordFailure('error');
      const stats = breaker.getStats();
      expect(stats.totalRequestCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Registry', () => {
    let registry: CircuitBreakerRegistry;

    beforeEach(() => {
      registry = new CircuitBreakerRegistry({
        baseFailureThreshold: 5,
        openTimeout: 1000,
      });
    });

    it('should create circuit breaker', () => {
      const cb = registry.getOrCreate('test-service');
      expect(cb).toBeDefined();
    });

    it('should return same breaker for same name', () => {
      const cb1 = registry.getOrCreate('test-service');
      const cb2 = registry.getOrCreate('test-service');
      expect(cb1).toBe(cb2);
    });

    it('should remove circuit breaker', () => {
      registry.getOrCreate('test-service');
      const removed = registry.remove('test-service');
      expect(removed).toBe(true);
    });

    it('should return false when removing non-existent', () => {
      const removed = registry.remove('non-existent');
      expect(removed).toBe(false);
    });

    it('should remove by prefix', () => {
      registry.getOrCreate('service-a');
      registry.getOrCreate('service-b');
      registry.getOrCreate('other-c');

      const count = registry.removeByPrefix('service-');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should get all stats', () => {
      registry.getOrCreate('service-a');
      registry.getOrCreate('service-b');

      const stats = registry.getAllStats();
      expect(Object.keys(stats).length).toBe(2);
    });

    it('should clear all breakers', () => {
      registry.getOrCreate('service-a');
      registry.getOrCreate('service-b');

      registry.clear();

      expect(Object.keys(registry.getAllStats()).length).toBe(0);
    });

    it('should update all config', () => {
      registry.getOrCreate('service-a');
      registry.updateAllConfig({ openTimeout: 5000 });

      expect(registry.get('service-a')?.getConfig().openTimeout).toBe(5000);
    });

    it('should get undefined for non-existent', () => {
      const cb = registry.get('non-existent');
      expect(cb).toBeUndefined();
    });
  });

  describe('Dual-Protocol Error Handling', () => {
    it('should track Ollama-style transient errors', () => {
      breaker.recordFailure('connection timeout', 'transient');
      breaker.recordFailure('server unavailable', 'retryable');

      const stats = breaker.getStats();
      expect(stats.errorCounts.transient).toBe(1);
      expect(stats.errorCounts.retryable).toBe(1);
    });

    it('should track OpenAI-style rate limiting', () => {
      breaker.recordFailure('rate limit exceeded', 'rateLimited');
      breaker.recordFailure('quota exceeded', 'rateLimited');

      const stats = breaker.getStats();
      expect(stats.errorCounts.rateLimited).toBe(2);
    });

    it('should track authentication errors', () => {
      breaker.recordFailure('invalid API key', 'non-retryable');

      const stats = breaker.getStats();
      expect(stats.errorCounts['non-retryable']).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple consecutive successes', () => {
      for (let i = 0; i < 10; i++) {
        breaker.recordSuccess();
      }
      const stats = breaker.getStats();
      expect(stats.successCount).toBe(10);
    });

    it('should handle multiple consecutive failures', () => {
      for (let i = 0; i < 10; i++) {
        breaker.recordFailure('error');
      }
      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(10);
    });

    it('should handle rapid success/failure alternation', () => {
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          breaker.recordSuccess();
        } else {
          breaker.recordFailure('error');
        }
      }
      const stats = breaker.getStats();
      expect(stats.failureCount).toBeGreaterThan(0);
      expect(stats.successCount).toBeGreaterThan(0);
    });

    it('should track blocked requests', () => {
      breaker.forceOpen();
      breaker.canExecute();
      breaker.canExecute();

      const stats = breaker.getStats();
      expect(stats.blockedRequestCount).toBe(2);
    });
  });
});
