import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  HealthCheckScheduler,
  type HealthCheckSchedulerServerDescriptor,
} from '../../../src/probe/health-check-scheduler.js';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/config/config.js', () => ({
  getConfigManager: () => ({
    getConfig: () => ({
      healthCheck: {
        enabled: true,
        intervalMs: 30000,
        timeoutMs: 5000,
        maxConcurrentChecks: 3,
        retryAttempts: 1,
        retryDelayMs: 100,
        recoveryIntervalMs: 60000,
        backoffMultiplier: 1.5,
      },
    }),
  }),
}));

describe('HealthCheckScheduler', () => {
  let servers: HealthCheckSchedulerServerDescriptor[];
  let updateCalls: string[];

  beforeEach(() => {
    servers = [];
    updateCalls = [];
  });

  it('runs updateServerStatus on every server once per cycle', async () => {
    servers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const scheduler = new HealthCheckScheduler({
      serverListProvider: () => servers,
      updateServerStatus: async s => {
        updateCalls.push(s.id);
      },
    });

    const result = await scheduler.runOnce();
    expect(result.serversProbed).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(updateCalls.sort()).toEqual(['a', 'b', 'c']);
  });

  it('honors maxConcurrentChecks', async () => {
    servers = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}` }));
    let inFlight = 0;
    let peak = 0;

    const scheduler = new HealthCheckScheduler({
      serverListProvider: () => servers,
      updateServerStatus: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 10));
        inFlight--;
      },
    });

    await scheduler.runOnce();
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('counts failures but does not throw', async () => {
    servers = [{ id: 'a' }, { id: 'b-fail' }];
    const scheduler = new HealthCheckScheduler({
      serverListProvider: () => servers,
      updateServerStatus: async s => {
        if (s.id === 'b-fail') {
          throw new Error('boom');
        }
      },
    });

    const result = await scheduler.runOnce();
    expect(result.serversProbed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('skips overlapping ticks', async () => {
    servers = [{ id: 'a' }];
    let resolveUpdate: (() => void) | null = null;
    const scheduler = new HealthCheckScheduler({
      serverListProvider: () => servers,
      updateServerStatus: () =>
        new Promise<void>(resolve => {
          resolveUpdate = resolve;
        }),
    });

    const first = scheduler.runOnce();
    const second = await scheduler.runOnce();
    expect(second.skipped).toBe(true);
    resolveUpdate?.();
    await first;
  });

  it('starts and stops the interval timer', () => {
    vi.useFakeTimers();
    servers = [{ id: 'a' }];
    const scheduler = new HealthCheckScheduler({
      serverListProvider: () => servers,
      updateServerStatus: async () => {
        updateCalls.push('x');
      },
    });

    scheduler.start();
    expect(updateCalls).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    scheduler.stop();
    vi.useRealTimers();
  });
});
