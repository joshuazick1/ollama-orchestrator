/**
 * analytics-engine.test.ts
 * Unit tests for AnalyticsEngine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnalyticsEngine,
  type TopModelData,
  type ServerPerformanceData,
  type ErrorAnalysisData,
  type CapacityData,
} from '../../src/analytics/analytics-engine.js';
import type { ServerModelMetrics, RequestContext } from '../../src/orchestrator.types.js';

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
});
