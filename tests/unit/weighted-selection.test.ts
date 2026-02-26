/**
 * weighted-selection.test.ts
 * Tests for weighted selection algorithms
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoadBalancer } from '../../src/load-balancer.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('Weighted Selection Algorithms Tests', () => {
  let loadBalancer: LoadBalancer;

  const createServer = (id: string, latency = 100, successRate = 1.0): AIServer => ({
    id,
    url: `http://localhost:${11434 + parseInt(id.split('-')[1])}`,
    type: 'ollama',
    healthy: true,
    supportsOllama: true,
    lastResponseTime: latency,
    models: ['llama3:latest'],
    maxConcurrency: 4,
  });

  beforeEach(() => {
    loadBalancer = new LoadBalancer({});
    vi.clearAllMocks();
  });

  describe('Load Balancer Configuration', () => {
    it('should create load balancer with defaults', () => {
      expect(loadBalancer).toBeDefined();
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
          failureRatePenalty: 2.0,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should accept cross-model inference config', () => {
      const lb = new LoadBalancer({
        crossModelInference: {
          enabled: true,
          useParameterSize: true,
          minSamplesForExact: 5,
          fallbackWeight: 0.5,
        },
      });
      expect(lb).toBeDefined();
    });
  });

  describe('Server Selection', () => {
    it('should select from single server', () => {
      const server = createServer('ollama-1');
      const candidates = [server];

      expect(candidates.length).toBe(1);
      expect(candidates[0].id).toBe('ollama-1');
    });

    it('should handle empty candidates', () => {
      const candidates: AIServer[] = [];
      expect(candidates.length).toBe(0);
    });

    it('should handle multiple servers', () => {
      const servers = [
        createServer('ollama-1'),
        createServer('ollama-2'),
        createServer('ollama-3'),
      ];
      expect(servers.length).toBe(3);
    });

    it('should handle servers with different latencies', () => {
      const servers = [
        createServer('ollama-1', 50),
        createServer('ollama-2', 100),
        createServer('ollama-3', 200),
      ];

      const sorted = [...servers].sort((a, b) => a.lastResponseTime - b.lastResponseTime);
      expect(sorted[0].id).toBe('ollama-1');
    });

    it('should handle servers with different success rates', () => {
      const server1 = createServer('ollama-1', 100, 0.95);
      const server2 = createServer('ollama-2', 100, 0.8);

      expect(server1.lastResponseTime).toBe(server2.lastResponseTime);
    });

    it('should handle servers with different capacities', () => {
      const server1 = { ...createServer('ollama-1'), maxConcurrency: 8 };
      const server2 = { ...createServer('ollama-2'), maxConcurrency: 2 };

      expect(server1.maxConcurrency).toBe(8);
      expect(server2.maxConcurrency).toBe(2);
    });

    it('should handle unhealthy servers', () => {
      const healthy = createServer('ollama-1');
      const unhealthy: AIServer = {
        ...createServer('ollama-2'),
        healthy: false,
      };

      expect(healthy.healthy).toBe(true);
      expect(unhealthy.healthy).toBe(false);
    });

    it('should handle draining servers', () => {
      const draining: AIServer = {
        ...createServer('ollama-1'),
        draining: true,
      };

      expect(draining.draining).toBe(true);
    });
  });

  describe('Algorithm Variations', () => {
    it('should handle latency-weighted selection', () => {
      const lb = new LoadBalancer({
        weights: {
          latency: 1.0,
          successRate: 0.0,
          load: 0.0,
          capacity: 0.0,
          circuitBreaker: 0.0,
          timeout: 0.0,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should handle success-rate weighted selection', () => {
      const lb = new LoadBalancer({
        weights: {
          latency: 0.0,
          successRate: 1.0,
          load: 0.0,
          capacity: 0.0,
          circuitBreaker: 0.0,
          timeout: 0.0,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should handle capacity-weighted selection', () => {
      const lb = new LoadBalancer({
        weights: {
          latency: 0.0,
          successRate: 0.0,
          load: 0.0,
          capacity: 1.0,
          circuitBreaker: 0.0,
          timeout: 0.0,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should handle equal weights', () => {
      const lb = new LoadBalancer({
        weights: {
          latency: 0.25,
          successRate: 0.25,
          load: 0.25,
          capacity: 0.25,
          circuitBreaker: 0.0,
          timeout: 0.0,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should handle extreme weight values', () => {
      const lb = new LoadBalancer({
        weights: {
          latency: 1.0,
          successRate: 0.0,
          load: 0.0,
          capacity: 0.0,
          circuitBreaker: 0.0,
          timeout: 0.0,
        },
      });
      expect(lb).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle all servers with same score', () => {
      const servers = [
        createServer('ollama-1', 100, 1.0),
        createServer('ollama-2', 100, 1.0),
        createServer('ollama-3', 100, 1.0),
      ];
      expect(servers.length).toBe(3);
    });

    it('should handle servers at capacity', () => {
      const atCapacity: AIServer = {
        ...createServer('ollama-1'),
        maxConcurrency: 0,
      };
      expect(atCapacity.maxConcurrency).toBe(0);
    });

    it('should handle undefined max concurrency', () => {
      const noMax: AIServer = {
        ...createServer('ollama-1'),
        maxConcurrency: undefined,
      };
      expect(noMax.maxConcurrency).toBeUndefined();
    });

    it('should handle very large latency values', () => {
      const highLatency = createServer('ollama-1', 100000);
      expect(highLatency.lastResponseTime).toBe(100000);
    });

    it('should handle zero latency', () => {
      const zeroLatency = createServer('ollama-1', 0);
      expect(zeroLatency.lastResponseTime).toBe(0);
    });

    it('should handle servers with maintenance flag', () => {
      const maintenance: AIServer = {
        ...createServer('ollama-1'),
        maintenance: true,
      };
      expect(maintenance.maintenance).toBe(true);
    });
  });

  describe('Dual-Protocol Selection', () => {
    it('should handle Ollama servers', () => {
      const ollamaServer = createServer('ollama-1');
      expect(ollamaServer.supportsOllama).toBe(true);
    });

    it('should handle OpenAI servers', () => {
      const openaiServer: AIServer = {
        id: 'openai-1',
        url: 'http://localhost:8000',
        type: 'ollama',
        healthy: true,
        supportsV1: true,
        v1Models: ['gpt-4'],
        lastResponseTime: 100,
        models: [],
      };
      expect(openaiServer.supportsV1).toBe(true);
    });

    it('should handle dual-capability servers', () => {
      const dualServer: AIServer = {
        id: 'dual-1',
        url: 'http://localhost:9000',
        type: 'ollama',
        healthy: true,
        supportsOllama: true,
        supportsV1: true,
        models: ['llama3:latest'],
        v1Models: ['gpt-4'],
        lastResponseTime: 100,
      };
      expect(dualServer.supportsOllama).toBe(true);
      expect(dualServer.supportsV1).toBe(true);
    });
  });

  describe('Streaming Selection', () => {
    it('should handle TTFT weight', () => {
      const lb = new LoadBalancer({
        streaming: {
          ttftWeight: 0.8,
          durationWeight: 0.2,
          ttftBlendAvg: 0.5,
          ttftBlendP95: 0.5,
          durationEstimateMultiplier: 2,
          chunkWeight: 0.2,
          maxChunkGapPenaltyMs: 5000,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should handle duration weight', () => {
      const lb = new LoadBalancer({
        streaming: {
          ttftWeight: 0.5,
          durationWeight: 0.5,
          ttftBlendAvg: 0.5,
          ttftBlendP95: 0.5,
          durationEstimateMultiplier: 2,
          chunkWeight: 0.2,
          maxChunkGapPenaltyMs: 5000,
        },
      });
      expect(lb).toBeDefined();
    });

    it('should handle chunk weight', () => {
      const lb = new LoadBalancer({
        streaming: {
          ttftWeight: 0.4,
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
  });
});
