/**
 * health-check-scheduler.test.ts
 * Tests for the HealthCheckScheduler class
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HealthCheckScheduler } from '../../src/health-check-scheduler.js';
import type { HealthCheckConfig } from '../../src/config/config.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('HealthCheckScheduler', () => {
  let config: HealthCheckConfig;
  let mockServer: AIServer;
  let scheduler: HealthCheckScheduler;
  let getServers: ReturnType<typeof vi.fn<[], AIServer[]>>;
  let onHealthCheck: ReturnType<typeof vi.fn>;
  let onAllChecksComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxConcurrentChecks: 10,
      retryAttempts: 2,
      retryDelayMs: 1000,
      recoveryIntervalMs: 60000,
      failureThreshold: 3,
      successThreshold: 2,
      backoffMultiplier: 1.5,
    };

    mockServer = {
      id: 'test-server',
      url: 'http://localhost:11434',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 1000,
      models: ['llama3:latest'],
      maxConcurrency: 10,
    };

    getServers = vi.fn(() => [mockServer]);
    onHealthCheck = vi.fn();
    onAllChecksComplete = vi.fn();

    scheduler = new HealthCheckScheduler(config, getServers, onHealthCheck, onAllChecksComplete);
  });

  afterEach(() => {
    scheduler.stop();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with provided config and callbacks', () => {
      expect(scheduler.isActive()).toBe(false);
      expect(scheduler.getMetrics()).toEqual({
        totalChecks: 0,
        successfulChecks: 0,
        failedChecks: 0,
        averageResponseTime: 0,
        lastCheckTime: 0,
      });
    });
  });

  describe('start', () => {
    it('should start the scheduler when enabled', () => {
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);
    });

    it('should not start when disabled', () => {
      const disabledConfig = { ...config, enabled: false };
      const disabledScheduler = new HealthCheckScheduler(disabledConfig, getServers);
      disabledScheduler.start();
      expect(disabledScheduler.isActive()).toBe(false);
    });

    it('should not start if already running', () => {
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);
      scheduler.start(); // Should not change state
      expect(scheduler.isActive()).toBe(true);
    });

    it('should schedule health checks and recovery checks', async () => {
      const mockRunHealthChecks = vi
        .spyOn(scheduler as any, 'runHealthChecks')
        .mockResolvedValue(undefined);
      const mockRunRecoveryChecks = vi
        .spyOn(scheduler as any, 'runRecoveryChecks')
        .mockResolvedValue(undefined);

      scheduler.start();

      // Wait for initial check
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(mockRunHealthChecks).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop the scheduler', () => {
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);

      scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    });

    it('should clear intervals', () => {
      scheduler.start();
      expect((scheduler as any).intervalId).toBeDefined();
      expect((scheduler as any).recoveryIntervalId).toBeDefined();

      scheduler.stop();
      expect((scheduler as any).intervalId).toBeUndefined();
      expect((scheduler as any).recoveryIntervalId).toBeUndefined();
    });

    it('should not error if not running', () => {
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('checkServerHealth', () => {
    beforeEach(() => {
      // Mock fetch
      global.fetch = vi.fn();
    });

    it('should return success for healthy server', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ models: [] }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await scheduler.checkServerHealth(mockServer);

      expect(result).toEqual({
        serverId: 'test-server',
        success: true,
        responseTime: expect.any(Number),
        timestamp: expect.any(Number),
      });
      expect(onHealthCheck).toHaveBeenCalledWith(result);
    });

    it('should return failure for unhealthy server', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await scheduler.checkServerHealth(mockServer);

      expect(result).toEqual({
        serverId: 'test-server',
        success: false,
        error: 'HTTP 500',
        timestamp: expect.any(Number),
      });
      expect(onHealthCheck).toHaveBeenCalledWith(result);
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await scheduler.checkServerHealth(mockServer);

      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });

    it('should handle timeout', async () => {
      const slowFetch = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Aborted')), 6000);
      });
      (global.fetch as any).mockReturnValue(slowFetch);

      const fastConfig = { ...config, timeoutMs: 100 };
      const fastScheduler = new HealthCheckScheduler(fastConfig);

      const result = await fastScheduler.checkServerHealth(mockServer);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Aborted|timeout/i);
    });

    it('should retry on retryable errors', async () => {
      let callCount = 0;
      (global.fetch as any).mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('ECONNREFUSED'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: [] }),
        });
      });

      const result = await scheduler.checkServerHealth(mockServer);

      expect(callCount).toBe(3); // Initial + 2 retries
      expect(result.success).toBe(true);
    });

    it('should not retry on non-retryable errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Invalid response format'));

      const result = await scheduler.checkServerHealth(mockServer);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid response format');
    });

    it('should validate response format', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ invalid: 'response' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await scheduler.checkServerHealth(mockServer);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid response format');
    });
  });

  describe('getMetrics', () => {
    it('should return current metrics', () => {
      const metrics = scheduler.getMetrics();
      expect(metrics).toEqual({
        totalChecks: 0,
        successfulChecks: 0,
        failedChecks: 0,
        averageResponseTime: 0,
        lastCheckTime: 0,
      });
    });

    it('should update metrics after health checks', async () => {
      // Mock fetch globally with delay to simulate response time
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise(resolve =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve({ models: [] }),
                }),
              10
            )
          )
      );

      try {
        // Create a new scheduler with callbacks for this test
        const testScheduler = new HealthCheckScheduler(
          config,
          getServers,
          onHealthCheck,
          onAllChecksComplete
        );
        const result = await testScheduler.checkServerHealth(mockServer);

        expect(result.success).toBe(true);
        expect(result.responseTime).toBeGreaterThan(0);

        const metrics = testScheduler.getMetrics();
        expect(metrics.totalChecks).toBe(1);
        expect(metrics.successfulChecks).toBe(1);
        expect(metrics.failedChecks).toBe(0);
        expect(metrics.averageResponseTime).toBeGreaterThan(0);
        expect(metrics.lastCheckTime).toBeGreaterThan(0);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const newConfig = { timeoutMs: 10000, maxConcurrentChecks: 5 };
      scheduler.updateConfig(newConfig);

      expect((scheduler as any).config.timeoutMs).toBe(10000);
      expect((scheduler as any).config.maxConcurrentChecks).toBe(5);
    });

    it('should restart scheduler when interval changes', () => {
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);

      const restartSpy = vi.spyOn(scheduler as any, 'restart');
      scheduler.updateConfig({ intervalMs: 60000 });

      expect(restartSpy).toHaveBeenCalled();
    });
  });

  describe('runHealthChecks', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });
    });

    it('should run health checks on all servers', async () => {
      const multipleServers: AIServer[] = [
        { ...mockServer, id: 'server1' },
        { ...mockServer, id: 'server2' },
      ];
      getServers.mockReturnValue(multipleServers);

      // Start scheduler to set isRunning = true
      scheduler.start();

      await (scheduler as any).runHealthChecks();

      expect(onAllChecksComplete).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ serverId: 'server1', success: true }),
          expect.objectContaining({ serverId: 'server2', success: true }),
        ])
      );
    });

    it('should respect concurrency limits', async () => {
      const manyServers: AIServer[] = Array.from({ length: 15 }, (_, i) => ({
        ...mockServer,
        id: `server${i}`,
      }));
      getServers.mockReturnValue(manyServers);

      const lowConcurrencyConfig = { ...config, maxConcurrentChecks: 3 };
      const lowConcurrencyScheduler = new HealthCheckScheduler(
        lowConcurrencyConfig,
        () => manyServers,
        onHealthCheck,
        onAllChecksComplete
      );

      lowConcurrencyScheduler.start();

      await (lowConcurrencyScheduler as any).runHealthChecks();

      expect(onAllChecksComplete).toHaveBeenCalledWith(
        expect.arrayContaining(
          manyServers.map(server => expect.objectContaining({ serverId: server.id, success: true }))
        )
      );
    });

    it('should skip if no servers', async () => {
      getServers.mockReturnValue([]);

      await (scheduler as any).runHealthChecks();

      expect(onAllChecksComplete).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      scheduler.start();

      await (scheduler as any).runHealthChecks();

      expect(onAllChecksComplete).toHaveBeenCalled();
    });
  });

  describe('runRecoveryChecks', () => {
    it('should check only unhealthy servers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      const servers: AIServer[] = [
        { ...mockServer, id: 'healthy', healthy: true },
        { ...mockServer, id: 'unhealthy1', healthy: false },
        { ...mockServer, id: 'unhealthy2', healthy: false },
      ];
      getServers.mockReturnValue(servers);

      scheduler.start();

      await (scheduler as any).runRecoveryChecks();

      expect(global.fetch).toHaveBeenCalledTimes(2); // Only unhealthy servers
    });

    it('should skip if no unhealthy servers', async () => {
      const healthyServers: AIServer[] = [
        { ...mockServer, id: 'healthy1', healthy: true },
        { ...mockServer, id: 'healthy2', healthy: true },
      ];
      getServers.mockReturnValue(healthyServers);

      await (scheduler as any).runRecoveryChecks();

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Integration', () => {
    it('should handle full scheduler lifecycle', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      // Start scheduler
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);

      // Wait for some checks (initial check is scheduled after 1000ms)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Check metrics updated
      const metrics = scheduler.getMetrics();
      expect(metrics.totalChecks).toBeGreaterThan(0);

      // Update config
      scheduler.updateConfig({ timeoutMs: 1000 });

      // Stop scheduler
      scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    });
  });
});
