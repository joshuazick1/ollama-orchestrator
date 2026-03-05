/**
 * analytics-engine.test.ts
 * Unit tests for AnalyticsEngine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  AnalyticsEngine,
  type TopModelData,
  type ServerPerformanceData,
  type ErrorAnalysisData,
  type CapacityData,
} from '../../src/analytics/analytics-engine.js';
import type { ServerModelMetrics, RequestContext } from '../../src/orchestrator.types.js';
import * as metricsStoreMod from '../../src/storage/metrics-store.js';
import type { UnifiedErrorType, RequestRow } from '../../src/storage/types.js';

// ============================================================
// Mock for SQLite store — used by Phase 2 long-range tests
// ============================================================
vi.mock('../../src/storage/metrics-store.js', () => {
  const mockStore = {
    getHourlyRollups: vi.fn(),
    getDailyRollups: vi.fn(),
    getRequests: vi.fn(),
    getDecisions: vi.fn(),
  };
  return { getMetricsStore: () => mockStore, _mockStore: mockStore };
});
// Access the underlying mock object
const mockStore = (
  metricsStoreMod as unknown as { _mockStore: ReturnType<typeof metricsStoreMod.getMetricsStore> }
)._mockStore;

describe('AnalyticsEngine', () => {
  let analytics: AnalyticsEngine;

  beforeEach(() => {
    analytics = new AnalyticsEngine();
  });

  // Helper to create mock metrics
  function createMockMetrics(
    serverId: string,
    model: string,
    overrides: Partial<ServerModelMetrics> = {}
  ): ServerModelMetrics {
    const now = Date.now();
    return {
      serverId,
      model,
      inFlight: 0,
      queued: 0,
      windows: {
        '1m': {
          startTime: now - 60000,
          endTime: now,
          count: 10,
          userRequests: 10,
          latencySum: 5000,
          latencySquaredSum: 2500000,
          minLatency: 100,
          maxLatency: 1000,
          errors: 1,
          tokensGenerated: 1000,
          tokensPrompt: 500,
        },
        '5m': {
          startTime: now - 300000,
          endTime: now,
          count: 50,
          userRequests: 50,
          latencySum: 25000,
          latencySquaredSum: 12500000,
          minLatency: 100,
          maxLatency: 1000,
          errors: 2,
          tokensGenerated: 5000,
          tokensPrompt: 2500,
        },
        '15m': {
          startTime: now - 900000,
          endTime: now,
          count: 150,
          userRequests: 150,
          latencySum: 75000,
          latencySquaredSum: 37500000,
          minLatency: 100,
          maxLatency: 1000,
          errors: 5,
          tokensGenerated: 15000,
          tokensPrompt: 7500,
        },
        '1h': {
          startTime: now - 3600000,
          endTime: now,
          count: 600,
          userRequests: 600,
          latencySum: 300000,
          latencySquaredSum: 150000000,
          minLatency: 100,
          maxLatency: 1000,
          errors: 10,
          tokensGenerated: 60000,
          tokensPrompt: 30000,
        },
        '24h': {
          startTime: now - 86400000,
          endTime: now,
          count: 10000,
          userRequests: 10000,
          latencySum: 5000000,
          latencySquaredSum: 2500000000,
          minLatency: 100,
          maxLatency: 1000,
          errors: 50,
          tokensGenerated: 1000000,
          tokensPrompt: 500000,
        },
      },
      percentiles: { p50: 500, p95: 950, p99: 990 },
      successRate: 0.98,
      throughput: 120,
      avgTokensPerRequest: 100,
      avgTokensPerSecond: 10,
      coldStartCount: 0,
      lastUpdated: now,
      recentLatencies: [500, 600, 400, 550, 450],
      ...overrides,
    };
  }

  // Helper to create mock request context
  function createMockRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
    return {
      id: `req-${Date.now()}`,
      startTime: Date.now(),
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 500,
      serverId: 'server-1',
      ...overrides,
    };
  }

  describe('Time Range Parsing', () => {
    it('should parse 1h time range', () => {
      const range = analytics.parseTimeRange('1h');
      const now = Date.now();
      expect(range.end - range.start).toBe(3600000);
      expect(range.end).toBeLessThanOrEqual(now + 1000);
    });

    it('should parse 24h time range', () => {
      const range = analytics.parseTimeRange('24h');
      expect(range.end - range.start).toBe(86400000);
    });

    it('should parse 7d time range', () => {
      const range = analytics.parseTimeRange('7d');
      expect(range.end - range.start).toBe(604800000);
    });

    it('should handle custom time range', () => {
      const custom = { start: 1000, end: 5000 };
      const range = analytics.parseTimeRange('custom', custom);
      expect(range).toEqual(custom);
    });
  });

  describe('Top Models Analytics', () => {
    it('should return empty array when no metrics', () => {
      const topModels = analytics.getTopModels();
      expect(topModels).toHaveLength(0);
    });

    it('should rank models by request count', () => {
      const metrics1 = createMockMetrics('server-1', 'model-a');
      const metrics2 = createMockMetrics('server-1', 'model-b');
      metrics2.windows['1h'].count = 1000; // More requests

      const metricsMap = new Map([
        ['server-1:model-a', metrics1],
        ['server-1:model-b', metrics2],
      ]);

      analytics.updateMetrics(metricsMap);
      const topModels = analytics.getTopModels(10, '1h');

      expect(topModels).toHaveLength(2);
      expect(topModels[0].model).toBe('model-b'); // Most requests first
      expect(topModels[1].model).toBe('model-a');
    });

    it('should calculate percentages correctly', () => {
      const metrics1 = createMockMetrics('server-1', 'model-a');
      const metricsMap = new Map([['server-1:model-a', metrics1]]);

      analytics.updateMetrics(metricsMap);
      const topModels = analytics.getTopModels();

      expect(topModels[0].percentage).toBe(100); // Only one model
    });
  });

  describe('Server Performance Analytics', () => {
    it('should calculate server performance metrics', () => {
      const metrics = createMockMetrics('server-1', 'llama3:latest');
      const metricsMap = new Map([['server-1:llama3:latest', metrics]]);

      analytics.updateMetrics(metricsMap);
      const performance = analytics.getServerPerformance('1h');

      expect(performance).toHaveLength(1);
      expect(performance[0].id).toBe('server-1');
      expect(performance[0].requests).toBe(600);
      expect(performance[0].score).toBeGreaterThan(0);
    });

    it('should sort servers by score', () => {
      const metrics1 = createMockMetrics('server-1', 'llama3:latest', {
        percentiles: { p50: 100, p95: 200, p99: 300 },
      });
      const metrics2 = createMockMetrics('server-2', 'llama3:latest', {
        percentiles: { p50: 500, p95: 1000, p99: 1500 },
        successRate: 0.5,
      });

      const metricsMap = new Map([
        ['server-1:llama3:latest', metrics1],
        ['server-2:llama3:latest', metrics2],
      ]);

      analytics.updateMetrics(metricsMap);
      const performance = analytics.getServerPerformance();

      expect(performance[0].id).toBe('server-1'); // Better score
      expect(performance[1].id).toBe('server-2');
    });
  });

  describe('Error Analysis', () => {
    it('should classify timeout errors', () => {
      const context = createMockRequestContext({
        success: false,
        error: new Error('Request timeout after 30000ms'),
      });

      analytics.recordRequest(context);
      const analysis = analytics.getErrorAnalysis();

      expect(analysis.byType['timeout']).toBe(1);
    });

    it('should classify OOM errors', () => {
      const context = createMockRequestContext({
        success: false,
        error: new Error('Out of memory error'),
      });

      analytics.recordRequest(context);
      const analysis = analytics.getErrorAnalysis();

      expect(analysis.byType['oom']).toBe(1);
    });

    it('should aggregate errors by server and model', () => {
      const contexts = [
        createMockRequestContext({
          serverId: 'server-1',
          model: 'model-a',
          success: false,
          error: new Error('timeout'),
        }),
        createMockRequestContext({
          serverId: 'server-1',
          model: 'model-b',
          success: false,
          error: new Error('timeout'),
        }),
        createMockRequestContext({
          serverId: 'server-2',
          model: 'model-a',
          success: false,
          error: new Error('timeout'),
        }),
      ];

      contexts.forEach(ctx => analytics.recordRequest(ctx));
      const analysis = analytics.getErrorAnalysis();

      expect(analysis.byServer['server-1']).toBe(2);
      expect(analysis.byServer['server-2']).toBe(1);
      expect(analysis.byModel['model-a']).toBe(2);
      expect(analysis.byModel['model-b']).toBe(1);
    });

    it('should calculate error trend', () => {
      // Create errors with time distribution
      const now = Date.now();

      // Old errors (first half of 24h)
      for (let i = 0; i < 5; i++) {
        analytics.recordRequest(
          createMockRequestContext({
            startTime: now - 20 * 3600000,
            success: false,
            error: new Error('timeout'),
          })
        );
      }

      // Recent errors (second half of 24h)
      for (let i = 0; i < 15; i++) {
        analytics.recordRequest(
          createMockRequestContext({
            startTime: now - 2 * 3600000,
            success: false,
            error: new Error('timeout'),
          })
        );
      }

      const analysis = analytics.getErrorAnalysis();
      expect(analysis.trend).toBe('increasing');
    });
  });

  describe('Capacity Analysis', () => {
    it('should calculate current capacity', () => {
      const metrics = createMockMetrics('server-1', 'llama3:latest', {
        inFlight: 2,
      });
      const metricsMap = new Map([['server-1:llama3:latest', metrics]]);

      analytics.updateMetrics(metricsMap);
      const capacity = analytics.getCapacityAnalysis(5);

      expect(capacity.current.totalCapacity).toBeGreaterThan(0);
      expect(capacity.current.usedCapacity).toBe(2);
      expect(capacity.current.queueDepth).toBe(5);
    });

    it('should provide capacity forecasts', () => {
      const metrics = createMockMetrics('server-1', 'llama3:latest');
      const metricsMap = new Map([['server-1:llama3:latest', metrics]]);

      analytics.updateMetrics(metricsMap);
      const capacity = analytics.getCapacityAnalysis();

      expect(capacity.forecast.nextHour).toBeDefined();
      expect(capacity.forecast.nextHour.predictedSaturation).toBeGreaterThanOrEqual(0);
      expect(capacity.forecast.nextHour.predictedSaturation).toBeLessThanOrEqual(1);
    });

    it('should generate recommendations', () => {
      // Create high load scenario
      const metrics = createMockMetrics('server-1', 'llama3:latest', {
        throughput: 1000, // Very high throughput
      });
      const metricsMap = new Map([['server-1:llama3:latest', metrics]]);

      analytics.updateMetrics(metricsMap);
      const capacity = analytics.getCapacityAnalysis(100); // Large queue

      expect(capacity.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Trend Analysis', () => {
    it('should detect increasing latency trend', () => {
      const metrics1 = createMockMetrics('server-1', 'model-a', {
        windows: {
          ...createMockMetrics('server-1', 'model-a').windows,
          '1h': {
            ...createMockMetrics('server-1', 'model-a').windows['1h'],
            latencySum: 1000,
            count: 10, // 100ms avg
          },
        },
      });
      const metrics2 = createMockMetrics('server-2', 'model-a', {
        windows: {
          ...createMockMetrics('server-2', 'model-a').windows,
          '1h': {
            ...createMockMetrics('server-2', 'model-a').windows['1h'],
            latencySum: 10000,
            count: 10, // 1000ms avg
          },
        },
      });

      const metricsMap = new Map([
        ['server-1:model-a', metrics1],
        ['server-2:model-a', metrics2],
      ]);

      analytics.updateMetrics(metricsMap);
      const trend = analytics.analyzeTrend('latency', undefined, 'model-a');

      expect(trend.direction).toBe('increasing');
      expect(trend.slope).toBeGreaterThan(0);
    });

    it('should detect stable trend', () => {
      const metrics1 = createMockMetrics('server-1', 'model-a');
      const metrics2 = createMockMetrics('server-2', 'model-a', {
        windows: metrics1.windows,
      });

      const metricsMap = new Map([
        ['server-1:model-a', metrics1],
        ['server-2:model-a', metrics2],
      ]);

      analytics.updateMetrics(metricsMap);
      const trend = analytics.analyzeTrend('latency');

      expect(trend.direction).toBe('stable');
    });
  });

  describe('Summary Statistics', () => {
    it('should provide summary statistics', () => {
      const metrics1 = createMockMetrics('server-1', 'model-a');
      const metrics2 = createMockMetrics('server-1', 'model-b');
      const metrics3 = createMockMetrics('server-2', 'model-a');

      const metricsMap = new Map([
        ['server-1:model-a', metrics1],
        ['server-1:model-b', metrics2],
        ['server-2:model-a', metrics3],
      ]);

      analytics.updateMetrics(metricsMap);
      const summary = analytics.getSummary();

      expect(summary.totalRequests).toBeGreaterThan(0);
      expect(summary.uniqueModels).toBe(2);
      expect(summary.uniqueServers).toBe(2);
    });

    it('should return empty summary when no data', () => {
      const summary = analytics.getSummary();
      expect(summary.totalRequests).toBe(0);
      expect(summary.uniqueModels).toBe(0);
    });
  });

  describe('Capacity Analysis', () => {
    it('should analyze capacity with queue depth', () => {
      const metrics = createMockMetrics('server-1', 'llama3:latest', {
        inFlight: 2,
        queued: 5,
      });
      const metricsMap = new Map([['server-1:llama3:latest', metrics]]);

      analytics.updateMetrics(metricsMap);
      const capacity = analytics.getCapacityAnalysis(3);

      expect(capacity).toBeDefined();
    });

    it('should handle empty metrics', () => {
      const capacity = analytics.getCapacityAnalysis();
      expect(capacity).toBeDefined();
    });
  });

  describe('Error Analysis', () => {
    it('should analyze errors', () => {
      const errors = analytics.getErrorAnalysis('1h');
      expect(errors).toBeDefined();
    });
  });

  describe('Server Selection Stats', () => {
    it('should get server selection statistics', () => {
      analytics.recordRequest(createMockRequestContext({ serverId: 'server-1' }));
      analytics.recordRequest(createMockRequestContext({ serverId: 'server-2' }));

      const stats = analytics.getServerSelectionStats(1);
      expect(stats).toBeDefined();
    });
  });

  describe('Algorithm Stats', () => {
    it('should get algorithm statistics', () => {
      const stats = analytics.getAlgorithmStats(1);
      expect(stats).toBeDefined();
    });
  });

  describe('Decision Events', () => {
    it('should get decision events', () => {
      analytics.recordRequest(createMockRequestContext());

      const events = analytics.getDecisionEvents(10);
      expect(events).toBeDefined();
    });

    it('should filter decision events by model', () => {
      analytics.recordRequest(createMockRequestContext({ model: 'llama3:latest' }));
      analytics.recordRequest(createMockRequestContext({ model: 'mistral:latest' }));

      const events = analytics.getDecisionEvents(10, 'llama3:latest');
      expect(events.every(e => e.model === 'llama3:latest')).toBe(true);
    });
  });

  describe('Total Request Count', () => {
    it('should return total request count', () => {
      const count = analytics.getTotalRequestCount();
      expect(typeof count).toBe('number');
    });
  });

  describe('Reset', () => {
    it('should reset all data', () => {
      const metrics = createMockMetrics('server-1', 'llama3:latest');
      analytics.updateMetrics(new Map([['server-1:llama3:latest', metrics]]));
      analytics.recordRequest(createMockRequestContext());

      analytics.reset();
      const summary = analytics.getSummary();

      expect(summary.totalRequests).toBe(0);
      expect(summary.uniqueModels).toBe(0);
    });
  });

  // ============================================================
  // Phase 2: SQLite-backed long-range (7d / 30d) tests
  // ============================================================

  describe('Phase 2 – long-range reads from SQLite', () => {
    function makeHourlyRow(
      overrides: Partial<{
        server_id: string;
        model: string;
        total_requests: number;
        latency_sum: number;
        failures: number;
        latency_p95: number;
        latency_p99: number;
        avg_tokens_per_second: number;
      }> = {}
    ) {
      return {
        server_id: 'server-1',
        model: 'llama3:latest',
        hour_start: Date.now() - 3600000,
        total_requests: 100,
        user_requests: 100,
        successes: 95,
        failures: 5,
        cold_starts: 0,
        latency_sum: 50000,
        latency_sq_sum: 0,
        latency_min: 100,
        latency_max: 2000,
        latency_p50: 450,
        latency_p95: 900,
        latency_p99: 1800,
        ttft_count: 0,
        ttft_sum: 0,
        ttft_p50: null,
        ttft_p95: null,
        tokens_generated: 5000,
        tokens_prompt: 2000,
        avg_tokens_per_second: 20,
        errors_timeout: 2,
        errors_oom: 1,
        errors_connection: 2,
        errors_other: 0,
        hour_of_day: 12,
        day_of_week: 1,
        ...overrides,
      };
    }

    function makeRequestRow(
      overrides: Partial<{
        id: string;
        timestamp: number;
        server_id: string;
        model: string;
        success: number;
        duration_ms: number;
        error_type: UnifiedErrorType | null;
      }> = {}
    ): RequestRow {
      return {
        id: `req-${Math.random()}`,
        parent_request_id: null,
        is_retry: 0,
        timestamp: Date.now() - 86400000 * 3,
        server_id: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: 0,
        success: 0,
        duration_ms: 3000,
        error_type: 'timeout' as UnifiedErrorType,
        error_message: 'request timed out',
        tokens_prompt: null,
        tokens_generated: null,
        tokens_per_second: null,
        ttft_ms: null,
        streaming_duration_ms: null,
        chunk_count: null,
        total_bytes: null,
        max_chunk_gap_ms: null,
        avg_chunk_size: null,
        eval_duration: null,
        prompt_eval_duration: null,
        total_duration: null,
        load_duration: null,
        is_cold_start: 0,
        queue_wait_ms: null,
        hour_of_day: 10,
        day_of_week: 2,
        date_str: '2026-03-02',
        ...overrides,
      } as unknown as RequestRow;
    }

    beforeEach(() => {
      vi.mocked(mockStore.getHourlyRollups).mockReset();
      vi.mocked(mockStore.getDailyRollups).mockReset();
      vi.mocked(mockStore.getRequests).mockReset();
      // Default: empty results
      vi.mocked(mockStore.getHourlyRollups).mockReturnValue([]);
      vi.mocked(mockStore.getDailyRollups).mockReturnValue([]);
      vi.mocked(mockStore.getRequests).mockReturnValue([]);
    });

    describe('getTopModels – 7d routes through hourly rollups', () => {
      it('returns data from hourly rollups for 7d', () => {
        vi.mocked(mockStore.getHourlyRollups).mockReturnValue([
          makeHourlyRow({
            server_id: 'server-1',
            model: 'llama3:latest',
            total_requests: 200,
            latency_sum: 100000,
            failures: 10,
          }),
          makeHourlyRow({
            server_id: 'server-2',
            model: 'mistral:latest',
            total_requests: 50,
            latency_sum: 20000,
            failures: 2,
          }),
        ]);

        const result = analytics.getTopModels(10, '7d');

        expect(mockStore.getHourlyRollups).toHaveBeenCalled();
        expect(result).toHaveLength(2);
        expect(result[0].model).toBe('llama3:latest');
        expect(result[0].requests).toBe(200);
        expect(result[1].model).toBe('mistral:latest');
      });

      it('calculates percentage correctly from rollup totals', () => {
        vi.mocked(mockStore.getHourlyRollups).mockReturnValue([
          makeHourlyRow({ model: 'model-a', total_requests: 75 }),
          makeHourlyRow({ model: 'model-b', total_requests: 25 }),
        ]);

        const result = analytics.getTopModels(10, '7d');

        expect(result.find(r => r.model === 'model-a')!.percentage).toBeCloseTo(75);
        expect(result.find(r => r.model === 'model-b')!.percentage).toBeCloseTo(25);
      });

      it('respects the limit parameter', () => {
        vi.mocked(mockStore.getHourlyRollups).mockReturnValue([
          makeHourlyRow({ model: 'model-a', total_requests: 100 }),
          makeHourlyRow({ model: 'model-b', total_requests: 80 }),
          makeHourlyRow({ model: 'model-c', total_requests: 60 }),
        ]);

        const result = analytics.getTopModels(2, '7d');
        expect(result).toHaveLength(2);
      });

      it('returns empty array when SQLite has no data for 7d', () => {
        vi.mocked(mockStore.getHourlyRollups).mockReturnValue([]);
        const result = analytics.getTopModels(10, '7d');
        expect(result).toHaveLength(0);
      });
    });

    describe('getTopModels – 30d routes through daily rollups', () => {
      it('uses daily rollups for 30d (not hourly)', () => {
        vi.mocked(mockStore.getDailyRollups).mockReturnValue([
          makeHourlyRow({ model: 'llama3:latest', total_requests: 5000 }) as any,
        ]);

        analytics.getTopModels(10, '30d');

        expect(mockStore.getDailyRollups).toHaveBeenCalled();
        expect(mockStore.getHourlyRollups).not.toHaveBeenCalled();
      });
    });

    describe('getServerPerformance – 7d routes through hourly rollups', () => {
      it('returns server data from hourly rollups for 7d', () => {
        vi.mocked(mockStore.getHourlyRollups).mockReturnValue([
          makeHourlyRow({
            server_id: 'server-1',
            total_requests: 300,
            latency_sum: 150000,
            failures: 15,
          }),
        ]);

        const result = analytics.getServerPerformance('7d');

        expect(mockStore.getHourlyRollups).toHaveBeenCalled();
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('server-1');
        expect(result[0].requests).toBe(300);
      });

      it('aggregates multiple hourly rows for the same server', () => {
        vi.mocked(mockStore.getHourlyRollups).mockReturnValue([
          makeHourlyRow({
            server_id: 'server-1',
            total_requests: 100,
            latency_sum: 50000,
            failures: 5,
          }),
          makeHourlyRow({
            server_id: 'server-1',
            total_requests: 200,
            latency_sum: 100000,
            failures: 10,
          }),
        ]);

        const result = analytics.getServerPerformance('7d');

        expect(result).toHaveLength(1);
        expect(result[0].requests).toBe(300);
      });

      it('uses daily rollups for 30d', () => {
        vi.mocked(mockStore.getDailyRollups).mockReturnValue([
          makeHourlyRow({ server_id: 'server-1', total_requests: 2000 }) as any,
        ]);

        analytics.getServerPerformance('30d');

        expect(mockStore.getDailyRollups).toHaveBeenCalled();
        expect(mockStore.getHourlyRollups).not.toHaveBeenCalled();
      });

      it('returns empty array when SQLite has no data for 7d', () => {
        vi.mocked(mockStore.getHourlyRollups).mockReturnValue([]);
        const result = analytics.getServerPerformance('7d');
        expect(result).toHaveLength(0);
      });

      it('sorts by score descending', () => {
        vi.mocked(mockStore.getHourlyRollups).mockReturnValue([
          makeHourlyRow({
            server_id: 'server-bad',
            total_requests: 100,
            latency_sum: 10000000,
            failures: 80,
          }),
          makeHourlyRow({
            server_id: 'server-good',
            total_requests: 100,
            latency_sum: 5000,
            failures: 0,
          }),
        ]);

        const result = analytics.getServerPerformance('7d');

        expect(result[0].id).toBe('server-good');
        expect(result[1].id).toBe('server-bad');
      });
    });

    describe('getErrorAnalysis – 7d routes through requests table', () => {
      it('returns error counts from SQLite failed requests for 7d', () => {
        vi.mocked(mockStore.getRequests).mockReturnValue([
          makeRequestRow({ server_id: 'server-1', error_type: 'timeout' }),
          makeRequestRow({ server_id: 'server-1', error_type: 'timeout' }),
          makeRequestRow({ server_id: 'server-2', error_type: 'oom' }),
        ]);

        const result = analytics.getErrorAnalysis('7d');

        expect(mockStore.getRequests).toHaveBeenCalledWith(
          expect.objectContaining({ success: false })
        );
        expect(result.totalErrors).toBe(3);
        expect(result.byType['timeout']).toBe(2);
        expect(result.byType['oom']).toBe(1);
        expect(result.byServer['server-1']).toBe(2);
        expect(result.byServer['server-2']).toBe(1);
      });

      it('computes trend from first/second half', () => {
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const mid = now - sevenDaysMs / 2;
        // 2 errors in first half, 8 in second → ratio > 1.5 → increasing
        const rows = [
          makeRequestRow({ timestamp: mid - 1000 }),
          makeRequestRow({ timestamp: mid - 2000 }),
          makeRequestRow({ timestamp: mid + 1000 }),
          makeRequestRow({ timestamp: mid + 2000 }),
          makeRequestRow({ timestamp: mid + 3000 }),
          makeRequestRow({ timestamp: mid + 4000 }),
          makeRequestRow({ timestamp: mid + 5000 }),
          makeRequestRow({ timestamp: mid + 6000 }),
          makeRequestRow({ timestamp: mid + 7000 }),
          makeRequestRow({ timestamp: mid + 8000 }),
        ];
        vi.mocked(mockStore.getRequests).mockReturnValue(rows);

        const result = analytics.getErrorAnalysis('7d');
        expect(result.trend).toBe('increasing');
      });

      it('returns stable trend when fewer than 10 errors', () => {
        vi.mocked(mockStore.getRequests).mockReturnValue([makeRequestRow(), makeRequestRow()]);
        const result = analytics.getErrorAnalysis('7d');
        expect(result.trend).toBe('stable');
      });

      it('returns empty analysis when SQLite has no data for 7d', () => {
        vi.mocked(mockStore.getRequests).mockReturnValue([]);
        const result = analytics.getErrorAnalysis('7d');
        expect(result.totalErrors).toBe(0);
        expect(result.trend).toBe('stable');
        expect(result.recentErrors).toHaveLength(0);
      });

      it('caps recentErrors at 50', () => {
        const rows = Array.from({ length: 100 }, (_, i) =>
          makeRequestRow({ id: `req-${i}`, timestamp: Date.now() - i * 1000 })
        );
        vi.mocked(mockStore.getRequests).mockReturnValue(rows);

        const result = analytics.getErrorAnalysis('7d');
        expect(result.recentErrors.length).toBeLessThanOrEqual(50);
      });
    });

    describe('in-memory paths still used for <= 24h ranges', () => {
      it('getTopModels with 1h does NOT call getHourlyRollups', () => {
        analytics.getTopModels(10, '1h');
        expect(mockStore.getHourlyRollups).not.toHaveBeenCalled();
      });

      it('getTopModels with 24h does NOT call getHourlyRollups', () => {
        analytics.getTopModels(10, '24h');
        expect(mockStore.getHourlyRollups).not.toHaveBeenCalled();
      });

      it('getServerPerformance with 1h does NOT call getHourlyRollups', () => {
        analytics.getServerPerformance('1h');
        expect(mockStore.getHourlyRollups).not.toHaveBeenCalled();
      });

      it('getErrorAnalysis with 24h does NOT call getRequests for failed rows', () => {
        analytics.getErrorAnalysis('24h');
        expect(mockStore.getRequests).not.toHaveBeenCalled();
      });
    });
  });
});
