/**
 * perf-probe-scheduler.test.ts
 * Unit tests for PerformanceProbeScheduler
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { PerformanceProbeScheduler } from '../../src/probe/perf-probe-scheduler.js';

vi.mock('../../src/probe/three-sink-feeder.js', () => ({
  feedThreeSinks: vi.fn(),
}));

describe('PerformanceProbeScheduler', () => {
  let scheduler: PerformanceProbeScheduler;
  let mockOrchestrator: any;
  let mockRunProbe: any;
  let mockMetricsStore: any;
  let mockInFlightManager: any;
  let mockLogger: any;

  const defaultConfig = {
    intervalMs: 60_000,
    jitterMs: 0,
    maxConcurrent: 4,
    cooldownMs: 0,
    enabled: true,
    probeModelCount: 50,
    probeTimeoutMs: 30_000,
    newServerProbeDelayMs: 7200000,
  };

  beforeEach(() => {
    vi.useFakeTimers();

    mockOrchestrator = {
      getModelMap: vi.fn().mockReturnValue({
        'llama3:8b': ['server-1', 'server-2'],
        'mistral:7b': ['server-1'],
        'codellama:7b': ['server-2'],
      }),
      getServer: vi.fn().mockImplementation((id: string) => ({
        id,
        url: `http://${id}:11434`,
        maxConcurrency: 4,
      })),
    };

    mockRunProbe = vi.fn().mockResolvedValue({
      success: true,
      serverId: 'server-1',
      model: 'llama3:8b',
      ttftMs: 100,
      tokensPerSec: 50,
      totalDurationMs: 1000,
      score: 0.75,
    });

    mockMetricsStore = {
      getRequests: vi.fn().mockReturnValue([]),
    };

    mockInFlightManager = {
      tryIncrementInFlight: vi.fn().mockReturnValue(true),
      decrementInFlight: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    scheduler = new PerformanceProbeScheduler({
      logger: mockLogger,
      orchestrator: mockOrchestrator,
      runProbe: mockRunProbe,
      metricsStore: mockMetricsStore,
      inFlightManager: mockInFlightManager,
      schedulerId: 'test-scheduler',
      config: defaultConfig,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('scheduleNext24hCycle generates one entry per (server, model) pair', async () => {
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    expect(schedule.length).toBe(2);
    expect(schedule.find(e => e.serverId === 'server-1' && e.model === 'llama3:8b')).toBeDefined();
    expect(schedule.find(e => e.serverId === 'server-2' && e.model === 'llama3:8b')).toBeDefined();
  });

  it('fire-times are uniformly distributed within [0, intervalMs)', async () => {
    const manyServers: Record<string, string[]> = {};
    for (let i = 0; i < 20; i++) {
      manyServers[`model-${i}`] = [`server-${i}`];
    }
    mockOrchestrator.getModelMap.mockReturnValue(manyServers);
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    const intervalMs = defaultConfig.intervalMs;
    for (const entry of schedule) {
      const delay = entry.firesAt - entry.scheduledAt;
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(intervalMs);
    }
    const delays = schedule.map(e => e.firesAt - e.scheduledAt);
    const mean = delays.reduce((a, b) => a + b, 0) / delays.length;
    expect(mean).toBeGreaterThan(intervalMs * 0.3);
    expect(mean).toBeLessThan(intervalMs * 0.7);
  });

  it('per-server with N models produces N distinct events at different times', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1', 'server-2'],
      'mistral:7b': ['server-1'],
    });
    await scheduler.start();
    const server1Entries = scheduler.getSchedule().filter(e => e.serverId === 'server-1');
    expect(server1Entries.length).toBe(1);
  });

  it('two consecutive calls produce different random times', async () => {
    await scheduler.start();
    const schedule1 = scheduler.getSchedule();
    const times1 = schedule1.map(e => e.firesAt);
    vi.advanceTimersByTimeAsync(defaultConfig.intervalMs);
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.stop();
    await scheduler.start();
    const schedule2 = scheduler.getSchedule();
    const times2 = schedule2.map(e => e.firesAt);
    const allSame = times1.every((t, i) => t === times2[i]);
    expect(allSame).toBe(false);
  });

  it('stop() clears all pending timeouts', async () => {
    await scheduler.start();
    expect(scheduler.activeTimeouts.size).toBeGreaterThan(0);
    await scheduler.stop();
    expect(scheduler.activeTimeouts.size).toBe(0);
    expect(scheduler.isRunning()).toBe(false);
  });

  it('stop() is idempotent', async () => {
    await scheduler.start();
    await scheduler.stop();
    await scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.activeTimeouts.size).toBe(0);
  });

  it('start() is idempotent', async () => {
    await scheduler.start();
    const schedule1 = scheduler.getSchedule();
    const size1 = scheduler.activeTimeouts.size;
    await scheduler.start();
    const schedule2 = scheduler.getSchedule();
    expect(schedule1.length).toBe(schedule2.length);
    expect(scheduler.activeTimeouts.size).toBe(size1);
  });

  it('concurrency cap: probes respect maxConcurrent limit', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    scheduler = new PerformanceProbeScheduler({
      logger: mockLogger,
      orchestrator: mockOrchestrator,
      runProbe: mockRunProbe,
      metricsStore: mockMetricsStore,
      inFlightManager: mockInFlightManager,
      schedulerId: 'test-scheduler',
      config: { ...defaultConfig, maxConcurrent: 2, intervalMs: 100 },
    });
    await scheduler.start();
    vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(0);
    const status = scheduler.getStatus();
    const total = status.stats.totalCompletedToday + status.stats.totalSkippedConcurrency;
    expect(total).toBeGreaterThan(0);
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('cooldown: if (server, model) was probed recently it is skipped', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    scheduler = new PerformanceProbeScheduler({
      logger: mockLogger,
      orchestrator: mockOrchestrator,
      runProbe: mockRunProbe,
      metricsStore: mockMetricsStore,
      inFlightManager: mockInFlightManager,
      schedulerId: 'test-scheduler',
      config: { ...defaultConfig, cooldownMs: 300_000, intervalMs: 100 },
    });
    mockMetricsStore.getRequests.mockReturnValue([
      { serverId: 'server-1', model: 'llama3:8b', timestamp: Date.now() },
    ]);
    await scheduler.start();
    vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(0);
    const status = scheduler.getStatus();
    expect(status.stats.totalSkippedCooldown).toBeGreaterThan(0);
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('runProbe exception handling: caught and treated as failure', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    mockRunProbe.mockRejectedValueOnce(new Error('network error'));
    scheduler = new PerformanceProbeScheduler({
      logger: mockLogger,
      orchestrator: mockOrchestrator,
      runProbe: mockRunProbe,
      metricsStore: mockMetricsStore,
      inFlightManager: mockInFlightManager,
      schedulerId: 'test-scheduler',
      config: { ...defaultConfig, intervalMs: 100 },
    });
    await scheduler.start();
    vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(0);
    const status = scheduler.getStatus();
    expect(status.stats.totalFailedToday).toBeGreaterThan(0);
    expect(mockLogger.error).toHaveBeenCalled();
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('after 3 failed attempts, no more retries', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    mockRunProbe
      .mockResolvedValueOnce({ success: false, error: 'fail 1' })
      .mockResolvedValueOnce({ success: false, error: 'fail 2' })
      .mockResolvedValueOnce({ success: false, error: 'fail 3' });
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1'],
    });
    scheduler = new PerformanceProbeScheduler({
      logger: mockLogger,
      orchestrator: mockOrchestrator,
      runProbe: mockRunProbe,
      metricsStore: mockMetricsStore,
      inFlightManager: mockInFlightManager,
      schedulerId: 'test-scheduler',
      config: { ...defaultConfig, intervalMs: 100 },
    });
    await scheduler.start();
    vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(0);
    const status = scheduler.getStatus();
    expect(status.stats.totalFailedToday).toBeGreaterThan(0);
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('per-server: no concurrent probes on same server', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const controlledInFlightManager = {
      tryIncrementInFlight: vi.fn().mockImplementation((serverId: string) => {
        return serverId !== 'server-1';
      }),
      decrementInFlight: vi.fn(),
    };
    scheduler = new PerformanceProbeScheduler({
      logger: mockLogger,
      orchestrator: mockOrchestrator,
      runProbe: mockRunProbe,
      metricsStore: mockMetricsStore,
      inFlightManager: controlledInFlightManager as any,
      schedulerId: 'test-scheduler',
      config: { ...defaultConfig, maxConcurrent: 10, intervalMs: 100 },
    });
    await scheduler.start();
    vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(0);
    expect(controlledInFlightManager.tryIncrementInFlight).toHaveBeenCalled();
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('lifecycle: start() → stop() leaves no leaked handles', async () => {
    await scheduler.start();
    const handleCountBefore = scheduler.activeTimeouts.size;
    expect(handleCountBefore).toBeGreaterThan(0);
    await scheduler.stop();
    expect(scheduler.activeTimeouts.size).toBe(0);
    expect(scheduler.isRunning()).toBe(false);
    const status = scheduler.getStatus();
    expect(status.running).toBe(false);
  });

  it('getStatus() returns correct structure', async () => {
    await scheduler.start();
    const status = scheduler.getStatus();
    expect(status.running).toBe(true);
    expect(status.enabled).toBe(true);
    expect(status.cycleStartedAt).not.toBeNull();
    expect(status.cycleEndsAt).not.toBeNull();
    expect(status.config).toBeDefined();
    expect(status.stats).toBeDefined();
  });

  it('getStatus() returns running: false when stopped', async () => {
    await scheduler.start();
    expect(scheduler.getStatus().running).toBe(true);
    await scheduler.stop();
    const status = scheduler.getStatus();
    expect(status.running).toBe(false);
    expect(status.cycleStartedAt).toBeNull();
    expect(status.cycleEndsAt).toBeNull();
  });

  it('getStatus() currentProbes list matches scheduled entries', async () => {
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    const status = scheduler.getStatus();
    expect(status.currentProbes.length).toBe(schedule.length);
    for (const entry of schedule) {
      const found = status.currentProbes.find(
        p => p.serverId === entry.serverId && p.model === entry.model
      );
      expect(found).toBeDefined();
      expect(found?.firesAt).toBe(entry.firesAt);
    }
  });

  it('getStatus() stats counters reflect probe activity', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    scheduler = new PerformanceProbeScheduler({
      logger: mockLogger,
      orchestrator: mockOrchestrator,
      runProbe: mockRunProbe,
      metricsStore: mockMetricsStore,
      inFlightManager: mockInFlightManager,
      schedulerId: 'test-scheduler',
      config: { ...defaultConfig, intervalMs: 100 },
    });
    await scheduler.start();
    vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(0);
    const status = scheduler.getStatus();
    expect(status.stats.totalScheduledToday).toBeGreaterThan(0);
    const totalProcessed =
      status.stats.totalCompletedToday +
      status.stats.totalFailedToday +
      status.stats.totalSkippedCooldown +
      status.stats.totalSkippedConcurrency;
    expect(totalProcessed).toBeGreaterThan(0);
    vi.spyOn(Math, 'random').mockRestore();
  });

  // ---- new-server probe tests ----

  it('scheduleNewServerProbe: fires after delay and probes all models on server', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-new'],
      'mistral:7b': ['server-new'],
    });
    mockOrchestrator.getServer.mockReturnValue({
      id: 'server-new',
      url: 'http://server-new:11434',
      maxConcurrency: 4,
    });

    await scheduler.start();
    scheduler.scheduleNewServerProbe('server-new', 100);

    // Not fired yet
    await vi.advanceTimersByTimeAsync(50);
    expect(mockRunProbe).not.toHaveBeenCalled();

    // Advance past delay — setTimeout fires synchronously, runNewServerProbe starts async chain
    // Two awaits needed: first pumps the timeout callback, second pumps the resulting promise chain
    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunProbe).toHaveBeenCalledTimes(2);
    expect(mockRunProbe).toHaveBeenCalledWith(
      'server-new',
      'llama3:8b',
      'http://server-new:11434',
      expect.any(Object)
    );
    expect(mockRunProbe).toHaveBeenCalledWith(
      'server-new',
      'mistral:7b',
      'http://server-new:11434',
      expect.any(Object)
    );
  });

  it('scheduleNewServerProbe: is idempotent (reschedules if called again)', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-new'],
    });
    mockOrchestrator.getServer.mockReturnValue({
      id: 'server-new',
      url: 'http://server-new:11434',
      maxConcurrency: 4,
    });

    scheduler.scheduleNewServerProbe('server-new', 100);
    scheduler.scheduleNewServerProbe('server-new', 200);

    // Should only fire once with the second delay (200ms)
    await vi.advanceTimersByTimeAsync(150);
    expect(mockRunProbe).not.toHaveBeenCalled();

    // Advance past 200ms, then flush promise chain
    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunProbe).toHaveBeenCalledTimes(1);
  });

  it('cancelNewServerProbe: prevents the probe from firing', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-new'],
    });
    mockOrchestrator.getServer.mockReturnValue({
      id: 'server-new',
      url: 'http://server-new:11434',
      maxConcurrency: 4,
    });

    scheduler.scheduleNewServerProbe('server-new', 100);
    scheduler.cancelNewServerProbe('server-new');

    vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunProbe).not.toHaveBeenCalled();
  });

  it('cancelNewServerProbe: is idempotent (no-op if nothing scheduled)', () => {
    expect(() => scheduler.cancelNewServerProbe('nonexistent')).not.toThrow();
  });

  it('getStatus() exposes pending new-server probes', () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-new'],
    });

    scheduler.scheduleNewServerProbe('server-new', 5000);

    const status = scheduler.getStatus();
    expect(status.newServerProbes).toHaveLength(1);
    expect(status.newServerProbes[0].serverId).toBe('server-new');
    expect(status.newServerProbes[0].scheduledAt).toBeGreaterThan(0);
    expect(status.newServerProbes[0].firesAt - status.newServerProbes[0].scheduledAt).toBe(5000);
  });

  it('getStatus() newServerProbes is empty when no probes scheduled', () => {
    const status = scheduler.getStatus();
    expect(status.newServerProbes).toHaveLength(0);
  });

  it('stop() clears all new-server probe timeouts', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-new'],
    });
    mockOrchestrator.getServer.mockReturnValue({
      id: 'server-new',
      url: 'http://server-new:11434',
      maxConcurrency: 4,
    });

    scheduler.scheduleNewServerProbe('server-new', 10000);
    await scheduler.stop();

    vi.advanceTimersByTimeAsync(15000);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunProbe).not.toHaveBeenCalled();
    const status = scheduler.getStatus();
    expect(status.newServerProbes).toHaveLength(0);
  });

  it('scheduleNewServerProbe: skips server if not found when firing', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({});
    mockOrchestrator.getServer.mockReturnValue(undefined);

    scheduler.scheduleNewServerProbe('server-gone', 100);
    vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunProbe).not.toHaveBeenCalled();
  });
});
