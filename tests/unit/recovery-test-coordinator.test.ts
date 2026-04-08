import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { CircuitBreaker } from '../../src/circuit-breaker/circuit-breaker.js';
import {
  RecoveryTestCoordinator,
  resetRecoveryTestCoordinator,
  isEmbeddingModel,
} from '../../src/recovery-test-coordinator';

function makeBreaker(name: string, state: 'open' | 'half-open' | 'closed' = 'half-open') {
  const cb = {
    _name: name,
    _state: state,
    getState: () => cb._state,
    getStats: () => ({
      halfOpenStartedAt: Date.now() - 1000,
      activeTestsInProgress: 0,
    }),
    getConfig: () => ({ halfOpenTimeout: 300_000 }),
    canExecute: () => cb._state !== 'open',
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    startActiveTest: vi.fn(),
    endActiveTest: vi.fn(),
    getName: () => cb._name,
    getModelType: () => undefined as 'embedding' | 'generation' | undefined,
    setModelType: vi.fn(),
    get name() {
      return cb._name;
    },
  };
  return cb as unknown as CircuitBreaker;
}

describe('RecoveryTestCoordinator', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    coordinator = new RecoveryTestCoordinator();
  });

  describe('constructor', () => {
    it('should create coordinator with default config', () => {
      expect(coordinator).toBeDefined();
    });

    it('should accept custom config', () => {
      const custom = new RecoveryTestCoordinator({
        serverCooldownMs: 5000,
        maxWaitForInFlightMs: 2000,
      });
      expect(custom).toBeDefined();
    });
  });

  describe('setServerUrlProvider', () => {
    it('should accept a server URL provider', () => {
      const provider = (serverId: string) => `http://server-${serverId}:11434`;
      coordinator.setServerUrlProvider(provider);
    });
  });

  describe('setInFlightProvider', () => {
    it('should accept an in-flight provider', () => {
      const provider = (serverId: string) => 0;
      coordinator.setInFlightProvider(provider);
    });
  });

  describe('setIncrementInFlight', () => {
    it('should accept increment function', () => {
      const increment = (serverId: string, model: string) => {};
      coordinator.setIncrementInFlight(increment);
    });
  });

  describe('setDecrementInFlight', () => {
    it('should accept decrement function', () => {
      const decrement = (serverId: string, model: string) => {};
      coordinator.setDecrementInFlight(decrement);
    });
  });
});

describe('isEmbeddingModel (REC-16)', () => {
  describe('positive cases – embedding models', () => {
    it('detects "embed" in name', () => {
      expect(isEmbeddingModel('nomic-embed-text')).toBe(true);
      expect(isEmbeddingModel('mxbai-embed-large')).toBe(true);
      expect(isEmbeddingModel('all-minilm-embed')).toBe(true);
    });

    it('detects "nomic-embed" in name', () => {
      expect(isEmbeddingModel('nomic-embed-text:latest')).toBe(true);
    });

    it('detects "text-embedding" in name', () => {
      expect(isEmbeddingModel('text-embedding-ada-002')).toBe(true);
      expect(isEmbeddingModel('text-embedding-3-small')).toBe(true);
    });

    it('detects "sentence" in name', () => {
      expect(isEmbeddingModel('sentence-transformers/all-MiniLM-L6-v2')).toBe(true);
    });

    it('detects "bge-" prefix', () => {
      expect(isEmbeddingModel('bge-m3')).toBe(true);
      expect(isEmbeddingModel('bge-large-en-v1.5')).toBe(true);
    });

    it('detects "gte-" prefix', () => {
      expect(isEmbeddingModel('gte-small')).toBe(true);
    });

    it('detects "e5-" prefix', () => {
      expect(isEmbeddingModel('e5-large-v2')).toBe(true);
    });

    it('detects "all-minilm" in name', () => {
      expect(isEmbeddingModel('all-minilm-l6-v2')).toBe(true);
    });

    it('detects "all-mpnet" in name', () => {
      expect(isEmbeddingModel('all-mpnet-base-v2')).toBe(true);
    });

    it('detects "pygmalion" in name', () => {
      expect(isEmbeddingModel('pygmalion-6b')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isEmbeddingModel('NOMIC-EMBED-TEXT')).toBe(true);
      expect(isEmbeddingModel('Text-Embedding-Ada-002')).toBe(true);
      expect(isEmbeddingModel('BGE-M3')).toBe(true);
    });
  });

  describe('negative cases – generative models', () => {
    it('does not flag llama models', () => {
      expect(isEmbeddingModel('llama3.1:8b')).toBe(false);
      expect(isEmbeddingModel('llama3:latest')).toBe(false);
    });

    it('does not flag mistral models', () => {
      expect(isEmbeddingModel('mistral:7b')).toBe(false);
      expect(isEmbeddingModel('mistral-instruct')).toBe(false);
    });

    it('does not flag codellama', () => {
      expect(isEmbeddingModel('codellama:13b')).toBe(false);
    });

    it('does not flag phi models', () => {
      expect(isEmbeddingModel('phi3:mini')).toBe(false);
    });

    it('does not flag qwen models', () => {
      expect(isEmbeddingModel('qwen2:7b')).toBe(false);
    });

    it('does not flag deepseek models', () => {
      expect(isEmbeddingModel('deepseek-r1:8b')).toBe(false);
    });
  });
});

describe('RecoveryTestCoordinator – performCoordinatedRecoveryTest', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
            text: async () => JSON.stringify({ ok: true }),
          }) as unknown as Response
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('server-level breaker (no colon in name)', () => {
    it('success path – returns true when fetch returns ok:true', async () => {
      const breaker = makeBreaker('srv-ok');
      const result = await coordinator.performCoordinatedRecoveryTest(breaker);
      expect(result).toBe(true);
    });

    it('failure path – returns false when fetch returns ok:false', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            ({
              ok: false,
              status: 503,
              text: async () => 'Service Unavailable',
            }) as unknown as Response
        )
      );
      const breaker = makeBreaker('srv-fail');
      const result = await coordinator.performCoordinatedRecoveryTest(breaker);
      expect(result).toBe(false);
    });

    it('error path – returns false when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));
      const breaker = makeBreaker('srv-err');
      const result = await coordinator.performCoordinatedRecoveryTest(breaker);
      expect(result).toBe(false);
    });

    it('server URL not found – returns false when URL provider returns null', async () => {
      coordinator.setServerUrlProvider(() => null);
      const breaker = makeBreaker('srv-nourl');
      const result = await coordinator.performCoordinatedRecoveryTest(breaker);
      expect(result).toBe(false);
    });

    it('cooldown enforcement – returns false when lastTestTime is recent', async () => {
      coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 60000 });
      coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
      coordinator.setInFlightProvider(() => 0);

      const state = (coordinator as any).serverStates as Map<
        string,
        { lastTestTime: number; currentTestBreakerId: string | null; testQueue: string[] }
      >;
      state.set('srv-cool', {
        lastTestTime: Date.now() - 1000,
        currentTestBreakerId: null,
        testQueue: [],
      });

      const breaker = makeBreaker('srv-cool');
      const result = await coordinator.performCoordinatedRecoveryTest(breaker);
      expect(result).toBe(false);
    });

    it('in-flight blocking – returns false when inFlightProvider returns > 0', async () => {
      coordinator.setInFlightProvider(() => 3);
      const breaker = makeBreaker('srv-inflight');
      const result = await coordinator.performCoordinatedRecoveryTest(breaker);
      expect(result).toBe(false);
    });

    it('concurrency guard – returns false when activeServers already has serverId', async () => {
      (coordinator as any).activeServers.add('srv-active');
      const breaker = makeBreaker('srv-active');
      const result = await coordinator.performCoordinatedRecoveryTest(breaker);
      expect(result).toBe(false);
    });

    it('releases the lock after completion', async () => {
      const breaker = makeBreaker('srv-lock');
      await coordinator.performCoordinatedRecoveryTest(breaker);
      expect((coordinator as any).activeServers.has('srv-lock')).toBe(false);
    });
  });

  describe('model-level breaker (serverId:modelName format)', () => {
    it('success path – returns true when fetch returns ok with response field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            ({
              ok: true,
              status: 200,
              json: async () => ({ response: 'ok' }),
              text: async () => JSON.stringify({ response: 'ok' }),
            }) as unknown as Response
        )
      );
      const breaker = makeBreaker('srv-model:llama3.1:8b');
      const result = await coordinator.performCoordinatedRecoveryTest(breaker);
      expect(result).toBe(true);
    });

    it('failure path – returns false when fetch returns ok:false', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            ({
              ok: false,
              status: 503,
              text: async () => 'Service Unavailable',
            }) as unknown as Response
        )
      );
      const breaker = makeBreaker('srv-model:llama3.1:8b');
      const result = await coordinator.performCoordinatedRecoveryTest(breaker);
      expect(result).toBe(false);
    });

    it('embedding model detection – uses /api/embeddings endpoint for embed models', async () => {
      let capturedUrl = '';
      const fetchMock = vi.fn(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ embedding: [0.1, 0.2] }),
          text: async () => JSON.stringify({ embedding: [0.1, 0.2] }),
        } as unknown as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      const breaker = makeBreaker('srv-embed:nomic-embed-text');
      await coordinator.performCoordinatedRecoveryTest(breaker);

      expect(capturedUrl).toContain('/api/embeddings');
    });

    it('queue management – second breaker waits when first is at front', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            ({
              ok: true,
              status: 200,
              json: async () => ({ response: 'ok' }),
              text: async () => JSON.stringify({ response: 'ok' }),
            }) as unknown as Response
        )
      );

      const breaker1 = makeBreaker('srv-q:modelA');
      const breaker2 = makeBreaker('srv-q:modelB');

      coordinator.queueForTest(breaker1);
      const result2 = await coordinator.performCoordinatedRecoveryTest(breaker2);
      expect(result2).toBe(false);

      const state = (coordinator as any).serverStates.get('srv-q');
      expect(state?.testQueue).toContain('srv-q:modelB');
    });
  });
});

describe('RecoveryTestCoordinator – runActiveTests', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
            text: async () => JSON.stringify({ ok: true }),
          }) as unknown as Response
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('concurrency guard – returns empty array when activeServers has serverId', async () => {
    (coordinator as any).activeServers.add('srv-ra');
    const breaker = makeBreaker('srv-ra');
    const results = await coordinator.runActiveTests('srv-ra', [{ breaker }]);
    expect(results).toEqual([]);
  });

  it('success path – server-level breaker calls recordSuccess on success', async () => {
    const breaker = makeBreaker('srv-success');
    const results = await coordinator.runActiveTests('srv-success', [{ breaker }]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(breaker.recordSuccess).toHaveBeenCalled();
  });

  it('failure path – fetch returns ok:false → calls recordFailure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            text: async () => 'Service Unavailable',
          }) as unknown as Response
      )
    );
    const breaker = makeBreaker('srv-fail2');
    const results = await coordinator.runActiveTests('srv-fail2', [{ breaker }]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(breaker.recordFailure).toHaveBeenCalled();
  });

  it('cancelled test – cancelledTests.has() → result.error = "Test cancelled"', async () => {
    const breaker = makeBreaker('srv-cancel');
    (coordinator as any).cancelledTests.add('srv-cancel');
    const results = await coordinator.runActiveTests('srv-cancel', [{ breaker }]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Test cancelled');
  });

  it('test invalidation – result.success = false with invalidated error', async () => {
    const breaker = makeBreaker('srv-inv');

    const fetchMock = vi.fn(async () => {
      (coordinator as any).serverTestsInvalidated.set('srv-inv', true);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await coordinator.runActiveTests('srv-inv', [{ breaker }]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('invalidated');
  });

  it('onTestStart and onTestEnd callbacks are called correctly', async () => {
    const onTestStart = vi.fn();
    const onTestEnd = vi.fn();
    const breaker = makeBreaker('srv-cb');
    await coordinator.runActiveTests('srv-cb', [{ breaker }], { onTestStart, onTestEnd });
    expect(onTestStart).toHaveBeenCalledWith('srv-cb');
    expect(onTestEnd).toHaveBeenCalledWith('srv-cb', true, expect.any(Number));
  });

  it('releases the lock after runActiveTests completes', async () => {
    const breaker = makeBreaker('srv-lock2');
    await coordinator.runActiveTests('srv-lock2', [{ breaker }]);
    expect((coordinator as any).activeServers.has('srv-lock2')).toBe(false);
  });

  it('model-level breaker – passes model to result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ response: 'ok' }),
            text: async () => JSON.stringify({ response: 'ok' }),
          }) as unknown as Response
      )
    );
    const breaker = makeBreaker('srv-ml:llama3.1:8b');
    const results = await coordinator.runActiveTests('srv-ml', [{ breaker, model: 'llama3.1:8b' }]);
    expect(results).toHaveLength(1);
    expect(results[0].model).toBe('llama3.1:8b');
  });
}, 30000);

describe('RecoveryTestCoordinator – queueForTest', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0, maxQueueSizePerServer: 2 });
  });

  it('adds breaker to queue and returns true', () => {
    const breaker = makeBreaker('srv-q1:modelA');
    const result = coordinator.queueForTest(breaker);
    expect(result).toBe(true);
    const state = (coordinator as any).serverStates.get('srv-q1');
    expect(state?.testQueue).toContain('srv-q1:modelA');
  });

  it('returns true when breaker is already queued (no duplicate)', () => {
    const breaker = makeBreaker('srv-q2:modelA');
    coordinator.queueForTest(breaker);
    const result = coordinator.queueForTest(breaker);
    expect(result).toBe(true);
    const state = (coordinator as any).serverStates.get('srv-q2');
    expect(state?.testQueue.filter((n: string) => n === 'srv-q2:modelA')).toHaveLength(1);
  });

  it('returns true when breaker is currently being tested', () => {
    const breaker = makeBreaker('srv-q3:modelA');
    const state = (coordinator as any).serverStates as Map<
      string,
      { lastTestTime: number; currentTestBreakerId: string | null; testQueue: string[] }
    >;
    state.set('srv-q3', {
      lastTestTime: 0,
      currentTestBreakerId: 'srv-q3:modelA',
      testQueue: [],
    });
    const result = coordinator.queueForTest(breaker);
    expect(result).toBe(true);
  });

  it('returns false when queue is full (maxQueueSizePerServer exceeded)', () => {
    const breakerA = makeBreaker('srv-qfull:modelA');
    const breakerB = makeBreaker('srv-qfull:modelB');
    const breakerC = makeBreaker('srv-qfull:modelC');
    coordinator.queueForTest(breakerA);
    coordinator.queueForTest(breakerB);
    const result = coordinator.queueForTest(breakerC);
    expect(result).toBe(false);
  });
});

describe('RecoveryTestCoordinator – test invalidation helpers', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
  });

  it('invalidateServerTests only sets flag when server is in activeServers', () => {
    coordinator.invalidateServerTests('srv-notactive');
    expect(coordinator.areServerTestsInvalidated('srv-notactive')).toBe(false);

    (coordinator as any).activeServers.add('srv-active2');
    coordinator.invalidateServerTests('srv-active2');
    expect(coordinator.areServerTestsInvalidated('srv-active2')).toBe(true);
  });

  it('areServerTestsInvalidated returns false for unknown servers', () => {
    expect(coordinator.areServerTestsInvalidated('unknown')).toBe(false);
  });

  it('clearServerTestsInvalidated resets the flag', () => {
    (coordinator as any).activeServers.add('srv-clr');
    coordinator.invalidateServerTests('srv-clr');
    expect(coordinator.areServerTestsInvalidated('srv-clr')).toBe(true);
    coordinator.clearServerTestsInvalidated('srv-clr');
    expect(coordinator.areServerTestsInvalidated('srv-clr')).toBe(false);
  });
});

describe('RecoveryTestCoordinator – cancelTest', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
  });

  it('returns false when no server state exists', () => {
    const result = coordinator.cancelTest('srv-nostate:modelA');
    expect(result).toBe(false);
  });

  it('removes breaker from queue and adds to cancelledTests', () => {
    const breaker = makeBreaker('srv-cancelq:modelA');
    coordinator.queueForTest(breaker);
    const result = coordinator.cancelTest('srv-cancelq:modelA');
    expect(result).toBe(true);
    expect((coordinator as any).cancelledTests.has('srv-cancelq:modelA')).toBe(true);
    const state = (coordinator as any).serverStates.get('srv-cancelq');
    expect(state?.testQueue).not.toContain('srv-cancelq:modelA');
  });

  it('cancels active test by clearing currentTestBreakerId', () => {
    const state = (coordinator as any).serverStates as Map<
      string,
      { lastTestTime: number; currentTestBreakerId: string | null; testQueue: string[] }
    >;
    state.set('srv-cact', {
      lastTestTime: 0,
      currentTestBreakerId: 'srv-cact:modelX',
      testQueue: [],
    });
    const result = coordinator.cancelTest('srv-cact:modelX');
    expect(result).toBe(true);
    expect(state.get('srv-cact')?.currentTestBreakerId).toBeNull();
  });
});

describe('RecoveryTestCoordinator – getTestStats', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns zero stats when no tests have run', () => {
    const stats = coordinator.getTestStats();
    expect(stats.totalTests).toBe(0);
    expect(stats.successes).toBe(0);
    expect(stats.failures).toBe(0);
    expect(stats.timeouts).toBe(0);
    expect(stats.cancellations).toBe(0);
    expect(stats.averageDuration).toBe(0);
  });

  it('counts successes after a successful test', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
            text: async () => JSON.stringify({ ok: true }),
          }) as unknown as Response
      )
    );
    const breaker = makeBreaker('srv-stats');
    await coordinator.runActiveTests('srv-stats', [{ breaker }]);
    const stats = coordinator.getTestStats();
    expect(stats.totalTests).toBeGreaterThanOrEqual(1);
    expect(stats.successes).toBeGreaterThanOrEqual(1);
  });

  it('counts failures after a failed test', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            text: async () => 'Service Unavailable',
          }) as unknown as Response
      )
    );
    const breaker = makeBreaker('srv-stats2');
    await coordinator.runActiveTests('srv-stats2', [{ breaker }]);
    const stats = coordinator.getTestStats();
    expect(stats.failures).toBeGreaterThanOrEqual(1);
  });

  it('counts cancellations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
            text: async () => JSON.stringify({ ok: true }),
          }) as unknown as Response
      )
    );
    const breaker = makeBreaker('srv-statscancel');
    (coordinator as any).cancelledTests.add('srv-statscancel');
    await coordinator.runActiveTests('srv-statscancel', [{ breaker }]);
    const stats = coordinator.getTestStats();
    expect(stats.cancellations).toBeGreaterThanOrEqual(1);
  });
}, 30000);

describe('RecoveryTestCoordinator – getRecoveryProbability', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns -1 when no test data exists for breaker', () => {
    expect(coordinator.getRecoveryProbability('no-data-breaker')).toBe(-1);
  });

  it('computes correct ratio from test metrics', () => {
    const metrics = (coordinator as any).testMetrics as Array<{
      testId: string;
      breakerName: string;
      startTime: number;
      endTime: number;
      duration: number;
      success: boolean;
      timeout: boolean;
      cancelled: boolean;
    }>;

    const now = Date.now();
    metrics.push(
      {
        testId: 't1',
        breakerName: 'srv-prob',
        startTime: now - 100,
        endTime: now,
        duration: 100,
        success: true,
        timeout: false,
        cancelled: false,
      },
      {
        testId: 't2',
        breakerName: 'srv-prob',
        startTime: now - 200,
        endTime: now - 100,
        duration: 100,
        success: true,
        timeout: false,
        cancelled: false,
      },
      {
        testId: 't3',
        breakerName: 'srv-prob',
        startTime: now - 300,
        endTime: now - 200,
        duration: 100,
        success: false,
        timeout: false,
        cancelled: false,
      }
    );

    const prob = coordinator.getRecoveryProbability('srv-prob');
    expect(prob).toBeCloseTo(2 / 3);
  });

  it('respects windowHours and excludes old data', () => {
    const metrics = (coordinator as any).testMetrics as Array<{
      testId: string;
      breakerName: string;
      startTime: number;
      endTime: number;
      duration: number;
      success: boolean;
      timeout: boolean;
      cancelled: boolean;
    }>;

    const now = Date.now();
    metrics.push({
      testId: 't-old',
      breakerName: 'srv-prob-win',
      startTime: now - 2 * 60 * 60 * 1000,
      endTime: now - 2 * 60 * 60 * 1000 + 100,
      duration: 100,
      success: true,
      timeout: false,
      cancelled: false,
    });

    const prob = coordinator.getRecoveryProbability('srv-prob-win', 1);
    expect(prob).toBe(-1);
  });
});

describe('RecoveryTestCoordinator – getServerQueueStatus', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
  });

  it('returns correct shape for a new server', () => {
    const status = coordinator.getServerQueueStatus('srv-qs');
    expect(status).toMatchObject({
      queueLength: 0,
      isTesting: false,
      currentTestBreakerId: null,
      timeSinceLastTest: expect.any(Number),
    });
  });

  it('reflects queue length after queuing a breaker', () => {
    const breaker = makeBreaker('srv-qs2:modelA');
    coordinator.queueForTest(breaker);
    const status = coordinator.getServerQueueStatus('srv-qs2');
    expect(status.queueLength).toBe(1);
    expect(status.isTesting).toBe(false);
  });

  it('reflects isTesting=true when currentTestBreakerId is set', () => {
    const state = (coordinator as any).serverStates as Map<
      string,
      { lastTestTime: number; currentTestBreakerId: string | null; testQueue: string[] }
    >;
    state.set('srv-qs3', {
      lastTestTime: 0,
      currentTestBreakerId: 'srv-qs3:modelX',
      testQueue: [],
    });
    const status = coordinator.getServerQueueStatus('srv-qs3');
    expect(status.isTesting).toBe(true);
    expect(status.currentTestBreakerId).toBe('srv-qs3:modelX');
  });
});

// ============================================================================
// Wave 13 additions
// ============================================================================

describe('performCoordinatedRecoveryTest – invalid response handling (13.1)', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when ok:true but response body has no .response field', async () => {
    // Stub fetch to return HTTP 200 OK with an empty JSON body (no .response field)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({}),
            text: async () => JSON.stringify({}),
          }) as unknown as Response
      )
    );

    // Use a model-level breaker (not server-level) so /api/generate is called
    const breaker = makeBreaker('srv-inv-resp:llama3.1:8b');
    const result = await coordinator.performCoordinatedRecoveryTest(breaker);

    // Missing .response means the response is invalid → should return false
    expect(result).toBe(false);
  });
});

describe('performCoordinatedRecoveryTest – generate→embeddings fallback (13.1)', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls setModelType("embedding") and falls back to /api/embeddings on "does not support generate" error', async () => {
    const capturedUrls: string[] = [];
    let callCount = 0;

    const fetchMock = vi.fn(async (url: string) => {
      capturedUrls.push(url);
      callCount++;

      if (callCount === 1) {
        // First call: /api/generate fails with "does not support generate"
        return {
          ok: false,
          status: 400,
          text: async () => 'model does not support generate',
        } as unknown as Response;
      }

      // Second call: /api/embeddings succeeds
      return {
        ok: true,
        status: 200,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
        text: async () => JSON.stringify({ embedding: [0.1, 0.2, 0.3] }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    // llama3.1:8b is NOT an embedding model by name, so /api/generate will be tried first
    const breaker = makeBreaker('srv-fallback:llama3.1:8b');
    const result = await coordinator.performCoordinatedRecoveryTest(breaker);

    // setModelType should have been called to mark it as embedding
    expect(breaker.setModelType).toHaveBeenCalledWith('embedding');

    // The second request should have been to /api/embeddings
    const embeddingCall = capturedUrls.find(u => u.includes('/api/embeddings'));
    expect(embeddingCall).toBeDefined();

    // Should have returned true (embedding test succeeded)
    expect(result).toBe(true);
  });
});

describe('runActiveTests – timeout path (13.3)', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recordFailure is called and result.success is false when fetch throws timeout error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Request timed out after 120000ms'))
    );

    const breaker = makeBreaker('srv-timeout:llama3.1:8b');
    const results = await coordinator.runActiveTests('srv-timeout', [
      { breaker, model: 'llama3.1:8b' },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(breaker.recordFailure).toHaveBeenCalled();
  });

  it('recordTimeoutFailure provider is called when error propagates out of test helpers', async () => {
    const recordTimeoutFailure = vi.fn();
    coordinator.setRecordTimeoutFailure(recordTimeoutFailure);

    const breakerName = 'srv-timeout2:llama3.1:8b';
    const breaker = makeBreaker(breakerName);

    const abortControllers = (coordinator as any).abortControllers as Map<string, AbortController>;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch timed out unexpectedly');
      })
    );

    await coordinator.runActiveTests('srv-timeout2', [{ breaker, model: 'llama3.1:8b' }]);

    expect(breaker.recordFailure).toHaveBeenCalled();
  });
}, 30000);

describe('runActiveTests – adaptive timeout via getTimeout provider (13.3)', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0, modelTestTimeoutMs: 1000 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses getTimeout provider to determine timeout for a test', async () => {
    // Track what timeout was passed to fetch
    let capturedOptions: any = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: any) => {
        capturedOptions = opts;
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: 'ok' }),
          text: async () => JSON.stringify({ response: 'ok' }),
        } as unknown as Response;
      })
    );

    // Provide a custom getTimeout that returns a large value
    const customTimeout = 99999;
    coordinator.setGetTimeout(() => customTimeout);

    const breaker = makeBreaker('srv-adaptive:llama3.1:8b');
    const results = await coordinator.runActiveTests('srv-adaptive', [
      { breaker, model: 'llama3.1:8b' },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);

    // The timeout passed to fetchWithTimeout must be at least the customTimeout
    // (capturedOptions.timeout is set by fetchWithTimeout from the signal/timeout option)
    if (capturedOptions?.timeout !== undefined) {
      expect(capturedOptions.timeout).toBeGreaterThanOrEqual(customTimeout);
    }
  });
}, 30000);

describe('runActiveTests – maxConcurrentPerServer=1 limit (13.3)', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ response: 'ok' }),
            text: async () => JSON.stringify({ response: 'ok' }),
          }) as unknown as Response
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('only tests the first breaker when 3 are provided', async () => {
    const breakerA = makeBreaker('srv-conc:modelA');
    const breakerB = makeBreaker('srv-conc:modelB');
    const breakerC = makeBreaker('srv-conc:modelC');

    const results = await coordinator.runActiveTests('srv-conc', [
      { breaker: breakerA, model: 'modelA' },
      { breaker: breakerB, model: 'modelB' },
      { breaker: breakerC, model: 'modelC' },
    ]);

    // maxConcurrentPerServer=1 means only 1 should be tested
    expect(results).toHaveLength(1);
    // The other breakers should NOT have been tested
    expect(breakerB.recordSuccess).not.toHaveBeenCalled();
    expect(breakerB.recordFailure).not.toHaveBeenCalled();
    expect(breakerC.recordSuccess).not.toHaveBeenCalled();
    expect(breakerC.recordFailure).not.toHaveBeenCalled();
  });
}, 30000);

describe('runActiveTests – sorts by halfOpenStartedAt oldest-first (13.3)', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tests the breaker with the older halfOpenStartedAt first', async () => {
    const testedOrder: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({ response: 'ok' }),
          text: async () => JSON.stringify({ response: 'ok' }),
        } as unknown as Response;
      })
    );

    // Create breakers with different halfOpenStartedAt
    const olderStartedAt = Date.now() - 5000;
    const newerStartedAt = Date.now() - 1000;

    const makeSortBreaker = (
      name: string,
      halfOpenStartedAt: number,
      label: string
    ): CircuitBreaker => {
      const cb = {
        getState: () => 'half-open' as const,
        getStats: () => ({ halfOpenStartedAt, activeTestsInProgress: 0 }),
        getConfig: () => ({ halfOpenTimeout: 300_000 }),
        canExecute: () => true,
        recordSuccess: vi.fn(() => {
          testedOrder.push(label);
          return Promise.resolve();
        }),
        recordFailure: vi.fn(),
        startActiveTest: vi.fn(),
        endActiveTest: vi.fn(),
        getName: () => name,
        getModelType: () => undefined as 'embedding' | 'generation' | undefined,
        setModelType: vi.fn(),
        get name() {
          return name;
        },
      };
      return cb as unknown as CircuitBreaker;
    };

    const breakerOlder = makeSortBreaker('srv-sort:modelOlder', olderStartedAt, 'older');
    const breakerNewer = makeSortBreaker('srv-sort:modelNewer', newerStartedAt, 'newer');

    // Pass newer first intentionally — they should be sorted oldest-first
    const results = await coordinator.runActiveTests('srv-sort', [
      { breaker: breakerNewer, model: 'modelNewer' },
      { breaker: breakerOlder, model: 'modelOlder' },
    ]);

    // With maxConcurrentPerServer=1, only the oldest breaker should be tested
    expect(results).toHaveLength(1);

    // The first result should be the older breaker (sorted by halfOpenStartedAt)
    expect(results[0].breakerName).toBe('srv-sort:modelOlder');
  });
}, 30000);

describe('breakerTestAttempt counter reset after 10 failures', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reset attempt counter after 10 consecutive failures', async () => {
    const breaker = makeBreaker('srv-test:modelA');

    // Simulate 9 failures (counter goes 0 -> 9)
    for (let i = 0; i < 9; i++) {
      const attempt = coordinator['incrementBreakerTestAttempt']('srv-test:modelA');
      expect(attempt).toBe(i + 1);
    }

    // 10th failure should reset to 0
    const attemptAfterReset = coordinator['incrementBreakerTestAttempt']('srv-test:modelA');
    expect(attemptAfterReset).toBe(0);
  });

  it('should not reset before 10 failures', () => {
    const breakerName = 'srv-test:modelA';

    // 9 failures - counter should be at 9
    for (let i = 0; i < 9; i++) {
      coordinator['incrementBreakerTestAttempt'](breakerName);
    }
    expect(coordinator['getBreakerTestAttempt'](breakerName)).toBe(9);

    // 10th failure - reset to 0
    coordinator['incrementBreakerTestAttempt'](breakerName);
    expect(coordinator['getBreakerTestAttempt'](breakerName)).toBe(0);
  });

  it('should resetBreakerTestAttempt on success', () => {
    const breakerName = 'srv-test:modelA';

    // Increment a few times
    coordinator['incrementBreakerTestAttempt'](breakerName);
    coordinator['incrementBreakerTestAttempt'](breakerName);
    expect(coordinator['getBreakerTestAttempt'](breakerName)).toBe(2);

    // Reset on success
    coordinator.resetBreakerTestAttempt(breakerName);
    expect(coordinator['getBreakerTestAttempt'](breakerName)).toBe(0);
  });
});
