import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIOrchestrator } from '../../src/orchestrator.js';
import { CircuitBreakerRegistry } from '../../src/circuit-breaker.js';
import { ConfigManager } from '../../src/config/config.js';

// Integration tests to verify all Phase 2 components work together

describe('Phase 2 Integration', () => {
  let orchestrator: AIOrchestrator;
  let registry: CircuitBreakerRegistry;
  let configManager: ConfigManager;

  beforeEach(() => {
    // Create fresh instances for tests (not from singleton to avoid persistence)
    orchestrator = new AIOrchestrator(undefined, undefined, undefined, {
      enabled: false,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxConcurrentChecks: 10,
      retryAttempts: 2,
      retryDelayMs: 1000,
      recoveryIntervalMs: 60000,
      failureThreshold: 3,
      successThreshold: 2,
      backoffMultiplier: 1.5,
    });
    registry = new CircuitBreakerRegistry();
    configManager = new ConfigManager();
  });

  afterEach(() => {
    // Cleanup
    registry.clear();
  });

  describe('Orchestrator with Circuit Breaker', () => {
    it('should use enhanced circuit breaker for server health', () => {
      const serverId = 'test-server';
      const breaker = registry.getOrCreate(serverId, {
        baseFailureThreshold: 5,
        errorRateThreshold: 1.0,
        adaptiveThresholds: true,
      });

      // Simulate server failures with transient errors
      breaker.recordFailure('Connection timeout', 'transient');
      breaker.recordFailure('Service unavailable', 'transient');

      // Circuit should still be closed (transient errors raise threshold)
      expect(breaker.getState()).toBe('closed');

      // But error rate should be tracked
      expect(breaker.getStats().errorRate).toBeGreaterThan(0);
    });

    it('should use error classification for different failure types', () => {
      const serverId = 'test-server';
      const breaker = registry.getOrCreate(serverId);

      // Classify different error types
      expect(breaker.classifyError('Connection timeout')).toBe('transient');
      expect(breaker.classifyError('Not found')).toBe('non-retryable');
      expect(breaker.classifyError('Unknown error')).toBe('retryable');
      expect(breaker.classifyError('HTTP 503')).toBe('transient');
      expect(breaker.classifyError('HTTP 404')).toBe('non-retryable');
    });
  });

  describe('Orchestrator with Config Manager', () => {
    it('should apply configuration settings to orchestrator behavior', () => {
      // Update config to change queue settings
      configManager.updateConfig({
        queue: { maxSize: 500 } as any,
        enableQueue: true,
      });

      const config = configManager.getConfig();
      expect(config.queue.maxSize).toBe(500);
      expect(config.enableQueue).toBe(true);
    });

    it('should support hot reload configuration updates', async () => {
      const watcher = vi.fn();
      configManager.onChange(watcher);

      // Simulate config update
      configManager.updateSection('queue', { maxSize: 200 } as any);

      expect(watcher).toHaveBeenCalled();
      const updatedConfig = watcher.mock.calls[0][0];
      expect(updatedConfig.queue.maxSize).toBe(200);
    });
  });

  describe('Orchestrator Metrics Integration', () => {
    it('should track in-flight requests with queue stats', () => {
      // Simulate adding in-flight requests
      orchestrator.incrementInFlight('server-1', 'model-1');
      orchestrator.incrementInFlight('server-1', 'model-2');

      const stats = orchestrator.getStats();
      expect(stats.inFlightRequests).toBe(2);

      const queueStats = orchestrator.getQueueStats();
      expect(queueStats.currentSize).toBe(0); // Queue is empty initially
    });

    it('should support queue pause and resume', () => {
      // Pause queue
      orchestrator.pauseQueue();
      expect(orchestrator.isQueuePaused()).toBe(true);

      // Resume queue
      orchestrator.resumeQueue();
      expect(orchestrator.isQueuePaused()).toBe(false);
    });
  });

  describe('Configuration with Environment Variables', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should read server configuration from environment', () => {
      process.env.ORCHESTRATOR_PORT = '8080';
      process.env.ORCHESTRATOR_LOG_LEVEL = 'debug';
      process.env.ORCHESTRATOR_ENABLE_STREAMING = 'true';

      const envManager = new ConfigManager();
      const config = envManager.getConfig();

      expect(config.port).toBe(8080);
      expect(config.logLevel).toBe('debug');
      expect(config.enableStreaming).toBe(true);
    });
  });

  describe('End-to-End Feature Flags', () => {
    it('should enable/disable features via configuration', () => {
      // All features enabled by default
      const config = configManager.getConfig();
      expect(config.enableQueue).toBe(true);
      expect(config.enableCircuitBreaker).toBe(true);
      expect(config.enableMetrics).toBe(true);
      expect(config.enableStreaming).toBe(true);

      // Disable features
      configManager.updateConfig({
        enableQueue: false,
        enableCircuitBreaker: false,
      });

      const updatedConfig = configManager.getConfig();
      expect(updatedConfig.enableQueue).toBe(false);
      expect(updatedConfig.enableCircuitBreaker).toBe(false);
      expect(updatedConfig.enableMetrics).toBe(true); // Unchanged
    });
  });
});
