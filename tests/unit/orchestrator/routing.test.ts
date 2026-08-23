/**
 * routing.test.ts
 * Task 2 unit tests for OrchestratorRouter.tryRequestOnServerNoRetry and
 * tryRequestOnServerWithRetries. These tests assert exactly one telemetry
 * dispatch per success/failure/retry attempt through the shared RequestTelemetry
 * boundary, and zero manual triplets after the refactor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '../../../src/orchestrator/orchestrator.types.js';

const recordRequestMock = vi.fn();
const requestTelemetryCtor = vi.fn();

vi.mock('../../../src/metrics/request-telemetry.js', () => ({
  RequestTelemetry: class {
    constructor(deps: unknown) {
      requestTelemetryCtor(deps);
      this.recordRequest = recordRequestMock;
    }
  },
}));

const metricsAggregatorRecordRequest = vi.fn();
const requestHistoryRecordRequest = vi.fn();
const metricsStoreRecordRequest = vi.fn();

vi.mock('../../../src/request-history.js', () => ({
  getRequestHistory: () => ({ recordRequest: requestHistoryRecordRequest }),
}));

vi.mock('../../../src/storage/metrics-store.js', () => ({
  getMetricsStore: () => ({ recordRequest: metricsStoreRecordRequest }),
}));

import { OrchestratorRouter } from '../../../src/orchestrator/routing.js';

class StubOrchestrator {
  getMetricsAggregator() {
    return { recordRequest: metricsAggregatorRecordRequest };
  }
  getRequestHistory() {
    return { recordRequest: requestHistoryRecordRequest };
  }
  getMetricsStore() {
    return { recordRequest: metricsStoreRecordRequest };
  }
  incrementInFlight() {
    /* no-op */
  }
  decrementInFlight() {
    /* no-op */
  }
  decrementInFlightWithTokens() {
    /* no-op */
  }
  getInFlightManager() {
    return {
      addStreamingRequest: () => undefined,
      removeStreamingRequest: () => undefined,
    };
  }
  resetServerFailureCount() {
    /* no-op */
  }
  recordSuccess() {
    /* no-op */
  }
  recordFailure() {
    /* no-op */
  }
  getTimeoutManager() {
    return {
      updateFromResponseTime: () => undefined,
      getTimeout: () => 30000,
    };
  }
  getTotalInFlight() {
    return 0;
  }
  getErrorAggregator() {
    return { recordError: () => undefined };
  }
  recordGarbageResponse() {
    /* no-op */
  }
  handleServerError() {
    /* no-op */
  }
  getConfig() {
    return {
      cooldown: { defaultMaxConcurrency: 4 },
      retry: { maxBudget: 10 },
    };
  }
  getInferenceTimeoutMs() {
    return 90000;
  }
}

const stubServer = {
  id: 'server-1',
  healthy: true,
  models: ['llama3'],
} as never;

describe('OrchestratorRouter telemetry dispatch (Task 2 single-dispatch contract)', () => {
  let router: OrchestratorRouter;
  let stubOrch: StubOrchestrator;

  beforeEach(() => {
    metricsAggregatorRecordRequest.mockReset();
    requestHistoryRecordRequest.mockReset();
    metricsStoreRecordRequest.mockReset();
    recordRequestMock.mockReset();
    requestTelemetryCtor.mockReset();

    metricsAggregatorRecordRequest.mockReturnValue(undefined);
    requestHistoryRecordRequest.mockReturnValue({});
    metricsStoreRecordRequest.mockReturnValue(undefined);
    recordRequestMock.mockReturnValue(undefined);

    stubOrch = new StubOrchestrator();
    router = new OrchestratorRouter(stubOrch as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('tryRequestOnServerNoRetry', () => {
    it('invokes RequestTelemetry.recordRequest exactly once on success', async () => {
      const result = await router.tryRequestOnServerNoRetry(
        stubServer,
        'llama3',
        async () => ({ eval_count: 100, prompt_eval_count: 50 }) as never,
        false,
        []
      );

      expect(result.success).toBe(true);
      expect(recordRequestMock).toHaveBeenCalledTimes(1);
    });

    it('invokes RequestTelemetry.recordRequest exactly once on failure', async () => {
      const result = await router.tryRequestOnServerNoRetry(
        stubServer,
        'llama3',
        async () => {
          throw new Error('boom');
        },
        false,
        []
      );

      expect(result.success).toBe(false);
      expect(recordRequestMock).toHaveBeenCalledTimes(1);
    });

    it('does not call MetricsAggregator / RequestHistory / MetricsStore directly (delegates via boundary)', async () => {
      await router.tryRequestOnServerNoRetry(
        stubServer,
        'llama3',
        async () => ({ eval_count: 1, prompt_eval_count: 2 }) as never,
        false,
        []
      );

      expect(metricsAggregatorRecordRequest).not.toHaveBeenCalled();
      expect(requestHistoryRecordRequest).not.toHaveBeenCalled();
      expect(metricsStoreRecordRequest).not.toHaveBeenCalled();
    });

    it('passes a populated RequestContext to the boundary', async () => {
      await router.tryRequestOnServerNoRetry(
        stubServer,
        'llama3',
        async () => ({ eval_count: 100, prompt_eval_count: 50 }) as never,
        false,
        []
      );

      expect(recordRequestMock).toHaveBeenCalledTimes(1);
      const ctx = recordRequestMock.mock.calls[0]?.[0] as RequestContext | undefined;
      expect(ctx).toBeDefined();
      expect(ctx!.serverId).toBe('server-1');
      expect(ctx!.model).toBe('llama3');
      expect(ctx!.success).toBe(true);
      expect(ctx!.duration).toBeGreaterThanOrEqual(0);
    });

    it('returns success on the happy path (boundary is internal)', async () => {
      const result = await router.tryRequestOnServerNoRetry(
        stubServer,
        'llama3',
        async () => ({ eval_count: 1, prompt_eval_count: 2 }) as never,
        false,
        []
      );

      expect(result.success).toBe(true);
    });
  });

  describe('tryRequestOnServerWithRetries', () => {
    it('invokes RequestTelemetry.recordRequest exactly once on first-attempt success', async () => {
      const result = await router.tryRequestOnServerWithRetries(
        stubServer,
        'llama3',
        async () => ({ ok: true }) as never,
        false,
        {
          maxRetriesPerServer: 2,
          retryDelayMs: 1,
          backoffMultiplier: 2,
          maxRetryDelayMs: 10,
          retryableStatusCodes: [429, 503],
        },
        []
      );

      expect(result.success).toBe(true);
      expect(recordRequestMock).toHaveBeenCalledTimes(1);
    });

    it('invokes RequestTelemetry.recordRequest exactly once per retry attempt (1 dispatch per attempt)', async () => {
      let attempts = 0;
      const result = await router.tryRequestOnServerWithRetries(
        stubServer,
        'llama3',
        async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('503 service unavailable');
          }
          return { ok: true } as never;
        },
        false,
        {
          maxRetriesPerServer: 3,
          retryDelayMs: 1,
          backoffMultiplier: 2,
          maxRetryDelayMs: 10,
          retryableStatusCodes: [429, 503],
        },
        []
      );

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
      expect(recordRequestMock).toHaveBeenCalledTimes(2);
    });

    it('does not call MetricsAggregator / RequestHistory / MetricsStore directly on retries', async () => {
      await router.tryRequestOnServerWithRetries(
        stubServer,
        'llama3',
        async () => ({ ok: true }) as never,
        false,
        {
          maxRetriesPerServer: 0,
          retryDelayMs: 1,
          backoffMultiplier: 2,
          maxRetryDelayMs: 10,
          retryableStatusCodes: [429, 503],
        },
        []
      );

      expect(metricsAggregatorRecordRequest).not.toHaveBeenCalled();
      expect(requestHistoryRecordRequest).not.toHaveBeenCalled();
      expect(metricsStoreRecordRequest).not.toHaveBeenCalled();
    });

    it('returns success on the first-attempt happy path (no retries)', async () => {
      const result = await router.tryRequestOnServerWithRetries(
        stubServer,
        'llama3',
        async () => ({ ok: true }) as never,
        false,
        {
          maxRetriesPerServer: 0,
          retryDelayMs: 1,
          backoffMultiplier: 2,
          maxRetryDelayMs: 10,
          retryableStatusCodes: [429, 503],
        },
        []
      );

      expect(result.success).toBe(true);
      expect(recordRequestMock).toHaveBeenCalledTimes(1);
    });
  });
});
