/**
 * weighted-selection.test.ts
 * Tests for weighted selection algorithms
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoadBalancer, calculateServerScore } from '../../src/load-balancer.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('Weighted Selection Algorithms Tests', () => {
  let loadBalancer: LoadBalancer;

  const createServer = (id: string, latency = 100): AIServer => ({
    id,
    url: `http://localhost:${11434 + parseInt(id.split('-')[1] || '1')}`,
    type: 'ollama',
    healthy: true,
    supportsOllama: true,
    lastResponseTime: latency,
    models: ['llama3:latest'],
    maxConcurrency: 4,
  });

  const getLoad = (serverId: string, model: string): number => 1;
  const getTotalLoad = (serverId: string): number => 2;

  beforeEach(() => {
    loadBalancer = new LoadBalancer({});
    vi.clearAllMocks();
  });

  describe('Load Balancer Configuration', () => {
    it('should create load balancer with fastest-response algorithm by default', () => {
      const lb = new LoadBalancer({});
      expect(lb.getAlgorithm()).toBe('fastest-response');
    });

    it('should accept custom weights', () => {
      const lb = new LoadBalancer({
        weights: {
          latency: 0.4,
          successRate: 0.3,
          load: 0.2,
          capacity: 0.1,
          circuitBreaker: 0.0,
          timeout: 0.0,
          throughput: 0.0,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should accept custom thresholds', () => {
      const lb = new LoadBalancer({
        thresholds: {
          maxP95Latency: 10000,
          minSuccessRate: 0.8,
          latencyPenalty: 0.5,
          errorPenalty: 0.3,
          circuitBreakerPenalty: 0.1,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should accept latency blend config', () => {
      const lb = new LoadBalancer({
        latencyBlendRecent: 0.7,
        latencyBlendHistorical: 0.3,
      });
      expect(lb).toBeDefined();
    });

    it('should accept streaming config', () => {
      const lb = new LoadBalancer({
        streaming: {
          ttftWeight: 0.6,
          durationWeight: 0.4,
          ttftBlendAvg: 0.5,
          ttftBlendP95: 0.5,
          durationEstimateMultiplier: 2,
          chunkWeight: 0.2,
          maxChunkGapPenaltyMs: 5000,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should accept round-robin config', () => {
      const lb = new LoadBalancer({
        roundRobin: {
          skipUnhealthy: true,
          checkCapacity: true,
          stickySessionsTtlMs: 300000,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should accept least connections config', () => {
      const lb = new LoadBalancer({
        leastConnections: {
          skipUnhealthy: true,
          considerCapacity: true,
          considerFailureRate: true,
          failureRatePenalty: 0.5,
        },
      });
      expect(lb).toBeDefined();
    });
  });

  describe('Algorithm Selection', () => {
    it('should set weighted algorithm', () => {
      loadBalancer.setAlgorithm('weighted');
      expect(loadBalancer.getAlgorithm()).toBe('weighted');
    });

    it('should set round-robin algorithm', () => {
      loadBalancer.setAlgorithm('round-robin');
      expect(loadBalancer.getAlgorithm()).toBe('round-robin');
    });

    it('should set least-connections algorithm', () => {
      loadBalancer.setAlgorithm('least-connections');
      expect(loadBalancer.getAlgorithm()).toBe('least-connections');
    });

    it('should set random algorithm', () => {
      loadBalancer.setAlgorithm('random');
      expect(loadBalancer.getAlgorithm()).toBe('random');
    });

    it('should set fastest-response algorithm', () => {
      loadBalancer.setAlgorithm('fastest-response');
      expect(loadBalancer.getAlgorithm()).toBe('fastest-response');
    });

    it('should set streaming-optimized algorithm', () => {
      loadBalancer.setAlgorithm('streaming-optimized');
      expect(loadBalancer.getAlgorithm()).toBe('streaming-optimized');
    });
  });

  describe('Server Selection - Empty Candidates', () => {
    it('should return undefined when no candidates provided', () => {
      const result = loadBalancer.select(
        [],
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined
      );
      expect(result).toBeUndefined();
    });

    it('should handle unhealthy servers appropriately', () => {
      const unhealthyServer = { ...createServer('ollama-1'), healthy: false };
      const healthyServer = createServer('ollama-2');
      const result = loadBalancer.select(
        [unhealthyServer, healthyServer],
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined
      );
      expect(result).toBeDefined();
    });
  });

  describe('Server Selection - Weighted Algorithm', () => {
    it('should select server with weighted scoring', () => {
      loadBalancer.setAlgorithm('weighted');
      const servers = [createServer('ollama-1', 100), createServer('ollama-2', 200)];

      const result = loadBalancer.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined
      );
      expect(result).toBeDefined();
      expect(servers).toContain(result);
    });

    it('should consider latency in weighted selection', () => {
      loadBalancer.setAlgorithm('weighted');
      const fastServer = createServer('fast', 50);
      const slowServer = createServer('slow', 500);
      const servers = [slowServer, fastServer];

      const results = Array.from({ length: 10 }, () =>
        loadBalancer.select(servers, 'llama3:latest', getLoad, getTotalLoad, () => undefined)
      );
      const fastSelected = results.filter(r => r?.id === 'fast').length;
      expect(fastSelected).toBeGreaterThan(0);
    });
  });

  describe('Server Selection - Round Robin', () => {
    it('should rotate through servers', () => {
      loadBalancer.setAlgorithm('round-robin');
      const servers = [
        createServer('ollama-1'),
        createServer('ollama-2'),
        createServer('ollama-3'),
      ];

      const results = [
        loadBalancer.select(servers, 'llama3:latest', getLoad, getTotalLoad, () => undefined),
        loadBalancer.select(servers, 'llama3:latest', getLoad, getTotalLoad, () => undefined),
        loadBalancer.select(servers, 'llama3:latest', getLoad, getTotalLoad, () => undefined),
        loadBalancer.select(servers, 'llama3:latest', getLoad, getTotalLoad, () => undefined),
      ];

      const ids = results.map(r => r?.id).filter(Boolean);
      expect(new Set(ids).size).toBeGreaterThan(1);
    });

    it('should skip unhealthy servers when configured', () => {
      loadBalancer.setAlgorithm('round-robin');
      const servers = [
        { ...createServer('ollama-1'), healthy: false },
        createServer('ollama-2'),
        createServer('ollama-3'),
      ];

      const result = loadBalancer.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined
      );
      expect(result?.healthy).toBe(true);
    });
  });

  describe('Server Selection - Least Connections', () => {
    it('should consider load in selection', () => {
      loadBalancer.setAlgorithm('least-connections');
      const servers = [createServer('ollama-1'), createServer('ollama-2')];
      const getLoadFn = (serverId: string) => (serverId === 'ollama-1' ? 10 : 1);

      const result = loadBalancer.select(
        servers,
        'llama3:latest',
        getLoadFn,
        getTotalLoad,
        () => undefined
      );
      expect(result).toBeDefined();
    });
  });

  describe('Server Selection - Random', () => {
    it('should randomly select from candidates', () => {
      loadBalancer.setAlgorithm('random');
      const servers = [
        createServer('ollama-1'),
        createServer('ollama-2'),
        createServer('ollama-3'),
      ];

      const results = Array.from({ length: 20 }, () =>
        loadBalancer.select(servers, 'llama3:latest', getLoad, getTotalLoad, () => undefined)
      );

      const ids = results.map(r => r?.id).filter(Boolean);
      expect(new Set(ids).size).toBeGreaterThan(1);
    });
  });

  describe('Server Selection - Fastest Response', () => {
    it('should select fastest responding server by lastResponseTime', () => {
      loadBalancer.setAlgorithm('fastest-response');
      const servers = [createServer('ollama-1', 100), createServer('ollama-2', 50)];

      const result = loadBalancer.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined
      );
      expect(result?.id).toBe('ollama-2');
    });
  });

  describe('Sticky Sessions', () => {
    it('should maintain sticky session for same client', () => {
      loadBalancer.updateConfig({
        roundRobin: {
          skipUnhealthy: true,
          checkCapacity: true,
          stickySessionsTtlMs: 300000,
        },
      });
      loadBalancer.setAlgorithm('round-robin');
      const servers = [createServer('ollama-1'), createServer('ollama-2')];

      const first = loadBalancer.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined,
        false,
        'client-1'
      );

      const second = loadBalancer.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined,
        false,
        'client-1'
      );

      expect(second?.id).toBe(first?.id);
    });
  });

  describe('Config Updates', () => {
    it('should update weights at runtime', () => {
      loadBalancer.updateConfig({
        weights: {
          latency: 0.5,
          successRate: 0.5,
          load: 0.0,
          capacity: 0.0,
          circuitBreaker: 0.0,
          timeout: 0.0,
          throughput: 0.0,
        },
      });
      expect(loadBalancer.getAlgorithm()).toBeDefined();
    });

    it('should update thresholds at runtime', () => {
      loadBalancer.updateConfig({
        thresholds: {
          maxP95Latency: 5000,
          minSuccessRate: 0.9,
          latencyPenalty: 0.5,
          errorPenalty: 0.3,
          circuitBreakerPenalty: 0.1,
        },
      });
      expect(loadBalancer.getAlgorithm()).toBeDefined();
    });
  });

  describe('Dual Protocol Support', () => {
    it('should select from Ollama servers', () => {
      const servers: AIServer[] = [
        { ...createServer('ollama-1'), type: 'ollama', supportsOllama: true, supportsV1: false },
      ];
      const result = loadBalancer.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined
      );
      expect(result?.type).toBe('ollama');
    });

    it('should select from servers supporting OpenAI', () => {
      const servers: AIServer[] = [
        { ...createServer('openai-1'), type: 'ollama', supportsOllama: false, supportsV1: true },
      ];
      const result = loadBalancer.select(servers, 'gpt-4', getLoad, getTotalLoad, () => undefined);
      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle servers with missing metrics', () => {
      loadBalancer.setAlgorithm('fastest-response');
      const servers = [createServer('ollama-1', 100), createServer('ollama-2', 200)];

      const result = loadBalancer.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined
      );
      expect(result).toBeDefined();
    });

    it('should handle single server cluster', () => {
      const servers = [createServer('ollama-1')];
      const result = loadBalancer.select(
        servers,
        'llama3:latest',
        getLoad,
        getTotalLoad,
        () => undefined
      );
      expect(result?.id).toBe('ollama-1');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REC-28: Token throughput incorporated into weighted scoring
  // ──────────────────────────────────────────────────────────────────────────

  describe('REC-28: token throughput score in weighted algorithm', () => {
    it('server with higher avgTokensPerSecond scores higher via throughputScore', () => {
      const server: AIServer = {
        id: 'srv',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 200,
        models: ['llama3:latest'],
        maxConcurrency: 4,
      };

      const baseMetrics = {
        serverId: 'srv',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 200, p95: 300, p99: 400 },
        successRate: 0.99,
        throughput: 10,
        avgTokensPerRequest: 50,
        coldStartCount: 0,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const lowThroughputMetrics = { ...baseMetrics, avgTokensPerSecond: 5 }; // 5 t/s → score 10/100
      const highThroughputMetrics = { ...baseMetrics, avgTokensPerSecond: 40 }; // 40 t/s → score 80/100

      const lowScore = calculateServerScore(server, 'llama3:latest', 0, 0, lowThroughputMetrics);
      const highScore = calculateServerScore(server, 'llama3:latest', 0, 0, highThroughputMetrics);

      expect(highScore.totalScore).toBeGreaterThan(lowScore.totalScore);
      expect(highScore.breakdown.throughputScore).toBeGreaterThan(
        lowScore.breakdown.throughputScore
      );
    });

    it('throughputScore is 0 when metrics has avgTokensPerSecond=0', () => {
      const server: AIServer = {
        id: 'srv',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 200,
        models: ['llama3:latest'],
        maxConcurrency: 4,
      };

      const metrics = {
        serverId: 'srv',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 200, p95: 300, p99: 400 },
        successRate: 0.99,
        throughput: 10,
        avgTokensPerRequest: 50,
        avgTokensPerSecond: 0,
        coldStartCount: 0,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);
      expect(score.breakdown.throughputScore).toBe(0);
    });

    it('throughputScore is capped at 100 when avgTokensPerSecond >= 50', () => {
      const server: AIServer = {
        id: 'srv',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 200,
        models: ['llama3:latest'],
        maxConcurrency: 4,
      };

      const metrics = {
        serverId: 'srv',
        model: 'llama3:latest',
        inFlight: 0,
        queued: 0,
        windows: {} as any,
        percentiles: { p50: 200, p95: 300, p99: 400 },
        successRate: 0.99,
        throughput: 10,
        avgTokensPerRequest: 50,
        avgTokensPerSecond: 100, // well above 50 t/s cap
        coldStartCount: 0,
        lastUpdated: Date.now(),
        recentLatencies: [],
      };

      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);
      expect(score.breakdown.throughputScore).toBe(100);
    });

    it('throughputScore is 0 when metrics is undefined', () => {
      const server: AIServer = {
        id: 'srv',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 200,
        models: ['llama3:latest'],
        maxConcurrency: 4,
      };

      const score = calculateServerScore(server, 'llama3:latest', 0, 0, undefined);
      expect(score.breakdown.throughputScore).toBe(0);
    });
  });
});
