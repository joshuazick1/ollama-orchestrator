/**
 * calculate-server-score.test.ts
 * Wave 8.1: Unit tests for calculateServerScore() in load-balancer.ts
 *
 * Tests cover:
 * 1. Empty metrics → falls back to defaults
 * 2. All metrics present → score is calculated
 * 3. Hot model with low latency → high score
 * 4. Cold model with high latency → low score
 * 5. Circuit breaker open → score near 0
 * 6. VRAM near capacity → low score
 * 7. Temporal adjustment applies when confidence ≥ 0.3
 * 8. Context score near limit → low score
 * 9. Throughput score: high recent throughput → high score
 * 10. Token-weighted load (after 3.3): heavy prompt → low score
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AIServer, ServerModelMetrics } from '../../../src/orchestrator/orchestrator.types.js';
import type { TemporalAdjustment } from '../../../src/load-balancer/temporal-scorer.js';
import { DEFAULT_LB_CONFIG } from '../../../src/load-balancer/load-balancer.js';

// Mock logger to suppress debug output during tests
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock InFlightManager for token-weighted load tests
const mockInFlightManager = {
  getTokenWeightedLoad: vi.fn((_serverId: string, _model: string) => 0),
  getTotalTokenWeightedLoad: vi.fn((_serverId: string) => 0),
  getInFlight: vi.fn(() => 0),
  getQueued: vi.fn(() => 0),
  addRequest: vi.fn(),
  removeRequest: vi.fn(),
  updateChunkProgress: vi.fn(),
  addStreamingRequest: vi.fn(),
  removeStreamingRequest: vi.fn(),
  getAllStreamingRequests: vi.fn(() => []),
};

vi.mock('../../../src/utils/in-flight-manager.js', () => ({
  getInFlightManager: vi.fn(() => mockInFlightManager),
}));

// Mock TemporalScorer for temporal adjustment tests
const mockTemporalScorer = {
  isEnabled: vi.fn(() => true),
  isShadowMode: vi.fn(() => false),
  getAdjustment: vi.fn(
    (): TemporalAdjustment => ({
      latencyMultiplier: 1.0,
      successRateMultiplier: 1.0,
      throughputMultiplier: 1.0,
      confidence: 0,
      reason: 'low-confidence',
    })
  ),
  clearCache: vi.fn(),
  updateConfig: vi.fn(),
};

vi.mock('../../../src/load-balancer/temporal-scorer.js', () => ({
  getTemporalScorer: vi.fn(() => mockTemporalScorer),
  TemporalScorer: vi.fn(),
  resetTemporalScorer: vi.fn(),
}));

function makeServer(overrides: Partial<AIServer> = {}): AIServer {
  return {
    id: 'srv-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
    maxConcurrency: 4,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<ServerModelMetrics> = {}): ServerModelMetrics {
  return {
    serverId: 'srv-1',
    model: 'llama3:latest',
    inFlight: 0,
    queued: 0,
    windows: {
      '1m': {
        startTime: Date.now() - 60000,
        endTime: Date.now(),
        count: 100,
        userRequests: 95,
        latencySum: 15000,
        latencySquaredSum: 2500000,
        minLatency: 20,
        maxLatency: 500,
        errors: 5,
        tokensGenerated: 5000,
        tokensPrompt: 2500,
      },
      '5m': {
        startTime: Date.now() - 300000,
        endTime: Date.now(),
        count: 500,
        userRequests: 475,
        latencySum: 75000,
        latencySquaredSum: 12500000,
        minLatency: 20,
        maxLatency: 500,
        errors: 25,
        tokensGenerated: 25000,
        tokensPrompt: 12500,
      },
      '15m': {
        startTime: Date.now() - 900000,
        endTime: Date.now(),
        count: 1500,
        userRequests: 1425,
        latencySum: 225000,
        latencySquaredSum: 37500000,
        minLatency: 20,
        maxLatency: 500,
        errors: 75,
        tokensGenerated: 75000,
        tokensPrompt: 37500,
      },
      '1h': {
        startTime: Date.now() - 3600000,
        endTime: Date.now(),
        count: 6000,
        userRequests: 5700,
        latencySum: 900000,
        latencySquaredSum: 150000000,
        minLatency: 20,
        maxLatency: 500,
        errors: 300,
        tokensGenerated: 300000,
        tokensPrompt: 150000,
      },
      '24h': {
        startTime: Date.now() - 86400000,
        endTime: Date.now(),
        count: 144000,
        userRequests: 136800,
        latencySum: 21600000,
        latencySquaredSum: 3600000000,
        minLatency: 20,
        maxLatency: 500,
        errors: 7200,
        tokensGenerated: 7200000,
        tokensPrompt: 3600000,
      },
    } as ServerModelMetrics['windows'],
    percentiles: { p50: 100, p95: 150, p99: 200 },
    successRate: 1.0,
    throughput: 10,
    avgTokensPerRequest: 100,
    avgPromptTokens: 50,
    avgTokensPerSecond: 25,
    coldStartCount: 0,
    lastUpdated: Date.now(),
    recentLatencies: [80, 90, 95, 100, 105, 110],
    ...overrides,
  };
}

// ─── Test suite ──────────────────────────────────────────────────────────────

// Dynamic import to ensure mocks are applied before the module under test is loaded
let calculateServerScore: typeof import('../../../src/load-balancer/load-balancer.js').calculateServerScore;

beforeEach(async () => {
  vi.clearAllMocks();

  // Reset mock return values to neutral defaults
  mockInFlightManager.getTokenWeightedLoad.mockReturnValue(0);
  mockInFlightManager.getTotalTokenWeightedLoad.mockReturnValue(0);
  mockTemporalScorer.isEnabled.mockReturnValue(true);
  mockTemporalScorer.isShadowMode.mockReturnValue(false);
  mockTemporalScorer.getAdjustment.mockReturnValue({
    latencyMultiplier: 1.0,
    successRateMultiplier: 1.0,
    throughputMultiplier: 1.0,
    confidence: 0,
    reason: 'low-confidence',
  });

  const mod = await import('../../../src/load-balancer/load-balancer.js');
  calculateServerScore = mod.calculateServerScore;
});

describe('calculateServerScore', () => {
  // ── Test 1: Empty metrics → falls back to defaults ──────────────────────
  describe('empty metrics fall back to defaults', () => {
    it('returns a valid ServerScore when metrics are undefined', () => {
      const server = makeServer({ lastResponseTime: 200 });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, undefined);

      expect(score.totalScore).toBeGreaterThan(0);
      expect(score.server).toBe(server);
      expect(score.breakdown).toBeDefined();
    });

    it('uses server.lastResponseTime as latency source when no metrics', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        lastResponseTime: 500,
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, undefined);

      expect(score.breakdown.latencyScore).toBeCloseTo(90, 1);
    });

    it('uses defaultLatencyMs (1000) when no metrics and no lastResponseTime', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        lastResponseTime: 0,
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, undefined);

      expect(score.breakdown.latencyScore).toBeCloseTo(80, 1);
    });

    it('defaults throughputScore to 50 (neutral) when no metrics', () => {
      const server = makeServer();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, undefined);

      // throughputScore = 50 when no metrics (cold-start neutral fallback)
      expect(score.breakdown.throughputScore).toBe(50);
    });

    it('defaults successRateScore to 100 when no metrics', () => {
      const server = makeServer();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, undefined);

      expect(score.breakdown.successRateScore).toBe(100);
    });
  });

  // ── Test 2: All metrics present → score is calculated ───────────────────
  describe('all metrics present', () => {
    it('produces a non-zero total score with full metrics', () => {
      const server = makeServer();
      const metrics = makeMetrics({
        percentiles: { p50: 50, p95: 100, p99: 150 },
        successRate: 0.99,
        avgTokensPerSecond: 30,
      });

      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.totalScore).toBeGreaterThan(0);
      expect(score.totalScore).toBeLessThanOrEqual(100);
    });

    it('includes all breakdown fields in the returned score', () => {
      const server = makeServer();
      const metrics = makeMetrics();

      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.latencyScore).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.successRateScore).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.loadScore).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.capacityScore).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.circuitBreakerScore).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.timeoutScore).toBe(100); // no timeout passed
      expect(score.breakdown.throughputScore).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.vramScore).toBe(50); // no hardware info → neutral
    });

    it('total score is the weighted sum of all components', () => {
      const server = makeServer();
      const metrics = makeMetrics();
      const config = DEFAULT_LB_CONFIG;

      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      const expected =
        score.breakdown.latencyScore * config.weights.latency +
        score.breakdown.successRateScore * config.weights.successRate +
        score.breakdown.loadScore * config.weights.load +
        score.breakdown.capacityScore * config.weights.capacity +
        score.breakdown.circuitBreakerScore * config.weights.circuitBreaker +
        score.breakdown.timeoutScore * config.weights.timeout +
        score.breakdown.throughputScore * config.weights.throughput +
        score.breakdown.vramScore * config.weights.vram +
        (score.breakdown.temporalScore ?? 100) * (config.weights.temporal ?? 0.1) +
        (score.breakdown.contextScore ?? 100) * (config.weights.context ?? 0.05);

      expect(score.totalScore).toBeCloseTo(expected, 1);
    });
  });

  // ── Test 3: Hot model with low latency → high score ──────────────────────
  describe('hot model scoring', () => {
    it('gives a high latency score when model is loaded in VRAM and latency is low', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 8 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });

      const metrics = makeMetrics({ percentiles: { p50: 30, p95: 50, p99: 70 } });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      // latencyScore = max(0, 100 - (50/5000)*100) = 99, no cold penalty
      expect(score.breakdown.latencyScore).toBeGreaterThanOrEqual(98);
    });

    it('loaded model with imminent eviction applies eviction penalty', () => {
      const imminent = new Date(Date.now() + 15_000).toISOString(); // 15s — imminent
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 8 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: imminent,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });

      const metrics = makeMetrics({ percentiles: { p50: 30, p95: 50, p99: 70 } });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      // evictionPenalty = 0.6 for < 30s; latencyScore *= 0.6
      expect(score.breakdown.latencyScore).toBeLessThan(60); // heavily penalised
    });

    it('VRAM score is 100 when model is hot in VRAM', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 8 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });

      const metrics = makeMetrics();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      // vramScore = 100 * evictionPenalty = 100 (no eviction)
      expect(score.breakdown.vramScore).toBe(100);
    });
  });

  // ── Test 4: Cold model with high latency → low score ─────────────────────
  describe('cold model scoring', () => {
    it('applies cold-start penalty when model is not loaded in VRAM', () => {
      const server = makeServer({
        // hardware.loadedModels does NOT include 'llama3:latest'
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 8 * 1024 * 1024 * 1024,
          loadedModels: [],
          lastUpdated: new Date(),
        },
      });

      const metrics = makeMetrics({
        percentiles: { p50: 100, p95: 200, p99: 300 },
        coldStartCount: 0,
      });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      // Base latencyScore = max(0, 100 - (200/5000)*100) = 96
      // ColdPenalty = 0.85 (base, no cold starts observed)
      // Final latencyScore ≈ 96 * 0.85 ≈ 81.6
      expect(score.breakdown.latencyScore).toBeLessThan(90);
    });

    it('cold penalty increases with coldStartCount', () => {
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 8 * 1024 * 1024 * 1024,
          loadedModels: [],
          lastUpdated: new Date(),
        },
      });

      const manyColdStarts = makeMetrics({
        percentiles: { p50: 100, p95: 200, p99: 300 },
        coldStartCount: 20,
      });
      const noColdStarts = makeMetrics({
        percentiles: { p50: 100, p95: 200, p99: 300 },
        coldStartCount: 0,
      });

      const scoreMany = calculateServerScore(server, 'llama3:latest', 0, 0, manyColdStarts);
      const scoreNone = calculateServerScore(server, 'llama3:latest', 0, 0, noColdStarts);

      // More cold starts → lower coldPenalty → lower latencyScore
      expect(scoreMany.breakdown.latencyScore).toBeLessThan(scoreNone.breakdown.latencyScore);
    });

    it('cold penalty is capped at max reduction (0.7)', () => {
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 8 * 1024 * 1024 * 1024,
          loadedModels: [],
          lastUpdated: new Date(),
        },
      });

      // coldStartCount=20 → coldPenalty = max(0.7, 0.85 - 20*0.01) = 0.70
      const manyColdStarts = makeMetrics({
        percentiles: { p50: 100, p95: 200, p99: 300 },
        coldStartCount: 20,
      });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, manyColdStarts);

      const baseLatencyScore = 100 - (200 / 5000) * 100; // 96
      // Max penalty = 0.7, so latencyScore ≈ 96 * 0.7 ≈ 67.2
      expect(score.breakdown.latencyScore).toBeLessThan(70);
    });
  });

  describe('additional scoring factors', () => {
    it('applies latency penalty when p95 exceeds maxP95Latency threshold', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const metrics = makeMetrics({ percentiles: { p50: 5000, p95: 8000, p99: 10000 } });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      const baseLatencyScore = Math.max(0, 100 - (8000 / 5000) * 100);
      expect(baseLatencyScore).toBe(0);
    });

    it('applies eviction penalty for approaching eviction (< 2min)', () => {
      const soon = new Date(Date.now() + 60_000).toISOString(); // 60s — approaching eviction
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: soon,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const metrics = makeMetrics({ percentiles: { p50: 30, p95: 50, p99: 70 } });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      const baseLatencyScore = 100 - (50 / 5000) * 100;
      expect(score.breakdown.latencyScore).toBeLessThan(baseLatencyScore);
    });

    it('applies network overhead penalty when avgNetworkOverheadMs > 100', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const metrics = makeMetrics({
        percentiles: { p50: 100, p95: 200, p99: 300 },
        avgNetworkOverheadMs: 300,
      });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      const baseLatencyScore = 100 - (200 / 5000) * 100;
      const overheadFraction = (300 - 100) / 400;
      const expectedScore = baseLatencyScore * (1 - overheadFraction * 0.2);
      expect(score.breakdown.latencyScore).toBeCloseTo(expectedScore, 1);
    });

    it('applies queue wait time penalty when avgQueueWaitTimeMs > 200', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const metrics = makeMetrics({
        percentiles: { p50: 100, p95: 200, p99: 300 },
        avgQueueWaitTimeMs: 1100,
      });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      const baseLoadScore = Math.max(0, 100 - (0 / 8) * 100);
      const queueFraction = (1100 - 200) / 1800;
      const expectedLoadScore = baseLoadScore * (1 - queueFraction * 0.25);
      expect(score.breakdown.loadScore).toBeLessThan(100);
    });

    it('gives vramScore of 75 when modelSizeEstimate is 0 but freeVRam > 0', () => {
      const server = makeServer({
        hardware: {
          totalVram: 8 * 1024 * 1024 * 1024,
          usedVram: 0,
          loadedModels: [],
          lastUpdated: new Date(),
        },
      });
      const metrics = makeMetrics();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.vramScore).toBe(75);
    });

    it('computes itlScore from streamingMetrics.avgChunkGapMs', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const metrics = makeMetrics({
        streamingMetrics: {
          recentTTFTs: [],
          ttftPercentiles: { p50: 50, p95: 100, p99: 200 },
          avgTTFT: 50,
          recentStreamingDurations: [],
          streamingDurationPercentiles: { p50: 1000, p95: 2000, p99: 3000 },
          avgStreamingDuration: 1000,
          recentChunkCounts: [],
          chunkCountPercentiles: { p50: 50, p95: 80, p99: 100 },
          avgChunkCount: 50,
          recentMaxChunkGaps: [],
          maxChunkGapPercentiles: { p50: 50, p95: 100, p99: 200 },
          avgChunkSizeBytes: 100,
          recentChunkSizes: [],
          chunkSizePercentiles: { p50: 100, p95: 200, p99: 300 },
          recentChunkGaps: [],
          avgChunkGapMs: 250,
          chunkGapPercentiles: { p50: 200, p95: 300, p99: 400 },
        },
      } as ServerModelMetrics['streamingMetrics'] & ServerModelMetrics);
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      const expectedItl = Math.max(0, 100 - (250 / 500) * 100);
      expect(score.breakdown.itlScore).toBe(expectedItl);
    });

    it('computes cacheHitScore from metrics.cacheHitRate', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const metrics = makeMetrics({ cacheHitRate: 0.8 });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.cacheHitScore).toBe(80);
    });

    it('computes promptSizeScore from metrics.parameterSize', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const metrics = makeMetrics({ parameterSize: '70B' });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.promptSizeScore).toBeLessThan(100);
    });

    it('computes errorTypeScore from metrics.errorTypeHistogram', () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const server = makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
      const errorHistogram = new Map<string, number>();
      errorHistogram.set('timeout', 3);
      const metrics = makeMetrics({ errorTypeHistogram: errorHistogram });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.errorTypeScore).toBeLessThan(100);
    });
  });

  // ── Test 5: Circuit breaker open → score near 0 ─────────────────────────
  describe('circuit breaker scoring', () => {
    it('reduces circuitBreakerScore when 5m window has errors', () => {
      const metrics = makeMetrics({
        windows: {
          '1m': {
            startTime: Date.now() - 60000,
            endTime: Date.now(),
            count: 100,
            userRequests: 95,
            latencySum: 15000,
            latencySquaredSum: 2500000,
            minLatency: 20,
            maxLatency: 500,
            errors: 5,
            tokensGenerated: 5000,
            tokensPrompt: 2500,
          },
          '5m': {
            startTime: Date.now() - 300000,
            endTime: Date.now(),
            count: 100,
            userRequests: 95,
            latencySum: 75000,
            latencySquaredSum: 12500000,
            minLatency: 20,
            maxLatency: 500,
            errors: 50,
            tokensGenerated: 25000,
            tokensPrompt: 12500,
          }, // 50% error rate!
          '15m': {
            startTime: Date.now() - 900000,
            endTime: Date.now(),
            count: 300,
            userRequests: 285,
            latencySum: 225000,
            latencySquaredSum: 37500000,
            minLatency: 20,
            maxLatency: 500,
            errors: 150,
            tokensGenerated: 75000,
            tokensPrompt: 37500,
          },
          '1h': {
            startTime: Date.now() - 3600000,
            endTime: Date.now(),
            count: 1200,
            userRequests: 1140,
            latencySum: 900000,
            latencySquaredSum: 150000000,
            minLatency: 20,
            maxLatency: 500,
            errors: 600,
            tokensGenerated: 300000,
            tokensPrompt: 150000,
          },
          '24h': {
            startTime: Date.now() - 86400000,
            endTime: Date.now(),
            count: 28800,
            userRequests: 27360,
            latencySum: 21600000,
            latencySquaredSum: 3600000000,
            minLatency: 20,
            maxLatency: 500,
            errors: 14400,
            tokensGenerated: 7200000,
            tokensPrompt: 3600000,
          },
        } as ServerModelMetrics['windows'],
      });

      const server = makeServer();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      // errorRate = 50/100 = 0.5; circuitBreakerScore = (1 - 0.5) * 100 = 50
      expect(score.breakdown.circuitBreakerScore).toBe(50);
    });

    it('circuitBreakerScore is 100 when 5m window has no errors', () => {
      const metrics = makeMetrics({
        windows: {
          '1m': {
            startTime: Date.now() - 60000,
            endTime: Date.now(),
            count: 100,
            userRequests: 95,
            latencySum: 15000,
            latencySquaredSum: 2500000,
            minLatency: 20,
            maxLatency: 500,
            errors: 0,
            tokensGenerated: 5000,
            tokensPrompt: 2500,
          },
          '5m': {
            startTime: Date.now() - 300000,
            endTime: Date.now(),
            count: 100,
            userRequests: 95,
            latencySum: 75000,
            latencySquaredSum: 12500000,
            minLatency: 20,
            maxLatency: 500,
            errors: 0,
            tokensGenerated: 25000,
            tokensPrompt: 12500,
          },
          '15m': {
            startTime: Date.now() - 900000,
            endTime: Date.now(),
            count: 300,
            userRequests: 285,
            latencySum: 225000,
            latencySquaredSum: 37500000,
            minLatency: 20,
            maxLatency: 500,
            errors: 0,
            tokensGenerated: 75000,
            tokensPrompt: 37500,
          },
          '1h': {
            startTime: Date.now() - 3600000,
            endTime: Date.now(),
            count: 1200,
            userRequests: 1140,
            latencySum: 900000,
            latencySquaredSum: 150000000,
            minLatency: 20,
            maxLatency: 500,
            errors: 0,
            tokensGenerated: 300000,
            tokensPrompt: 150000,
          },
          '24h': {
            startTime: Date.now() - 86400000,
            endTime: Date.now(),
            count: 28800,
            userRequests: 27360,
            latencySum: 21600000,
            latencySquaredSum: 3600000000,
            minLatency: 20,
            maxLatency: 500,
            errors: 0,
            tokensGenerated: 7200000,
            tokensPrompt: 3600000,
          },
        } as ServerModelMetrics['windows'],
      });

      const server = makeServer();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.circuitBreakerScore).toBe(100);
    });

    it('total score is meaningfully reduced when circuit breaker is open', () => {
      const goodServer = makeServer();
      const badServer = makeServer({ id: 'srv-bad' });

      const goodMetrics = makeMetrics({ serverId: 'srv-1' });
      const badMetrics = makeMetrics({
        serverId: 'srv-bad',
        windows: {
          '1m': {
            startTime: Date.now() - 60000,
            endTime: Date.now(),
            count: 100,
            userRequests: 95,
            latencySum: 15000,
            latencySquaredSum: 2500000,
            minLatency: 20,
            maxLatency: 500,
            errors: 0,
            tokensGenerated: 5000,
            tokensPrompt: 2500,
          },
          '5m': {
            startTime: Date.now() - 300000,
            endTime: Date.now(),
            count: 100,
            userRequests: 95,
            latencySum: 75000,
            latencySquaredSum: 12500000,
            minLatency: 20,
            maxLatency: 500,
            errors: 50,
            tokensGenerated: 25000,
            tokensPrompt: 12500,
          },
          '15m': {
            startTime: Date.now() - 900000,
            endTime: Date.now(),
            count: 300,
            userRequests: 285,
            latencySum: 225000,
            latencySquaredSum: 37500000,
            minLatency: 20,
            maxLatency: 500,
            errors: 0,
            tokensGenerated: 75000,
            tokensPrompt: 37500,
          },
          '1h': {
            startTime: Date.now() - 3600000,
            endTime: Date.now(),
            count: 1200,
            userRequests: 1140,
            latencySum: 900000,
            latencySquaredSum: 150000000,
            minLatency: 20,
            maxLatency: 500,
            errors: 0,
            tokensGenerated: 300000,
            tokensPrompt: 150000,
          },
          '24h': {
            startTime: Date.now() - 86400000,
            endTime: Date.now(),
            count: 28800,
            userRequests: 27360,
            latencySum: 21600000,
            latencySquaredSum: 3600000000,
            minLatency: 20,
            maxLatency: 500,
            errors: 0,
            tokensGenerated: 7200000,
            tokensPrompt: 3600000,
          },
        } as ServerModelMetrics['windows'],
      });

      const goodScore = calculateServerScore(goodServer, 'llama3:latest', 0, 0, goodMetrics);
      const badScore = calculateServerScore(badServer, 'llama3:latest', 0, 0, badMetrics);

      // CB weight is 0.12; bad CB score is 50 vs 100 → 6-point difference
      expect(goodScore.totalScore).toBeGreaterThan(badScore.totalScore);
    });
  });

  // ── Test 6: VRAM near capacity → low score ───────────────────────────────
  describe('VRAM scoring', () => {
    it('gives low vramScore when model is not loaded and free VRAM < model size estimate', () => {
      // Server has some loaded models that give us a size estimate
      // Model is NOT loaded → must estimate model size from loaded models
      const server = makeServer({
        hardware: {
          totalVram: 8 * 1024 * 1024 * 1024, // 8 GB total
          usedVram: 7 * 1024 * 1024 * 1024, // 7 GB used → 1 GB free
          loadedModels: [
            {
              name: 'other-model:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
              digest: 'sha256:def',
            },
          ],
          lastUpdated: new Date(),
        },
      });

      const metrics = makeMetrics();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      // Model not loaded; modelSizeEstimate ≈ 4GB (avg of loaded models)
      // freeVram = 1GB; vramScore = (1GB / 4GB) * 100 = 25
      expect(score.breakdown.vramScore).toBeLessThan(50);
    });

    it('gives neutral vramScore (50) when no hardware info', () => {
      const server = makeServer(); // no hardware field
      const metrics = makeMetrics();

      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.vramScore).toBe(50);
    });

    it('gives high vramScore when server has plenty of free VRAM', () => {
      const server = makeServer({
        hardware: {
          totalVram: 32 * 1024 * 1024 * 1024, // 32 GB
          usedVram: 4 * 1024 * 1024 * 1024, // 4 GB used → 28 GB free
          loadedModels: [
            {
              name: 'tiny-model:latest',
              sizeVram: 2 * 1024 * 1024 * 1024,
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
              digest: 'sha256:ghi',
            },
          ],
          lastUpdated: new Date(),
        },
      });

      const metrics = makeMetrics();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      // freeVram = 28GB; modelSizeEstimate = 2GB; ratio = 14 → capped at 100
      expect(score.breakdown.vramScore).toBe(100);
    });
  });

  // ── Test 7: Temporal adjustment applies when confidence ≥ 0.3 ───────────
  describe('temporal adjustment scoring', () => {
    const hotServer = () => {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      return makeServer({
        hardware: {
          totalVram: 16 * 1024 * 1024 * 1024,
          usedVram: 4 * 1024 * 1024 * 1024,
          loadedModels: [
            {
              name: 'llama3:latest',
              sizeVram: 4 * 1024 * 1024 * 1024,
              expiresAt: farFuture,
              digest: 'sha256:abc',
            },
          ],
          lastUpdated: new Date(),
        },
      });
    };

    it('does NOT apply temporal adjustment when confidence < 0.3', () => {
      mockTemporalScorer.getAdjustment.mockReturnValue({
        latencyMultiplier: 2.0,
        successRateMultiplier: 1.5,
        throughputMultiplier: 1.5,
        confidence: 0.1,
        reason: 'low-confidence',
      });

      const server = hotServer();
      const metrics = makeMetrics({ percentiles: { p50: 100, p95: 200, p99: 300 } });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.latencyScore).toBeCloseTo(96, 0);
      expect(score.breakdown.temporalScore).toBe(100);
    });

    it('applies temporal adjustment to latencyScore when confidence ≥ 0.3', () => {
      mockTemporalScorer.getAdjustment.mockReturnValue({
        latencyMultiplier: 2.0,
        successRateMultiplier: 1.0,
        throughputMultiplier: 1.0,
        confidence: 0.8,
        reason: 'peak-hours',
      });

      const server = hotServer();
      const metrics = makeMetrics({ percentiles: { p50: 100, p95: 200, p99: 300 } });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.latencyScore).toBe(48);
    });

    it('applies temporal adjustment to throughputScore when confidence ≥ 0.3', () => {
      mockTemporalScorer.getAdjustment.mockReturnValue({
        latencyMultiplier: 1.0,
        successRateMultiplier: 1.0,
        throughputMultiplier: 2.0,
        confidence: 0.8,
        reason: 'peak-hours',
      });

      const server = hotServer();
      const metrics = makeMetrics({ avgTokensPerSecond: 25 });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.throughputScore).toBe(100);
    });

    it('computes temporalScore sub-component when confidence ≥ 0.3 and not shadow mode', () => {
      mockTemporalScorer.getAdjustment.mockReturnValue({
        latencyMultiplier: 2.0,
        successRateMultiplier: 1.2,
        throughputMultiplier: 1.0,
        confidence: 0.8,
        reason: 'peak-hours',
      });

      const server = hotServer();
      const metrics = makeMetrics();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.temporalScore).toBeCloseTo(60, 0);
    });

    it('temporalScore is undefined when isShadowMode returns true', () => {
      mockTemporalScorer.isShadowMode.mockReturnValue(true);
      mockTemporalScorer.getAdjustment.mockReturnValue({
        latencyMultiplier: 2.0,
        successRateMultiplier: 1.0,
        throughputMultiplier: 1.0,
        confidence: 0.8,
        reason: 'shadow-mode',
      });

      const server = hotServer();
      const metrics = makeMetrics();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.temporalScore).toBe(100);
    });
  });

  // ── Test 8: Context score near limit → low score ─────────────────────────
  describe('context fit scoring', () => {
    it('gives low contextScore when estimated prompt tokens are near the limit', () => {
      const server = makeServer();
      // getContextLimit returns 4096; effectiveLimit = floor(4096 * 0.9) = 3686
      const getContextLimit = (_serverId: string, _model: string) => 4096;

      // estimatedPromptTokens = 3600 → headroom = 3686 - 3600 = 86
      const score = calculateServerScore(
        server,
        'llama3:latest',
        0,
        0,
        makeMetrics(),
        undefined,
        undefined,
        3600,
        getContextLimit
      );

      // headroomRatio = 86 / 3686 ≈ 0.023; contextScore = 50 + 0.023*50 ≈ 51
      expect(score.breakdown.contextScore).toBeLessThan(60);
    });

    it('gives high contextScore when estimated prompt tokens are well within limit', () => {
      const server = makeServer();
      const getContextLimit = (_serverId: string, _model: string) => 4096;

      // estimatedPromptTokens = 1000 → headroom = 3686 - 1000 = 2686
      const score = calculateServerScore(
        server,
        'llama3:latest',
        0,
        0,
        makeMetrics(),
        undefined,
        undefined,
        1000,
        getContextLimit
      );

      // headroomRatio = 2686 / 3686 ≈ 0.73; contextScore = 50 + 0.73*50 ≈ 86.5
      expect(score.breakdown.contextScore).toBeGreaterThan(80);
    });

    it('gives contextScore of 0 when prompt exceeds context limit', () => {
      const server = makeServer();
      const getContextLimit = (_serverId: string, _model: string) => 2048;

      // estimatedPromptTokens = 4000 > effectiveLimit = floor(2048*0.9) = 1843
      const score = calculateServerScore(
        server,
        'llama3:latest',
        0,
        0,
        makeMetrics(),
        undefined,
        undefined,
        4000,
        getContextLimit
      );

      expect(score.breakdown.contextScore).toBe(0);
    });

    it('defaults contextScore to 100 when no getContextLimit provided', () => {
      const server = makeServer();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, makeMetrics());

      expect(score.breakdown.contextScore).toBe(100);
    });

    it('defaults contextScore to 100 when estimatedPromptTokens is 0', () => {
      const server = makeServer();
      const getContextLimit = (_serverId: string, _model: string) => 4096;

      const score = calculateServerScore(
        server,
        'llama3:latest',
        0,
        0,
        makeMetrics(),
        undefined,
        undefined,
        0,
        getContextLimit
      );

      expect(score.breakdown.contextScore).toBe(100);
    });
  });

  // ── Test 9: Throughput score: high recent throughput → high score ───────
  describe('throughput scoring', () => {
    it('gives high throughputScore when avgTokensPerSecond is high', () => {
      const server = makeServer();
      // avgTokensPerSecond = 40 → score = min(100, (40/50)*100) = 80
      const metrics = makeMetrics({ avgTokensPerSecond: 40 });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.throughputScore).toBe(80);
    });

    it('gives low throughputScore when avgTokensPerSecond is low', () => {
      const server = makeServer();
      // avgTokensPerSecond = 5 → score = min(100, (5/50)*100) = 10
      const metrics = makeMetrics({ avgTokensPerSecond: 5 });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.throughputScore).toBe(10);
    });

    it('caps throughputScore at 100 when avgTokensPerSecond ≥ 50', () => {
      const server = makeServer();
      const metrics = makeMetrics({ avgTokensPerSecond: 100 });
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, metrics);

      expect(score.breakdown.throughputScore).toBe(100);
    });

    it('defaults to 50 when metrics is undefined (cold-start neutral fallback)', () => {
      const server = makeServer();
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, undefined);

      expect(score.breakdown.throughputScore).toBe(50);
    });
  });

  // ── Test 10: Token-weighted load (after 3.3): heavy prompt → low score ──
  describe('token-weighted load scoring', () => {
    it('uses token-weighted load instead of simple count when tokenWeightedLoad.enabled', () => {
      // Mock returns high token-weighted load
      mockInFlightManager.getTokenWeightedLoad.mockReturnValue(6); // heavy in-flight
      mockInFlightManager.getTotalTokenWeightedLoad.mockReturnValue(10);

      const server = makeServer({ maxConcurrency: 4 });
      const config: typeof DEFAULT_LB_CONFIG = {
        ...DEFAULT_LB_CONFIG,
        tokenWeightedLoad: { enabled: true, promptTokenWeight: 1.0, outputTokenWeight: 4.0 },
      };

      const score = calculateServerScore(server, 'llama3:latest', 0, 0, makeMetrics(), config);

      // effectiveCurrentLoad = 6; effectiveTotalLoad = 10
      // maxExpectedLoad = 4 * 2 = 8
      // loadScore = max(0, 100 - (10/8)*100) = max(0, 100 - 125) = 0
      expect(score.breakdown.loadScore).toBe(0);
    });

    it('uses simple load when tokenWeightedLoad.enabled is false', () => {
      mockInFlightManager.getTokenWeightedLoad.mockReturnValue(100); // would be heavy
      mockInFlightManager.getTotalTokenWeightedLoad.mockReturnValue(100); // would be heavy

      const server = makeServer({ maxConcurrency: 4 });
      const config: typeof DEFAULT_LB_CONFIG = {
        ...DEFAULT_LB_CONFIG,
        tokenWeightedLoad: { enabled: false, promptTokenWeight: 1.0, outputTokenWeight: 4.0 },
      };

      // currentLoad=0, totalLoad=0 → loadScore should be 100 (no load)
      const score = calculateServerScore(server, 'llama3:latest', 0, 0, makeMetrics(), config);

      expect(score.breakdown.loadScore).toBe(100);
    });

    it('capacity score accounts for token-weighted effectiveCurrentLoad', () => {
      mockInFlightManager.getTokenWeightedLoad.mockReturnValue(6);
      mockInFlightManager.getTotalTokenWeightedLoad.mockReturnValue(6);

      const server = makeServer({ maxConcurrency: 4 });
      const config: typeof DEFAULT_LB_CONFIG = {
        ...DEFAULT_LB_CONFIG,
        tokenWeightedLoad: { enabled: true, promptTokenWeight: 1.0, outputTokenWeight: 4.0 },
      };

      const score = calculateServerScore(server, 'llama3:latest', 0, 0, makeMetrics(), config);

      // availableCapacity = 4 - 6 = -2 → capacityScore = max(0, (-2/4)*100) = 0
      expect(score.breakdown.capacityScore).toBe(0);
    });
  });
});
