import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  calculateServerScore,
  selectBestServer,
  LoadBalancer,
  DEFAULT_LB_CONFIG,
  CircuitBreakerHealth,
} from '../../src/load-balancer.js';
import type { AIServer, ServerModelMetrics } from '../../src/orchestrator.types.js';

const mockServer: AIServer = {
  id: 'server-1',
  url: 'http://localhost:11434',
  type: 'ollama',
  healthy: true,
  lastResponseTime: 100,
  models: ['llama3:latest'],
  maxConcurrency: 4,
};

describe('Load Balancer - Additional Tests', () => {
  describe('Circuit Breaker in Score Calculation', () => {
    it('should penalize open circuit breaker', () => {
      const cbHealth: CircuitBreakerHealth = {
        state: 'open',
        failureCount: 5,
        errorRate: 0.5,
      };

      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 100, p95: 200, p99: 300 },
        successRate: 1,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(
        mockServer,
        'llama3:latest',
        0,
        0,
        metrics,
        DEFAULT_LB_CONFIG,
        cbHealth
      );

      expect(score.breakdown.circuitBreakerScore).toBe(5);
    });

    it('should penalize half-open circuit breaker', () => {
      const cbHealth: CircuitBreakerHealth = {
        state: 'half-open',
        failureCount: 3,
        errorRate: 0.3,
      };

      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 100, p95: 200, p99: 300 },
        successRate: 1,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(
        mockServer,
        'llama3:latest',
        0,
        0,
        metrics,
        DEFAULT_LB_CONFIG,
        cbHealth
      );

      expect(score.breakdown.circuitBreakerScore).toBe(20);
    });

    it('should apply minor penalty for failures in closed state', () => {
      const cbHealth: CircuitBreakerHealth = {
        state: 'closed',
        failureCount: 3,
        errorRate: 0.1,
      };

      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 100, p95: 200, p99: 300 },
        successRate: 1,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(
        mockServer,
        'llama3:latest',
        0,
        0,
        metrics,
        DEFAULT_LB_CONFIG,
        cbHealth
      );

      expect(score.breakdown.circuitBreakerScore).toBe(85);
    });
  });

  describe('Timeout in Score Calculation', () => {
    it('should have max timeout score when no timeout', () => {
      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 100, p95: 200, p99: 300 },
        successRate: 1,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(mockServer, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.timeoutScore).toBe(100);
    });

    it('should penalize long timeouts', () => {
      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 100, p95: 200, p99: 300 },
        successRate: 1,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(
        mockServer,
        'llama3:latest',
        0,
        0,
        metrics,
        DEFAULT_LB_CONFIG,
        undefined,
        300000
      );

      expect(score.breakdown.timeoutScore).toBe(0);
    });

    it('should apply partial penalty for medium timeout', () => {
      const metrics: ServerModelMetrics = {
        serverId: 'server-1',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 100, p95: 200, p99: 300 },
        successRate: 1,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(
        mockServer,
        'llama3:latest',
        0,
        0,
        metrics,
        DEFAULT_LB_CONFIG,
        undefined,
        150000
      );

      expect(score.breakdown.timeoutScore).toBe(50);
    });
  });

  describe('Random Algorithm', () => {
    it('should select randomly from candidates', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('random');

      const servers = [
        { ...mockServer, id: 'server-1' },
        { ...mockServer, id: 'server-2' },
        { ...mockServer, id: 'server-3' },
      ];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => undefined;

      const selected = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      expect(selected).toBeDefined();
      expect(servers.some(s => s.id === selected?.id)).toBe(true);
    });

    it('should return undefined for empty candidates with random', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('random');

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => undefined;

      const selected = lb.select([], 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      expect(selected).toBeUndefined();
    });
  });

  describe('Streaming Optimized Algorithm', () => {
    it('should fall back to fastest-response for non-streaming', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('streaming-optimized');

      const servers = [
        { ...mockServer, id: 'fast-server', lastResponseTime: 50 },
        { ...mockServer, id: 'slow-server', lastResponseTime: 500 },
      ];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => undefined;

      const selected = lb.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        getMetrics,
        false
      );
      expect(selected?.id).toBe('fast-server');
    });
  });

  describe('Sticky Sessions', () => {
    let lb: LoadBalancer;

    afterEach(() => {
      lb.stopCleanup();
    });

    it('should maintain sticky session for same client', () => {
      lb = new LoadBalancer({
        roundRobin: {
          stickySessionsTtlMs: 60000,
          skipUnhealthy: true,
          checkCapacity: true,
        },
      });
      lb.setAlgorithm('round-robin');

      const servers = [
        { ...mockServer, id: 'server-1', healthy: true, maxConcurrency: 4 },
        { ...mockServer, id: 'server-2', healthy: true, maxConcurrency: 4 },
      ];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => undefined;

      const first = lb.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        getMetrics,
        false,
        'client-1'
      );
      const second = lb.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        getMetrics,
        false,
        'client-1'
      );

      expect(second?.id).toBe(first?.id);
    });
  });

  describe('Least Connections with Failure Rate', () => {
    it('should penalize servers with low success rate', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('least-connections');

      const servers = [
        { ...mockServer, id: 'good-server', healthy: true, maxConcurrency: 4 },
        { ...mockServer, id: 'bad-server', healthy: true, maxConcurrency: 4 },
      ];

      const loadMap = new Map<string, number>([
        ['good-server', 2],
        ['bad-server', 2],
      ]);

      const metricsMap = new Map<string, ServerModelMetrics>();
      metricsMap.set('good-server:llama3:latest', {
        serverId: 'good-server',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 100, p95: 200, p99: 300 },
        successRate: 1,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      });
      metricsMap.set('bad-server:llama3:latest', {
        serverId: 'bad-server',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 100, p95: 200, p99: 300 },
        successRate: 0.5,
        throughput: 10,
        avgTokensPerRequest: 50,
        lastUpdated: Date.now(),
        recentLatencies: [],
      });

      const getLoad = () => 0;
      const getTotalLoad = (id: string) => loadMap.get(id) || 0;
      const getMetrics = (serverId: string, model: string) =>
        metricsMap.get(`${serverId}:${model}`);

      const selected = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      expect(selected?.id).toBe('good-server');
    });
  });

  describe('Round Robin with Filtering', () => {
    it('should filter unhealthy servers', () => {
      const lb = new LoadBalancer({
        roundRobin: {
          skipUnhealthy: true,
          checkCapacity: false,
          stickySessionsTtlMs: 0,
        },
      });
      lb.setAlgorithm('round-robin');

      const servers = [
        { ...mockServer, id: 'server-1', healthy: false },
        { ...mockServer, id: 'server-2', healthy: true },
        { ...mockServer, id: 'server-3', healthy: true },
      ];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => undefined;

      const selected = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      expect(selected?.healthy).toBe(true);
    });

    it('should filter servers at capacity', () => {
      const lb = new LoadBalancer({
        roundRobin: {
          skipUnhealthy: false,
          checkCapacity: true,
          stickySessionsTtlMs: 0,
        },
        defaultMaxConcurrency: 4,
      });
      lb.setAlgorithm('round-robin');

      const servers = [
        { ...mockServer, id: 'server-1', maxConcurrency: 4 },
        { ...mockServer, id: 'server-2', maxConcurrency: 4 },
        { ...mockServer, id: 'server-3', maxConcurrency: 4 },
      ];

      const loadMap = new Map<string, number>([
        ['server-1', 4],
        ['server-2', 0],
        ['server-3', 0],
      ]);

      const getLoad = () => 0;
      const getTotalLoad = (id: string) => loadMap.get(id) || 0;
      const getMetrics = () => undefined;

      const selected = lb.select(servers, 'llama3:latest', getLoad, getTotalLoad, getMetrics);
      expect(selected?.id).not.toBe('server-1');
    });
  });

  describe('Load Balancer Configuration', () => {
    it('should accept custom configuration', () => {
      const lb = new LoadBalancer({
        weights: {
          latency: 0.5,
          successRate: 0.3,
          load: 0.1,
          capacity: 0.05,
          circuitBreaker: 0.03,
          timeout: 0.02,
        },
      });

      expect(lb.getAlgorithm()).toBe('fastest-response');
    });

    it('should allow algorithm change', () => {
      const lb = new LoadBalancer();
      expect(lb.getAlgorithm()).toBe('fastest-response');

      lb.setAlgorithm('round-robin');
      expect(lb.getAlgorithm()).toBe('round-robin');

      lb.setAlgorithm('least-connections');
      expect(lb.getAlgorithm()).toBe('least-connections');

      lb.setAlgorithm('weighted');
      expect(lb.getAlgorithm()).toBe('weighted');

      lb.setAlgorithm('random');
      expect(lb.getAlgorithm()).toBe('random');

      lb.setAlgorithm('streaming-optimized');
      expect(lb.getAlgorithm()).toBe('streaming-optimized');
    });
  });
});
