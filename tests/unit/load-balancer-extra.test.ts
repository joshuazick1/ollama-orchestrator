import { describe, it, expect } from 'vitest';

import {
  calculateServerScore,
  selectBestServer,
  LoadBalancer,
  DEFAULT_LB_CONFIG,
} from '../../src/load-balancer/load-balancer.js';
import type { AIServer, ServerModelMetrics } from '../../src/orchestrator/orchestrator.types.js';
import { createServer } from '../fixtures/factories.js';

const mockServer: AIServer = createServer({
  id: 'server-1',
  lastResponseTime: 100,
  models: ['llama3:latest'],
});

describe('Load Balancer - Additional Tests', () => {
  describe('Circuit Breaker in Score Calculation', () => {
    it('should have neutral circuit breaker score when no CB health data', () => {
      const score = calculateServerScore(mockServer, 'llama3:latest', 0, 0, undefined);
      expect(score.breakdown.circuitBreakerScore).toBe(100);
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
        avgTokensPerSecond: 0,
        coldStartCount: 0,
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
        avgTokensPerSecond: 0,
        coldStartCount: 0,
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
        avgTokensPerSecond: 0,
        coldStartCount: 0,
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
        createServer({ id: 'server-1', lastResponseTime: 100, models: ['llama3:latest'] }),
        createServer({ id: 'server-2', lastResponseTime: 100, models: ['llama3:latest'] }),
        createServer({ id: 'server-3', lastResponseTime: 100, models: ['llama3:latest'] }),
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
        createServer({ id: 'fast-server', lastResponseTime: 50, models: ['llama3:latest'] }),
        createServer({ id: 'slow-server', lastResponseTime: 500, models: ['llama3:latest'] }),
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
        createServer({
          id: 'server-1',
          healthy: true,
          maxConcurrency: 4,
          lastResponseTime: 100,
          models: ['llama3:latest'],
        }),
        createServer({
          id: 'server-2',
          healthy: true,
          maxConcurrency: 4,
          lastResponseTime: 100,
          models: ['llama3:latest'],
        }),
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

  describe('Sticky Sessions LRU Eviction', () => {
    let lb: LoadBalancer;

    afterEach(() => {
      lb.stopCleanup();
    });

    it('caps stickySessions at maxStickySessions and evicts oldest', () => {
      lb = new LoadBalancer({
        roundRobin: {
          stickySessionsTtlMs: 60000, // TTL enabled so entries are created; cap=3 tests LRU
          maxStickySessions: 3,
          skipUnhealthy: true,
          checkCapacity: true,
        },
      });
      lb.setAlgorithm('round-robin');

      const servers = [
        createServer({
          id: 'server-1',
          healthy: true,
          maxConcurrency: 4,
          lastResponseTime: 100,
          models: ['m'],
        }),
        createServer({
          id: 'server-2',
          healthy: true,
          maxConcurrency: 4,
          lastResponseTime: 100,
          models: ['m'],
        }),
      ];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => undefined;

      // Use 5 unique clientIds (more than maxStickySessions=3)
      lb.select(servers, 'm', getLoad, getTotalLoad, getMetrics, false, 'client-1');
      lb.select(servers, 'm', getLoad, getTotalLoad, getMetrics, false, 'client-2');
      lb.select(servers, 'm', getLoad, getTotalLoad, getMetrics, false, 'client-3');
      lb.select(servers, 'm', getLoad, getTotalLoad, getMetrics, false, 'client-4');
      lb.select(servers, 'm', getLoad, getTotalLoad, getMetrics, false, 'client-5');

      expect(lb['stickySessions'].size).toBe(3);
      expect(lb['stickySessions'].has('client-1')).toBe(false);
      expect(lb['stickySessions'].has('client-2')).toBe(false);
      expect(lb['stickySessions'].has('client-3')).toBe(true);
      expect(lb['stickySessions'].has('client-4')).toBe(true);
      expect(lb['stickySessions'].has('client-5')).toBe(true);
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
        avgTokensPerSecond: 0,
        coldStartCount: 0,
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
        avgTokensPerSecond: 0,
        coldStartCount: 0,
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
        createServer({
          id: 'server-1',
          healthy: false,
          lastResponseTime: 100,
          models: ['llama3:latest'],
        }),
        createServer({
          id: 'server-2',
          healthy: true,
          lastResponseTime: 100,
          models: ['llama3:latest'],
        }),
        createServer({
          id: 'server-3',
          healthy: true,
          lastResponseTime: 100,
          models: ['llama3:latest'],
        }),
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
        createServer({
          id: 'server-1',
          maxConcurrency: 4,
          lastResponseTime: 100,
          models: ['llama3:latest'],
        }),
        createServer({
          id: 'server-2',
          maxConcurrency: 4,
          lastResponseTime: 100,
          models: ['llama3:latest'],
        }),
        createServer({
          id: 'server-3',
          maxConcurrency: 4,
          lastResponseTime: 100,
          models: ['llama3:latest'],
        }),
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
          throughput: 0.0,
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
