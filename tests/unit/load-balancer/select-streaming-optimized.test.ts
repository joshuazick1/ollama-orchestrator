/**
 * select-streaming-optimized.test.ts
 * Wave 8.2: Unit tests for selectStreamingOptimized() in load-balancer.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { LoadBalancer } from '../../../src/load-balancer/load-balancer.js';
import type { AIServer, ServerModelMetrics } from '../../../src/orchestrator/orchestrator.types.js';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockInFlightManager = {
  getTokenWeightedLoad: vi.fn(() => 0),
  getTotalTokenWeightedLoad: vi.fn(() => 0),
  getInFlight: vi.fn(() => 0),
  getQueued: vi.fn(() => 0),
  addRequest: vi.fn(),
  removeRequest: vi.fn(),
  updateChunkProgress: vi.fn(),
  addStreamingRequest: vi.fn(),
  removeStreamingRequest: vi.fn(),
  getAllStreamingRequests: vi.fn(() => []),
  getStalledRequestCount: vi.fn(() => 0),
};

vi.mock('../../../src/utils/in-flight-manager.js', () => ({
  getInFlightManager: vi.fn(() => mockInFlightManager),
}));

vi.mock('../../../src/load-balancer/temporal-scorer.js', () => ({
  getTemporalScorer: vi.fn(() => ({
    isEnabled: vi.fn(() => true),
    isShadowMode: vi.fn(() => false),
    getAdjustment: vi.fn(() => ({
      latencyMultiplier: 1.0,
      successRateMultiplier: 1.0,
      throughputMultiplier: 1.0,
      confidence: 0,
      reason: 'low-confidence',
    })),
    clearCache: vi.fn(),
    updateConfig: vi.fn(),
  })),
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

function makeStreamingMetrics(
  overrides: Partial<ServerModelMetrics['streamingMetrics']> = {}
): ServerModelMetrics['streamingMetrics'] & ServerModelMetrics {
  return {
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
    ...overrides,
  } as ServerModelMetrics['streamingMetrics'] & ServerModelMetrics;
}

let lb: LoadBalancer;

beforeEach(async () => {
  vi.clearAllMocks();
  mockInFlightManager.getTokenWeightedLoad.mockReturnValue(0);
  mockInFlightManager.getTotalTokenWeightedLoad.mockReturnValue(0);
  mockInFlightManager.getStalledRequestCount.mockReturnValue(0);
  lb = new LoadBalancer();
  lb.setAlgorithm('streaming-optimized');
});

describe('selectStreamingOptimized', () => {
  describe('single eligible server', () => {
    it('returns that server immediately when only one candidate exists', () => {
      const server = makeServer({ id: 'srv-1', lastResponseTime: 100 });
      const result = lb.select(
        [server],
        'llama3:latest',
        () => 0,
        () => 0,
        () => undefined,
        true
      );
      expect(result).toBe(server);
    });

    it('returns the only server even when it has poor metrics', () => {
      const server = makeServer({ id: 'srv-1', lastResponseTime: 5000 });
      const result = lb.select(
        [server],
        'llama3:latest',
        () => 0,
        () => 0,
        () => undefined,
        true
      );
      expect(result).toBe(server);
    });
  });

  describe('multiple hot servers - selects by TTFT', () => {
    it('selects the server with lowest TTFT when all have good streaming metrics', () => {
      const fastTTFT = makeServer({ id: 'srv-fast', lastResponseTime: 80 });
      const slowTTFT = makeServer({ id: 'srv-slow', lastResponseTime: 80 });

      const fastMetrics = makeMetrics({
        serverId: 'srv-fast',
        streamingMetrics: makeStreamingMetrics({
          avgTTFT: 50,
          ttftPercentiles: { p50: 30, p95: 50, p99: 80 },
          avgStreamingDuration: 2000,
          streamingDurationPercentiles: { p50: 1500, p95: 2000, p99: 2500 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const slowMetrics = makeMetrics({
        serverId: 'srv-slow',
        streamingMetrics: makeStreamingMetrics({
          avgTTFT: 200,
          ttftPercentiles: { p50: 150, p95: 200, p99: 300 },
          avgStreamingDuration: 2000,
          streamingDurationPercentiles: { p50: 1500, p95: 2000, p99: 2500 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [slowTTFT, fastTTFT],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId => (serverId === 'srv-fast' ? fastMetrics : slowMetrics),
        true
      );

      expect(result?.id).toBe('srv-fast');
    });

    it('prefers server with better duration when TTFT is similar', () => {
      const betterDuration = makeServer({ id: 'srv-fast-duration', lastResponseTime: 80 });
      const worseDuration = makeServer({ id: 'srv-slow-duration', lastResponseTime: 80 });

      const sameTTFT = makeStreamingMetrics({
        avgTTFT: 100,
        ttftPercentiles: { p50: 80, p95: 100, p99: 150 },
      });

      const betterDurationMetrics = makeMetrics({
        serverId: 'srv-fast-duration',
        streamingMetrics: makeStreamingMetrics({
          ...sameTTFT,
          avgStreamingDuration: 1000,
          streamingDurationPercentiles: { p50: 800, p95: 1000, p99: 1200 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const worseDurationMetrics = makeMetrics({
        serverId: 'srv-slow-duration',
        streamingMetrics: makeStreamingMetrics({
          ...sameTTFT,
          avgStreamingDuration: 3000,
          streamingDurationPercentiles: { p50: 2500, p95: 3000, p99: 3500 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [worseDuration, betterDuration],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId =>
          serverId === 'srv-fast-duration' ? betterDurationMetrics : worseDurationMetrics,
        true
      );

      expect(result?.id).toBe('srv-fast-duration');
    });

    it('considers chunk throughput when TTFT and duration are similar', () => {
      const highThroughput = makeServer({ id: 'srv-high-tput', lastResponseTime: 80 });
      const lowThroughput = makeServer({ id: 'srv-low-tput', lastResponseTime: 80 });

      const baseStreaming = makeStreamingMetrics({
        avgTTFT: 100,
        ttftPercentiles: { p50: 80, p95: 100, p99: 150 },
        avgStreamingDuration: 2000,
        streamingDurationPercentiles: { p50: 1800, p95: 2000, p99: 2200 },
      });

      const highTputMetrics = makeMetrics({
        serverId: 'srv-high-tput',
        streamingMetrics: makeStreamingMetrics({
          ...baseStreaming,
          avgChunkCount: 100,
          avgStreamingDuration: 2000,
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const lowTputMetrics = makeMetrics({
        serverId: 'srv-low-tput',
        streamingMetrics: makeStreamingMetrics({
          ...baseStreaming,
          avgChunkCount: 5,
          avgStreamingDuration: 2000,
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [lowThroughput, highThroughput],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId => (serverId === 'srv-high-tput' ? highTputMetrics : lowTputMetrics),
        true
      );

      expect(result?.id).toBe('srv-high-tput');
    });
  });

  describe('cold servers - uses duration estimate', () => {
    it('uses durationEstimateMultiplier when no streamingMetrics available', () => {
      const fastDuration = makeServer({ id: 'srv-fast-dur', lastResponseTime: 50 });
      const slowDuration = makeServer({ id: 'srv-slow-dur', lastResponseTime: 200 });

      const result = lb.select(
        [slowDuration, fastDuration],
        'llama3:latest',
        () => 0,
        () => 0,
        () => undefined,
        true
      );

      expect(result?.id).toBe('srv-fast-dur');
    });

    it('prefers server with lower p95 streaming duration when TTFT data is missing', () => {
      const fastDuration = makeServer({ id: 'srv-fast-dur', lastResponseTime: 100 });
      const slowDuration = makeServer({ id: 'srv-slow-dur', lastResponseTime: 100 });

      const fastMetrics = makeMetrics({
        serverId: 'srv-fast-dur',
        streamingMetrics: makeStreamingMetrics({
          avgTTFT: 0,
          ttftPercentiles: { p50: 0, p95: 0, p99: 0 },
          avgStreamingDuration: 500,
          streamingDurationPercentiles: { p50: 400, p95: 500, p99: 600 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const slowMetrics = makeMetrics({
        serverId: 'srv-slow-dur',
        streamingMetrics: makeStreamingMetrics({
          avgTTFT: 0,
          ttftPercentiles: { p50: 0, p95: 0, p99: 0 },
          avgStreamingDuration: 2000,
          streamingDurationPercentiles: { p50: 1800, p95: 2000, p99: 2200 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [slowDuration, fastDuration],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId => (serverId === 'srv-fast-dur' ? fastMetrics : slowMetrics),
        true
      );

      expect(result?.id).toBe('srv-fast-dur');
    });
  });

  describe('TTFT vs duration weight balance', () => {
    it('balances TTFT and duration using configured weights (ttftWeight=0.6, durationWeight=0.4)', () => {
      const serverA = makeServer({ id: 'srv-ttft-good', lastResponseTime: 50 });
      const serverB = makeServer({ id: 'srv-dur-good', lastResponseTime: 300 });

      const serverAMetrics = makeMetrics({
        serverId: 'srv-ttft-good',
        streamingMetrics: makeStreamingMetrics({
          avgTTFT: 50,
          ttftPercentiles: { p50: 40, p95: 50, p99: 70 },
          avgStreamingDuration: 5000,
          streamingDurationPercentiles: { p50: 4500, p95: 5000, p99: 5500 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const serverBMetrics = makeMetrics({
        serverId: 'srv-dur-good',
        streamingMetrics: makeStreamingMetrics({
          avgTTFT: 300,
          ttftPercentiles: { p50: 250, p95: 300, p99: 400 },
          avgStreamingDuration: 800,
          streamingDurationPercentiles: { p50: 700, p95: 800, p99: 900 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [serverA, serverB],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId => (serverId === 'srv-ttft-good' ? serverAMetrics : serverBMetrics),
        true
      );

      expect(result?.id).toBe('srv-dur-good');
    });
  });

  describe('stall detection', () => {
    it('applies stall penalty when getStalledRequestCount returns non-zero', () => {
      const goodServer = makeServer({ id: 'srv-good', lastResponseTime: 50 });
      const badServer = makeServer({ id: 'srv-bad', lastResponseTime: 50 });

      const baseStreaming = makeStreamingMetrics({
        avgTTFT: 50,
        ttftPercentiles: { p50: 40, p95: 50, p99: 70 },
        avgStreamingDuration: 500,
        streamingDurationPercentiles: { p50: 450, p95: 500, p99: 550 },
      });

      const goodMetrics = makeMetrics({
        serverId: 'srv-good',
        streamingMetrics: baseStreaming as ServerModelMetrics['streamingMetrics'],
      });

      const badMetrics = makeMetrics({
        serverId: 'srv-bad',
        streamingMetrics: baseStreaming as ServerModelMetrics['streamingMetrics'],
      });

      mockInFlightManager.getStalledRequestCount.mockImplementation(serverId => {
        return serverId === 'srv-bad' ? 3 : 0;
      });

      const result = lb.select(
        [badServer, goodServer],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId => (serverId === 'srv-good' ? goodMetrics : badMetrics),
        true
      );

      expect(result?.id).toBe('srv-good');
    });

    it('caps stall penalty at 0.5 (50%) for many stalled requests', () => {
      const goodServer = makeServer({ id: 'srv-good', lastResponseTime: 50 });
      const badServer = makeServer({ id: 'srv-bad', lastResponseTime: 50 });

      const baseStreaming = makeStreamingMetrics({
        avgTTFT: 50,
        ttftPercentiles: { p50: 40, p95: 50, p99: 70 },
        avgStreamingDuration: 500,
        streamingDurationPercentiles: { p50: 450, p95: 500, p99: 550 },
      });

      const goodMetrics = makeMetrics({
        serverId: 'srv-good',
        streamingMetrics: baseStreaming as ServerModelMetrics['streamingMetrics'],
      });

      const badMetrics = makeMetrics({
        serverId: 'srv-bad',
        streamingMetrics: baseStreaming as ServerModelMetrics['streamingMetrics'],
      });

      mockInFlightManager.getStalledRequestCount.mockImplementation(serverId => {
        return serverId === 'srv-bad' ? 10 : 0;
      });

      const result = lb.select(
        [badServer, goodServer],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId => (serverId === 'srv-good' ? goodMetrics : badMetrics),
        true
      );

      expect(result?.id).toBe('srv-good');
    });
  });

  describe('chunk gap penalty', () => {
    it('applies chunk gap penalty when maxChunkGapPercentiles.p95 exceeds threshold', () => {
      const goodServer = makeServer({ id: 'srv-good', lastResponseTime: 50 });
      const gapServer = makeServer({ id: 'srv-gap', lastResponseTime: 50 });

      const baseStreaming = makeStreamingMetrics({
        avgTTFT: 50,
        ttftPercentiles: { p50: 40, p95: 50, p99: 70 },
        avgStreamingDuration: 1000,
        streamingDurationPercentiles: { p50: 900, p95: 1000, p99: 1100 },
        maxChunkGapPercentiles: { p50: 100, p95: 100, p99: 200 },
      });

      const gapStreaming = makeStreamingMetrics({
        avgTTFT: 50,
        ttftPercentiles: { p50: 40, p95: 50, p99: 70 },
        avgStreamingDuration: 1000,
        streamingDurationPercentiles: { p50: 900, p95: 1000, p99: 1100 },
        maxChunkGapPercentiles: { p50: 5000, p95: 8000, p99: 10000 },
      });

      const goodMetrics = makeMetrics({
        serverId: 'srv-good',
        streamingMetrics: baseStreaming as ServerModelMetrics['streamingMetrics'],
      });

      const gapMetrics = makeMetrics({
        serverId: 'srv-gap',
        streamingMetrics: gapStreaming as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [gapServer, goodServer],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId => (serverId === 'srv-good' ? goodMetrics : gapMetrics),
        true
      );

      expect(result?.id).toBe('srv-good');
    });

    it('does not apply chunk gap penalty when below threshold', () => {
      const goodServer = makeServer({ id: 'srv-good', lastResponseTime: 50 });
      const betterTTFTServer = makeServer({ id: 'srv-better', lastResponseTime: 50 });

      const baseStreaming = makeStreamingMetrics({
        avgTTFT: 80,
        ttftPercentiles: { p50: 70, p95: 80, p99: 100 },
        avgStreamingDuration: 1000,
        streamingDurationPercentiles: { p50: 900, p95: 1000, p99: 1100 },
        maxChunkGapPercentiles: { p50: 100, p95: 200, p99: 300 },
      });

      const betterTTFTStreaming = makeStreamingMetrics({
        avgTTFT: 50,
        ttftPercentiles: { p50: 40, p95: 50, p99: 70 },
        avgStreamingDuration: 1000,
        streamingDurationPercentiles: { p50: 900, p95: 1000, p99: 1100 },
        maxChunkGapPercentiles: { p50: 100, p95: 200, p99: 300 },
      });

      const baseMetrics = makeMetrics({
        serverId: 'srv-good',
        streamingMetrics: baseStreaming as ServerModelMetrics['streamingMetrics'],
      });

      const betterMetrics = makeMetrics({
        serverId: 'srv-better',
        streamingMetrics: betterTTFTStreaming as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [goodServer, betterTTFTServer],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId => (serverId === 'srv-better' ? betterMetrics : baseMetrics),
        true
      );

      expect(result?.id).toBe('srv-better');
    });
  });

  describe('load factor adjustment', () => {
    it('load factor increases adjusted TTFT and duration, reducing scores', () => {
      const lowLoadServer = makeServer({
        id: 'srv-low-load',
        lastResponseTime: 80,
        maxConcurrency: 4,
      });
      const highLoadServer = makeServer({
        id: 'srv-high-load',
        lastResponseTime: 80,
        maxConcurrency: 4,
      });

      const streamingMetrics = makeStreamingMetrics({
        avgTTFT: 50,
        ttftPercentiles: { p50: 40, p95: 50, p99: 70 },
        avgStreamingDuration: 500,
        streamingDurationPercentiles: { p50: 450, p95: 500, p99: 550 },
      });

      const lowLoadMetrics = makeMetrics({
        serverId: 'srv-low-load',
        streamingMetrics: streamingMetrics as ServerModelMetrics['streamingMetrics'],
      });

      const highLoadMetrics = makeMetrics({
        serverId: 'srv-high-load',
        streamingMetrics: streamingMetrics as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [highLoadServer, lowLoadServer],
        'llama3:latest',
        serverId => (serverId === 'srv-high-load' ? 3 : 0),
        () => 3,
        serverId => (serverId === 'srv-low-load' ? lowLoadMetrics : highLoadMetrics),
        true
      );

      expect(result?.id).toBe('srv-low-load');
    });

    it('server at max concurrency gets highest load factor', () => {
      const unloaded = makeServer({ id: 'srv-unloaded', lastResponseTime: 80, maxConcurrency: 4 });
      const maxed = makeServer({ id: 'srv-maxed', lastResponseTime: 80, maxConcurrency: 4 });

      const streamingMetrics = makeStreamingMetrics({
        avgTTFT: 100,
        ttftPercentiles: { p50: 80, p95: 100, p99: 120 },
        avgStreamingDuration: 1000,
        streamingDurationPercentiles: { p50: 900, p95: 1000, p99: 1100 },
      });

      const unloadedMetrics = makeMetrics({
        serverId: 'srv-unloaded',
        streamingMetrics: streamingMetrics as ServerModelMetrics['streamingMetrics'],
      });

      const maxedMetrics = makeMetrics({
        serverId: 'srv-maxed',
        streamingMetrics: streamingMetrics as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [maxed, unloaded],
        'llama3:latest',
        serverId => (serverId === 'srv-maxed' ? 4 : 0),
        () => 4,
        serverId => (serverId === 'srv-unloaded' ? unloadedMetrics : maxedMetrics),
        true
      );

      expect(result?.id).toBe('srv-unloaded');
    });
  });

  describe('non-streaming fallback', () => {
    it('falls back to selectFastestResponse when isStreaming=false', () => {
      const lowLatency = makeServer({ id: 'srv-fast', lastResponseTime: 50 });
      const highLatency = makeServer({ id: 'srv-slow', lastResponseTime: 200 });

      const result = lb.select(
        [lowLatency, highLatency],
        'llama3:latest',
        () => 0,
        () => 0,
        () => undefined,
        false
      );

      expect(result?.id).toBe('srv-fast');
    });
  });

  describe('edge cases', () => {
    it('returns undefined when no candidates provided', () => {
      const result = lb.select(
        [],
        'llama3:latest',
        () => 0,
        () => 0,
        () => undefined,
        true
      );
      expect(result).toBeUndefined();
    });

    it('uses lastResponseTime when no metrics available', () => {
      const fastServer = makeServer({ id: 'srv-fast', lastResponseTime: 30 });
      const slowServer = makeServer({ id: 'srv-slow', lastResponseTime: 200 });

      const result = lb.select(
        [slowServer, fastServer],
        'llama3:latest',
        () => 0,
        () => 0,
        () => undefined,
        true
      );

      expect(result?.id).toBe('srv-fast');
    });

    it('blends avgTTFT and p95 TTFT when both are available', () => {
      const server1 = makeServer({ id: 'srv-1', lastResponseTime: 100 });
      const server2 = makeServer({ id: 'srv-2', lastResponseTime: 100 });

      const server1Metrics = makeMetrics({
        serverId: 'srv-1',
        streamingMetrics: makeStreamingMetrics({
          avgTTFT: 100,
          ttftPercentiles: { p50: 80, p95: 50, p99: 150 },
          avgStreamingDuration: 500,
          streamingDurationPercentiles: { p50: 400, p95: 500, p99: 600 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const server2Metrics = makeMetrics({
        serverId: 'srv-2',
        streamingMetrics: makeStreamingMetrics({
          avgTTFT: 50,
          ttftPercentiles: { p50: 30, p95: 100, p99: 150 },
          avgStreamingDuration: 800,
          streamingDurationPercentiles: { p50: 700, p95: 800, p99: 900 },
        }) as ServerModelMetrics['streamingMetrics'],
      });

      const result = lb.select(
        [server1, server2],
        'llama3:latest',
        () => 0,
        () => 0,
        serverId => (serverId === 'srv-1' ? server1Metrics : server2Metrics),
        true
      );

      expect(result?.id).toBe('srv-1');
    });
  });
});
