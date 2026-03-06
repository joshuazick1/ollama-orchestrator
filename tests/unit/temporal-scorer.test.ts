/**
 * temporal-scorer.test.ts
 * Unit tests for TemporalScorer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock metrics-store before importing the module under test
const mockStore = {
  getTemporalProfile: vi.fn(),
  getDailyRollups: vi.fn(),
};

vi.mock('../../src/storage/metrics-store.js', () => ({
  getMetricsStore: () => mockStore,
}));

import {
  TemporalScorer,
  getTemporalScorer,
  resetTemporalScorer,
} from '../../src/load-balancer/temporal-scorer.js';

const mockDailyRollup = {
  server_id: 'server-1',
  model: 'llama3:latest',
  date_str: '2026-03-05',
  total_requests: 1000,
  user_requests: 900,
  successes: 950,
  failures: 50,
  cold_starts: 100,
  latency_sum: 500000,
  latency_sq_sum: 0,
  latency_min: 100,
  latency_max: 2000,
  latency_p50: 400,
  latency_p95: 800,
  latency_p99: 1200,
  ttft_count: 500,
  ttft_sum: 100000,
  ttft_p50: 150,
  ttft_p95: 300,
  tokens_generated: 40000, // 40 tokens/sec * 1000 requests
  tokens_prompt: 100000,
  avg_tokens_per_second: 40,
  errors_timeout: 20,
  errors_oom: 10,
  errors_connection: 15,
  errors_other: 5,
  day_of_week: 3,
};

describe('TemporalScorer', () => {
  let scorer: TemporalScorer;

  beforeEach(() => {
    resetTemporalScorer();
    vi.clearAllMocks();
    scorer = getTemporalScorer({ enabled: true, minConfidence: 0.3 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getAdjustment', () => {
    it('returns neutral adjustment when disabled', () => {
      const disabledScorer = new TemporalScorer({ enabled: false });
      const adjustment = disabledScorer.getAdjustment('server-1', 'llama3:latest');

      expect(adjustment.latencyMultiplier).toBe(1.0);
      expect(adjustment.successRateMultiplier).toBe(1.0);
      expect(adjustment.confidence).toBe(0);
      expect(adjustment.reason).toBe('disabled');
    });

    it('returns neutral adjustment when no profile found', () => {
      mockStore.getTemporalProfile.mockReturnValue(null);
      mockStore.getDailyRollups.mockReturnValue([]);

      const adjustment = scorer.getAdjustment('server-1', 'llama3:latest');

      // When profile is null, it returns 'low-confidence' (profile check happens first)
      expect(adjustment.latencyMultiplier).toBe(1.0);
      expect(adjustment.reason).toBe('low-confidence');
    });

    it('returns neutral adjustment when confidence below threshold', () => {
      mockStore.getTemporalProfile.mockReturnValue({
        id: 1,
        server_id: 'server-1',
        model: 'llama3:latest',
        hour_of_day: 14,
        day_of_week: 3,
        profile_type: 'exact' as const,
        sample_count: 2,
        total_requests: 20,
        avg_latency_ms: 750,
        avg_latency_stddev: 50,
        p95_latency_ms: 900,
        success_rate: 0.85,
        avg_tokens_per_second: 40,
        cold_start_rate: 0.1,
        avg_ttft_ms: 200,
        confidence: 0.2, // Below minConfidence (0.3)
        updated_at: Date.now(),
      });
      mockStore.getDailyRollups.mockReturnValue([mockDailyRollup]);

      const adjustment = scorer.getAdjustment('server-1', 'llama3:latest');

      // Below minConfidence returns low-confidence neutral
      expect(adjustment.reason).toBe('low-confidence');
      expect(adjustment.latencyMultiplier).toBe(1.0);
    });

    it('calculates correct multipliers when profile exists', () => {
      mockStore.getTemporalProfile.mockReturnValue({
        id: 1,
        server_id: 'server-1',
        model: 'llama3:latest',
        hour_of_day: 14,
        day_of_week: 3,
        profile_type: 'exact' as const,
        sample_count: 10,
        total_requests: 100,
        avg_latency_ms: 750,
        avg_latency_stddev: 50,
        p95_latency_ms: 900,
        success_rate: 0.85,
        avg_tokens_per_second: 40,
        cold_start_rate: 0.1,
        avg_ttft_ms: 200,
        confidence: 0.8,
        updated_at: Date.now(),
      });
      mockStore.getDailyRollups.mockReturnValue([mockDailyRollup]);

      const adjustment = scorer.getAdjustment('server-1', 'llama3:latest');

      // Profile latency (750) vs overall avg (500) = 1.5x
      // With confidence 0.8: 1.0 + (1.5 - 1.0) * 0.8 = 1.4
      expect(adjustment.latencyMultiplier).toBeCloseTo(1.4, 1);
      // Profile success rate 0.85 vs overall (950/1000 = 0.95) = 0.895
      // With invert=true: raw = 0.95/0.85 = 1.118
      // effective = 1.0 + (1.118 - 1.0) * 0.8 = 1.094
      expect(adjustment.successRateMultiplier).toBeCloseTo(1.094, 1);
      // Profile throughput (40) vs overall (40) = 1.0x
      // With invert=true and same values: raw = 40/40 = 1.0
      // effective = 1.0 + (1.0 - 1.0) * 0.8 = 1.0
      expect(adjustment.throughputMultiplier).toBeCloseTo(1.0, 1);
      expect(adjustment.confidence).toBe(0.8);
    });

    it('clamps multipliers to maxAdjustment', () => {
      mockStore.getTemporalProfile.mockReturnValue({
        id: 1,
        server_id: 'server-1',
        model: 'llama3:latest',
        hour_of_day: 14,
        day_of_week: 3,
        profile_type: 'exact' as const,
        sample_count: 10,
        total_requests: 100,
        avg_latency_ms: 1500, // 3x worse than overall 500
        avg_latency_stddev: 50,
        p95_latency_ms: 900,
        success_rate: 0.85,
        avg_tokens_per_second: 40,
        cold_start_rate: 0.1,
        avg_ttft_ms: 200,
        confidence: 1.0,
        updated_at: Date.now(),
      });
      mockStore.getDailyRollups.mockReturnValue([mockDailyRollup]);

      const scorerStrict = new TemporalScorer({ maxAdjustment: 2.0 });
      const adjustment = scorerStrict.getAdjustment('server-1', 'llama3:latest');

      // Raw: 3.0, clamped to maxAdjustment 2.0
      expect(adjustment.latencyMultiplier).toBe(2.0);
    });

    it('applies model fallback confidence', () => {
      mockStore.getTemporalProfile.mockReturnValue({
        id: 1,
        server_id: null,
        model: 'llama3:latest',
        hour_of_day: 14,
        day_of_week: 3,
        profile_type: 'model' as const,
        sample_count: 10,
        total_requests: 100,
        avg_latency_ms: 750,
        avg_latency_stddev: 50,
        p95_latency_ms: 900,
        success_rate: 0.85,
        avg_tokens_per_second: 40,
        cold_start_rate: 0.1,
        avg_ttft_ms: 200,
        confidence: 1.0,
        updated_at: Date.now(),
      });
      mockStore.getDailyRollups.mockReturnValue([mockDailyRollup]);

      const scorerWithFallback = new TemporalScorer({
        modelFallbackConfidence: 0.6,
        minConfidence: 0.0,
      });
      const adjustment = scorerWithFallback.getAdjustment('server-1', 'llama3:latest');

      // Original confidence 1.0 * modelFallback 0.6 = 0.6
      expect(adjustment.confidence).toBe(0.6);
    });
  });

  describe('getComparativeAdjustments', () => {
    it('returns adjustments for multiple servers', () => {
      mockStore.getTemporalProfile.mockImplementation((serverId: string) => {
        if (serverId === 'server-1') {
          return {
            id: 1,
            server_id: 'server-1',
            model: 'llama3:latest',
            hour_of_day: 14,
            day_of_week: 3,
            profile_type: 'exact' as const,
            sample_count: 10,
            total_requests: 100,
            avg_latency_ms: 750,
            avg_latency_stddev: 50,
            p95_latency_ms: 900,
            success_rate: 0.85,
            avg_tokens_per_second: 40,
            cold_start_rate: 0.1,
            avg_ttft_ms: 200,
            confidence: 0.8,
            updated_at: Date.now(),
          };
        }
        return null;
      });
      mockStore.getDailyRollups.mockReturnValue([mockDailyRollup]);

      const adjustments = scorer.getComparativeAdjustments('llama3:latest', [
        'server-1',
        'server-2',
      ]);

      expect(adjustments.size).toBe(2);
      expect(adjustments.get('server-1')?.confidence).toBe(0.8);
      expect(adjustments.get('server-2')?.confidence).toBe(0);
    });
  });

  describe('configuration', () => {
    it('isEnabled returns correct state', () => {
      expect(scorer.isEnabled()).toBe(true);

      const disabled = new TemporalScorer({ enabled: false });
      expect(disabled.isEnabled()).toBe(false);
    });

    it('isShadowMode returns correct state', () => {
      const shadowScorer = new TemporalScorer({ shadowMode: true });
      expect(shadowScorer.isShadowMode()).toBe(true);

      const normalScorer = new TemporalScorer({ shadowMode: false });
      expect(normalScorer.isShadowMode()).toBe(false);
    });

    it('updateConfig modifies config', () => {
      scorer.updateConfig({ minConfidence: 0.5 });
      expect(scorer.getConfig().minConfidence).toBe(0.5);
    });

    it('clearCache clears internal caches', () => {
      scorer.clearCache();
      expect(scorer.getConfig()).toBeDefined();
    });
  });
});
