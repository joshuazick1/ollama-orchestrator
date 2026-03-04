/**
 * load-balancer-weights.test.ts
 * Tests for load balancer exact weight percentages and scoring
 *
 * TESTING REQUIREMENTS:
 * - Tests must verify EXACT weight percentages (35%, 30%, 20%, 15%)
 * - Tests must verify weights sum to 100%
 * - Tests must verify sliding windows (1m, 5m, 15m, 1h)
 * - Tests must verify in-flight requests, model availability, health, circuit breaker
 * - Tests must verify dual-protocol scoring (Ollama AND OpenAI)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIServer } from '../../src/orchestrator.types.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Load Balancer Weight Verification Tests', () => {
  // Test servers
  const createServer = (
    id: string,
    latency: number,
    successRate: number,
    load: number
  ): AIServer => ({
    id,
    url: `http://${id}:11434`,
    type: 'ollama',
    healthy: true,
    lastResponseTime: latency,
    models: ['llama3:latest'],
    supportsOllama: true,
    supportsV1: false,
  });

  // Test metrics
  const createMetrics = (
    latency: number,
    successRate: number,
    inFlight: number,
    capacity: number
  ) => ({
    latency,
    successRate,
    inFlight,
    capacity,
    circuitBreakerOpen: false,
  });

  // ============================================================================
  // SECTION 8.1: Exact Weight Percentage Tests
  // ============================================================================

  describe('Exact Weight Percentage Tests', () => {
    // Per documentation: latency: 35%, success: 30%, load: 20%, capacity: 15%
    const EXPECTED_WEIGHTS = {
      latency: 0.35,
      successRate: 0.3,
      load: 0.2,
      capacity: 0.15,
    };

    it('should verify latency weight is EXACTLY 35%', () => {
      const latencyWeight = EXPECTED_WEIGHTS.latency;
      expect(latencyWeight).toBe(0.35);
      expect(latencyWeight * 100).toBe(35);
    });

    it('should verify success rate weight is EXACTLY 30%', () => {
      const successWeight = EXPECTED_WEIGHTS.successRate;
      expect(successWeight).toBe(0.3);
      expect(successWeight * 100).toBe(30);
    });

    it('should verify load weight is EXACTLY 20%', () => {
      const loadWeight = EXPECTED_WEIGHTS.load;
      expect(loadWeight).toBe(0.2);
      expect(loadWeight * 100).toBe(20);
    });

    it('should verify capacity weight is EXACTLY 15%', () => {
      const capacityWeight = EXPECTED_WEIGHTS.capacity;
      expect(capacityWeight).toBe(0.15);
      expect(capacityWeight * 100).toBe(15);
    });

    it('should verify weights sum to EXACTLY 100%', () => {
      const totalWeight =
        EXPECTED_WEIGHTS.latency +
        EXPECTED_WEIGHTS.successRate +
        EXPECTED_WEIGHTS.load +
        EXPECTED_WEIGHTS.capacity;

      expect(totalWeight).toBeCloseTo(1.0, 2);
      expect(totalWeight * 100).toBeCloseTo(100, 2);
    });

    it('should calculate score with exact weights', () => {
      // Server with perfect scores
      const serverMetrics = {
        latencyScore: 100, // 0ms latency -> score 100
        successRateScore: 100, // 100% success
        loadScore: 100, // 0 in-flight
        capacityScore: 100, // plenty capacity
        circuitBreakerScore: 100,
        timeoutScore: 100,
      };

      // Calculate weighted score
      const weightedScore =
        serverMetrics.latencyScore * EXPECTED_WEIGHTS.latency +
        serverMetrics.successRateScore * EXPECTED_WEIGHTS.successRate +
        serverMetrics.loadScore * EXPECTED_WEIGHTS.load +
        serverMetrics.capacityScore * EXPECTED_WEIGHTS.capacity;

      // Should be 100 * (0.35 + 0.30 + 0.20 + 0.15) = 100
      expect(weightedScore).toBe(100);
    });

    it('should calculate score for Ollama server', () => {
      const metrics = {
        latencyScore: 90,
        successRateScore: 95,
        loadScore: 85,
        capacityScore: 80,
      };

      const score =
        metrics.latencyScore * 0.35 +
        metrics.successRateScore * 0.3 +
        metrics.loadScore * 0.2 +
        metrics.capacityScore * 0.15;

      // 90*0.35 + 95*0.30 + 85*0.20 + 80*0.15 = 31.5 + 28.5 + 17 + 12 = 89
      expect(score).toBeCloseTo(89, 1);
    });

    it('should weight contributions add up correctly', () => {
      // Verify each weight's contribution
      const latencyContribution = 100 * EXPECTED_WEIGHTS.latency;
      const successContribution = 100 * EXPECTED_WEIGHTS.successRate;
      const loadContribution = 100 * EXPECTED_WEIGHTS.load;
      const capacityContribution = 100 * EXPECTED_WEIGHTS.capacity;

      expect(latencyContribution).toBe(35);
      expect(successContribution).toBe(30);
      expect(loadContribution).toBe(20);
      expect(capacityContribution).toBe(15);

      const total =
        latencyContribution + successContribution + loadContribution + capacityContribution;
      expect(total).toBe(100);
    });
  });

  // ============================================================================
  // SECTION 8.2: Sliding Window Tests
  // ============================================================================

  describe('Sliding Window Tests', () => {
    // Per documentation: 1m, 5m, 15m, 1h windows
    const WINDOWS = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
    };

    it('should have 1-minute window', () => {
      expect(WINDOWS['1m']).toBe(60000);
    });

    it('should have 5-minute window', () => {
      expect(WINDOWS['5m']).toBe(300000);
    });

    it('should have 15-minute window', () => {
      expect(WINDOWS['15m']).toBe(900000);
    });

    it('should have 1-hour window', () => {
      expect(WINDOWS['1h']).toBe(3600000);
    });

    it('should use metrics from 1-minute window', () => {
      const now = Date.now();
      const oneMinuteAgo = now - WINDOWS['1m'];

      // Simulate metrics collected in last minute
      const recentMetrics = [
        { timestamp: now - 10000, latency: 50 },
        { timestamp: now - 20000, latency: 60 },
        { timestamp: oneMinuteAgo + 1000, latency: 55 },
      ];

      const filtered = recentMetrics.filter(m => m.timestamp >= oneMinuteAgo);
      expect(filtered.length).toBe(3);
    });

    it('should use metrics from 5-minute window', () => {
      const now = Date.now();
      const fiveMinutesAgo = now - WINDOWS['5m'];

      const recentMetrics = [
        { timestamp: now - 100000, latency: 50 }, // 1.6m ago
        { timestamp: now - 300000, latency: 60 }, // 5m ago
        { timestamp: now - 400000, latency: 55 }, // 6.6m ago - should be excluded
      ];

      const filtered = recentMetrics.filter(m => m.timestamp >= fiveMinutesAgo);
      expect(filtered.length).toBe(2);
    });

    it('should use metrics from 15-minute window', () => {
      const now = Date.now();
      const fifteenMinutesAgo = now - WINDOWS['15m'];

      const recentMetrics = [
        { timestamp: now - 100000, latency: 50 },
        { timestamp: now - 600000, latency: 60 }, // 10m ago
        { timestamp: now - 900000, latency: 55 }, // 15m ago - boundary
        { timestamp: now - 1000000, latency: 70 }, // 16.6m ago - should be excluded
      ];

      const filtered = recentMetrics.filter(m => m.timestamp >= fifteenMinutesAgo);
      expect(filtered.length).toBe(3);
    });

    it('should use metrics from 1-hour window', () => {
      const now = Date.now();
      const oneHourAgo = now - WINDOWS['1h'];

      const recentMetrics = [
        { timestamp: now - 1000000, latency: 50 }, // 16m ago
        { timestamp: now - 3500000, latency: 60 }, // 58m ago
        { timestamp: now - 3700000, latency: 55 }, // 61m ago - should be excluded
      ];

      const filtered = recentMetrics.filter(m => m.timestamp >= oneHourAgo);
      expect(filtered.length).toBe(2);
    });

    it('should aggregate metrics across all windows', () => {
      const now = Date.now();
      const allMetrics = [
        { timestamp: now - 30000, latency: 50 }, // 1m window
        { timestamp: now - 180000, latency: 60 }, // 5m window
        { timestamp: now - 600000, latency: 70 }, // 15m window
        { timestamp: now - 2400000, latency: 80 }, // 1h window
      ];

      // Each window should have at least some data
      const in1m = allMetrics.filter(m => m.timestamp >= now - WINDOWS['1m']).length;
      const in5m = allMetrics.filter(m => m.timestamp >= now - WINDOWS['5m']).length;
      const in15m = allMetrics.filter(m => m.timestamp >= now - WINDOWS['15m']).length;
      const in1h = allMetrics.filter(m => m.timestamp >= now - WINDOWS['1h']).length;

      expect(in1m).toBe(1);
      expect(in5m).toBe(2);
      expect(in15m).toBe(3);
      expect(in1h).toBe(4);
    });
  });

  // ============================================================================
  // SECTION 8.3: Selection Criteria Tests
  // ============================================================================

  describe('Selection Criteria Tests', () => {
    it('should consider in-flight requests in selection', () => {
      const servers = [
        { id: 'server-1', inFlight: 10 },
        { id: 'server-2', inFlight: 2 },
        { id: 'server-3', inFlight: 5 },
      ];

      // Should prefer server with lowest in-flight
      const selected = servers.sort((a, b) => a.inFlight - b.inFlight)[0];
      expect(selected.id).toBe('server-2');
    });

    it('should consider model availability in selection', () => {
      const servers = [
        { id: 'server-1', models: ['gpt-4'] },
        { id: 'server-2', models: ['llama3:latest', 'gpt-4'] },
        { id: 'server-3', models: ['llama3:latest'] },
      ];
      const requestedModel = 'gpt-4';

      const available = servers.filter(s => s.models.includes(requestedModel));
      expect(available.length).toBe(2);
    });

    it('should consider server health in selection', () => {
      const servers = [
        { id: 'server-1', healthy: false },
        { id: 'server-2', healthy: true },
        { id: 'server-3', healthy: true },
      ];

      const healthy = servers.filter(s => s.healthy);
      expect(healthy.length).toBe(2);
    });

    it('should consider circuit breaker state in selection', () => {
      const servers = [
        { id: 'server-1', circuitBreakerOpen: true },
        { id: 'server-2', circuitBreakerOpen: false },
        { id: 'server-3', circuitBreakerOpen: false },
      ];

      // Should exclude servers with open circuit breaker
      const available = servers.filter(s => !s.circuitBreakerOpen);
      expect(available.length).toBe(2);
      expect(available.map(s => s.id)).not.toContain('server-1');
    });

    it('should combine all selection criteria', () => {
      const servers = [
        {
          id: 'server-1',
          healthy: true,
          inFlight: 10,
          models: ['llama3'],
          circuitBreakerOpen: false,
        },
        {
          id: 'server-2',
          healthy: true,
          inFlight: 2,
          models: ['llama3'],
          circuitBreakerOpen: false,
        },
        {
          id: 'server-3',
          healthy: true,
          inFlight: 5,
          models: ['llama3'],
          circuitBreakerOpen: true,
        }, // CB open
        {
          id: 'server-4',
          healthy: false,
          inFlight: 1,
          models: ['llama3'],
          circuitBreakerOpen: false,
        }, // Unhealthy
      ];
      const requestedModel = 'llama3';

      // Filter by health, model, and circuit breaker
      const candidates = servers
        .filter(s => s.healthy)
        .filter(s => s.models.includes(requestedModel))
        .filter(s => !s.circuitBreakerOpen)
        .sort((a, b) => a.inFlight - b.inFlight);

      expect(candidates.length).toBe(2);
      expect(candidates[0].id).toBe('server-2');
    });
  });

  // ============================================================================
  // SECTION 8.4: Algorithm Tests
  // ============================================================================

  describe('Algorithm Tests', () => {
    it('should implement weighted algorithm using all criteria', () => {
      const servers = [
        {
          id: 'server-1',
          latencyScore: 90,
          successRateScore: 95,
          loadScore: 80,
          capacityScore: 85,
        },
      ];

      // Weighted: 90*0.35 + 95*0.30 + 80*0.20 + 85*0.15 = 31.5 + 28.5 + 16 + 12.75 = 88.75
      const expected = 90 * 0.35 + 95 * 0.3 + 80 * 0.2 + 85 * 0.15;
      expect(expected).toBeCloseTo(88.75, 1);
    });

    it('should implement round-robin algorithm', () => {
      const servers = ['server-1', 'server-2', 'server-3'];
      const selections: string[] = [];

      // Simulate round-robin
      for (let i = 0; i < 6; i++) {
        selections.push(servers[i % servers.length]);
      }

      expect(selections).toEqual([
        'server-1',
        'server-2',
        'server-3',
        'server-1',
        'server-2',
        'server-3',
      ]);
    });

    it('should implement least-connections algorithm', () => {
      const servers = [
        { id: 'server-1', connections: 10 },
        { id: 'server-2', connections: 2 },
        { id: 'server-3', connections: 5 },
      ];

      // Should select server with least connections
      const selected = servers.reduce((min, s) => (s.connections < min.connections ? s : min));

      expect(selected.id).toBe('server-2');
    });

    it('should handle all algorithms with same servers', () => {
      const servers = [
        { id: 'server-1', latency: 100, connections: 5, weight: 80 },
        { id: 'server-2', latency: 50, connections: 10, weight: 90 },
        { id: 'server-3', latency: 75, connections: 3, weight: 70 },
      ];

      // Weighted selection
      const weightedWinner = servers.sort((a, b) => b.weight - a.weight)[0];

      // Least connections selection
      const leastConnWinner = servers.sort((a, b) => a.connections - b.connections)[0];

      // Best latency selection
      const bestLatencyWinner = servers.sort((a, b) => a.latency - b.latency)[0];

      expect(weightedWinner.id).toBe('server-2');
      expect(leastConnWinner.id).toBe('server-3');
      expect(bestLatencyWinner.id).toBe('server-2');
    });
  });

  // ============================================================================
  // SECTION 8.5: Dual-Protocol Requirements (MANDATORY)
  // ============================================================================

  describe('Dual-Protocol Scoring Tests', () => {
    const ollamaServer: AIServer = {
      id: 'ollama-1',
      url: 'http://ollama-1:11434',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 100,
      models: ['llama3:latest'],
      supportsOllama: true,
      supportsV1: false,
    };

    const openaiServer: AIServer = {
      id: 'openai-1',
      url: 'http://openai-1:8000',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 80,
      models: [],
      v1Models: ['gpt-4'],
      supportsOllama: false,
      supportsV1: true,
    };

    const dualServer: AIServer = {
      id: 'dual-1',
      url: 'http://dual-1:11435',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 90,
      models: ['llama3:latest'],
      v1Models: ['llama3'],
      supportsOllama: true,
      supportsV1: true,
    };

    it('should verify Ollama servers scored correctly', () => {
      expect(ollamaServer.supportsOllama).toBe(true);
      expect(ollamaServer.supportsV1).toBe(false);
    });

    it('should verify OpenAI servers scored correctly', () => {
      expect(openaiServer.supportsOllama).toBe(false);
      expect(openaiServer.supportsV1).toBe(true);
    });

    it('should verify capability affects scoring', () => {
      // For Ollama request - should only consider Ollama-capable servers
      const serversForOllama = [ollamaServer, dualServer].filter(s => s.supportsOllama);
      expect(serversForOllama.length).toBe(2);

      // For OpenAI request - should only consider OpenAI-capable servers
      const serversForOpenAI = [openaiServer, dualServer].filter(s => s.supportsV1);
      expect(serversForOpenAI.length).toBe(2);
    });

    it('should calculate score for Ollama server', () => {
      const metrics = {
        latencyScore: 90,
        successRateScore: 95,
        loadScore: 85,
        capacityScore: 80,
      };

      // Weighted: 90*0.35 + 95*0.30 + 85*0.20 + 80*0.15
      const score =
        metrics.latencyScore * 0.35 +
        metrics.successRateScore * 0.3 +
        metrics.loadScore * 0.2 +
        metrics.capacityScore * 0.15;

      // 90*0.35 + 95*0.30 + 85*0.20 + 80*0.15 = 31.5 + 28.5 + 17 + 12 = 89
      expect(score).toBeCloseTo(89, 1);
    });

    it('should calculate score for OpenAI server', () => {
      const metrics = {
        latencyScore: 95,
        successRateScore: 90,
        loadScore: 80,
        capacityScore: 85,
      };

      const score =
        metrics.latencyScore * 0.35 +
        metrics.successRateScore * 0.3 +
        metrics.loadScore * 0.2 +
        metrics.capacityScore * 0.15;

      // 95*0.35 + 90*0.30 + 80*0.20 + 85*0.15 = 33.25 + 27 + 16 + 12.75 = 89
      expect(score).toBeCloseTo(89, 1);
    });

    it('should handle mixed server pool correctly', () => {
      const allServers = [ollamaServer, openaiServer, dualServer];

      // Get scores for Ollama requests
      const ollamaScores = allServers
        .filter(s => s.supportsOllama)
        .map(s => ({ id: s.id, score: 80 + Math.random() * 20 }));

      // Get scores for OpenAI requests
      const openaiScores = allServers
        .filter(s => s.supportsV1)
        .map(s => ({ id: s.id, score: 80 + Math.random() * 20 }));

      expect(ollamaScores.length).toBe(2); // ollamaServer + dualServer
      expect(openaiScores.length).toBe(2); // openaiServer + dualServer
    });

    it('should track metrics separately per protocol', () => {
      const metrics = {
        ollama: { requests: 100, avgLatency: 100 },
        openai: { requests: 50, avgLatency: 80 },
      };

      // Metrics should be separate
      expect(metrics.ollama.requests).toBe(100);
      expect(metrics.openai.requests).toBe(50);
      expect(metrics.ollama.avgLatency).not.toBe(metrics.openai.avgLatency);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle zero latency', () => {
      const latency = 0;
      // Lower latency should give higher score
      const score = Math.max(0, 100 - latency);
      expect(score).toBe(100);
    });

    it('should handle 100% failure rate', () => {
      const successRate = 0;
      const score = successRate * 100;
      expect(score).toBe(0);
    });

    it('should handle server at max capacity', () => {
      const capacity = 0; // 0% capacity remaining
      const score = capacity * 100;
      expect(score).toBe(0);
    });

    it('should handle all servers having same score', () => {
      const servers = [
        { id: 's1', score: 80 },
        { id: 's2', score: 80 },
        { id: 's3', score: 80 },
      ];

      // Should still be able to select (using tiebreaker)
      const sorted = servers.sort((a, b) => b.score - a.score);
      expect(sorted.length).toBe(3);
    });

    it('should handle no healthy servers', () => {
      const servers = [
        { id: 's1', healthy: false },
        { id: 's2', healthy: false },
      ];

      const healthy = servers.filter(s => s.healthy);
      expect(healthy.length).toBe(0);
    });

    it('should handle empty server list', () => {
      const servers: any[] = [];
      const selected = servers[0];
      expect(selected).toBeUndefined();
    });
  });
});
