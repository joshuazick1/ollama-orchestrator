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
