import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { HealthCheckConfig } from '../../src/config/config.js';
import { HealthCheckScheduler } from '../../src/health-check-scheduler.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';

describe('HealthCheckScheduler - per-server jitter', () => {
  let config: HealthCheckConfig;
  let mockServer: AIServer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getServers: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onHealthCheck: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onAllChecksComplete: any;

  beforeEach(() => {
    vi.useFakeTimers();

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

    getServers = vi.fn(() => []);
    onHealthCheck = vi.fn();
    onAllChecksComplete = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should spread health checks across the jitter window', async () => {
    const checkTimes: number[] = [];

    global.fetch = vi.fn().mockImplementation(() => {
      checkTimes.push(Date.now());
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });
    });

    const servers: AIServer[] = Array.from({ length: 10 }, (_, i) => ({
      ...mockServer,
      id: `srv-${i}`,
    }));

    getServers.mockReturnValue(servers);

    const scheduler = new HealthCheckScheduler(
      config,
      getServers,
      onHealthCheck,
      onAllChecksComplete
    );

    scheduler.start();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(30000);

    expect(checkTimes.length).toBeGreaterThanOrEqual(10);

    const minTime = Math.min(...checkTimes);
    const maxTime = Math.max(...checkTimes);
    const spread = maxTime - minTime;

    expect(spread).toBeGreaterThanOrEqual(3000);

    scheduler.stop();
  });

  it('should populate jitter offsets when checks are scheduled', async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });
    });

    const servers: AIServer[] = Array.from({ length: 5 }, (_, i) => ({
      ...mockServer,
      id: `srv-${i}`,
    }));

    getServers.mockReturnValue(servers);

    const scheduler = new HealthCheckScheduler(
      config,
      getServers,
      onHealthCheck,
      onAllChecksComplete
    );

    scheduler.start();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(100);

    const offsets = (scheduler as any).serverJitterOffsets;
    expect(offsets.size).toBeGreaterThan(0);

    for (const [, offset] of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0.9);
      expect(offset).toBeLessThanOrEqual(1.1);
    }

    scheduler.stop();
  });
});
