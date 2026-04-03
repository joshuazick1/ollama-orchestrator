import { describe, it, expect, beforeEach } from 'vitest';

import { MetricsAggregator } from '../../src/metrics/metrics-aggregator.js';
import type { RequestContext } from '../../src/orchestrator/orchestrator.types.js';

function makeContext(
  serverId: string,
  model: string,
  overrides: Partial<RequestContext> = {}
): RequestContext {
  return {
    id: 'req-test',
    startTime: Date.now() - 200,
    serverId,
    model,
    endpoint: 'generate',
    streaming: false,
    success: true,
    duration: 200,
    ...overrides,
  };
}

function recordMany(
  aggregator: MetricsAggregator,
  serverId: string,
  model: string,
  count: number,
  overrides: Partial<RequestContext> = {}
): void {
  for (let i = 0; i < count; i++) {
    aggregator.recordRequest(makeContext(serverId, model, { id: `req-${i}`, ...overrides }));
  }
}

describe('cross-model fallback weighting', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator({ enabled: false });
  });

  describe('auto-resolve parameterSize (Bug 1)', () => {
    it('resolves parameterSize from any server when not explicitly provided', () => {
      recordMany(aggregator, 'server-1', 'model-a', 10);
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      recordMany(aggregator, 'server-2', 'model-b', 10);
      aggregator.updateModelMetadata('server-2', 'model-b', { parameterSize: '8B' });

      const result = aggregator.getMetricsWithFallback('server-2', 'model-a');
      expect(result).toBeDefined();
      expect(result!.model).toContain('model-a');
      expect(result!.model).toContain('inferred from model-b');
    });

    it('does NOT find a fallback when parameterSize is not resolvable for the requested model', () => {
      recordMany(aggregator, 'server-2', 'model-b', 10);
      aggregator.updateModelMetadata('server-2', 'model-b', { parameterSize: '8B' });

      const result = aggregator.getMetricsWithFallback('server-2', 'model-a');
      expect(result).toBeUndefined();
    });

    it('uses explicit parameterSize even when model has no prior metrics', () => {
      recordMany(aggregator, 'server-1', 'model-b', 10);
      aggregator.updateModelMetadata('server-1', 'model-b', { parameterSize: '8B' });

      const result = aggregator.getMetricsWithFallback('server-1', 'model-a', '8B');
      expect(result).toBeDefined();
      expect(result!.model).toContain('inferred from model-b');
    });
  });

  describe('pure fallback with weight discount (Bug 3)', () => {
    it('discounts successRate towards 0.5 using fallbackWeight', () => {
      recordMany(aggregator, 'server-1', 'model-a', 10, { success: true });
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      const raw = aggregator.getMetrics('server-1', 'model-a')!;
      expect(raw.successRate).toBeGreaterThan(0.9);

      aggregator.setCrossModelInferenceConfig({ fallbackWeight: 0.5 });

      const result = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');
      expect(result).toBeDefined();
      expect(result!.successRate).toBeCloseTo(0.5 + (raw.successRate - 0.5) * 0.5, 5);
    });

    it('discounts throughput using fallbackWeight', () => {
      recordMany(aggregator, 'server-1', 'model-a', 10);
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      const raw = aggregator.getMetrics('server-1', 'model-a')!;

      aggregator.setCrossModelInferenceConfig({ fallbackWeight: 0.5 });

      const result = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');
      expect(result).toBeDefined();
      expect(result!.throughput).toBeCloseTo(raw.throughput * 0.5, 5);
    });

    it('tags the inferred model name correctly', () => {
      recordMany(aggregator, 'server-1', 'model-a', 10);
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      const result = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');
      expect(result!.model).toBe('model-b (inferred from model-a)');
    });

    it('different fallbackWeight values produce different discounts', () => {
      recordMany(aggregator, 'server-1', 'model-a', 10, { success: true });
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      aggregator.setCrossModelInferenceConfig({ fallbackWeight: 0.2 });
      const result02 = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');

      aggregator.setCrossModelInferenceConfig({ fallbackWeight: 0.8 });
      const result08 = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');

      const raw = aggregator.getMetrics('server-1', 'model-a')!;
      expect(result02!.successRate).toBeCloseTo(0.5 + (raw.successRate - 0.5) * 0.2, 5);
      expect(result08!.successRate).toBeCloseTo(0.5 + (raw.successRate - 0.5) * 0.8, 5);
      expect(result08!.successRate).toBeGreaterThan(result02!.successRate);
    });
  });

  describe('low-sample blending (Bug 2)', () => {
    it('blends exact low-sample metrics with fallback when below minSamplesForExact', () => {
      aggregator.setCrossModelInferenceConfig({ minSamplesForExact: 5, fallbackWeight: 0.5 });

      recordMany(aggregator, 'server-1', 'model-a', 10, { success: true });
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      recordMany(aggregator, 'server-1', 'model-b', 2, { success: false });

      const exactMetrics = aggregator.getMetrics('server-1', 'model-b')!;
      expect(exactMetrics.recentLatencies.length).toBe(2);
      expect(exactMetrics.successRate).toBe(0);

      const fallbackMetrics = aggregator.getMetrics('server-1', 'model-a')!;
      expect(fallbackMetrics.successRate).toBeGreaterThan(0.9);

      const result = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');
      expect(result).toBeDefined();
      expect(result!.successRate).toBeGreaterThan(0);
      expect(result!.successRate).toBeLessThan(fallbackMetrics.successRate);
    });

    it('blends successRate between exact and fallback proportionally to sample count', () => {
      aggregator.setCrossModelInferenceConfig({ minSamplesForExact: 10, fallbackWeight: 1.0 });

      recordMany(aggregator, 'server-1', 'model-a', 20, { success: true });
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      recordMany(aggregator, 'server-1', 'model-b', 5, { success: false });

      const exactRate = aggregator.getMetrics('server-1', 'model-b')!.successRate;
      const fallbackRate = aggregator.getMetrics('server-1', 'model-a')!.successRate;

      const result = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B')!;

      expect(result.successRate).toBeGreaterThan(exactRate);
      expect(result.successRate).toBeLessThan(fallbackRate);
    });

    it('exact metrics returned as-is when no fallback available (low samples is ok)', () => {
      aggregator.setCrossModelInferenceConfig({ minSamplesForExact: 10 });

      recordMany(aggregator, 'server-1', 'model-b', 2);
      const exact = aggregator.getMetrics('server-1', 'model-b')!;

      const result = aggregator.getMetricsWithFallback('server-1', 'model-b');
      expect(result).toBe(exact);
    });
  });

  describe('sufficient samples bypass fallback (Bug 2)', () => {
    it('returns exact metrics object reference unchanged when sample count >= minSamplesForExact', () => {
      aggregator.setCrossModelInferenceConfig({ minSamplesForExact: 5 });

      recordMany(aggregator, 'server-1', 'model-a', 10);
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      recordMany(aggregator, 'server-1', 'model-b', 10);
      aggregator.updateModelMetadata('server-1', 'model-b', { parameterSize: '8B' });

      const exact = aggregator.getMetrics('server-1', 'model-b')!;
      const result = aggregator.getMetricsWithFallback('server-1', 'model-b')!;

      expect(result).toBe(exact);
    });

    it('does not apply blending when sample count exactly equals minSamplesForExact', () => {
      aggregator.setCrossModelInferenceConfig({ minSamplesForExact: 5 });

      recordMany(aggregator, 'server-1', 'model-a', 10);
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      recordMany(aggregator, 'server-1', 'model-b', 5);
      aggregator.updateModelMetadata('server-1', 'model-b', { parameterSize: '8B' });

      const exact = aggregator.getMetrics('server-1', 'model-b')!;
      const result = aggregator.getMetricsWithFallback('server-1', 'model-b')!;

      expect(result).toBe(exact);
    });
  });

  describe('config wiring (Bug 4)', () => {
    it('setCrossModelInferenceConfig updates fallbackWeight used during fallback', () => {
      recordMany(aggregator, 'server-1', 'model-a', 10, { success: true });
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      const raw = aggregator.getMetrics('server-1', 'model-a')!;

      aggregator.setCrossModelInferenceConfig({ fallbackWeight: 0.2 });
      const result02 = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');

      aggregator.setCrossModelInferenceConfig({ fallbackWeight: 0.8 });
      const result08 = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');

      expect(result02!.successRate).toBeCloseTo(0.5 + (raw.successRate - 0.5) * 0.2, 5);
      expect(result08!.successRate).toBeCloseTo(0.5 + (raw.successRate - 0.5) * 0.8, 5);
      expect(result08!.successRate).toBeGreaterThan(result02!.successRate);
    });

    it('setCrossModelInferenceConfig updates minSamplesForExact for blending threshold', () => {
      recordMany(aggregator, 'server-1', 'model-a', 20, { success: true });
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      recordMany(aggregator, 'server-1', 'model-b', 5, { success: false });

      const exact = aggregator.getMetrics('server-1', 'model-b')!;
      expect(exact.recentLatencies.length).toBe(5);

      aggregator.setCrossModelInferenceConfig({ minSamplesForExact: 3 });
      const resultLowMin = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');

      aggregator.setCrossModelInferenceConfig({ minSamplesForExact: 20 });
      const resultHighMin = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');

      expect(resultLowMin).toBe(exact);
      expect(resultHighMin!.successRate).not.toBe(exact.successRate);
    });
  });

  describe('disabled cross-model', () => {
    it('returns undefined when no exact metrics and cross-model is disabled', () => {
      aggregator.setCrossModelInferenceConfig({ enabled: false });

      recordMany(aggregator, 'server-1', 'model-a', 10);
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '8B' });

      const result = aggregator.getMetricsWithFallback('server-1', 'model-b', '8B');
      expect(result).toBeUndefined();
    });

    it('returns exact metrics when disabled and exact exists', () => {
      aggregator.setCrossModelInferenceConfig({ enabled: false });

      recordMany(aggregator, 'server-1', 'model-b', 10);
      const exact = aggregator.getMetrics('server-1', 'model-b')!;

      const result = aggregator.getMetricsWithFallback('server-1', 'model-b');
      expect(result).toBe(exact);
    });
  });

  describe('no fallback available', () => {
    it('returns undefined when no exact metrics and no same-size model on that server', () => {
      recordMany(aggregator, 'server-1', 'model-a', 10);
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '70B' });

      const result = aggregator.getMetricsWithFallback('server-2', 'model-c', '8B');
      expect(result).toBeUndefined();
    });

    it('returns exact metrics when requested model has sufficient data but no same-size sibling', () => {
      recordMany(aggregator, 'server-1', 'model-a', 10);
      aggregator.updateModelMetadata('server-1', 'model-a', { parameterSize: '70B' });

      const exact = aggregator.getMetrics('server-1', 'model-a')!;
      const result = aggregator.getMetricsWithFallback('server-1', 'model-a');
      expect(result).toBe(exact);
    });

    it('returns undefined when model has no metrics and no resolvable parameterSize', () => {
      const result = aggregator.getMetricsWithFallback('server-1', 'model-unknown');
      expect(result).toBeUndefined();
    });
  });
});
