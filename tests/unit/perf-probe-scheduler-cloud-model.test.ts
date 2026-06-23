/**
 * perf-probe-scheduler-cloud-model.test.ts
 * Unit tests verifying cloud models are never scheduled for probing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { PerformanceProbeScheduler } from '../../src/probe/perf-probe-scheduler.js';

vi.mock('../../src/probe/three-sink-feeder.js', () => ({
  feedThreeSinks: vi.fn(),
}));

describe('PerformanceProbeScheduler cloud-model filter', () => {
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

  it('scheduleNext24hCycle never schedules cloud models (deepseek-v4-pro:cloud pattern)', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1'],
      'deepseek-v4-pro:cloud': ['server-1'],
      'mistral:7b': ['server-2'],
    });
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    for (const entry of schedule) {
      expect(entry.model).not.toMatch(/:cloud$/i);
    }
    expect(schedule.find(e => e.model === 'deepseek-v4-pro:cloud')).toBeUndefined();
    expect(schedule.find(e => e.model === 'llama3:8b')).toBeDefined();
  });

  it('scheduleNext24hCycle never schedules cloud models (cloud-gpt4 prefix pattern)', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1'],
      'cloud-gpt4': ['server-1'],
      'mistral:7b': ['server-2'],
    });
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    for (const entry of schedule) {
      expect(entry.model).not.toMatch(/^cloud-/i);
    }
    expect(schedule.find(e => e.model === 'cloud-gpt4')).toBeUndefined();
  });

  it('scheduleNext24hCycle never schedules cloud models (meta-cloud suffix pattern)', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1'],
      'meta-cloud': ['server-1'],
      'mistral:7b': ['server-2'],
    });
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    for (const entry of schedule) {
      expect(entry.model).not.toMatch(/-cloud$/i);
    }
    expect(schedule.find(e => e.model === 'meta-cloud')).toBeUndefined();
  });

  it('scheduleNext24hCycle mixes cloud and non-cloud but only schedules non-cloud', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1'],
      'deepseek-v4-pro:cloud': ['server-1', 'server-2'],
      'mistral:7b': ['server-2'],
      'cloud-llama': ['server-1', 'server-2'],
      'codellama:7b': ['server-3'],
      'openai-cloud': ['server-3'],
    });
    await scheduler.start();
    const schedule = scheduler.getSchedule();
    const cloudModels = schedule.filter(
      e => /:cloud$/i.test(e.model) || /^cloud-/i.test(e.model) || /-cloud$/i.test(e.model)
    );
    expect(cloudModels).toHaveLength(0);
    expect(schedule.length).toBeGreaterThan(0);
    const scheduledModels = new Set(schedule.map(e => e.model));
    expect(scheduledModels.has('deepseek-v4-pro:cloud')).toBe(false);
    expect(scheduledModels.has('cloud-llama')).toBe(false);
    expect(scheduledModels.has('openai-cloud')).toBe(false);
  });

  it('runNewServerProbe never probes cloud models (:cloud$ pattern)', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-new'],
      'deepseek-v4-pro:cloud': ['server-new'],
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

    const cloudProbeCalls = mockRunProbe.mock.calls.filter(([, model]) =>
      /:cloud$/i.test(model as string)
    );
    expect(cloudProbeCalls).toHaveLength(0);
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

  it('runNewServerProbe never probes cloud models (cloud- prefix pattern)', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-new'],
      'cloud-gpt4': ['server-new'],
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

    const cloudProbeCalls = mockRunProbe.mock.calls.filter(([, model]) =>
      /^cloud-/i.test(model as string)
    );
    expect(cloudProbeCalls).toHaveLength(0);
    expect(mockRunProbe).toHaveBeenCalledTimes(1);
    expect(mockRunProbe).toHaveBeenCalledWith(
      'server-new',
      'llama3:8b',
      'http://server-new:11434',
      expect.any(Object)
    );
  });

  it('runNewServerProbe never probes cloud models (-cloud$ suffix pattern)', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-new'],
      'meta-cloud': ['server-new'],
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

    const cloudProbeCalls = mockRunProbe.mock.calls.filter(([, model]) =>
      /-cloud$/i.test(model as string)
    );
    expect(cloudProbeCalls).toHaveLength(0);
    expect(mockRunProbe).toHaveBeenCalledTimes(1);
  });

  it('runNewServerProbe skips cloud models but still probes when non-cloud models remain', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'deepseek-v4-pro:cloud': ['server-new'],
      'cloud-llama': ['server-new'],
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

    expect(mockRunProbe).toHaveBeenCalledTimes(1);
    expect(mockRunProbe).toHaveBeenCalledWith(
      'server-new',
      'mistral:7b',
      'http://server-new:11434',
      expect.any(Object)
    );
  });

  it('runNewServerProbe skips entirely when all models are cloud models', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'deepseek-v4-pro:cloud': ['server-new'],
      'cloud-gpt4': ['server-new'],
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

    expect(mockRunProbe).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'new-server probe skipped: no models on server',
      expect.objectContaining({ serverId: 'server-new' })
    );
  });

  it('getFallbackModels returns only non-cloud models (regression)', async () => {
    mockOrchestrator.getModelMap.mockReturnValue({
      'llama3:8b': ['server-1'],
      'deepseek-v4-pro:cloud': ['server-1'],
      'mistral:7b': ['server-1'],
    });

    await scheduler.start();
    const fallbacks = (scheduler as any).getFallbackModels('server-1', 'llama3:8b');

    for (const model of fallbacks) {
      expect(model).not.toMatch(/:cloud$/i);
      expect(model).not.toMatch(/^cloud-/i);
      expect(model).not.toMatch(/-cloud$/i);
    }
    expect(fallbacks).not.toContain('deepseek-v4-pro:cloud');
    expect(fallbacks).toContain('mistral:7b');
  });
});
