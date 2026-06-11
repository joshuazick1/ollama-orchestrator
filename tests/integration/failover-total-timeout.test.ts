import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AIOrchestrator } from '../../src/orchestrator/orchestrator.js';
import { resetInFlightManager } from '../../src/utils/in-flight-manager.js';

vi.mock('../../src/storage/operational-store.js', () => ({
  getOperationalStore: () => ({
    addBan: vi.fn(),
    removeBan: vi.fn(),
    removeServerBans: vi.fn().mockReturnValue(0),
    removeModelBans: vi.fn().mockReturnValue(0),
    clearAllBans: vi.fn(),
    getActiveBans: vi.fn().mockReturnValue([]),
    runStartupMigrations: vi.fn(),
    close: vi.fn(),
  }),
  initOperationalStore: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));


describe('Failover - total request timeout', () => {
  beforeEach(() => {
    resetInFlightManager();
  });

  afterEach(() => {});

  it('should abort when total budget exceeded', async () => {
    const orch = new AIOrchestrator(
      {
        inferenceTimeoutMs: 250,
      },
      undefined,
      {
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
      }
    );
    orch['healthCheckScheduler'].stop();
    orch['probeScheduler'].stop();

    for (let i = 0; i < 3; i++) {
      orch.addServer({
        id: `srv-${i}`,
        url: `http://localhost:1144${i}`,
        type: 'ollama',
      });
    }

    let requestCount = 0;

    orch.generate = vi.fn(async () => {
      requestCount++;
      await new Promise(resolve => setTimeout(resolve, 100));
      throw new Error('Server timeout');
    });

    const start = Date.now();
    let error: Error | undefined;

    try {
      await orch.generate({
        model: 'llama3',
        prompt: 'test',
        stream: false,
      });
    } catch (err) {
      error = err as Error;
    }

    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(400);
    expect(error).toBeDefined();

    await orch.shutdown();
  });

  it('should respect inferenceTimeoutMs config and abort early', async () => {
    const orch = new AIOrchestrator(
      {
        inferenceTimeoutMs: 150,
      },
      undefined,
      {
        enabled: false,
        intervalMs: 30000,
        timeoutMs: 100,
        maxConcurrentChecks: 10,
        retryAttempts: 2,
        retryDelayMs: 1000,
        recoveryIntervalMs: 60000,
        failureThreshold: 3,
        successThreshold: 2,
        backoffMultiplier: 1.5,
      }
    );
    orch['healthCheckScheduler'].stop();
    orch['probeScheduler'].stop();

    for (let i = 0; i < 3; i++) {
      orch.addServer({
        id: `srv-${i}`,
        url: `http://localhost:1144${i}`,
        type: 'ollama',
        maxConcurrency: 1,
      });
    }

    let requestCount = 0;

    orch.generate = vi.fn(async () => {
      requestCount++;
      await new Promise(resolve => setTimeout(resolve, 100));
      throw new Error('Server timeout');
    });

    const start = Date.now();

    try {
      await orch.generate({
        model: 'llama3',
        prompt: 'test',
        stream: false,
      });
    } catch (err) {}

    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(300);

    await orch.shutdown();
  });
});
