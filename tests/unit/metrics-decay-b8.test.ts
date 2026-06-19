import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MetricsAggregator } from '../../src/metrics/metrics-aggregator.js';
import type { RequestContext } from '../../src/orchestrator/orchestrator.types.js';

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    id: `test-${Date.now()}`,
    startTime: Date.now(),
    serverId: 'srv1',
    model: 'llama3',
    endpoint: 'chat',
    streaming: false,
    success: true,
    duration: 100,
    ...overrides,
  };
}

describe('MetricsAggregator decay (B8)', () => {
  let agg: MetricsAggregator;

  beforeEach(() => {
    agg = new MetricsAggregator({
      enabled: true,
      halfLifeMs: 60 * 1000,
      minDecayFactor: 0.1,
      staleThresholdMs: 10,
    });
  });

  it('should apply decay to window data in getGlobalMetrics', () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    agg.recordRequest(makeContext({ duration: 50000, startTime: now }));

    const freshMetrics = agg.getGlobalMetrics();
    expect(freshMetrics.avgLatency).toBeCloseTo(50000, -10);

    vi.setSystemTime(now + 120_000);

    const decayedMetrics = agg.getGlobalMetrics();
    expect(decayedMetrics.avgLatency).toBeLessThan(50000);
    expect(decayedMetrics.avgLatency).toBeLessThan(20000);

    vi.useRealTimers();
  });

  it('should return fresh metrics as-is when not stale', () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    agg.recordRequest(makeContext({ duration: 100, startTime: now }));

    const fresh = agg.getGlobalMetrics();
    expect(fresh.avgLatency).toBeCloseTo(100, -5);

    vi.useRealTimers();
  });

  it('should apply decay to windows in getMetrics', () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    agg.recordRequest(makeContext({ duration: 50000, startTime: now }));

    vi.setSystemTime(now + 120_000);

    const decayed = agg.getMetrics('srv1', 'llama3');
    expect(decayed).toBeDefined();
    if (decayed) {
      const w5m = decayed.windows['5m'];
      expect(w5m.count).toBeLessThan(1);
      expect(w5m.latencySum).toBeLessThan(50000);
    }

    vi.useRealTimers();
  });
});
