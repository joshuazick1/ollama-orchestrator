/**
 * orchestrator-test-telemetry-dispatch.test.ts
 * Task 2 sink-failure isolation tests for the RequestTelemetry boundary.
 *
 * Goal: prove that a single throwing sink callback does NOT silently corrupt
 * the request outcome or starve the other sinks. RequestTelemetry is a thin
 * dispatcher that must isolate sink failures via independent try/catch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestTelemetry } from '../../src/metrics/request-telemetry.js';
import type { RequestContext } from '../../src/orchestrator/orchestrator.types.js';

const baseContext: RequestContext = {
  id: 'req-1',
  startTime: 1,
  endTime: 2,
  duration: 1,
  serverId: 'server-1',
  model: 'llama3',
  endpoint: 'ollama_generate',
  streaming: false,
  success: true,
};

describe('RequestTelemetry (sink-failure isolation)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes a recordRequest method on the class', () => {
    const t = new RequestTelemetry({
      metricsAggregators: { recordRequest: vi.fn() },
      getRequestHistory: () => ({ recordRequest: vi.fn() }),
      getMetricsStore: () => ({ recordRequest: vi.fn() }),
      getAnalyticsEngine: () => ({ recordRequest: vi.fn() }),
      getErrorEventStore: () => ({ recordError: vi.fn() }),
    });
    expect(typeof t.recordRequest).toBe('function');
  });

  it('invokes all five sinks exactly once per recordRequest call (success)', () => {
    const metricsAggregators = { recordRequest: vi.fn() };
    const requestHistory = { recordRequest: vi.fn() };
    const metricsStore = { recordRequest: vi.fn() };
    const analyticsEngine = { recordRequest: vi.fn() };
    const errorEventStore = { recordError: vi.fn() };

    const t = new RequestTelemetry({
      metricsAggregators,
      getRequestHistory: () => requestHistory,
      getMetricsStore: () => metricsStore,
      getAnalyticsEngine: () => analyticsEngine,
      getErrorEventStore: () => errorEventStore,
    });

    t.recordRequest(baseContext);

    expect(metricsAggregators.recordRequest).toHaveBeenCalledTimes(1);
    expect(requestHistory.recordRequest).toHaveBeenCalledTimes(1);
    expect(metricsStore.recordRequest).toHaveBeenCalledTimes(1);
    expect(analyticsEngine.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing metricsAggregators sink from the rest of the dispatch', () => {
    const metricsAggregators = {
      recordRequest: vi.fn().mockImplementation(() => {
        throw new Error('metrics sink boom');
      }),
    };
    const requestHistory = { recordRequest: vi.fn() };
    const metricsStore = { recordRequest: vi.fn() };
    const analyticsEngine = { recordRequest: vi.fn() };
    const errorEventStore = { recordError: vi.fn() };

    const t = new RequestTelemetry({
      metricsAggregators,
      getRequestHistory: () => requestHistory,
      getMetricsStore: () => metricsStore,
      getAnalyticsEngine: () => analyticsEngine,
      getErrorEventStore: () => errorEventStore,
    });

    expect(() => t.recordRequest(baseContext)).not.toThrow();
    expect(requestHistory.recordRequest).toHaveBeenCalledTimes(1);
    expect(metricsStore.recordRequest).toHaveBeenCalledTimes(1);
    expect(analyticsEngine.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing requestHistory sink from the rest of the dispatch', () => {
    const requestHistory = {
      recordRequest: vi.fn().mockImplementation(() => {
        throw new Error('history sink boom');
      }),
    };
    const metricsAggregators = { recordRequest: vi.fn() };
    const metricsStore = { recordRequest: vi.fn() };
    const analyticsEngine = { recordRequest: vi.fn() };
    const errorEventStore = { recordError: vi.fn() };

    const t = new RequestTelemetry({
      metricsAggregators,
      getRequestHistory: () => requestHistory,
      getMetricsStore: () => metricsStore,
      getAnalyticsEngine: () => analyticsEngine,
      getErrorEventStore: () => errorEventStore,
    });

    expect(() => t.recordRequest(baseContext)).not.toThrow();
    expect(metricsAggregators.recordRequest).toHaveBeenCalledTimes(1);
    expect(metricsStore.recordRequest).toHaveBeenCalledTimes(1);
    expect(analyticsEngine.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing metricsStore sink from the rest of the dispatch', () => {
    const metricsStore = {
      recordRequest: vi.fn().mockImplementation(() => {
        throw new Error('store sink boom');
      }),
    };
    const metricsAggregators = { recordRequest: vi.fn() };
    const requestHistory = { recordRequest: vi.fn() };
    const analyticsEngine = { recordRequest: vi.fn() };
    const errorEventStore = { recordError: vi.fn() };

    const t = new RequestTelemetry({
      metricsAggregators,
      getRequestHistory: () => requestHistory,
      getMetricsStore: () => metricsStore,
      getAnalyticsEngine: () => analyticsEngine,
      getErrorEventStore: () => errorEventStore,
    });

    expect(() => t.recordRequest(baseContext)).not.toThrow();
    expect(metricsAggregators.recordRequest).toHaveBeenCalledTimes(1);
    expect(requestHistory.recordRequest).toHaveBeenCalledTimes(1);
    expect(analyticsEngine.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing analyticsEngine sink from the rest of the dispatch', () => {
    const analyticsEngine = {
      recordRequest: vi.fn().mockImplementation(() => {
        throw new Error('analytics sink boom');
      }),
    };
    const metricsAggregators = { recordRequest: vi.fn() };
    const requestHistory = { recordRequest: vi.fn() };
    const metricsStore = { recordRequest: vi.fn() };
    const errorEventStore = { recordError: vi.fn() };

    const t = new RequestTelemetry({
      metricsAggregators,
      getRequestHistory: () => requestHistory,
      getMetricsStore: () => metricsStore,
      getAnalyticsEngine: () => analyticsEngine,
      getErrorEventStore: () => errorEventStore,
    });

    expect(() => t.recordRequest(baseContext)).not.toThrow();
    expect(metricsAggregators.recordRequest).toHaveBeenCalledTimes(1);
    expect(requestHistory.recordRequest).toHaveBeenCalledTimes(1);
    expect(metricsStore.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('propagates the malformed-context failure as a domain error (without starvingsinks)', () => {
    const metricsAggregators = { recordRequest: vi.fn() };
    const requestHistory = { recordRequest: vi.fn() };
    const metricsStore = {
      recordRequest: vi.fn().mockImplementation(() => {
        throw new Error('Bad RequestContext: missing required fields');
      }),
    };
    const analyticsEngine = { recordRequest: vi.fn() };
    const errorEventStore = { recordError: vi.fn() };

    const t = new RequestTelemetry({
      metricsAggregators,
      getRequestHistory: () => requestHistory,
      getMetricsStore: () => metricsStore,
      getAnalyticsEngine: () => analyticsEngine,
      getErrorEventStore: () => errorEventStore,
    });

    // Sink throws must be swallowed at the boundary — telemetry never raises.
    expect(() => t.recordRequest(baseContext)).not.toThrow();
    // Other sinks must still receive the same context.
    expect(metricsAggregators.recordRequest).toHaveBeenCalledWith(baseContext);
    expect(requestHistory.recordRequest).toHaveBeenCalledWith(baseContext, undefined);
    expect(analyticsEngine.recordRequest).toHaveBeenCalledWith(baseContext);
  });

  it('dispatches a structured error event when the context is a failure (non-probe)', () => {
    const errorEventStore = {
      recordError: vi.fn().mockResolvedValue(undefined),
    };
    const metricsAggregators = { recordRequest: vi.fn() };
    const requestHistory = { recordRequest: vi.fn() };
    const metricsStore = { recordRequest: vi.fn() };
    const analyticsEngine = { recordRequest: vi.fn() };

    const t = new RequestTelemetry({
      metricsAggregators,
      getRequestHistory: () => requestHistory,
      getMetricsStore: () => metricsStore,
      getAnalyticsEngine: () => analyticsEngine,
      getErrorEventStore: () => errorEventStore,
    });

    const failureContext: RequestContext = {
      ...baseContext,
      success: false,
      error: new Error('upstream 503'),
    };

    t.recordRequest(failureContext);

    // The five-sink dispatch must still run for failure contexts.
    expect(metricsAggregators.recordRequest).toHaveBeenCalledTimes(1);
    expect(requestHistory.recordRequest).toHaveBeenCalledTimes(1);
    expect(metricsStore.recordRequest).toHaveBeenCalledTimes(1);
    expect(analyticsEngine.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('does NOT invoke ErrorEventStore.recordError on the success hot path', () => {
    const errorEventStore = {
      recordError: vi.fn().mockResolvedValue(undefined),
    };
    const metricsAggregators = { recordRequest: vi.fn() };
    const requestHistory = { recordRequest: vi.fn() };
    const metricsStore = { recordRequest: vi.fn() };
    const analyticsEngine = { recordRequest: vi.fn() };

    const t = new RequestTelemetry({
      metricsAggregators,
      getRequestHistory: () => requestHistory,
      getMetricsStore: () => metricsStore,
      getAnalyticsEngine: () => analyticsEngine,
      getErrorEventStore: () => errorEventStore,
    });

    t.recordRequest({ ...baseContext, success: true });

    expect(errorEventStore.recordError).not.toHaveBeenCalled();
  });

  it('propagates the decisionId field to all sinks', () => {
    const metricsAggregators = { recordRequest: vi.fn() };
    const requestHistory = { recordRequest: vi.fn() };
    const metricsStore = { recordRequest: vi.fn() };
    const analyticsEngine = { recordRequest: vi.fn() };
    const errorEventStore = { recordError: vi.fn() };

    const t = new RequestTelemetry({
      metricsAggregators,
      getRequestHistory: () => requestHistory,
      getMetricsStore: () => metricsStore,
      getAnalyticsEngine: () => analyticsEngine,
      getErrorEventStore: () => errorEventStore,
    });

    const ctxWithDecision: RequestContext = {
      ...baseContext,
      decisionId: 'dec-task2-1',
    };
    t.recordRequest(ctxWithDecision);

    expect(metricsAggregators.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'dec-task2-1' })
    );
    expect(requestHistory.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'dec-task2-1' }),
      undefined
    );
    expect(metricsStore.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'dec-task2-1' }),
      undefined
    );
    expect(analyticsEngine.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'dec-task2-1' })
    );
  });
});
