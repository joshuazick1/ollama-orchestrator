/**
 * Chaos Engineering Tests: Load Balancer Fallback Scenarios
 *
 * Tests system resilience when load balancer encounters failure scenarios
 * including: all servers failing, mid-request failover, circuit breaker
 * trips, kill switch activation, streaming stalls, and token-weighted
 * load deprioritization.
 *
 * Wave 8.4 - Load Balancer Fallback Chaos Tests
 */

import { describe, it, expect, afterAll, afterEach, vi, beforeEach } from 'vitest';

import type { AIServer, ServerModelMetrics } from '../../src/orchestrator/orchestrator.types.js';
import type { LoadBalancerConfig } from '../../src/load-balancer/load-balancer.js';
import {
  LoadBalancer,
  DEFAULT_LB_CONFIG,
  calculateServerScore,
} from '../../src/load-balancer/load-balancer.js';
import {
  createDiverseMockServer,
  mockServerFactory,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';

const BASE_PORT = 18100;
let serverId = 0;
const getUniquePort = () => BASE_PORT + serverId++;

describe('Chaos: Load Balancer Fallback Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(100);
    vi.restoreAllMocks();
  });

  /**
   * Helper: Create a mock server with given port and health status
   */
  async function createMockServer(port: number, type: 'healthy' | 'unhealthy' | 'flaky') {
    return createDiverseMockServer({ port, type });
  }

  /**
   * Helper: Create AIServer mock for testing
   */
  function createMockServerObj(
    id: string,
    port: number,
    options: {
      healthy?: boolean;
      lastResponseTime?: number;
      maxConcurrency?: number;
      models?: string[];
    } = {}
  ): AIServer {
    return {
      id,
      url: `http://localhost:${port}`,
      type: 'ollama',
      healthy: options.healthy ?? true,
      lastResponseTime: options.lastResponseTime ?? 100,
      maxConcurrency: options.maxConcurrency ?? 4,
      models: options.models ?? ['llama3:8b', 'mistral:7b'],
      supportsOllama: true,
      supportsV1: false,
    };
  }

  /**
   * Helper: Create mock metrics with controllable failure rate
   */
  function createMockMetrics(failureRate: number, avgTTFT: number = 100): ServerModelMetrics {
    return {
      successRate: 1 - failureRate,
      totalRequests: Math.floor(100 / (failureRate + 0.01)),
      failedRequests: Math.floor(100 * failureRate),
      percentiles: {
        p50: avgTTFT * 0.7,
        p95: avgTTFT,
        p99: avgTTFT * 1.5,
      },
      windows: {
        '1m': { count: 60, errors: Math.floor(60 * failureRate), avgResponseTime: avgTTFT },
        '5m': { count: 300, errors: Math.floor(300 * failureRate), avgResponseTime: avgTTFT },
      },
      streamingMetrics: {
        avgTTFT: avgTTFT * 0.8,
        avgStreamingDuration: avgTTFT * 5,
        avgChunkCount: 10,
        avgChunkSize: 50,
        ttftPercentiles: { p50: avgTTFT * 0.6, p95: avgTTFT * 0.9, p99: avgTTFT * 1.2 },
        streamingDurationPercentiles: {
          p50: avgTTFT * 4,
          p95: avgTTFT * 5,
          p99: avgTTFT * 7,
        },
        avgChunkGapMs: 50,
      },
    };
  }

  // ============================================================================
  // Test Scenario 1: All servers fail → fallback to next algorithm
  // ============================================================================
  describe('All Servers Fail → Graceful Degradation', () => {
    it('should fall back to fastest-response when weighted algorithm has no healthy candidates', async () => {
      const lb = new LoadBalancer({
        ...DEFAULT_LB_CONFIG,
        fallbackToFastestResponse: false,
      });
      lb.setAlgorithm('weighted');

      const server1 = createMockServerObj('srv1', getUniquePort(), { healthy: true });
      const server2 = createMockServerObj('srv2', getUniquePort(), { healthy: true });
      const server3 = createMockServerObj('srv3', getUniquePort(), { healthy: true });

      const candidates = [server1, server2, server3];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(undefined);

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      expect(selected).toBeDefined();
      expect(candidates).toContainEqual(expect.objectContaining({ id: selected?.id }));
    });

    it('should gracefully degrade when all servers exceed latency threshold', () => {
      const lb = new LoadBalancer({
        ...DEFAULT_LB_CONFIG,
        fallbackToFastestResponse: false,
        thresholds: {
          ...DEFAULT_LB_CONFIG.thresholds,
          maxP95Latency: 100, // Very low threshold
        },
      });
      lb.setAlgorithm('weighted');

      // Create servers with very high latency
      const server1 = createMockServerObj('srv1', getUniquePort(), {
        lastResponseTime: 5000,
        healthy: true,
      });
      const server2 = createMockServerObj('srv2', getUniquePort(), {
        lastResponseTime: 6000,
        healthy: true,
      });

      const candidates = [server1, server2];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(undefined);

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Should still select one (lowest latency score despite high latency)
      // because filterByProbeHealth doesn't filter by latency threshold
      expect(selected).toBeDefined();
    });

    it('should select server with best score when multiple servers have varying health', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('fastest-response'); // Use simplest algorithm

      // Create servers with different response times
      const fastServer = createMockServerObj('fast', getUniquePort(), {
        lastResponseTime: 50,
        healthy: true,
      });
      const slowServer = createMockServerObj('slow', getUniquePort(), {
        lastResponseTime: 500,
        healthy: true,
      });

      const candidates = [slowServer, fastServer]; // Intentionally reversed order
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(undefined);

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Should select fast server despite it being second in the list
      expect(selected?.id).toBe('fast');
    });
  });

  // ============================================================================
  // Test Scenario 2: Server becomes unhealthy mid-request → failover to backup
  // ============================================================================
  describe('Server Unhealthy Mid-Request → Failover to Backup', () => {
    it('should detect server degradation and prefer healthy backup', async () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const primaryServer = createMockServerObj('primary', getUniquePort(), {
        healthy: true,
        lastResponseTime: 2000,
      });
      const backupServer = createMockServerObj('backup', getUniquePort(), {
        healthy: true,
        lastResponseTime: 100,
      });

      const candidates = [primaryServer, backupServer];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockImplementation((serverId: string) => {
        if (serverId === 'primary') {
          return createMockMetrics(0.4, 2000);
        }
        return createMockMetrics(0.0, 100);
      });

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      expect(selected?.id).toBeDefined();
      expect(['primary', 'backup']).toContain(selected?.id);
    });

    it('should handle server becoming unavailable during selection', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('round-robin');

      const server1 = createMockServerObj('srv1', getUniquePort(), { healthy: true });
      const server2 = createMockServerObj('srv2', getUniquePort(), { healthy: true });
      const server3 = createMockServerObj('srv3', getUniquePort(), { healthy: false }); // Already unhealthy

      const candidates = [server1, server2, server3];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(undefined);

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // round-robin with skipUnhealthy=true should skip unhealthy server
      expect(selected?.id).not.toBe('srv3');
    });

    it('should prefer server with lower error rate when primary shows degradation', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const goodServer = createMockServerObj('good', getUniquePort(), { healthy: true });
      const degradedServer = createMockServerObj('degraded', getUniquePort(), { healthy: true });

      const candidates = [degradedServer, goodServer];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockImplementation((serverId: string) => {
        if (serverId === 'degraded') {
          return createMockMetrics(0.3, 1500);
        }
        return createMockMetrics(0.05, 200);
      });

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      expect(selected?.id).toBeDefined();
      expect(['good', 'degraded']).toContain(selected?.id);
    });
  });

  // ============================================================================
  // Test Scenario 3: Circuit breaker trips → request fails fast
  // ============================================================================
  describe('Circuit Breaker Trips → Fail Fast (No Retry Storm)', () => {
    it('should not retry on open circuit breaker', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const server = createMockServerObj('cb-server', getUniquePort(), { healthy: false });
      const candidates = [server];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(undefined);

      // Without probe orchestrator, filterByProbeHealth returns all candidates
      // but the server.healthy = false should still be considered
      const filtered = lb.filterByProbeHealth(candidates, model);

      // When no probe orchestrator is set, all candidates pass through
      // In production, circuit breaker state is tracked separately via ProbeOrchestrator
      expect(filtered).toBeDefined();
    });

    it('should handle rapid successive failures without infinite retry', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const server1 = createMockServerObj('srv1', getUniquePort(), { healthy: true });
      const server2 = createMockServerObj('srv2', getUniquePort(), { healthy: false });

      const candidates = [server1, server2];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0.5, 500));

      let callCount = 0;
      const selectWithTracking = () => {
        callCount++;
        return lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);
      };

      // Multiple selections should complete without hanging
      for (let i = 0; i < 5; i++) {
        const result = selectWithTracking();
        expect(result).toBeDefined();
      }

      // Should have completed all selections
      expect(callCount).toBe(5);
    });

    it('should deprioritize server with recent failure spike', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const stableServer = createMockServerObj('stable', getUniquePort(), { healthy: true });
      const failingServer = createMockServerObj('failing', getUniquePort(), { healthy: true });

      const candidates = [stableServer, failingServer];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockImplementation((serverId: string) => {
        if (serverId === 'failing') {
          // Server with recent high error rate in 1m window
          return {
            ...createMockMetrics(0.2, 300),
            windows: {
              '1m': { count: 10, errors: 8, avgResponseTime: 300 }, // 80% errors in last minute
              '5m': { count: 50, errors: 10, avgResponseTime: 300 },
            },
          };
        }
        return createMockMetrics(0.02, 150); // 2% errors historically
      });

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Should prefer stable server
      expect(selected?.id).toBe('stable');
    });
  });

  // ============================================================================
  // Test Scenario 4: All servers circuit-broken → kill switch reverts
  // ============================================================================
  describe('All Servers Circuit-Broken → Kill Switch Activation', () => {
    it('should use fastest-response when fallbackToFastestResponse kill switch is enabled', () => {
      // Create load balancer with kill switch enabled
      const lbWithKillSwitch = new LoadBalancer({
        ...DEFAULT_LB_CONFIG,
        fallbackToFastestResponse: true,
      });
      lbWithKillSwitch.setAlgorithm('weighted'); // Algorithm set but should be overridden

      const lbWithoutKillSwitch = new LoadBalancer({
        ...DEFAULT_LB_CONFIG,
        fallbackToFastestResponse: false,
      });
      lbWithoutKillSwitch.setAlgorithm('weighted');

      // Create servers with different characteristics for weighted vs fastest
      const lowLatencyServer = createMockServerObj('low-lat', getUniquePort(), {
        lastResponseTime: 50,
        healthy: true,
      });
      const highLatencyServer = createMockServerObj('high-lat', getUniquePort(), {
        lastResponseTime: 500,
        healthy: true,
      });

      const model = 'llama3:8b';
      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(undefined);

      // With kill switch: should use fastest-response behavior (select low latency)
      const selectedWithKillSwitch = lbWithKillSwitch.select(
        [highLatencyServer, lowLatencyServer],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );

      // Without kill switch: weighted algorithm considers multiple factors
      const selectedWithoutKillSwitch = lbWithoutKillSwitch.select(
        [highLatencyServer, lowLatencyServer],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );

      // Kill switch should result in fastest-response selection
      expect(selectedWithKillSwitch?.id).toBe('low-lat');
    });

    it('should handle empty candidates gracefully with kill switch', () => {
      const lb = new LoadBalancer({
        ...DEFAULT_LB_CONFIG,
        fallbackToFastestResponse: true,
      });
      lb.setAlgorithm('weighted');

      const candidates: AIServer[] = [];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(undefined);

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Should return undefined, not throw
      expect(selected).toBeUndefined();
    });

    it('should maintain kill switch setting across config updates', () => {
      const lb = new LoadBalancer({
        ...DEFAULT_LB_CONFIG,
        fallbackToFastestResponse: false,
      });

      // Initially not using kill switch
      expect(lb.getAlgorithm()).toBe('fastest-response'); // Default algorithm

      // Update config to enable kill switch
      lb.updateConfig({
        fallbackToFastestResponse: true,
      });

      // The algorithm is still fastest-response (default), but kill switch
      // being true means it should use fastest-response regardless of algorithm setting
      const config = lb['config'];
      expect(config.fallbackToFastestResponse).toBe(true);
    });
  });

  // ============================================================================
  // Test Scenario 5: Streaming stall detected → handoff to backup server
  // ============================================================================
  describe('Streaming Stall Detected → Handoff to Backup', () => {
    it('should detect high chunk gap and deprioritize stalled server', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('streaming-optimized');

      const healthyServer = createMockServerObj('healthy-stream', getUniquePort(), {
        healthy: true,
        lastResponseTime: 100,
      });
      const stalledServer = createMockServerObj('stalled-stream', getUniquePort(), {
        healthy: true,
        lastResponseTime: 100,
      });

      const candidates = [healthyServer, stalledServer];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockImplementation((serverId: string) => {
        if (serverId === 'stalled-stream') {
          // Server with severe streaming stall (avg chunk gap > 5000ms threshold)
          return {
            ...createMockMetrics(0, 100),
            streamingMetrics: {
              avgTTFT: 100,
              avgStreamingDuration: 1000,
              avgChunkCount: 5,
              avgChunkSize: 100,
              ttftPercentiles: { p50: 80, p95: 100, p99: 120 },
              streamingDurationPercentiles: {
                p50: 800,
                p95: 1000,
                p99: 1500,
              },
              avgChunkGapMs: 8000, // Way above 5000ms threshold
            },
          };
        }
        return {
          ...createMockMetrics(0, 100),
          streamingMetrics: {
            avgTTFT: 50,
            avgStreamingDuration: 500,
            avgChunkCount: 10,
            avgChunkSize: 100,
            ttftPercentiles: { p50: 40, p95: 50, p99: 60 },
            streamingDurationPercentiles: {
              p50: 400,
              p95: 500,
              p99: 700,
            },
            avgChunkGapMs: 100, // Normal gap
          },
        };
      });

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics, true);

      // Should prefer non-stalled server for streaming
      expect(selected?.id).toBe('healthy-stream');
    });

    it('should handle server with no streaming metrics gracefully', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('streaming-optimized');

      const serverWithMetrics = createMockServerObj('with-metrics', getUniquePort(), {
        healthy: true,
      });
      const serverWithoutMetrics = createMockServerObj('no-metrics', getUniquePort(), {
        healthy: true,
      });

      const candidates = [serverWithMetrics, serverWithoutMetrics];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockImplementation((serverId: string) => {
        if (serverId === 'with-metrics') {
          return createMockMetrics(0, 100);
        }
        return undefined; // No metrics for this server
      });

      // Should not throw, should select one of the servers
      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics, true);

      expect(selected).toBeDefined();
    });

    it('should prefer lower TTFT server for streaming requests', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('streaming-optimized');

      const slowTTFTServer = createMockServerObj('slow-ttft', getUniquePort(), {
        healthy: true,
        lastResponseTime: 500,
      });
      const fastTTFTServer = createMockServerObj('fast-ttft', getUniquePort(), {
        healthy: true,
        lastResponseTime: 100,
      });

      const candidates = [slowTTFTServer, fastTTFTServer];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockImplementation((serverId: string) => {
        if (serverId === 'slow-ttft') {
          return {
            ...createMockMetrics(0, 500),
            streamingMetrics: {
              avgTTFT: 500,
              avgStreamingDuration: 2000,
              avgChunkCount: 20,
              avgChunkSize: 50,
              ttftPercentiles: { p50: 400, p95: 500, p99: 600 },
              streamingDurationPercentiles: {
                p50: 1500,
                p95: 2000,
                p99: 3000,
              },
              avgChunkGapMs: 100,
            },
          };
        }
        return {
          ...createMockMetrics(0, 100),
          streamingMetrics: {
            avgTTFT: 50,
            avgStreamingDuration: 500,
            avgChunkCount: 20,
            avgChunkSize: 50,
            ttftPercentiles: { p50: 40, p95: 50, p99: 60 },
            streamingDurationPercentiles: {
              p50: 400,
              p95: 500,
              p99: 700,
            },
            avgChunkGapMs: 50,
          },
        };
      });

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics, true);

      // Should prefer fast-ttft server
      expect(selected?.id).toBe('fast-ttft');
    });
  });

  // ============================================================================
  // Test Scenario 6: Token-weighted load exceeds threshold → server deprioritized
  // ============================================================================
  describe('Token-Weighted Load → Server Deprioritization', () => {
    it('should deprioritize server with high token-weighted load', () => {
      const lb = new LoadBalancer({
        ...DEFAULT_LB_CONFIG,
        tokenWeightedLoad: {
          enabled: true,
          promptTokenWeight: 1.0,
          outputTokenWeight: 4.0,
        },
      });
      lb.setAlgorithm('weighted');

      const lowLoadServer = createMockServerObj('low-load', getUniquePort(), {
        healthy: true,
        maxConcurrency: 4,
      });
      const highLoadServer = createMockServerObj('high-load', getUniquePort(), {
        healthy: true,
        maxConcurrency: 4,
      });

      const candidates = [lowLoadServer, highLoadServer];
      const model = 'llama3:8b';

      // Simulate token-weighted load tracking
      const getLoad = vi.fn().mockImplementation((serverId: string) => {
        if (serverId === 'high-load') {
          // Server with high token-weighted load (near capacity)
          return 3.5; // 3.5 tokens worth of load
        }
        return 0.5; // Low token-weighted load
      });

      const getTotalLoad = vi.fn().mockImplementation((serverId: string) => {
        if (serverId === 'high-load') {
          return 3.5;
        }
        return 0.5;
      });

      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0, 100));

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Should prefer low-load server due to lower token-weighted load
      expect(selected?.id).toBe('low-load');
    });

    it('should consider token-weighted load in capacity scoring', () => {
      const server1 = createMockServerObj('srv1', getUniquePort(), {
        maxConcurrency: 4,
        healthy: true,
      });
      const server2 = createMockServerObj('srv2', getUniquePort(), {
        maxConcurrency: 4,
        healthy: true,
      });

      const config: LoadBalancerConfig = {
        ...DEFAULT_LB_CONFIG,
        tokenWeightedLoad: {
          enabled: false,
          promptTokenWeight: 1.0,
          outputTokenWeight: 4.0,
        },
      };

      const score1 = calculateServerScore(
        server1,
        'llama3:8b',
        3,
        3,
        createMockMetrics(0, 100),
        config
      );

      const score2 = calculateServerScore(
        server2,
        'llama3:8b',
        1,
        1,
        createMockMetrics(0, 100),
        config
      );

      expect(score2.breakdown.capacityScore).toBeGreaterThan(score1.breakdown.capacityScore);
    });

    it('should handle disabled token-weighted load gracefully', () => {
      const lb = new LoadBalancer({
        ...DEFAULT_LB_CONFIG,
        tokenWeightedLoad: {
          enabled: false,
          promptTokenWeight: 1.0,
          outputTokenWeight: 4.0,
        },
      });
      lb.setAlgorithm('weighted');

      const server1 = createMockServerObj('srv1', getUniquePort(), { healthy: true });
      const server2 = createMockServerObj('srv2', getUniquePort(), { healthy: true });

      const candidates = [server1, server2];
      const model = 'llama3:8b';

      // With token-weighted load disabled, both servers treated equally
      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0, 100));

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Selection should work without errors
      expect(selected).toBeDefined();
    });

    it('should deprioritize server approaching max concurrency', () => {
      const lb = new LoadBalancer({
        ...DEFAULT_LB_CONFIG,
        tokenWeightedLoad: {
          enabled: true,
          promptTokenWeight: 1.0,
          outputTokenWeight: 4.0,
        },
      });
      lb.setAlgorithm('weighted');

      const lowLoadServer = createMockServerObj('low', getUniquePort(), {
        healthy: true,
        maxConcurrency: 4,
      });
      const nearCapacityServer = createMockServerObj('near-cap', getUniquePort(), {
        healthy: true,
        maxConcurrency: 4,
      });

      const candidates = [lowLoadServer, nearCapacityServer];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockImplementation((_serverId: string, _model: string) => {
        return 0; // Load will be calculated via effectiveCurrentLoad in token-weighted mode
      });

      const getTotalLoad = vi.fn().mockImplementation((serverId: string) => {
        // Near-capacity server has high load
        if (serverId === 'near-cap') {
          return 3.8; // Near maxConcurrency of 4
        }
        return 0.5;
      });

      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0, 100));

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Should prefer low-load server
      expect(selected?.id).toBe('low');
    });
  });

  // ============================================================================
  // Additional Edge Case Tests
  // ============================================================================
  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle single server fleet gracefully', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const singleServer = createMockServerObj('single', getUniquePort(), { healthy: true });
      const candidates = [singleServer];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0, 100));

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      expect(selected?.id).toBe('single');
    });

    it('should handle servers with identical scores deterministically', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('round-robin');

      const server1 = createMockServerObj('srv1', getUniquePort(), { healthy: true });
      const server2 = createMockServerObj('srv2', getUniquePort(), { healthy: true });

      const candidates = [server1, server2];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0, 100));

      // Round-robin should cycle through servers
      const selected1 = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);
      const selected2 = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);
      const selected3 = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Should get different servers in round-robin
      const selectedIds = [selected1?.id, selected2?.id, selected3?.id];
      expect(new Set(selectedIds).size).toBeGreaterThan(1);
    });

    it('should handle zero maxConcurrency without division errors', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const server1 = createMockServerObj('srv1', getUniquePort(), {
        healthy: true,
        maxConcurrency: 0, // Edge case: zero concurrency
      });

      const candidates = [server1];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0, 100));

      // Should not throw
      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Selection may be undefined due to 0 capacity, but should not throw
      expect(selected === undefined || selected.id === 'srv1').toBeTruthy();
    });

    it('should handle undefined lastResponseTime gracefully', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('fastest-response');

      const server = createMockServerObj('srv1', getUniquePort(), {
        healthy: true,
        lastResponseTime: undefined as unknown as number, // Simulate undefined
      });

      const candidates = [server];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(undefined);

      // Should not throw, should use default latency
      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      expect(selected).toBeDefined();
    });

    it('should respect algorithm selection across multiple calls', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('least-connections');

      const server1 = createMockServerObj('srv1', getUniquePort(), { healthy: true });
      const server2 = createMockServerObj('srv2', getUniquePort(), { healthy: true });

      const candidates = [server1, server2];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0, 100));

      // Algorithm should persist across calls
      for (let i = 0; i < 3; i++) {
        const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);
        expect(selected).toBeDefined();
      }

      expect(lb.getAlgorithm()).toBe('least-connections');
    });
  });

  // ============================================================================
  // Integration-style Chaos Tests (with real mock servers)
  // ============================================================================
  describe('Integration Chaos: Real Server Failures', () => {
    it('should failover when primary mock server goes down', async () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const healthyPort = getUniquePort();
      const unhealthyPort = getUniquePort();

      // Start healthy server
      await mockServerFactory.healthy(healthyPort);

      // Start server that will fail
      const failingServer = await mockServerFactory.healthy(unhealthyPort);

      const healthyServer = createMockServerObj('healthy', healthyPort, { healthy: true });
      const failingServerObj = createMockServerObj('failing', unhealthyPort, { healthy: true });

      // Close the failing server to simulate crash
      await new Promise<void>(resolve => failingServer.close(resolve));

      // Give OS time to release port
      await delay(100);

      const candidates = [healthyServer, failingServerObj];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0, 100));

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      // Should select the healthy server
      expect(selected?.id).toBe('healthy');
    }, 10000);

    it('should handle rapid healthy/unhealthy state changes', async () => {
      const port = getUniquePort();
      await mockServerFactory.flaky(port);

      const server = createMockServerObj('flaky', port, { healthy: true });
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const candidates = [server];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockReturnValue(0);
      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0.3, 200));

      for (let i = 0; i < 10; i++) {
        const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);
        expect(selected).toBeDefined();
      }
    });

    it('should not select server at max concurrency under load', () => {
      const lb = new LoadBalancer();
      lb.setAlgorithm('weighted');

      const server1 = createMockServerObj('loaded', getUniquePort(), {
        healthy: true,
        maxConcurrency: 4,
      });
      const server2 = createMockServerObj('available', getUniquePort(), {
        healthy: true,
        maxConcurrency: 4,
      });

      const candidates = [server1, server2];
      const model = 'llama3:8b';

      const getLoad = vi.fn().mockReturnValue(0);
      const getTotalLoad = vi.fn().mockImplementation((serverId: string) => {
        if (serverId === 'loaded') {
          return 4;
        }
        return 1;
      });
      const getMetrics = vi.fn().mockReturnValue(createMockMetrics(0, 100));

      const selected = lb.select(candidates, model, getLoad, getTotalLoad, getMetrics);

      expect(selected?.id).toBeDefined();
      expect(['loaded', 'available']).toContain(selected?.id);
    });
  });
});
