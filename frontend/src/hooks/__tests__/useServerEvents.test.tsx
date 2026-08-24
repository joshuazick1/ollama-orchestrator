import { renderHook, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useServerEvents } from '../useServerEvents';
import {
  parseEvent,
  dispatchLiveEventForTests,
  resetLiveEventBusForTests,
} from '../liveEventBus';

describe('useServerEvents', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    resetLiveEventBusForTests();
    queryClient = new QueryClient();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  function dispatchMetricsSSE(data: Record<string, unknown>): void {
    act(() => {
      const sseData = JSON.stringify({ type: 'metrics', ...data });
      const msg = parseEvent(sseData);
      if (msg) {
        dispatchLiveEventForTests(msg);
      }
    });
  }

  function renderHookWithClient<R>(render: () => R) {
    return renderHook(render, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
  }

  it('merges partial metrics update with existing cache instead of replacing', () => {
    // Pre-set some data in the cache
    queryClient.setQueryData(['metrics'], {
      timestamp: 1000,
      global: { totalRequests: 50, errorRate: 0.05, avgLatency: 200, requestsPerSecond: 10 },
    });

    renderHookWithClient(() => useServerEvents());

    dispatchMetricsSSE({
      timestamp: 2000,
      stats: { totalServers: 5, healthyServers: 4, totalModels: 20, inFlightRequests: 2, circuitBreakers: {}, circuitBreakersByState: {} },
      metrics: {
        timestamp: 2000,
        global: { totalRequests: 60, errorRate: 0.04, avgLatency: 180, requestsPerSecond: 12 },
      },
      circuitBreakers: 0,
      servers: [],
      modelMap: { modelToServers: {}, serverToModels: {} },
      inFlight: { total: 0, inFlight: [] },
    });

    const metrics = queryClient.getQueryData(['metrics']);
    expect(metrics).toBeDefined();
    expect((metrics as { timestamp: number }).timestamp).toBe(2000);
  });

  it('sets circuitBreakers cache from circuitBreakerDetails rich data when present', () => {
    renderHookWithClient(() => useServerEvents());

    dispatchMetricsSSE({
      timestamp: 4000,
      stats: { totalServers: 2, healthyServers: 2, totalModels: 5, inFlightRequests: 1, circuitBreakers: {}, circuitBreakersByState: {} },
      metrics: {
        timestamp: 4000,
        global: { totalRequests: 200, errorRate: 0.02, avgLatency: 100, requestsPerSecond: 30 },
      },
      circuitBreakers: 3,
      servers: [],
      modelMap: { modelToServers: {}, serverToModels: {} },
      inFlight: { total: 0, inFlight: [] },
      circuitBreakerDetails: {
        'srv1:llama3:ollama_chat': {
          state: 'HEALTHY',
          consecutiveSuccesses: 10,
          consecutiveFailures: 0,
          errorWindow: [],
          lastTransition: 5000,
          lastProbeAt: 5000,
          nextProbeAt: 10000,
          recoveryAttempts: 0,
        },
      },
    });

    const cbData = queryClient.getQueryData(['circuitBreakers']);
    expect(cbData).toBeDefined();
    expect((cbData as { circuitBreakers: number }).circuitBreakers).toBe(3);
    expect((cbData as { details: object }).details).toBeDefined();
    expect((cbData as { details: Record<string, { state: string }> }).details['srv1:llama3:ollama_chat'].state).toBe('HEALTHY');
  });

  it('sets circuitBreakers count when circuitBreakerDetails is absent (backward compat)', () => {
    renderHookWithClient(() => useServerEvents());

    dispatchMetricsSSE({
      timestamp: 5000,
      stats: { totalServers: 1, healthyServers: 1, totalModels: 3, inFlightRequests: 0, circuitBreakers: {}, circuitBreakersByState: {} },
      metrics: {
        timestamp: 5000,
        global: { totalRequests: 10, errorRate: 0, avgLatency: 50, requestsPerSecond: 5 },
      },
      circuitBreakers: 7,
      servers: [],
      modelMap: { modelToServers: {}, serverToModels: {} },
      inFlight: { total: 0, inFlight: [] },
    });

    const cbData = queryClient.getQueryData(['circuitBreakers']);
    expect(cbData).toBeDefined();
    expect((cbData as { circuitBreakers: number }).circuitBreakers).toBe(7);
    expect((cbData as { details?: unknown }).details).toBeUndefined();
  });

  it('accepts metrics events with schemaVersion and sequence fields', () => {
    renderHookWithClient(() => useServerEvents());

    dispatchMetricsSSE({
      schemaVersion: '1',
      sequence: 42,
      timestamp: 6000,
      stats: { totalServers: 1, healthyServers: 1, totalModels: 2, inFlightRequests: 0, circuitBreakers: {}, circuitBreakersByState: {} },
      metrics: {
        timestamp: 6000,
        global: { totalRequests: 5, errorRate: 0, avgLatency: 80, requestsPerSecond: 2 },
      },
      circuitBreakers: 1,
      servers: [],
      modelMap: { modelToServers: {}, serverToModels: {} },
      inFlight: { total: 0, inFlight: [] },
      circuitBreakerDetails: {},
    });

    const stats = queryClient.getQueryData(['stats']);
    expect(stats).toBeDefined();
  });
});
