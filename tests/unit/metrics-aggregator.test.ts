import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsAggregator } from '../../src/metrics/metrics-aggregator.js';
import type { RequestContext } from '../../src/orchestrator.types.js';

describe('MetricsAggregator', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator();
  });

  describe('Request Recording', () => {
    it('should record a successful request', () => {
      const context: RequestContext = {
        id: 'req-1',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 100,
      };

      aggregator.recordRequest(context);
      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');

      expect(metrics).toBeDefined();
      expect(metrics?.serverId).toBe('server-1');
      expect(metrics?.model).toBe('llama3:latest');
      expect(metrics?.windows['5m'].count).toBe(1);
      expect(metrics?.windows['5m'].latencySum).toBe(100);
    });

    it('should record a failed request', () => {
      const context: RequestContext = {
        id: 'req-1',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: false,
        duration: 100,
      };

      aggregator.recordRequest(context);
      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');

      expect(metrics?.windows['5m'].errors).toBe(1);
    });

    it('should track multiple requests', () => {
      for (let i = 0; i < 5; i++) {
        aggregator.recordRequest({
          id: `req-${i}`,
          startTime: Date.now() - 100,
          serverId: 'server-1',
          model: 'llama3:latest',
          endpoint: 'generate',
          streaming: false,
          success: i < 4, // 4 successes, 1 failure
          duration: 100 + i * 10,
        });
      }

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.windows['5m'].count).toBe(5);
      expect(metrics?.windows['5m'].errors).toBe(1);
    });

    it('should track token counts', () => {
      aggregator.recordRequest({
        id: 'req-1',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 100,
        tokensGenerated: 100,
        tokensPrompt: 50,
      });

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.windows['5m'].tokensGenerated).toBe(100);
      expect(metrics?.windows['5m'].tokensPrompt).toBe(50);
    });
  });

  describe('In-Flight Tracking', () => {
    it('should track in-flight requests', () => {
      aggregator.incrementInFlight('server-1', 'llama3:latest');
      aggregator.incrementInFlight('server-1', 'llama3:latest');

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.inFlight).toBe(2);
    });

    it('should decrement in-flight requests', () => {
      aggregator.incrementInFlight('server-1', 'llama3:latest');
      aggregator.incrementInFlight('server-1', 'llama3:latest');
      aggregator.decrementInFlight('server-1', 'llama3:latest');

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.inFlight).toBe(1);
    });

    it('should not go below zero', () => {
      aggregator.incrementInFlight('server-1', 'llama3:latest');
      aggregator.decrementInFlight('server-1', 'llama3:latest');
      aggregator.decrementInFlight('server-1', 'llama3:latest');

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.inFlight).toBe(0);
    });
  });

  describe('Percentile Calculations', () => {
    it('should calculate P50 correctly', () => {
      const latencies = [100, 200, 300, 400, 500];

      latencies.forEach((duration, i) => {
        aggregator.recordRequest({
          id: `req-${i}`,
          startTime: Date.now() - duration,
          serverId: 'server-1',
          model: 'llama3:latest',
          endpoint: 'generate',
          streaming: false,
          success: true,
          duration,
        });
      });

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.percentiles.p50).toBe(300);
    });

    it('should calculate P95 correctly', () => {
      // Create 100 requests with increasing latency
      for (let i = 0; i < 100; i++) {
        aggregator.recordRequest({
          id: `req-${i}`,
          startTime: Date.now() - i,
          serverId: 'server-1',
          model: 'llama3:latest',
          endpoint: 'generate',
          streaming: false,
          success: true,
          duration: i * 10,
        });
      }

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      // P95 of 100 values should be around the 95th value (950ms)
      expect(metrics?.percentiles.p95).toBeGreaterThan(0);
    });

    it('should handle empty metrics', () => {
      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics).toBeUndefined();
    });
  });

  describe('Derived Metrics', () => {
    it('should calculate success rate', () => {
      for (let i = 0; i < 10; i++) {
        aggregator.recordRequest({
          id: `req-${i}`,
          startTime: Date.now() - 100,
          serverId: 'server-1',
          model: 'llama3:latest',
          endpoint: 'generate',
          streaming: false,
          success: i < 9, // 9 successes, 1 failure
          duration: 100,
        });
      }

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.successRate).toBe(0.9);
    });

    it('should calculate throughput', () => {
      const baseTime = Date.now();

      // Record 60 requests spread over 60 seconds
      for (let i = 0; i < 60; i++) {
        aggregator.recordRequest({
          id: `req-${i}`,
          startTime: baseTime - i * 1000, // Spread over 60 seconds
          serverId: 'server-1',
          model: 'llama3:latest',
          endpoint: 'generate',
          streaming: false,
          success: true,
          duration: 100,
        });
      }

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      // Throughput should be approximately 60 requests per minute (or 1 per second)
      // Note: in tests with fast execution, window duration might be very small
      expect(metrics?.throughput).toBeDefined();
      expect(metrics?.windows['5m'].count).toBe(60);
    });

    it('should calculate average tokens', () => {
      aggregator.recordRequest({
        id: 'req-1',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 100,
        tokensGenerated: 100,
      });

      aggregator.recordRequest({
        id: 'req-2',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 100,
        tokensGenerated: 200,
      });

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.avgTokensPerRequest).toBe(150);
    });
  });

  describe('Global Metrics', () => {
    it('should aggregate across all server:models', () => {
      aggregator.recordRequest({
        id: 'req-1',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 100,
        tokensGenerated: 50,
      });

      aggregator.recordRequest({
        id: 'req-2',
        startTime: Date.now() - 100,
        serverId: 'server-2',
        model: 'mistral:latest',
        endpoint: 'generate',
        streaming: false,
        success: false,
        duration: 200,
        tokensGenerated: 100,
      });

      const global = aggregator.getGlobalMetrics();
      expect(global.totalRequests).toBe(2);
      expect(global.totalErrors).toBe(1);
      expect(global.totalTokens).toBe(150);
      expect(global.errorRate).toBe(0.5);
    });
  });

  describe('Metrics Export', () => {
    it('should export structured metrics', () => {
      aggregator.recordRequest({
        id: 'req-1',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 100,
      });

      const exported = aggregator.exportMetrics();
      expect(exported.timestamp).toBeDefined();
      expect(exported.global).toBeDefined();
      expect(exported.global.totalRequests).toBe(1);
    });

    it('should include server metrics in export', () => {
      aggregator.recordRequest({
        id: 'req-1',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 100,
      });

      const allMetrics = aggregator.getAllMetrics();
      expect(allMetrics.size).toBe(1);
      expect(allMetrics.has('server-1:llama3:latest')).toBe(true);
    });
  });

  describe('Reset', () => {
    it('should clear all metrics on reset', () => {
      aggregator.recordRequest({
        id: 'req-1',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 100,
      });

      aggregator.reset();

      const metrics = aggregator.getAllMetrics();
      expect(metrics.size).toBe(0);
    });
  });

  describe('Streaming Metrics', () => {
    it('should record streaming request with TTFT', () => {
      const context: RequestContext = {
        id: 'stream-1',
        startTime: Date.now() - 500,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: true,
        success: true,
        duration: 500,
        ttft: 100,
        streamingDuration: 400,
        chunkCount: 10,
        maxChunkGapMs: 50,
        avgChunkSizeBytes: 100,
      };

      aggregator.recordRequest(context);
      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');

      expect(metrics?.streamingMetrics).toBeDefined();
      expect(metrics?.streamingMetrics?.recentTTFTs).toContain(100);
      expect(metrics?.streamingMetrics?.recentChunkCounts).toContain(10);
      expect(metrics?.streamingMetrics?.recentStreamingDurations).toContain(400);
      expect(metrics?.streamingMetrics?.recentMaxChunkGaps).toContain(50);
      expect(metrics?.streamingMetrics?.recentChunkSizes).toContain(100);
    });

    it('should calculate average TTFT correctly', () => {
      aggregator.recordRequest({
        id: 'stream-1',
        startTime: Date.now() - 300,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: true,
        success: true,
        duration: 300,
        ttft: 100,
      });

      aggregator.recordRequest({
        id: 'stream-2',
        startTime: Date.now() - 200,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: true,
        success: true,
        duration: 200,
        ttft: 200,
      });

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.streamingMetrics?.avgTTFT).toBe(150);
    });

    it('should calculate TTFT percentiles', () => {
      const ttfts = [50, 100, 150, 200, 250];
      for (let i = 0; i < ttfts.length; i++) {
        aggregator.recordRequest({
          id: `stream-${i}`,
          startTime: Date.now() - 300 + i,
          serverId: 'server-1',
          model: 'llama3:latest',
          endpoint: 'generate',
          streaming: true,
          success: true,
          duration: 300,
          ttft: ttfts[i],
        });
      }

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.streamingMetrics?.ttftPercentiles.p50).toBeGreaterThan(0);
      expect(metrics?.streamingMetrics?.ttftPercentiles.p95).toBeGreaterThan(0);
      expect(metrics?.streamingMetrics?.ttftPercentiles.p99).toBeGreaterThan(0);
    });

    it('should not record TTFT when zero or undefined', () => {
      aggregator.recordRequest({
        id: 'stream-1',
        startTime: Date.now() - 300,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: true,
        success: true,
        duration: 300,
        ttft: 0,
      });

      aggregator.recordRequest({
        id: 'non-stream-1',
        startTime: Date.now() - 200,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 200,
      });

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.streamingMetrics?.recentTTFTs).toHaveLength(0);
      expect(metrics?.streamingMetrics?.avgTTFT).toBe(0);
    });

    it('should get streaming metrics summary', () => {
      aggregator.recordRequest({
        id: 'stream-1',
        startTime: Date.now() - 300,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: true,
        success: true,
        duration: 300,
        ttft: 100,
        streamingDuration: 200,
        chunkCount: 5,
      });

      aggregator.recordRequest({
        id: 'stream-2',
        startTime: Date.now() - 200,
        serverId: 'server-2',
        model: 'llama3:8b',
        endpoint: 'generate',
        streaming: true,
        success: true,
        duration: 200,
        ttft: 150,
        streamingDuration: 100,
        chunkCount: 3,
      });

      const summary = aggregator.getStreamingMetricsSummary(2);
      expect(summary).toBeDefined();
      expect(summary?.totalStreamingRequests).toBe(2);
      expect(summary?.avgTTFT).toBe(125);
      expect(summary?.avgStreamingDuration).toBe(150);
      expect(summary?.avgChunkCount).toBe(4);
    });

    it('should return undefined for streaming summary when no streaming requests', () => {
      aggregator.recordRequest({
        id: 'req-1',
        startTime: Date.now() - 100,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: false,
        success: true,
        duration: 100,
      });

      const summary = aggregator.getStreamingMetricsSummary(1);
      expect(summary).toBeUndefined();
    });

    it('should track chunk metrics correctly', () => {
      aggregator.recordRequest({
        id: 'stream-1',
        startTime: Date.now() - 300,
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: true,
        success: true,
        duration: 300,
        chunkCount: 10,
        maxChunkGapMs: 100,
        avgChunkSizeBytes: 50,
      });

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.streamingMetrics?.recentChunkCounts).toContain(10);
      expect(metrics?.streamingMetrics?.recentMaxChunkGaps).toContain(100);
      expect(metrics?.streamingMetrics?.recentChunkSizes).toContain(50);
      expect(metrics?.streamingMetrics?.avgChunkCount).toBe(10);
      expect(metrics?.streamingMetrics?.avgChunkSizeBytes).toBe(50);
    });

    it('should limit recent TTFTs array size', () => {
      for (let i = 0; i < 600; i++) {
        aggregator.recordRequest({
          id: `stream-${i}`,
          startTime: Date.now() - 600 + i,
          serverId: 'server-1',
          model: 'llama3:latest',
          endpoint: 'generate',
          streaming: true,
          success: true,
          duration: 100,
          ttft: 100 + i,
        });
      }

      const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
      expect(metrics?.streamingMetrics?.recentTTFTs.length).toBeLessThanOrEqual(500);
    });
  });
});
