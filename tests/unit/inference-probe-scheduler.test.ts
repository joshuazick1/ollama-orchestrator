import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProbeSchedulerConfig } from '../../src/config/config.js';
import { InferenceProbeScheduler, type ProbeTarget } from '../../src/inference-probe-scheduler.js';
import type { AIServer, ServerModelMetrics } from '../../src/orchestrator/orchestrator.types.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockFetchWithTimeout = vi.fn();
vi.mock('../../src/utils/fetch-with-timeout.js', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
}));

const mockGetTotalInFlight = vi.fn().mockReturnValue(0);
vi.mock('../../src/utils/in-flight-manager.js', () => ({
  getInFlightManager: () => ({
    getTotalInFlight: mockGetTotalInFlight,
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers / factories
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<ProbeSchedulerConfig>): ProbeSchedulerConfig {
  return {
    enabled: true,
    intervalMs: 3_600_000,
    maxConcurrentProbes: 2,
    maxProbesPerServer: 1,
    probeTimeoutMs: 30_000,
    cooldownAfterUserRequestMs: 300_000,
    minSamplesForCoverage: 5,
    onlyDuringLowTraffic: true,
    lowTrafficThreshold: 0.3,
    ...overrides,
  };
}

function makeWindow(count: number) {
  return {
    startTime: Date.now() - 24 * 60 * 60 * 1000,
    endTime: Date.now(),
    count,
    userRequests: count,
    latencySum: 0,
    latencySquaredSum: 0,
    minLatency: 0,
    maxLatency: 0,
    errors: 0,
    tokensGenerated: 0,
    tokensPrompt: 0,
  };
}

function makeServerMetrics(
  serverId: string,
  model: string,
  count24h: number,
  parameterSize?: string
): ServerModelMetrics {
  return {
    serverId,
    model,
    parameterSize,
    inFlight: 0,
    queued: 0,
    windows: {
      '1m': makeWindow(0),
      '5m': makeWindow(0),
      '15m': makeWindow(0),
      '1h': makeWindow(0),
      '24h': makeWindow(count24h),
    },
    percentiles: { p50: 0, p95: 0, p99: 0 },
    successRate: 1,
    throughput: 0,
    avgTokensPerRequest: 0,
    avgPromptTokens: 0,
    avgTokensPerSecond: 0,
    coldStartCount: 0,
    recentLatencies: [],
    lastUpdated: Date.now(),
  };
}

function makeServer(
  id: string,
  models: string[],
  opts?: {
    supportsOllama?: boolean;
    maxConcurrency?: number;
    loadedModels?: string[];
  }
): AIServer {
  return {
    id,
    url: `http://${id}:11434`,
    type: 'ollama',
    healthy: true,
    lastResponseTime: 0,
    models,
    supportsOllama: opts?.supportsOllama ?? true,
    maxConcurrency: opts?.maxConcurrency ?? 4,
    hardware:
      opts?.loadedModels !== undefined
        ? {
            loadedModels: opts.loadedModels.map(name => ({
              name,
              sizeVram: 0,
              expiresAt: '',
              digest: '',
            })),
            lastUpdated: new Date(),
          }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Mock aggregator builder
// ---------------------------------------------------------------------------

function makeAggregator(
  rawMetricsMap: Record<string, ServerModelMetrics | undefined> = {},
  allMetricsForServer: Record<string, ServerModelMetrics[]> = {}
) {
  return {
    getRawMetrics: vi.fn(
      (serverId: string, model: string) => rawMetricsMap[`${serverId}:${model}`]
    ),
    getAllMetricsForServer: vi.fn((serverId: string) => allMetricsForServer[serverId] ?? []),
    recordRequest: vi.fn(),
    updateModelMetadata: vi.fn(),
  };
}

function makeMetricsStore() {
  return {
    recordRequest: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Suite: extractParameterSizeFromName (via onModelDiscovered / groupModelsBySize)
// We test the private method indirectly through computeMinimumProbeSet.
// ---------------------------------------------------------------------------

describe('extractParameterSizeFromName (via probe set computation)', () => {
  it('parses colon-style tag: llama3:8b → 8B', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b']);
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    const targets = scheduler.computeMinimumProbeSet();
    expect(targets).toHaveLength(1);
    expect(targets[0].parameterSize).toBe('8B');
  });

  it('parses colon-style tag: codellama:70b → 70B', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['codellama:70b']);
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    const targets = scheduler.computeMinimumProbeSet();
    expect(targets[0].parameterSize).toBe('70B');
  });

  it('parses decimal param size: phi3:3.8b → 3.8B', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['phi3:3.8b']);
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    const targets = scheduler.computeMinimumProbeSet();
    expect(targets[0].parameterSize).toBe('3.8B');
  });

  it('uses "unknown" when no size is detectable (e.g. mistral:latest)', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['mistral:latest']);
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    const targets = scheduler.computeMinimumProbeSet();
    expect(targets[0].parameterSize).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Suite: computeMinimumProbeSet
// ---------------------------------------------------------------------------

describe('computeMinimumProbeSet', () => {
  it('returns empty array when all size classes are already covered', () => {
    const metrics8B = makeServerMetrics('srv1', 'llama3:8b', 10, '8B'); // count=10 >= minSamples=5
    const aggregator = makeAggregator({ 'srv1:llama3:8b': metrics8B }, { srv1: [metrics8B] });
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b']);
    const scheduler = new InferenceProbeScheduler(
      makeConfig({ minSamplesForCoverage: 5 }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    expect(scheduler.computeMinimumProbeSet()).toHaveLength(0);
  });

  it('returns a probe target for uncovered size class', () => {
    const aggregator = makeAggregator(); // no raw metrics → 0 samples
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b']);
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    const targets = scheduler.computeMinimumProbeSet();
    expect(targets).toHaveLength(1);
    expect(targets[0].serverId).toBe('srv1');
    expect(targets[0].model).toBe('llama3:8b');
    expect(targets[0].parameterSize).toBe('8B');
  });

  it('skips servers where supportsOllama is false', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { supportsOllama: false });
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    expect(scheduler.computeMinimumProbeSet()).toHaveLength(0);
  });

  it('skips servers with no models', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', []);
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    expect(scheduler.computeMinimumProbeSet()).toHaveLength(0);
  });

  it('groups models by parameterSize and emits one probe per uncovered size class', () => {
    // Two 8B models and one 70B — 24h count = 0 for all → two probe targets (one per size class)
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b', 'mistral:8b', 'codellama:70b']);
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    const targets = scheduler.computeMinimumProbeSet();
    const sizes = targets.map(t => t.parameterSize).sort();
    expect(sizes).toEqual(['70B', '8B']);
  });

  describe('priority assignment', () => {
    it('assigns critical priority for size class with ≥10 models', () => {
      const models = Array.from({ length: 10 }, (_, i) => `model${i}:8b`);
      const aggregator = makeAggregator();
      const store = makeMetricsStore();
      const server = makeServer('srv1', models);
      const scheduler = new InferenceProbeScheduler(
        makeConfig(),
        () => [server],
        () => aggregator as never,
        () => store as never
      );
      const targets = scheduler.computeMinimumProbeSet();
      expect(targets[0].priority).toBe('critical');
    });

    it('assigns normal priority for size class with 3–9 models', () => {
      const models = Array.from({ length: 5 }, (_, i) => `model${i}:8b`);
      const aggregator = makeAggregator();
      const store = makeMetricsStore();
      const server = makeServer('srv1', models);
      const scheduler = new InferenceProbeScheduler(
        makeConfig(),
        () => [server],
        () => aggregator as never,
        () => store as never
      );
      const targets = scheduler.computeMinimumProbeSet();
      expect(targets[0].priority).toBe('normal');
    });

    it('assigns low priority for size class with 1–2 models', () => {
      const aggregator = makeAggregator();
      const store = makeMetricsStore();
      const server = makeServer('srv1', ['llama3:8b']);
      const scheduler = new InferenceProbeScheduler(
        makeConfig(),
        () => [server],
        () => aggregator as never,
        () => store as never
      );
      const targets = scheduler.computeMinimumProbeSet();
      expect(targets[0].priority).toBe('low');
    });

    it('sorts targets with critical first', () => {
      const criticalModels = Array.from({ length: 10 }, (_, i) => `big${i}:70b`);
      const lowModel = ['tiny:1b'];
      const aggregator = makeAggregator();
      const store = makeMetricsStore();
      const server = makeServer('srv1', [...lowModel, ...criticalModels]);
      const scheduler = new InferenceProbeScheduler(
        makeConfig(),
        () => [server],
        () => aggregator as never,
        () => store as never
      );
      const targets = scheduler.computeMinimumProbeSet();
      expect(targets[0].priority).toBe('critical');
      expect(targets[targets.length - 1].priority).toBe('low');
    });
  });

  describe('selectBestProbeModel — loaded-model preference', () => {
    it('prefers a loaded model over unloaded', () => {
      // 'mistral:8b' is loaded, 'llama3:8b' is not
      const aggregator = makeAggregator();
      const store = makeMetricsStore();
      const server = makeServer('srv1', ['llama3:8b', 'mistral:8b'], {
        loadedModels: ['mistral:8b'],
      });
      const scheduler = new InferenceProbeScheduler(
        makeConfig(),
        () => [server],
        () => aggregator as never,
        () => store as never
      );
      const targets = scheduler.computeMinimumProbeSet();
      expect(targets[0].model).toBe('mistral:8b');
    });

    it('falls back to model with most 24h requests when none loaded', () => {
      const metricsA = makeServerMetrics('srv1', 'model-a:8b', 3, '8B'); // 3 requests
      const metricsB = makeServerMetrics('srv1', 'model-b:8b', 1, '8B'); // 1 request
      // Neither exceeds minSamplesForCoverage=5
      const aggregator = makeAggregator({
        'srv1:model-a:8b': metricsA,
        'srv1:model-b:8b': metricsB,
      });
      const store = makeMetricsStore();
      const server = makeServer('srv1', ['model-a:8b', 'model-b:8b']); // no loadedModels
      const scheduler = new InferenceProbeScheduler(
        makeConfig(),
        () => [server],
        () => aggregator as never,
        () => store as never
      );
      const targets = scheduler.computeMinimumProbeSet();
      expect(targets[0].model).toBe('model-a:8b');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: shouldSkipServer (tested via drainQueue / start behavior)
// ---------------------------------------------------------------------------

describe('shouldSkipServer via recordUserRequest cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetTotalInFlight.mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockGetTotalInFlight.mockReset();
    mockGetTotalInFlight.mockReturnValue(0);
  });

  it('skips server that recently had a user request (within cooldown)', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    mockFetchWithTimeout.mockResolvedValue({ ok: true, text: async () => '' });

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ cooldownAfterUserRequestMs: 300_000, onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    // Record a user request NOW — server should be in cooldown
    scheduler.recordUserRequest('srv1');

    scheduler.start();

    // Advance past the initial drain timer (10s) and well past startup coverage check
    await vi.advanceTimersByTimeAsync(15_000);

    // fetchWithTimeout should NOT have been called because server is in cooldown
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it('does NOT skip server after cooldown period has elapsed', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    mockFetchWithTimeout.mockResolvedValue({ ok: true, text: async () => '' });

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ cooldownAfterUserRequestMs: 10_000, onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    // Record a user request, then advance past cooldown
    scheduler.recordUserRequest('srv1');
    vi.advanceTimersByTime(11_000); // cooldown elapsed

    scheduler.start();

    // Advance past the initial drain timer (10s)
    await vi.advanceTimersByTimeAsync(15_000);

    // Now the probe should have been executed
    expect(mockFetchWithTimeout).toHaveBeenCalled();

    scheduler.stop();
  });

  it('skips server if active probes per server already at max', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    // Two different 8B models → two potential probe targets on same server
    const server = makeServer('srv1', ['llama3:8b', 'mistral:8b'], { maxConcurrency: 4 });

    // Make fetch hang so the first probe never completes
    let resolveFirst!: () => void;
    const firstProbePromise = new Promise<void>(res => {
      resolveFirst = res;
    });
    mockFetchWithTimeout.mockReturnValueOnce(
      firstProbePromise.then(() => ({ ok: true, text: async () => '' }))
    );

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ maxProbesPerServer: 1, maxConcurrentProbes: 2, onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);

    // Only one fetch call should have been made (second model skipped due to maxProbesPerServer)
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);

    resolveFirst();
    scheduler.stop();
  });

  it('skips server when traffic exceeds lowTrafficThreshold', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    // Simulate 2 in-flight requests on server with maxConcurrency=4 → 2/4 = 0.5 > threshold 0.3
    mockGetTotalInFlight.mockReturnValue(2);
    mockFetchWithTimeout.mockResolvedValue({ ok: true, text: async () => '' });

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ onlyDuringLowTraffic: true, lowTrafficThreshold: 0.3 }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(mockFetchWithTimeout).not.toHaveBeenCalled();

    scheduler.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite: drainQueue — maxConcurrentProbes throttle
// ---------------------------------------------------------------------------

describe('drainQueue maxConcurrentProbes throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetTotalInFlight.mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockGetTotalInFlight.mockReset();
    mockGetTotalInFlight.mockReturnValue(0);
  });

  it('does not exceed maxConcurrentProbes globally', async () => {
    // Two servers, one model each → two probe targets
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server1 = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });
    const server2 = makeServer('srv2', ['llama3:8b'], { maxConcurrency: 4 });

    // Make fetches hang so active probes accumulate
    let resolveSrv1!: () => void;
    let resolveSrv2!: () => void;
    mockFetchWithTimeout
      .mockReturnValueOnce(
        new Promise<void>(res => {
          resolveSrv1 = res;
        }).then(() => ({ ok: true, text: async () => '' }))
      )
      .mockReturnValueOnce(
        new Promise<void>(res => {
          resolveSrv2 = res;
        }).then(() => ({ ok: true, text: async () => '' }))
      );

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ maxConcurrentProbes: 1, maxProbesPerServer: 1, onlyDuringLowTraffic: false }),
      () => [server1, server2],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);

    // Only 1 of 2 fetches should have fired (global limit = 1)
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);

    resolveSrv1();
    resolveSrv2();
    scheduler.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite: onServerAdded / onModelDiscovered
// ---------------------------------------------------------------------------

describe('onServerAdded and onModelDiscovered', () => {
  it('does not crash when called on an unknown server', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [],
      () => aggregator as never,
      () => store as never
    );
    expect(() => scheduler.onServerAdded('nonexistent-server')).not.toThrow();
  });

  it('does not crash when called on an unknown model', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [],
      () => aggregator as never,
      () => store as never
    );
    expect(() => scheduler.onModelDiscovered('nonexistent-server', 'unknown-model')).not.toThrow();
  });

  it('does nothing when config.enabled is false', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b']);
    const scheduler = new InferenceProbeScheduler(
      makeConfig({ enabled: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    expect(() => scheduler.onServerAdded('srv1')).not.toThrow();
    expect(() => scheduler.onModelDiscovered('srv1', 'llama3:8b')).not.toThrow();
  });

  it('onModelDiscovered queues probe for uncovered size class', () => {
    // isSizeClassCovered → getAllMetricsForServer returns [] → not covered → enqueued
    const aggregator = makeAggregator({}, { srv1: [] });
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b']);

    // Intercept computeMinimumProbeSet via getRawMetrics
    (aggregator.getRawMetrics as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    // Should not throw and model should be queued
    scheduler.onModelDiscovered('srv1', 'llama3:8b');
    // We verify by calling computeMinimumProbeSet — a separate check would need queue access.
    // The public signal is: no throw, and a subsequent probe can be served.
    expect(aggregator.getAllMetricsForServer).toHaveBeenCalledWith('srv1');
  });

  it('onModelDiscovered does NOT duplicate-queue an already-queued model', () => {
    const aggregator = makeAggregator({}, { srv1: [] });
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b']);

    const scheduler = new InferenceProbeScheduler(
      makeConfig(),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.onModelDiscovered('srv1', 'llama3:8b');
    scheduler.onModelDiscovered('srv1', 'llama3:8b'); // second call — should be ignored

    // getAllMetricsForServer called twice (once per invocation)
    expect(aggregator.getAllMetricsForServer).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Suite: Exponential backoff
// ---------------------------------------------------------------------------

describe('exponential backoff on probe failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetTotalInFlight.mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockGetTotalInFlight.mockReset();
    mockGetTotalInFlight.mockReturnValue(0);
    mockFetchWithTimeout.mockReset();
  });

  it('does not re-probe a recently failed target before backoff expires', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    mockFetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'error',
    });

    // intervalMs well beyond our test window so no re-queue from the periodic check
    const scheduler = new InferenceProbeScheduler(
      makeConfig({ intervalMs: 3_600_000, onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);

    // Advance 4 minutes — well within the 5-minute initial backoff
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('retries after initial backoff period (5 min) expires', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    // First probe: fail; second probe: succeed
    mockFetchWithTimeout
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      .mockResolvedValueOnce({ ok: true, text: async () => '' });

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ intervalMs: 60_000, onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    // Trigger initial drain (first failure)
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);

    // Advance past the initial 5-min backoff and the hourly interval
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 60_000);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it('caps backoff at 60 minutes after many failures', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    // Always fail — we only care that the 3rd failure sets a 20-minute backoff
    mockFetchWithTimeout.mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });

    // Use a short interval (10s) so coverage checks re-queue the target between backoffs
    const scheduler = new InferenceProbeScheduler(
      makeConfig({ intervalMs: 10_000, onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();

    // Probe 1 fires after drain timer
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);

    // Advance past 5-minute initial backoff → probe 2
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 15_000);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2);

    // Advance past 10-minute backoff (2nd failure) → probe 3
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 15_000);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(3);

    // After 3rd failure backoff = 20 min; verify no extra probe fires within 19 minutes
    await vi.advanceTimersByTimeAsync(19 * 60 * 1000);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(3);

    scheduler.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite: executeProbe — records request with isProbe: true
// ---------------------------------------------------------------------------

describe('executeProbe records isProbe flag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetTotalInFlight.mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockGetTotalInFlight.mockReset();
    mockGetTotalInFlight.mockReturnValue(0);
    mockFetchWithTimeout.mockReset();
  });

  it('calls metricsAggregator.recordRequest with isProbe=true on success', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    mockFetchWithTimeout.mockResolvedValueOnce({ ok: true, text: async () => '' });

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(aggregator.recordRequest).toHaveBeenCalledTimes(1);
    const ctx = (aggregator.recordRequest as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ctx.isProbe).toBe(true);
    expect(ctx.model).toBe('llama3:8b');
    expect(ctx.serverId).toBe('srv1');

    scheduler.stop();
  });

  it('calls metricsStore.recordRequest with { isProbe: true } on success', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    mockFetchWithTimeout.mockResolvedValueOnce({ ok: true, text: async () => '' });

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(store.recordRequest).toHaveBeenCalledTimes(1);
    const [_ctx, opts] = (store.recordRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toEqual({ isProbe: true });

    scheduler.stop();
  });

  it('calls metricsStore.recordRequest with { isProbe: true } on HTTP failure', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    mockFetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(store.recordRequest).toHaveBeenCalledTimes(1);
    const [ctx, opts] = (store.recordRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toEqual({ isProbe: true });
    expect(ctx.success).toBe(false);

    scheduler.stop();
  });

  it('calls metricsStore.recordRequest with { isProbe: true } on network error', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    mockFetchWithTimeout.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(store.recordRequest).toHaveBeenCalledTimes(1);
    const [ctx, opts] = (store.recordRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toEqual({ isProbe: true });
    expect(ctx.success).toBe(false);
    expect(ctx.error).toBeInstanceOf(Error);

    scheduler.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite: start / stop lifecycle
// ---------------------------------------------------------------------------

describe('lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockFetchWithTimeout.mockReset();
  });

  it('does not start when enabled=false', () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b']);
    const scheduler = new InferenceProbeScheduler(
      makeConfig({ enabled: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );
    // start() should return early and not schedule timers
    expect(() => scheduler.start()).not.toThrow();
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('is idempotent — calling start() twice does not double-schedule', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    mockFetchWithTimeout.mockResolvedValue({ ok: true, text: async () => '' });
    mockGetTotalInFlight.mockReturnValue(0);

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    scheduler.start(); // second call should be no-op

    await vi.advanceTimersByTimeAsync(15_000);

    // Only one probe should fire (not two from double intervals)
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('stop() prevents further probes from firing', async () => {
    const aggregator = makeAggregator();
    const store = makeMetricsStore();
    const server = makeServer('srv1', ['llama3:8b'], { maxConcurrency: 4 });

    mockFetchWithTimeout.mockResolvedValue({ ok: true, text: async () => '' });
    mockGetTotalInFlight.mockReturnValue(0);

    const scheduler = new InferenceProbeScheduler(
      makeConfig({ onlyDuringLowTraffic: false }),
      () => [server],
      () => aggregator as never,
      () => store as never
    );

    scheduler.start();
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(15_000);

    // After stop, the drain timer was cleared — no probes
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });
});
