import { describe, it, expect } from 'vitest';
import { calculateServerScore, selectBestServer, LoadBalancer } from '../../src/load-balancer.js';
import type { AIServer, ServerModelMetrics } from '../../src/orchestrator.types.js';

describe('Load Balancer', () => {
  const mockServer: AIServer = {
    id: 'server-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
    maxConcurrency: 4,
  };

  describe('Server Score Calculation', () => {
    it('should calculate score with metrics', () => {
      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 1,
        queued: 0,
        windows: {} as any,
        percentiles: {
          p50: 100,
          p95: 200,
          p99: 300,
        },
        successRate: 0.99,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(mockServer, 'llama3:latest', 1, 1, metrics);

      expect(score.totalScore).toBeGreaterThan(0);
      expect(score.server.id).toBe('server-1');
      expect(score.breakdown.latencyScore).toBeGreaterThan(0);
      expect(score.breakdown.successRateScore).toBeGreaterThan(0);
      expect(score.breakdown.capacityScore).toBeGreaterThan(0);
      expect(score.breakdown.loadScore).toBeGreaterThan(0);
    });

    it('should penalize high latency', () => {
      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: {
          p50: 10000, // Very high latency
          p95: 15000,
          p99: 20000,
        },
        successRate: 1,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(mockServer, 'llama3:latest', 0, 0, metrics);
      
      // High latency should result in low latency score
      expect(score.breakdown.latencyScore).toBeLessThan(50);
    });

    it('should penalize low success rate', () => {
      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: {
          p50: 100,
          p95: 200,
          p99: 300,
        },
        successRate: 0.5, // Low success rate
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(mockServer, 'llama3:latest', 0, 0, metrics);
      
      // Low success rate should result in low success rate score
      expect(score.breakdown.successRateScore).toBeLessThan(50);
    });

    it('should prefer lower load', () => {
      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 3,
        queued: 0,
        windows: {} as any,
        percentiles: {
          p50: 100,
          p95: 200,
          p99: 300,
        },
        successRate: 1,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const lowLoadScore = calculateServerScore(mockServer, 'llama3:latest', 0, 0, metrics);
      const highLoadScore = calculateServerScore(mockServer, 'llama3:latest', 3, 3, metrics);
      
      // Lower load should have higher load score
      expect(lowLoadScore.breakdown.loadScore).toBeGreaterThan(highLoadScore.breakdown.loadScore);
    });

    it('should fallback to lastResponseTime when no metrics', () => {
      const score = calculateServerScore(mockServer, 'llama3:latest', 0, 0, undefined);
      
      // Should still calculate a score using lastResponseTime
      expect(score.totalScore).toBeGreaterThan(0);
    });
  });

  describe('Server Selection', () => {
    it('should select server with highest score', () => {
      const scores = [
        {
          server: { ...mockServer, id: 'server-1' },
          totalScore: 50,
          breakdown: {} as any,
        },
        {
          server: { ...mockServer, id: 'server-2' },
          totalScore: 80,
          breakdown: {} as any,
        },
        {
          server: { ...mockServer, id: 'server-3' },
          totalScore: 30,
          breakdown: {} as any,
        },
      ];

      const selected = selectBestServer(scores);
      expect(selected?.id).toBe('server-2');
    });

    it('should return undefined for empty candidates', () => {
      const selected = selectBestServer([]);
      expect(selected).toBeUndefined();
    });

    it('should return only candidate', () => {
      const scores = [
        {
          server: mockServer,
          totalScore: 50,
          breakdown: {} as any,
        },
      ];

      const selected = selectBestServer(scores);
      expect(selected?.id).toBe('server-1');
    });
  });

  describe('LoadBalancer Class', () => {
    it('should use weighted algorithm by default', () => {
      const lb = new LoadBalancer();
      expect(lb.getAlgorithm()).toBe('weighted');
    });

    it('should support round-robin algorithm', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('round-robin');
      expect(lb.getAlgorithm()).toBe('round-robin');
    });

    it('should select with weighted algorithm using metrics', () => {
      const lb = new LoadBalancer();
      const servers = [
        { ...mockServer, id: 'fast-server', lastResponseTime: 50 },
        { ...mockServer, id: 'slow-server', lastResponseTime: 500 },
      ];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => undefined;

      // With no metrics, it should use lastResponseTime
      // Fast server should be selected
      const selected = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      expect(selected?.id).toBe('fast-server');
    });

    it('should support round-robin selection', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('round-robin');
      
      const servers = [
        { ...mockServer, id: 'server-1' },
        { ...mockServer, id: 'server-2' },
        { ...mockServer, id: 'server-3' },
      ];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => undefined;

      // Should rotate through servers
      const s1 = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      const s2 = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      const s3 = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      const s4 = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);

      expect(s1?.id).toBe('server-1');
      expect(s2?.id).toBe('server-2');
      expect(s3?.id).toBe('server-3');
      expect(s4?.id).toBe('server-1'); // Wraps around
    });

    it('should support least-connections selection', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('least-connections');
      
      const servers = [
        { ...mockServer, id: 'server-1' },
        { ...mockServer, id: 'server-2' },
        { ...mockServer, id: 'server-3' },
      ];

      const loadMap = new Map<string, number>([
        ['server-1', 5],
        ['server-2', 2],
        ['server-3', 8],
      ]);

      const getLoad = () => 0;
      const getTotalLoad = (id: string) => loadMap.get(id) || 0;
      const getMetrics = () => undefined;

      // Should select server with least connections (server-2 with 2)
      const selected = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      expect(selected?.id).toBe('server-2');
    });

    it('should handle empty server list', () => {
      const lb = new LoadBalancer();
      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => undefined;

      const selected = lb.select([], 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      expect(selected).toBeUndefined();
    });
  });

  describe('Integration with Metrics', () => {
    it('should prefer server with better historical metrics', () => {
      const lb = new LoadBalancer();
      
      const servers = [
        { ...mockServer, id: 'good-server' },
        { ...mockServer, id: 'bad-server' },
      ];

      const metricsMap = new Map<string, ServerModelMetrics>([
        ['good-server:llama3:latest', {
          serverId: 'good-server',
          model: 'llama3:latest',
          inFlight: 0,
          queued: 0,
          windows: {} as any,
          percentiles: { p50: 100, p95: 150, p99: 200 },
          successRate: 0.99,
          throughput: 20,
          avgTokensPerRequest: 50,
          lastUpdated: Date.now(),
          recentLatencies: [],
        }],
        ['bad-server:llama3:latest', {
          serverId: 'bad-server',
          model: 'llama3:latest',
          inFlight: 0,
          queued: 0,
          windows: {} as any,
          percentiles: { p50: 500, p95: 1000, p99: 2000 },
          successRate: 0.80,
          throughput: 5,
          avgTokensPerRequest: 50,
          lastUpdated: Date.now(),
          recentLatencies: [],
        }],
      ]);

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = (serverId: string, model: string) => 
        metricsMap.get(`${serverId}:${model}`);

      // Good server should be selected
      const selected = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      expect(selected?.id).toBe('good-server');
    });
  });
});
