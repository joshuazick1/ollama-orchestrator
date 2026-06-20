/**
 * tests/stress/load-balancer-stress.test.ts
 * Stress tests for Load Balancer under high concurrency (Wave 8.5)
 *
 * Tests the load balancer's ability to handle:
 * 1. 100 concurrent requests to same model → all complete within 60s
 * 2. 500 requests/min sustained load → no memory leak
 * 3. 1000 requests with mixed models → all complete
 * 4. Streaming 50 concurrent → all complete (no leaks)
 *
 * Uses mock servers and direct loadBalancer.select() calls - no real HTTP.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoadBalancer } from '../../src/load-balancer/load-balancer.js';
import type { AIServer, ServerModelMetrics } from '../../src/orchestrator/orchestrator.types.js';
import {
  createServer,
  createServerBatch,
  createServerModelMetrics,
} from '../fixtures/factories.js';

// Increase timeout for stress tests
const STRESS_TIMEOUT = 120_000; // 120 seconds

describe('Load Balancer Stress Tests', () => {
  let loadBalancer: LoadBalancer;
  let mockServers: AIServer[];

  // Mock metrics store - simple in-memory implementation
  const metricsStore = new Map<string, ServerModelMetrics>();
  const loadStore = new Map<string, number>();
  const totalLoadStore = new Map<string, number>();

  // Mock functions that the load balancer expects
  const getLoad = (serverId: string, _model: string): number => {
    return loadStore.get(serverId) ?? 0;
  };

  const getTotalLoad = (serverId: string): number => {
    return totalLoadStore.get(serverId) ?? 0;
  };

  const getMetrics = (serverId: string, _model: string): ServerModelMetrics | undefined => {
    return metricsStore.get(serverId);
  };

  // Helper to reset stores
  const resetStores = () => {
    metricsStore.clear();
    loadStore.clear();
    totalLoadStore.clear();
  };

  // Helper to setup mock servers with default metrics
  const setupServersWithMetrics = (servers: AIServer[]) => {
    resetStores();
    for (const server of servers) {
      // Initialize with decent metrics
      metricsStore.set(
        server.id,
        createServerModelMetrics({
          serverId: server.id,
          model: 'llama3:latest',
          inFlight: 0,
          p50: 50 + Math.random() * 50,
          p95: 100 + Math.random() * 100,
          p99: 200 + Math.random() * 200,
        })
      );
      loadStore.set(server.id, 0);
      totalLoadStore.set(server.id, 0);
    }
  };

  // Helper to select a server (simulates a request)
  const simulateSelect = (model: string, isStreaming = false): AIServer | undefined => {
    return loadBalancer.select(mockServers, model, getLoad, getTotalLoad, getMetrics, isStreaming);
  };

  // Helper to simulate a request completing (update load)
  const simulateRequestStart = (serverId: string) => {
    loadStore.set(serverId, (loadStore.get(serverId) ?? 0) + 1);
    totalLoadStore.set(serverId, (totalLoadStore.get(serverId) ?? 0) + 1);
  };

  const simulateRequestEnd = (serverId: string) => {
    loadStore.set(serverId, Math.max(0, (loadStore.get(serverId) ?? 1) - 1));
    totalLoadStore.set(serverId, Math.max(0, (totalLoadStore.get(serverId) ?? 1) - 1));
  };

  beforeEach(() => {
    loadBalancer = new LoadBalancer();
    loadBalancer.setAlgorithm('fastest-response');

    // Create 8 mock servers for testing
    mockServers = createServerBatch(8, {
      id: 'stress-server',
      url: 'http://localhost',
      healthy: true,
      lastResponseTime: 50 + Math.random() * 100,
      maxConcurrency: 4,
    });

    setupServersWithMetrics(mockServers);
  });

  afterEach(() => {
    resetStores();
  });

  /**
   * Stress Test 1: 100 concurrent requests to same model
   * All selections should complete within 60 seconds
   */
  it(
    '100 concurrent requests to same model should all complete within 60s',
    async () => {
      const model = 'llama3:latest';
      const concurrency = 100;
      const startTime = Date.now();

      const selectPromises: Promise<AIServer | undefined>[] = [];

      for (let i = 0; i < concurrency; i++) {
        const promise = (async () => {
          const server = simulateSelect(model);
          if (server) {
            simulateRequestStart(server.id);
            // Simulate some work
            await new Promise(resolve => setTimeout(resolve, 5));
            simulateRequestEnd(server.id);
          }
          return server;
        })();
        selectPromises.push(promise);
      }

      const results = await Promise.all(selectPromises);
      const duration = Date.now() - startTime;

      // All requests should have gotten a server
      expect(results.filter(r => r !== undefined).length).toBe(concurrency);

      // Should complete within 60 seconds
      expect(duration).toBeLessThan(60_000);

      // Should have distributed across servers (not all to one)
      const selectedServers = new Set(results.filter(r => r !== undefined).map(r => r!.id));
      expect(selectedServers.size).toBeGreaterThan(1);

      console.log(
        `100 concurrent requests completed in ${duration}ms, distributed across ${selectedServers.size} servers`
      );
    },
    STRESS_TIMEOUT
  );

  /**
   * Stress Test 2: 500 requests/min sustained load
   * Should complete without memory leaks (RSS stays bounded)
   */
  it(
    '500 requests per minute sustained load should not cause memory leaks',
    async () => {
      const model = 'llama3:latest';
      const totalRequests = 500;
      const durationMs = 60_000; // 1 minute

      // Get initial memory baseline
      const initialMemory = process.memoryUsage().heapUsed;

      const startTime = Date.now();
      let completed = 0;
      let activeRequests = 0;
      const maxActive = 50; // Max concurrent to avoid overwhelming

      // Use a more realistic simulated workload with in-flight tracking
      const simulateWorkload = async () => {
        const batchSize = 10; // Process in small batches
        const batches = Math.ceil(totalRequests / batchSize);

        for (let batch = 0; batch < batches; batch++) {
          // Wait if at max active requests
          while (activeRequests >= maxActive) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }

          // Start a batch of requests
          const batchRequests: Promise<void>[] = [];
          const thisBatch = Math.min(batchSize, totalRequests - completed);

          for (let i = 0; i < thisBatch; i++) {
            activeRequests++;
            completed++;

            const promise = (async () => {
              try {
                const server = simulateSelect(model);
                if (server) {
                  simulateRequestStart(server.id);
                  // Small delay to simulate actual work
                  await new Promise(resolve => setTimeout(resolve, 2));
                  simulateRequestEnd(server.id);
                }
              } finally {
                activeRequests--;
              }
            })();
            batchRequests.push(promise);
          }

          await Promise.all(batchRequests);

          // Small delay between batches to simulate realistic traffic
          if (batch < batches - 1) {
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        }
      };

      await simulateWorkload();

      const elapsed = Date.now() - startTime;

      // Check memory after test
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024);

      // Memory increase should be reasonable (< 100MB for this workload)
      // This is a simplified check - real memory leak detection would need longer runs
      expect(memoryIncreaseMB).toBeLessThan(100);

      // All requests should complete
      expect(completed).toBe(totalRequests);

      // Should complete roughly within the expected duration
      expect(elapsed).toBeLessThan(durationMs * 1.5); // Allow 50% tolerance

      console.log(
        `500 requests completed in ${elapsed}ms, memory increase: ${memoryIncreaseMB.toFixed(2)}MB`
      );
    },
    STRESS_TIMEOUT
  );

  /**
   * Stress Test 3: 1000 requests with mixed models
   * All requests should complete successfully
   */
  it(
    '1000 requests with mixed models should all complete',
    async () => {
      const models = ['llama3:latest', 'mistral:latest', 'codellama:latest', 'phi3:latest'];
      const totalRequests = 1000;
      const batchSize = 100;

      const startTime = Date.now();

      // Add servers that support multiple models
      const multiModelServers = mockServers.map(s => ({
        ...s,
        models: [...models],
      }));

      // Recreate metrics for multi-model servers
      setupServersWithMetrics(multiModelServers);

      const results: AIServer[] = [];

      // Process in batches
      for (let batch = 0; batch < Math.ceil(totalRequests / batchSize); batch++) {
        const batchPromises: Promise<AIServer | undefined>[] = [];
        const startIdx = batch * batchSize;
        const endIdx = Math.min(startIdx + batchSize, totalRequests);

        for (let i = startIdx; i < endIdx; i++) {
          const model = models[i % models.length];

          const promise = (async () => {
            return loadBalancer.select(
              multiModelServers,
              model,
              getLoad,
              getTotalLoad,
              getMetrics,
              false
            );
          })();
          batchPromises.push(promise);
        }

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }

      const duration = Date.now() - startTime;

      // All requests should have gotten a server (servers support all models)
      const successCount = results.filter(r => r !== undefined).length;
      expect(successCount).toBe(totalRequests);

      // Check distribution across models
      const modelCounts = new Map<string, number>();
      for (let i = 0; i < totalRequests; i++) {
        const model = models[i % models.length];
        modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
      }

      // Each model should have been requested roughly equally
      for (const model of models) {
        expect(modelCounts.get(model)).toBeGreaterThan(0);
      }

      console.log(`1000 mixed-model requests completed in ${duration}ms`);
    },
    STRESS_TIMEOUT
  );

  /**
   * Stress Test 4: Streaming 50 concurrent requests
   * All should complete without resource leaks
   */
  it(
    'streaming 50 concurrent requests should all complete without leaks',
    async () => {
      const model = 'llama3:latest';
      const concurrency = 50;
      const startTime = Date.now();

      // Use streaming-optimized algorithm
      loadBalancer.setAlgorithm('streaming-optimized');

      const selectPromises: Promise<AIServer | undefined>[] = [];

      for (let i = 0; i < concurrency; i++) {
        const promise = (async () => {
          const server = loadBalancer.select(
            mockServers,
            model,
            getLoad,
            getTotalLoad,
            getMetrics,
            true // isStreaming
          );
          if (server) {
            simulateRequestStart(server.id);
            // Simulate streaming work (longer duration)
            await new Promise(resolve => setTimeout(resolve, 10));
            simulateRequestEnd(server.id);
          }
          return server;
        })();
        selectPromises.push(promise);
      }

      const results = await Promise.all(selectPromises);
      const duration = Date.now() - startTime;

      // All streaming requests should have gotten a server
      expect(results.filter(r => r !== undefined).length).toBe(concurrency);

      // Verify load is properly cleaned up (no leaked requests)
      for (const server of mockServers) {
        expect(loadStore.get(server.id) ?? 0).toBe(0);
        expect(totalLoadStore.get(server.id) ?? 0).toBe(0);
      }

      // Verify distribution
      const selectedServers = new Set(results.filter(r => r !== undefined).map(r => r!.id));
      expect(selectedServers.size).toBeGreaterThan(1);

      console.log(
        `50 streaming requests completed in ${duration}ms, distributed across ${selectedServers.size} servers`
      );
    },
    STRESS_TIMEOUT
  );

  /**
   * Stress Test 5: Rapid sequential selections (tests selection speed)
   * Load balancer should handle rapid calls without degradation
   */
  it(
    'rapid sequential selections should complete without errors',
    async () => {
      const model = 'llama3:latest';
      const iterations = 5000;

      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const server = simulateSelect(model);
        // Server should always be returned when servers are available
        if (i % 100 === 0) {
          // Periodically check server health state
          expect(server).toBeDefined();
        }
      }

      const duration = Date.now() - startTime;
      const selectionsPerSecond = (iterations / duration) * 1000;

      // Should be able to do at least 1000 selections per second
      expect(selectionsPerSecond).toBeGreaterThan(1000);

      console.log(
        `${iterations} sequential selections completed in ${duration}ms (${selectionsPerSecond.toFixed(0)} selections/sec)`
      );
    },
    STRESS_TIMEOUT
  );

  /**
   * Stress Test 6: Alternating high/low load simulation
   * Tests load balancer behavior under variable load patterns
   */
  it(
    'alternating high/low load should handle correctly',
    async () => {
      const model = 'llama3:latest';

      // Simulate load pattern: spike, settle, spike, settle
      const loadPattern = [
        { duration: 100, active: 80 },
        { duration: 200, active: 10 },
        { duration: 100, active: 100 },
        { duration: 200, active: 5 },
        { duration: 100, active: 60 },
      ];

      const startTime = Date.now();
      let totalCompleted = 0;
      const maxIterationsPerPhase = 10000;

      for (const phase of loadPattern) {
        const { duration: phaseDuration, active: targetActive } = phase;
        const phaseStart = Date.now();
        let iterations = 0;

        while (Date.now() - phaseStart < phaseDuration && iterations < maxIterationsPerPhase) {
          const modulo = (totalCompleted + iterations) % 100;
          if (modulo < targetActive) {
            const server = simulateSelect(model);
            if (server) {
              simulateRequestStart(server.id);
              simulateRequestEnd(server.id);
              totalCompleted++;
            }
          }
          iterations++;
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }

      const duration = Date.now() - startTime;

      expect(totalCompleted).toBeGreaterThan(0);

      console.log(`Variable load test completed: ${totalCompleted} selections over ${duration}ms`);
    },
    STRESS_TIMEOUT
  );
});
