/**
 * prometheus-exporter-stream-metrics.test.ts
 * Tests for stream metrics (chunks, max gap, total bytes, queue wait)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MetricsAggregator } from '../../src/metrics/metrics-aggregator.js';
import { PrometheusExporter } from '../../src/metrics/prometheus-exporter.js';
import type {
  ServerModelMetrics,
  TimeWindow,
  StreamingMetrics,
} from '../../src/orchestrator/orchestrator.types.js';

describe('PrometheusExporter stream metrics', () => {
  let mockAggregator: MetricsAggregator;
  let exporter: PrometheusExporter;

  const baseWindows: Record<TimeWindow, any> = {
    '1m': { count: 10, errors: 0, latencySum: 500, lastUpdated: Date.now() },
    '5m': { count: 50, errors: 1, latencySum: 2500, lastUpdated: Date.now() },
    '15m': { count: 150, errors: 2, latencySum: 7500, lastUpdated: Date.now() },
    '1h': { count: 600, errors: 5, latencySum: 30000, lastUpdated: Date.now() },
    '24h': { count: 2400, errors: 20, latencySum: 120000, lastUpdated: Date.now() },
  };

  beforeEach(() => {
    mockAggregator = {
      getAllMetrics: vi.fn().mockReturnValue(new Map()),
      getGlobalMetrics: vi.fn().mockReturnValue({
        totalRequests: 100,
        totalErrors: 5,
        totalTokens: 5000,
        requestsPerSecond: 10,
        avgLatency: 100,
        errorRate: 0.05,
      }),
      getMetrics: vi.fn().mockReturnValue(undefined),
    } as unknown as MetricsAggregator;

    exporter = new PrometheusExporter(mockAggregator);
  });

  describe('stream chunks total', () => {
    it('should emit orchestrator_stream_chunks_total when recentChunkCounts has data', () => {
      const streamingMetrics: StreamingMetrics = {
        recentTTFTs: [50, 60, 70],
        ttftPercentiles: { p50: 55, p95: 68, p99: 72 },
        avgTTFT: 60,
        recentStreamingDurations: [1000, 1100, 1200],
        streamingDurationPercentiles: { p50: 1050, p95: 1150, p99: 1250 },
        avgStreamingDuration: 1100,
        recentChunkCounts: [10, 15, 20],
        chunkCountPercentiles: { p50: 15, p95: 19, p99: 21 },
        avgChunkCount: 15,
        recentMaxChunkGaps: [100, 150, 200],
        maxChunkGapPercentiles: { p50: 150, p95: 190, p99: 210 },
        avgChunkSizeBytes: 256,
        recentChunkSizes: [1000, 1500, 2000],
        chunkSizePercentiles: { p50: 1500, p95: 1900, p99: 2100 },
        recentChunkGaps: [50, 75, 100],
        avgChunkGapMs: 75,
        chunkGapPercentiles: { p50: 75, p95: 95, p99: 105 },
      };

      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server1:llama3:latest', {
        serverId: 'server1',
        model: 'llama3:latest',
        inFlight: 2,
        queued: 0,
        windows: baseWindows,
        percentiles: { p50: 45.5, p95: 120.3, p99: 200.7 },
        successRate: 0.98,
        throughput: 10.5,
        avgTokensPerRequest: 150.5,
        recentLatencies: [30, 40, 50],
        streamingMetrics,
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      expect(result).toContain(
        '# HELP orchestrator_stream_chunks_total Total streaming chunks received'
      );
      expect(result).toContain('# TYPE orchestrator_stream_chunks_total counter');
      expect(result).toContain(
        'orchestrator_stream_chunks_total{server="server1",model="llama3:latest"} 45'
      );
    });

    it('should omit orchestrator_stream_chunks_total when recentChunkCounts is empty', () => {
      const streamingMetrics: StreamingMetrics = {
        recentTTFTs: [],
        ttftPercentiles: { p50: 0, p95: 0, p99: 0 },
        avgTTFT: 0,
        recentStreamingDurations: [],
        streamingDurationPercentiles: { p50: 0, p95: 0, p99: 0 },
        avgStreamingDuration: 0,
        recentChunkCounts: [],
        chunkCountPercentiles: { p50: 0, p95: 0, p99: 0 },
        avgChunkCount: 0,
        recentMaxChunkGaps: [],
        maxChunkGapPercentiles: { p50: 0, p95: 0, p99: 0 },
        avgChunkSizeBytes: 0,
        recentChunkSizes: [],
        chunkSizePercentiles: { p50: 0, p95: 0, p99: 0 },
        recentChunkGaps: [],
        avgChunkGapMs: 0,
        chunkGapPercentiles: { p50: 0, p95: 0, p99: 0 },
      };

      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server1:llama3:latest', {
        serverId: 'server1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: baseWindows,
        percentiles: { p50: 0, p95: 0, p99: 0 },
        successRate: 1,
        throughput: 0,
        avgTokensPerRequest: 0,
        recentLatencies: [],
        streamingMetrics,
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      expect(result).not.toContain('orchestrator_stream_chunks_total');
    });
  });

  describe('stream max chunk gap', () => {
    it('should emit orchestrator_stream_max_chunk_gap_ms with most recent value', () => {
      const streamingMetrics: StreamingMetrics = {
        recentTTFTs: [50],
        ttftPercentiles: { p50: 50, p95: 50, p99: 50 },
        avgTTFT: 50,
        recentStreamingDurations: [1000],
        streamingDurationPercentiles: { p50: 1000, p95: 1000, p99: 1000 },
        avgStreamingDuration: 1000,
        recentChunkCounts: [10],
        chunkCountPercentiles: { p50: 10, p95: 10, p99: 10 },
        avgChunkCount: 10,
        recentMaxChunkGaps: [100, 150, 200, 175],
        maxChunkGapPercentiles: { p50: 150, p95: 190, p99: 200 },
        avgChunkSizeBytes: 1000,
        recentChunkSizes: [500],
        chunkSizePercentiles: { p50: 500, p95: 500, p99: 500 },
        recentChunkGaps: [50],
        avgChunkGapMs: 50,
        chunkGapPercentiles: { p50: 50, p95: 50, p99: 50 },
      };

      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server1:llama3:latest', {
        serverId: 'server1',
        model: 'llama3:latest',
        inFlight: 1,
        queued: 0,
        windows: baseWindows,
        percentiles: { p50: 50, p95: 100, p99: 150 },
        successRate: 0.99,
        throughput: 12,
        avgTokensPerRequest: 200,
        recentLatencies: [50],
        streamingMetrics,
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      expect(result).toContain(
        '# HELP orchestrator_stream_max_chunk_gap_ms Maximum chunk gap in milliseconds'
      );
      expect(result).toContain('# TYPE orchestrator_stream_max_chunk_gap_ms gauge');
      expect(result).toContain(
        'orchestrator_stream_max_chunk_gap_ms{server="server1",model="llama3:latest"} 175.00'
      );
    });
  });

  describe('stream total bytes', () => {
    it('should emit orchestrator_stream_total_bytes as sum of recentChunkSizes', () => {
      const streamingMetrics: StreamingMetrics = {
        recentTTFTs: [50],
        ttftPercentiles: { p50: 50, p95: 50, p99: 50 },
        avgTTFT: 50,
        recentStreamingDurations: [1000],
        streamingDurationPercentiles: { p50: 1000, p95: 1000, p99: 1000 },
        avgStreamingDuration: 1000,
        recentChunkCounts: [10],
        chunkCountPercentiles: { p50: 10, p95: 10, p99: 10 },
        avgChunkCount: 10,
        recentMaxChunkGaps: [100],
        maxChunkGapPercentiles: { p50: 100, p95: 100, p99: 100 },
        avgChunkSizeBytes: 500,
        recentChunkSizes: [500, 1000, 1500, 2000],
        chunkSizePercentiles: { p50: 1000, p95: 1750, p99: 2000 },
        recentChunkGaps: [50],
        avgChunkGapMs: 50,
        chunkGapPercentiles: { p50: 50, p95: 50, p99: 50 },
      };

      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server1:llama3:latest', {
        serverId: 'server1',
        model: 'llama3:latest',
        inFlight: 1,
        queued: 0,
        windows: baseWindows,
        percentiles: { p50: 50, p95: 100, p99: 150 },
        successRate: 0.99,
        throughput: 12,
        avgTokensPerRequest: 200,
        recentLatencies: [50],
        streamingMetrics,
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      expect(result).toContain(
        '# HELP orchestrator_stream_total_bytes Total bytes from streaming responses'
      );
      expect(result).toContain('# TYPE orchestrator_stream_total_bytes counter');
      expect(result).toContain(
        'orchestrator_stream_total_bytes{server="server1",model="llama3:latest"} 5000'
      );
    });
  });

  describe('queue wait seconds', () => {
    it('should emit orchestrator_queue_wait_seconds from avgQueueWaitTimeMs', () => {
      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server1:llama3:latest', {
        serverId: 'server1',
        model: 'llama3:latest',
        inFlight: 2,
        queued: 1,
        windows: baseWindows,
        percentiles: { p50: 50, p95: 100, p99: 150 },
        successRate: 0.98,
        throughput: 12,
        avgTokensPerRequest: 200,
        recentLatencies: [50, 60, 70],
        avgQueueWaitTimeMs: 2500,
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      expect(result).toContain('# HELP orchestrator_queue_wait_seconds Queue wait time in seconds');
      expect(result).toContain('# TYPE orchestrator_queue_wait_seconds gauge');
      expect(result).toContain(
        'orchestrator_queue_wait_seconds{server="server1",model="llama3:latest"} 2.5000'
      );
    });

    it('should omit queue wait metric when avgQueueWaitTimeMs is zero', () => {
      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server1:llama3:latest', {
        serverId: 'server1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: baseWindows,
        percentiles: { p50: 0, p95: 0, p99: 0 },
        successRate: 1,
        throughput: 0,
        avgTokensPerRequest: 0,
        recentLatencies: [],
        avgQueueWaitTimeMs: 0,
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      expect(result).not.toContain('orchestrator_queue_wait_seconds');
    });
  });

  describe('all 4 metrics together', () => {
    it('should emit all stream metrics when data is present', () => {
      const streamingMetrics: StreamingMetrics = {
        recentTTFTs: [50, 60],
        ttftPercentiles: { p50: 55, p95: 60, p99: 62 },
        avgTTFT: 55,
        recentStreamingDurations: [1000, 1100],
        streamingDurationPercentiles: { p50: 1050, p95: 1100, p99: 1150 },
        avgStreamingDuration: 1050,
        recentChunkCounts: [10, 20],
        chunkCountPercentiles: { p50: 15, p95: 20, p99: 21 },
        avgChunkCount: 15,
        recentMaxChunkGaps: [100, 200],
        maxChunkGapPercentiles: { p50: 150, p95: 200, p99: 210 },
        avgChunkSizeBytes: 500,
        recentChunkSizes: [500, 1000],
        chunkSizePercentiles: { p50: 750, p95: 1000, p99: 1100 },
        recentChunkGaps: [50, 75],
        avgChunkGapMs: 62.5,
        chunkGapPercentiles: { p50: 62.5, p95: 75, p99: 80 },
      };

      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server1:llama3:latest', {
        serverId: 'server1',
        model: 'llama3:latest',
        inFlight: 3,
        queued: 1,
        windows: baseWindows,
        percentiles: { p50: 50, p95: 100, p99: 150 },
        successRate: 0.98,
        throughput: 12,
        avgTokensPerRequest: 200,
        recentLatencies: [50, 60, 70],
        streamingMetrics,
        avgQueueWaitTimeMs: 1500,
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      expect(result).toContain(
        'orchestrator_stream_chunks_total{server="server1",model="llama3:latest"} 30'
      );
      expect(result).toContain(
        'orchestrator_stream_max_chunk_gap_ms{server="server1",model="llama3:latest"} 200.00'
      );
      expect(result).toContain(
        'orchestrator_stream_total_bytes{server="server1",model="llama3:latest"} 1500'
      );
      expect(result).toContain(
        'orchestrator_queue_wait_seconds{server="server1",model="llama3:latest"} 1.5000'
      );
    });
  });

  describe('label escaping', () => {
    it('should handle special characters in server and model names', () => {
      const mockMetrics = new Map<string, ServerModelMetrics>();
      mockMetrics.set('server-1:model:with:colons', {
        serverId: 'server-1',
        model: 'model:with:colons',
        inFlight: 1,
        queued: 0,
        windows: baseWindows,
        percentiles: { p50: 50, p95: 100, p99: 150 },
        successRate: 0.99,
        throughput: 10,
        avgTokensPerRequest: 100,
        recentLatencies: [50],
        avgQueueWaitTimeMs: 1000,
        lastUpdated: Date.now(),
      });

      mockAggregator.getAllMetrics = vi.fn().mockReturnValue(mockMetrics);

      const result = exporter.export();

      expect(result).toContain(
        'orchestrator_queue_wait_seconds{server="server-1",model="model:with:colons"} 1.0000'
      );
    });
  });
});
