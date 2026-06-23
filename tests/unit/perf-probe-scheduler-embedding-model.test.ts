/**
 * perf-probe-scheduler-embedding-model.test.ts
 * Unit tests verifying embedding models are never scheduled for probing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { PerformanceProbeScheduler } from '../../src/probe/perf-probe-scheduler.js';

vi.mock('../../src/probe/three-sink-feeder.js', () => ({
  feedThreeSinks: vi.fn(),
}));

describe('PerformanceProbeScheduler embedding-model filter', () => {
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
      getModelMap: vi.fn().mockReturnValue({}),
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

  it('scheduleNext24hCycle never schedules nomic-embed-text:latest', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1'],
      'nomic-embed-text:latest': ['server-1'],
    });
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    for (const entry of schedule) {
      expect(entry.model).not.toContain('embed');
    }
    expect(schedule.find(e => e.model === 'nomic-embed-text:latest')).toBeUndefined();
    expect(schedule.find(e => e.model === 'llama3:8b')).toBeDefined();
  });

  it('scheduleNext24hCycle never schedules mxbai-embed-large:latest', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'qwen2.5:7b': ['server-1'],
      'mxbai-embed-large:latest': ['server-1'],
    });
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    for (const entry of schedule) {
      expect(entry.model).not.toContain('embed');
    }
    expect(schedule.find(e => e.model === 'mxbai-embed-large:latest')).toBeUndefined();
    expect(schedule.find(e => e.model === 'qwen2.5:7b')).toBeDefined();
  });

  it('runNewServerProbe skips embed models but still probes non-embed models', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-new'],
      'nomic-embed-text:latest': ['server-new'],
      'mistral:7b': ['server-new'],
    });
    mockOrchestrator.getServer.mockReturnValue({
      id: 'server-new',
      url: 'http://server-new:11434',
      maxConcurrency: 4,
    });

    await scheduler.start();
    scheduler.scheduleNewServerProbe('server-new', 100);

    await vi.advanceTimersByTimeAsync(110);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    const embedProbeCalls = mockRunProbe.mock.calls.filter(([, model]) =>
      (model as string).toLowerCase().includes('embed')
    );
    expect(embedProbeCalls).toHaveLength(0);
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

  it('scheduleNext24hCycle filters both cloud and embed models together', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1'],
      'nomic-embed-text:latest': ['server-1'],
      'deepseek-v4-pro:cloud': ['server-1'],
      'mistral:7b': ['server-2'],
    });
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    const embedModels = schedule.filter(e => e.model.toLowerCase().includes('embed'));
    const cloudModels = schedule.filter(
      e => /:cloud$/i.test(e.model) || /^cloud-/i.test(e.model) || /-cloud$/i.test(e.model)
    );
    expect(embedModels).toHaveLength(0);
    expect(cloudModels).toHaveLength(0);
    expect(schedule.find(e => e.model === 'llama3:8b')).toBeDefined();
    expect(schedule.find(e => e.model === 'mistral:7b')).toBeDefined();
  });

  it('scheduleNext24hCycle still schedules regular generation models', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1', 'server-2'],
    });
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    expect(schedule.length).toBeGreaterThan(0);
    const scheduledModels = new Set(schedule.map(e => e.model));
    expect(scheduledModels.has('llama3:8b')).toBe(true);
    for (const entry of schedule) {
      expect(entry.model).not.toContain('embed');
    }
  });
});
