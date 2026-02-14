import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  type CircuitBreakerConfig,
  type CircuitState,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from '../../src/circuit-breaker.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-breaker');
  });

  describe('Initial State', () => {
    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('should allow execution in closed state', () => {
      expect(breaker.canExecute()).toBe(true);
    });

    it('should return initial stats', () => {
      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.errorRate).toBe(0);
    });
  });

  describe('Success Recording', () => {
    it('should increment success count on success', () => {
      breaker.recordSuccess();
      const stats = breaker.getStats();
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(0);
    });

    it('should reset failure count on success in closed state', () => {
      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 5,
        errorRateThreshold: 1.0, // Prevent error rate from opening circuit
        adaptiveThresholds: false,
      };
      breaker = new CircuitBreaker('test', config);

      breaker.recordFailure('error1');
      breaker.recordFailure('error2');
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getStats().failureCount).toBe(2);

      breaker.recordSuccess();
      expect(breaker.getStats().failureCount).toBe(0);
    });

    it('should track consecutive successes', () => {
      breaker.recordSuccess();
      breaker.recordSuccess();
      breaker.recordSuccess();
      expect(breaker.getStats().consecutiveSuccesses).toBe(3);
    });
  });

  describe('Failure Recording', () => {
    it('should increment failure count on failure', () => {
      breaker.recordFailure('error');
      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(1);
      expect(stats.successCount).toBe(0);
    });

    it('should reset consecutive successes on failure', () => {
      breaker.recordSuccess();
      breaker.recordSuccess();
      expect(breaker.getStats().consecutiveSuccesses).toBe(2);

      breaker.recordFailure('error');
      expect(breaker.getStats().consecutiveSuccesses).toBe(0);
    });

    it('should open circuit after threshold failures', () => {
      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 3,
        adaptiveThresholds: false,
        // Set high error rate threshold to not trigger on error rate
        errorRateThreshold: 1.0,
      };
      breaker = new CircuitBreaker('test', config);

      breaker.recordFailure('error1');
      breaker.recordFailure('error2');
      expect(breaker.getState()).toBe('closed');

      breaker.recordFailure('error3');
      expect(breaker.getState()).toBe('open');
    });

    it('should not open circuit below threshold', () => {
      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 5,
        adaptiveThresholds: false,
        errorRateThreshold: 1.0,
      };
      breaker = new CircuitBreaker('test', config);

      breaker.recordFailure('error1');
      breaker.recordFailure('error2');
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('State Transitions', () => {
    it('should not allow execution when open', () => {
      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 1,
        adaptiveThresholds: false,
      };
      breaker = new CircuitBreaker('test', config);

      breaker.recordFailure('error');
      expect(breaker.getState()).toBe('open');
      expect(breaker.canExecute()).toBe(false);
    });

    it('should transition to half-open after timeout', async () => {
      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 1,
        openTimeout: 50,
        adaptiveThresholds: false,
      };
      breaker = new CircuitBreaker('test', config);

      breaker.recordFailure('error');
      expect(breaker.getState()).toBe('open');
      expect(breaker.canExecute()).toBe(false);

      // Wait for timeout - need to call canExecute to trigger state transition
      await new Promise(resolve => setTimeout(resolve, 100));

      // Call canExecute to trigger the state check
      const canExec = breaker.canExecute();

      expect(canExec).toBe(true);
      expect(breaker.getState()).toBe('half-open');
    });

    it('should close after enough consecutive successes in half-open', async () => {
      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 1,
        openTimeout: 50,
        halfOpenMaxRequests: 5,
        recoverySuccessThreshold: 2,
        adaptiveThresholds: false,
      };
      breaker = new CircuitBreaker('test', config);

      breaker.recordFailure('error');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Trigger half-open state
      breaker.canExecute();

      expect(breaker.getState()).toBe('half-open');

      breaker.recordSuccess();
      expect(breaker.getState()).toBe('half-open');

      breaker.recordSuccess();
      expect(breaker.getState()).toBe('closed');
    });

    it('should reopen on failure in half-open state', async () => {
      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 1,
        openTimeout: 50,
        adaptiveThresholds: false,
      };
      breaker = new CircuitBreaker('test', config);

      breaker.recordFailure('error');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Trigger half-open state
      breaker.canExecute();

      expect(breaker.getState()).toBe('half-open');

      breaker.recordFailure('another error');
      expect(breaker.getState()).toBe('open');
    });
  });

  describe('Error Classification', () => {
    it('should classify non-retryable errors', () => {
      const nonRetryableErrors = [
        'Not found',
        'Unauthorized',
        'Invalid request',
        'Bad request',
        'Not enough RAM',
        'Runner process has terminated',
      ];

      for (const error of nonRetryableErrors) {
        const type = breaker.classifyError(error);
        expect(type).toBe('non-retryable');
      }
    });

    it('should classify transient errors', () => {
      const transientErrors = [
        'Connection timeout',
        'Service temporarily unavailable',
        'Rate limit exceeded',
        'Too many requests',
        'Gateway timeout',
        'ECONNREFUSED',
        'ECONNRESET',
      ];

      for (const error of transientErrors) {
        const type = breaker.classifyError(error);
        expect(type).toBe('transient');
      }
    });

    it('should classify HTTP 5xx as transient', () => {
      expect(breaker.classifyError('HTTP 503')).toBe('transient');
      expect(breaker.classifyError('HTTP 502')).toBe('transient');
      expect(breaker.classifyError('HTTP 504')).toBe('transient');
    });

    it('should classify HTTP 4xx as non-retryable', () => {
      expect(breaker.classifyError('HTTP 400')).toBe('non-retryable');
      expect(breaker.classifyError('HTTP 404')).toBe('non-retryable');
      expect(breaker.classifyError('HTTP 401')).toBe('non-retryable');
    });

    it('should default to retryable for unknown errors', () => {
      expect(breaker.classifyError('Something went wrong')).toBe('retryable');
      expect(breaker.classifyError('Unexpected error')).toBe('retryable');
    });
  });

  describe('Adaptive Thresholds', () => {
    it('should use adaptive thresholds when enabled', () => {
      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 5,
        minFailureThreshold: 3,
        maxFailureThreshold: 10,
        adaptiveThresholds: true,
        // Disable error rate threshold to test pure failure count
        errorRateThreshold: 1.0,
      };
      breaker = new CircuitBreaker('test', config);

      // Add mostly non-retryable errors (should lower threshold to min 3)
      // With base of 5, and mostly non-retryable, threshold should drop to 3
      breaker.recordFailure('Not found', 'non-retryable');
      breaker.recordFailure('Not found', 'non-retryable');
      expect(breaker.getState()).toBe('closed');

      // Third failure with non-retryable should trigger at min threshold of 3
      breaker.recordFailure('Unauthorized', 'non-retryable');
      expect(breaker.getState()).toBe('open');
    });

    it('should increase threshold for mostly transient errors', () => {
      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 3,
        minFailureThreshold: 2,
        maxFailureThreshold: 8,
        adaptiveThresholds: true,
        // Disable error rate threshold to test pure failure count
        errorRateThreshold: 1.0,
      };
      breaker = new CircuitBreaker('test', config);

      // Add transient errors (should raise threshold above base of 3)
      // With base of 3 and transient errors, threshold should increase
      breaker.recordFailure('Timeout', 'transient');
      breaker.recordFailure('Timeout', 'transient');
      expect(breaker.getState()).toBe('closed'); // Not yet at threshold

      // Third failure - threshold should now be higher due to adaptive behavior
      breaker.recordFailure('Timeout', 'transient');
      // Should still be closed because transient errors raise the threshold
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('Error Rate Tracking', () => {
    it('should track error rate over time', () => {
      breaker.recordFailure('error1');
      breaker.recordFailure('error2');
      breaker.recordSuccess();

      const stats = breaker.getStats();
      expect(stats.errorRate).toBeGreaterThan(0);
      expect(stats.errorCounts['retryable']).toBeGreaterThan(0);
    });

    it('should open circuit based on error rate threshold', () => {
      const config: Partial<CircuitBreakerConfig> = {
        errorRateThreshold: 0.5,
        errorRateWindow: 60000,
        adaptiveThresholds: false,
      };
      breaker = new CircuitBreaker('test', config);

      // Add failures to exceed error rate threshold
      for (let i = 0; i < 10; i++) {
        breaker.recordFailure(`error${i}`);
      }
      breaker.recordSuccess();

      // Error rate should be > 50%
      expect(breaker.getStats().errorRate).toBeGreaterThan(0.5);
      expect(breaker.getState()).toBe('open');
    });
  });

  describe('Manual State Control', () => {
    it('should force open circuit', () => {
      breaker.recordSuccess();
      breaker.recordSuccess();

      breaker.forceOpen();
      expect(breaker.getState()).toBe('open');
      expect(breaker.canExecute()).toBe(false);
    });

    it('should force close circuit', () => {
      breaker.recordFailure('error');
      breaker.recordFailure('error');
      breaker.recordFailure('error');

      expect(breaker.getState()).toBe('open');

      breaker.forceClose();
      expect(breaker.getState()).toBe('closed');
      expect(breaker.canExecute()).toBe(true);
      expect(breaker.getStats().failureCount).toBe(0);
    });
  });

  describe('Configuration Update', () => {
    it('should update configuration at runtime', () => {
      const newConfig: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 10,
        openTimeout: 10000,
      };

      breaker.updateConfig(newConfig);
      const currentConfig = breaker.getConfig();

      expect(currentConfig.baseFailureThreshold).toBe(10);
      expect(currentConfig.openTimeout).toBe(10000);
    });

    it('should maintain other config values after partial update', () => {
      breaker.updateConfig({ baseFailureThreshold: 10 });
      const config = breaker.getConfig();

      expect(config.minFailureThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_CONFIG.minFailureThreshold);
      expect(config.adaptiveThresholds).toBe(DEFAULT_CIRCUIT_BREAKER_CONFIG.adaptiveThresholds);
    });
  });

  describe('State Change Callbacks', () => {
    it('should call state change callback', () => {
      const stateChanges: Array<{ from: CircuitState; to: CircuitState }> = [];
      const onStateChange = (from: CircuitState, to: CircuitState) => {
        stateChanges.push({ from, to });
      };

      const config: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 1,
        openTimeout: 50,
        recoverySuccessThreshold: 1,
        adaptiveThresholds: false,
      };
      breaker = new CircuitBreaker('test', config, onStateChange);

      breaker.recordFailure('error');
      expect(stateChanges).toContainEqual({ from: 'closed', to: 'open' });

      // Wait for half-open
      return new Promise<void>(resolve => {
        setTimeout(() => {
          breaker.canExecute(); // Trigger state check
          if (breaker.getState() === 'half-open') {
            expect(stateChanges).toContainEqual({ from: 'open', to: 'half-open' });

            breaker.recordSuccess();
            expect(stateChanges).toContainEqual({ from: 'half-open', to: 'closed' });
          }
          resolve();
        }, 60);
      });
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
  });

  describe('Breaker Management', () => {
    it('should create new circuit breaker', () => {
      const breaker = registry.getOrCreate('breaker-1');
      expect(breaker).toBeDefined();
      expect(breaker.getState()).toBe('closed');
    });

    it('should return existing circuit breaker', () => {
      const breaker1 = registry.getOrCreate('breaker-1');
      const breaker2 = registry.getOrCreate('breaker-1');
      expect(breaker1).toBe(breaker2);
    });

    it('should get existing breaker', () => {
      registry.getOrCreate('breaker-1');
      const breaker = registry.get('breaker-1');
      expect(breaker).toBeDefined();
    });

    it('should return undefined for non-existent breaker', () => {
      const breaker = registry.get('non-existent');
      expect(breaker).toBeUndefined();
    });

    it('should remove circuit breaker', () => {
      registry.getOrCreate('breaker-1');
      expect(registry.get('breaker-1')).toBeDefined();

      const removed = registry.remove('breaker-1');
      expect(removed).toBe(true);
      expect(registry.get('breaker-1')).toBeUndefined();
    });

    it('should return false when removing non-existent breaker', () => {
      const removed = registry.remove('non-existent');
      expect(removed).toBe(false);
    });

    it('should remove breakers by prefix', () => {
      // Create server-level and model-level breakers
      registry.getOrCreate('server-1');
      registry.getOrCreate('server-1:model-a');
      registry.getOrCreate('server-1:model-b');
      registry.getOrCreate('server-2');
      registry.getOrCreate('server-2:model-a');

      // Remove all breakers for server-1
      const removed = registry.removeByPrefix('server-1');
      expect(removed).toBe(3); // server-1, server-1:model-a, server-1:model-b

      // Verify server-1 breakers are gone
      expect(registry.get('server-1')).toBeUndefined();
      expect(registry.get('server-1:model-a')).toBeUndefined();
      expect(registry.get('server-1:model-b')).toBeUndefined();

      // Verify server-2 breakers still exist
      expect(registry.get('server-2')).toBeDefined();
      expect(registry.get('server-2:model-a')).toBeDefined();
    });

    it('should return 0 when no breakers match prefix', () => {
      registry.getOrCreate('server-1');
      registry.getOrCreate('server-1:model-a');

      const removed = registry.removeByPrefix('server-99');
      expect(removed).toBe(0);

      // Original breakers should still exist
      expect(registry.get('server-1')).toBeDefined();
      expect(registry.get('server-1:model-a')).toBeDefined();
    });

    it('should not remove breakers that only partially match prefix', () => {
      // Create breakers with similar names
      registry.getOrCreate('server-1');
      registry.getOrCreate('server-10');
      registry.getOrCreate('server-10:model-a');
      registry.getOrCreate('server-100');

      // Remove only server-1 (exact match and server-1:* patterns)
      const removed = registry.removeByPrefix('server-1');
      expect(removed).toBe(1); // Only server-1 itself

      // Verify server-10 and server-100 are NOT removed
      expect(registry.get('server-10')).toBeDefined();
      expect(registry.get('server-10:model-a')).toBeDefined();
      expect(registry.get('server-100')).toBeDefined();
    });
  });

  describe('Bulk Operations', () => {
    it('should get all breaker stats', () => {
      registry.getOrCreate('breaker-1');
      registry.getOrCreate('breaker-2');

      const allStats = registry.getAllStats();
      expect(Object.keys(allStats)).toHaveLength(2);
      expect(allStats['breaker-1']).toBeDefined();
      expect(allStats['breaker-2']).toBeDefined();
    });

    it('should update all breaker configs', () => {
      registry.getOrCreate('breaker-1');
      registry.getOrCreate('breaker-2');

      registry.updateAllConfig({ baseFailureThreshold: 10 });

      expect(registry.get('breaker-1')?.getConfig().baseFailureThreshold).toBe(10);
      expect(registry.get('breaker-2')?.getConfig().baseFailureThreshold).toBe(10);
    });

    it('should clear all breakers', () => {
      registry.getOrCreate('breaker-1');
      registry.getOrCreate('breaker-2');

      registry.clear();

      expect(registry.get('breaker-1')).toBeUndefined();
      expect(registry.get('breaker-2')).toBeUndefined();
      expect(Object.keys(registry.getAllStats())).toHaveLength(0);
    });
  });

  describe('Default Configuration', () => {
    it('should apply default config to new breakers', () => {
      const defaultConfig: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 3,
        adaptiveThresholds: false,
      };
      registry = new CircuitBreakerRegistry(defaultConfig);

      const breaker = registry.getOrCreate('breaker-1');
      expect(breaker.getConfig().baseFailureThreshold).toBe(3);
      expect(breaker.getConfig().adaptiveThresholds).toBe(false);
    });

    it('should allow override of default config', () => {
      const defaultConfig: Partial<CircuitBreakerConfig> = {
        baseFailureThreshold: 3,
      };
      registry = new CircuitBreakerRegistry(defaultConfig);

      const breaker = registry.getOrCreate('breaker-1', { baseFailureThreshold: 5 });
      expect(breaker.getConfig().baseFailureThreshold).toBe(5);
    });
  });
});
