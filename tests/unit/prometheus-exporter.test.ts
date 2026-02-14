/**
 * prometheus-exporter.test.ts
 * Tests for Prometheus metrics export
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrometheusExporter } from '../../src/metrics/prometheus-exporter.js';
import { MetricsAggregator } from '../../src/metrics/metrics-aggregator.js';
import type { ServerModelMetrics, TimeWindow } from '../../src/orchestrator.types.js';

describe('PrometheusExporter', () => {
  let mockAggregator: MetricsAggregator;
  let exporter: PrometheusExporter;

  beforeEach(() => {
    mockAggregator = {
      getAllMetrics: vi.fn().mockReturnValue(new Map()),
      getGlobalMetrics: vi.fn().mockReturnValue({
        totalRequests: 0,
        totalErrors: 0,
        totalTokens: 0,
        requestsPerSecond: 0,
        avgLatency: 0,
        errorRate: 0,
      }),
      getMetrics: vi.fn().mockReturnValue(undefined),
    } as unknown as MetricsAggregator;

    exporter = new PrometheusExporter(mockAggregator);
  });

  describe('export()', () => {
    it('should export global metrics with zero values', () => {
      const result = exporter.export();

      expect(result).toContain('# HELP orchestrator_requests_total Total requests processed');
      expect(result).toContain('# TYPE orchestrator_requests_total counter');
      expect(result).toContain('orchestrator_requests_total 0');

      expect(result).toContain('# HELP orchestrator_errors_total Total errors');
      expect(result).toContain('orchestrator_errors_total 0');

      expect(result).toContain('# HELP orchestrator_tokens_generated_total Total tokens generated');
      expect(result).toContain('orchestrator_tokens_generated_total 0');

      expect(result).toContain('# HELP orchestrator_requests_per_second Current request rate');
      expect(result).toContain('# TYPE orchestrator_requests_per_second gauge');
      expect(result).toContain('orchestrator_requests_per_second 0.00');

      expect(result).toContain(
        '# HELP orchestrator_avg_latency_ms Average latency in milliseconds'
      );
      expect(result).toContain('orchestrator_avg_latency_ms 0.00');

      expect(result).toContain('# HELP orchestrator_error_rate Current error rate');
      expect(result).toContain('orchestrator_error_rate 0.0000');
    });

    it('should export global metrics with actual values (lines 28-52)', () => {
      mockAggregator.getGlobalMetrics = vi.fn().mockReturnValue({
        totalRequests: 1000,
        totalErrors: 50,
        totalTokens: 50000,
        requestsPerSecond: 25.567,
        avgLatency: 145.789,
        errorRate: 0.05,
      });

      const result = exporter.export();

      expect(result).toContain('orchestrator_requests_total 1000');
      expect(result).toContain('orchestrator_errors_total 50');
      expect(result).toContain('orchestrator_tokens_generated_total 50000');
      expect(result).toContain('orchestrator_requests_per_second 25.57');
      expect(result).toContain('orchestrator_avg_latency_ms 145.79');
      expect(result).toContain('orchestrator_error_rate 0.0500');
    });

    it('should export per-server:model metrics (lines 55-81)', () => {
      const windows: Record<TimeWindow, any> = {
        '1m': { count: 10, errors: 1, latencySum: 500, lastUpdated: Date.now() },
        '5m': { count: 50, errors: 2, latencySum: 2500, lastUpdated: Date.now() },
        '15m': { count: 150, errors: 5, latencySum: 7500, lastUpdated: Date.now() },
        '1h': { count: 600, errors: 20, latencySum: 30000, lastUpdated: Date.now() },
      };

      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server1:llama3:latest', {
        serverId: 'server1',
        model: 'llama3:latest',
        inFlight: 5,
        queued: 0,
        windows,
        percentiles: { p50: 45.5, p95: 120.3, p99: 200.7 },
        successRate: 0.98,
        throughput: 10.5,
        avgTokensPerRequest: 150.5,
        recentLatencies: [30, 40, 50, 60, 45, 55, 35, 48, 52, 42],
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      // Check per-server metrics
      expect(result).toContain(
        'orchestrator_in_flight_requests{server="server1",model="llama3:latest"} 5'
      );

      // Check window metrics for all time windows
      expect(result).toContain(
        'orchestrator_window_requests{server="server1",model="llama3:latest",window="1m"} 10'
      );
      expect(result).toContain(
        'orchestrator_window_requests{server="server1",model="llama3:latest",window="5m"} 50'
      );
      expect(result).toContain(
        'orchestrator_window_requests{server="server1",model="llama3:latest",window="15m"} 150'
      );
      expect(result).toContain(
        'orchestrator_window_requests{server="server1",model="llama3:latest",window="1h"} 600'
      );

      // Check error counts
      expect(result).toContain(
        'orchestrator_window_errors{server="server1",model="llama3:latest",window="1m"} 1'
      );
      expect(result).toContain(
        'orchestrator_window_errors{server="server1",model="llama3:latest",window="5m"} 2'
      );

      // Check latency metrics
      expect(result).toContain(
        'orchestrator_window_latency_sum_ms{server="server1",model="llama3:latest",window="1m"} 500.00'
      );
      expect(result).toContain(
        'orchestrator_window_latency_count{server="server1",model="llama3:latest",window="1m"} 10'
      );

      // Check percentiles
      expect(result).toContain(
        'orchestrator_latency_p50_ms{server="server1",model="llama3:latest"} 45.50'
      );
      expect(result).toContain(
        'orchestrator_latency_p95_ms{server="server1",model="llama3:latest"} 120.30'
      );
      expect(result).toContain(
        'orchestrator_latency_p99_ms{server="server1",model="llama3:latest"} 200.70'
      );

      // Check derived metrics
      expect(result).toContain(
        'orchestrator_success_rate{server="server1",model="llama3:latest"} 0.9800'
      );
      expect(result).toContain(
        'orchestrator_throughput_per_min{server="server1",model="llama3:latest"} 10.50'
      );
      expect(result).toContain(
        'orchestrator_avg_tokens_per_request{server="server1",model="llama3:latest"} 150.50'
      );
    });

    it('should export metrics for multiple servers (lines 55-81 loop)', () => {
      const windows: Record<TimeWindow, any> = {
        '1m': { count: 10, errors: 0, latencySum: 300, lastUpdated: Date.now() },
        '5m': { count: 50, errors: 1, latencySum: 1500, lastUpdated: Date.now() },
        '15m': { count: 150, errors: 3, latencySum: 4500, lastUpdated: Date.now() },
        '1h': { count: 600, errors: 10, latencySum: 18000, lastUpdated: Date.now() },
      };

      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server1:model1', {
        serverId: 'server1',
        model: 'model1',
        inFlight: 3,
        queued: 1,
        windows,
        percentiles: { p50: 30, p95: 100, p99: 150 },
        successRate: 0.99,
        throughput: 15.0,
        avgTokensPerRequest: 200.0,
        recentLatencies: [25, 30, 35, 40, 32],
        lastUpdated: Date.now(),
      });

      mockMetrics.set('server2:model2', {
        serverId: 'server2',
        model: 'model2',
        inFlight: 2,
        queued: 0,
        windows,
        percentiles: { p50: 40, p95: 110, p99: 180 },
        successRate: 0.95,
        throughput: 8.5,
        avgTokensPerRequest: 100.0,
        recentLatencies: [35, 40, 45, 50, 42],
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      // Both servers should be present
      expect(result).toContain('server="server1",model="model1"');
      expect(result).toContain('server="server2",model="model2"');

      // Check in-flight for both
      expect(result).toContain(
        'orchestrator_in_flight_requests{server="server1",model="model1"} 3'
      );
      expect(result).toContain(
        'orchestrator_in_flight_requests{server="server2",model="model2"} 2'
      );
    });

    it('should include all metric type and help declarations (lines 83-95)', () => {
      const windows: Record<TimeWindow, any> = {
        '1m': { count: 1, errors: 0, latencySum: 50, lastUpdated: Date.now() },
        '5m': { count: 5, errors: 0, latencySum: 250, lastUpdated: Date.now() },
        '15m': { count: 15, errors: 0, latencySum: 750, lastUpdated: Date.now() },
        '1h': { count: 60, errors: 0, latencySum: 3000, lastUpdated: Date.now() },
      };

      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('s:m', {
        serverId: 's',
        model: 'm',
        inFlight: 1,
        queued: 0,
        windows,
        percentiles: { p50: 50, p95: 100, p99: 150 },
        successRate: 1.0,
        throughput: 1.0,
        avgTokensPerRequest: 100.0,
        recentLatencies: [50],
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      // Check that type and help declarations are present
      expect(result).toContain('# TYPE orchestrator_in_flight_requests gauge');
      expect(result).toContain('# HELP orchestrator_in_flight_requests Current in-flight requests');
      expect(result).toContain('# TYPE orchestrator_success_rate gauge');
      expect(result).toContain('# HELP orchestrator_success_rate Success rate (0-1)');
      expect(result).toContain('# TYPE orchestrator_throughput_per_min gauge');
      expect(result).toContain(
        '# HELP orchestrator_throughput_per_min Throughput (requests per minute)'
      );
      expect(result).toContain('# TYPE orchestrator_avg_tokens_per_request gauge');
      expect(result).toContain(
        '# HELP orchestrator_avg_tokens_per_request Average tokens per request'
      );
    });
  });

  describe('exportLatencyHistogram()', () => {
    it('should return empty string when metrics not found (lines 103-104)', () => {
      mockAggregator.getMetrics = vi.fn().mockReturnValue(undefined);

      const result = exporter.exportLatencyHistogram('nonexistent', 'model');

      expect(result).toBe('');
    });

    it('should export histogram with default buckets (lines 102-131)', () => {
      const metric: ServerModelMetrics = {
        serverId: 'server1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 0, p95: 0, p99: 0 },
        successRate: 1,
        throughput: 0,
        avgTokensPerRequest: 0,
        recentLatencies: [30, 80, 150, 300, 600, 1200, 2500, 5000, 7500, 15000],
        lastUpdated: Date.now(),
      };

      mockAggregator.getMetrics = vi.fn().mockReturnValue(metric);

      const result = exporter.exportLatencyHistogram('server1', 'llama3:latest');

      // Check header
      expect(result).toContain(
        '# HELP orchestrator_request_duration_ms Request duration histogram'
      );
      expect(result).toContain('# TYPE orchestrator_request_duration_ms histogram');

      // Check all default buckets
      expect(result).toContain(
        'orchestrator_request_duration_ms_bucket{server="server1",model="llama3:latest",le="50"}'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_bucket{server="server1",model="llama3:latest",le="100"}'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_bucket{server="server1",model="llama3:latest",le="250"}'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_bucket{server="server1",model="llama3:latest",le="500"}'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_bucket{server="server1",model="llama3:latest",le="1000"}'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_bucket{server="server1",model="llama3:latest",le="2500"}'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_bucket{server="server1",model="llama3:latest",le="5000"}'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_bucket{server="server1",model="llama3:latest",le="10000"}'
      );

      // Check +Inf bucket
      expect(result).toContain(
        'orchestrator_request_duration_ms_bucket{server="server1",model="llama3:latest",le="+Inf"} 10'
      );

      // Check sum and count
      expect(result).toContain(
        'orchestrator_request_duration_ms_sum{server="server1",model="llama3:latest"}'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_count{server="server1",model="llama3:latest"} 10'
      );
    });

    it('should export histogram with custom buckets (line 102)', () => {
      const metric: ServerModelMetrics = {
        serverId: 'server1',
        model: 'model1',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 0, p95: 0, p99: 0 },
        successRate: 1,
        throughput: 0,
        avgTokensPerRequest: 0,
        recentLatencies: [10, 25, 50, 75, 100],
        lastUpdated: Date.now(),
      };

      mockAggregator.getMetrics = vi.fn().mockReturnValue(metric);

      const customBuckets = [25, 50, 75];
      const result = exporter.exportLatencyHistogram('server1', 'model1', customBuckets);

      // Check custom buckets
      expect(result).toContain('le="25"');
      expect(result).toContain('le="50"');
      expect(result).toContain('le="75"');

      // Should not have default buckets
      expect(result).not.toContain('le="5000"');
      expect(result).not.toContain('le="10000"');
    });

    it('should correctly count requests in each bucket (lines 116-120)', () => {
      // All latencies are <= 100
      const metric: ServerModelMetrics = {
        serverId: 'server1',
        model: 'model1',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 0, p95: 0, p99: 0 },
        successRate: 1,
        throughput: 0,
        avgTokensPerRequest: 0,
        recentLatencies: [10, 20, 30, 40, 50],
        lastUpdated: Date.now(),
      };

      mockAggregator.getMetrics = vi.fn().mockReturnValue(metric);

      const result = exporter.exportLatencyHistogram('server1', 'model1', [25, 50, 100]);
      const lines = result.split('\n');

      // Find bucket lines
      const bucket25Line = lines.find(l => l.includes('le="25"'));
      const bucket50Line = lines.find(l => l.includes('le="50"'));
      const bucket100Line = lines.find(l => l.includes('le="100"'));

      // Extract counts
      const count25 = parseInt(bucket25Line?.split(' ').pop() || '0');
      const count50 = parseInt(bucket50Line?.split(' ').pop() || '0');
      const count100 = parseInt(bucket100Line?.split(' ').pop() || '0');

      // Latencies <= 25: [10, 20] = 2
      expect(count25).toBe(2);

      // Latencies <= 50: [10, 20, 30, 40, 50] = 5
      expect(count50).toBe(5);

      // Latencies <= 100: [10, 20, 30, 40, 50] = 5
      expect(count100).toBe(5);
    });

    it('should calculate sum of latencies correctly (lines 126-127)', () => {
      const metric: ServerModelMetrics = {
        serverId: 'server1',
        model: 'model1',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 0, p95: 0, p99: 0 },
        successRate: 1,
        throughput: 0,
        avgTokensPerRequest: 0,
        recentLatencies: [10, 20, 30, 40, 50],
        lastUpdated: Date.now(),
      };

      mockAggregator.getMetrics = vi.fn().mockReturnValue(metric);

      const result = exporter.exportLatencyHistogram('server1', 'model1');

      // Sum should be 150 (10+20+30+40+50)
      expect(result).toContain(
        'orchestrator_request_duration_ms_sum{server="server1",model="model1"} 150.00'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_count{server="server1",model="model1"} 5'
      );
    });

    it('should handle empty latencies array', () => {
      const metric: ServerModelMetrics = {
        serverId: 'server1',
        model: 'model1',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 0, p95: 0, p99: 0 },
        successRate: 1,
        throughput: 0,
        avgTokensPerRequest: 0,
        recentLatencies: [],
        lastUpdated: Date.now(),
      };

      mockAggregator.getMetrics = vi.fn().mockReturnValue(metric);

      const result = exporter.exportLatencyHistogram('server1', 'model1');

      // Should still produce valid output with zero counts
      expect(result).toContain('orchestrator_request_duration_ms_bucket');
      expect(result).toContain(
        'orchestrator_request_duration_ms_sum{server="server1",model="model1"} 0.00'
      );
      expect(result).toContain(
        'orchestrator_request_duration_ms_count{server="server1",model="model1"} 0'
      );
    });
  });
});
