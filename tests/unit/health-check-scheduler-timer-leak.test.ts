/**
 * health-check-scheduler-timer-leak.test.ts
 * Tests for timer leak prevention in HealthCheckScheduler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { HealthCheckConfig } from '../../src/config/config.js';
import { HealthCheckScheduler } from '../../src/health-check-scheduler.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';

describe('HealthCheckScheduler - timer leak prevention', () => {
  let config: HealthCheckConfig;
  let mockServer: AIServer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let getServers: any;

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

    getServers = vi.fn(() => [mockServer]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should clear activeTestIntervalId on stop', async () => {
    const scheduler = new HealthCheckScheduler(config, getServers);
    scheduler.start();

    // Verify the scheduler is running
    expect(scheduler.isActive()).toBe(true);

    scheduler.stop();

    // activeTestIntervalId should be cleared
    expect((scheduler as any).activeTestIntervalId).toBeUndefined();
  });

  it('should not leak timers across start/stop cycles', async () => {
    const scheduler = new HealthCheckScheduler(config, getServers);

    for (let i = 0; i < 3; i++) {
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);
      scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    }

    // After 3 cycles, only 0 active timers should remain
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should clear all timer types on stop', async () => {
    const onHealthCheck = vi.fn();
    const scheduler = new HealthCheckScheduler(config, getServers, onHealthCheck);

    scheduler.start();
    expect(scheduler.isActive()).toBe(true);

    scheduler.stop();

    // All interval IDs should be undefined after stop
    expect((scheduler as any).intervalId).toBeUndefined();
    expect((scheduler as any).recoveryIntervalId).toBeUndefined();
    expect((scheduler as any).initialTimeoutId).toBeUndefined();
    expect((scheduler as any).activeTestIntervalId).toBeUndefined();
  });
});
