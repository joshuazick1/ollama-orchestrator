/**
 * Chaos Engineering Tests: Load Spike Scenarios
 *
 * Tests system behavior when load suddenly increases dramatically,
 * including queue management, backpressure, and performance degradation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Server } from 'http';
import {
  createDiverseMockServer,
  mockServerFactory,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';

// Test ports range to avoid conflicts
const BASE_PORT = 11700;
let servers: Server[] = [];

describe('Chaos: Load Spike Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  beforeEach(async () => {
    // Clean up servers from previous test
    await cleanupMockServers();
    servers = [];
  });

  describe('Sudden Load Increases', () => {
    it('should handle sudden spike in concurrent requests', async () => {
      const server = await mockServerFactory.healthy(BASE_PORT);
      servers.push(server);

      // Start with normal load (5 concurrent requests)
      const normalLoadPromises = Array.from({ length: 5 }, () =>
        fetch(`http://localhost:${BASE_PORT}/api/tags`)
      );

      const normalResults = await Promise.all(normalLoadPromises);
      expect(normalResults.every(r => r.ok)).toBe(true);

      // Sudden spike: 50 concurrent requests
      const spikeLoadPromises = Array.from({ length: 50 }, () =>
        fetch(`http://localhost:${BASE_PORT}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        })
      );

      const spikeStart = Date.now();
      const spikeResults = await Promise.allSettled(spikeLoadPromises);
      const spikeDuration = Date.now() - spikeStart;

      const fulfilled = spikeResults.filter(r => r.status === 'fulfilled').length;
      const rejected = spikeResults.filter(r => r.status === 'rejected').length;

      // Should handle the load, though some may be slower
      expect(fulfilled).toBeGreaterThan(0);
      expect(spikeDuration).toBeLessThan(10000); // Should complete within reasonable time
    });

    it('should handle gradual load ramp-up', async () => {
      const server = await mockServerFactory.healthy(BASE_PORT);
      servers.push(server);

      const latencies: number[] = [];
      const successRates: number[] = [];

      // Gradually increase load: 1, 5, 10, 20, 50 concurrent requests
      const loadLevels = [1, 5, 10, 20, 50];

      for (const load of loadLevels) {
        const start = Date.now();
        const promises = Array.from({ length: load }, () =>
          fetch(`http://localhost:${BASE_PORT}/api/tags`, {
            signal: AbortSignal.timeout(10000),
          })
            .then(res => res.ok)
            .catch(() => false)
        );

        const results = await Promise.all(promises);
        const duration = Date.now() - start;

        latencies.push(duration);
        successRates.push(results.filter(r => r).length / load);

        // Brief pause between load levels
        await delay(100);
      }

      // Verify that performance degrades gracefully
      // Early loads should be faster than later heavy loads
      expect(latencies[0]).toBeLessThan(latencies[latencies.length - 1]);
      // But success rate should remain high
      expect(successRates.every(rate => rate > 0.8)).toBe(true);
    });
  });

  describe('Queue Behavior Under Load', () => {
    it('should handle queue overflow scenarios', async () => {
      // Create a slow server to simulate backpressure
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 1000, // 1 second per request
      });
      servers.push(server);

      // Flood with requests that exceed server capacity
      const requestCount = 100;
      const promises = Array.from({ length: requestCount }, () =>
        fetch(`http://localhost:${BASE_PORT}/api/tags`, {
          signal: AbortSignal.timeout(3000), // Timeout before server can respond
        })
      );

      const start = Date.now();
      const results = await Promise.allSettled(promises);
      const duration = Date.now() - start;

      const fulfilled = results.filter(r => r.status === 'fulfilled').length;
      const rejected = results.filter(r => r.status === 'rejected').length;

      // Should have some successes and some timeouts
      expect(fulfilled).toBeGreaterThan(0);
      expect(rejected).toBeGreaterThan(0);
      expect(fulfilled + rejected).toBe(requestCount);

      // Total duration should be reasonable (not all requests timing out immediately)
      expect(duration).toBeGreaterThan(1000);
      expect(duration).toBeLessThan(15000);
    });

    it('should handle bursty traffic patterns', async () => {
      const server = await mockServerFactory.healthy(BASE_PORT);
      servers.push(server);

      const allResults: Array<{ success: boolean; latency: number; batch: number }> = [];

      // Simulate bursty traffic: periods of high load separated by quiet periods
      for (let burst = 0; burst < 5; burst++) {
        // Burst: 20 concurrent requests
        const burstPromises = Array.from({ length: 20 }, async () => {
          const start = Date.now();
          try {
            const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
              signal: AbortSignal.timeout(5000),
            });
            const latency = Date.now() - start;
            return { success: response.ok, latency, batch: burst };
          } catch {
            const latency = Date.now() - start;
            return { success: false, latency, batch: burst };
          }
        });

        const burstResults = await Promise.all(burstPromises);
        allResults.push(...burstResults);

        // Quiet period: 500ms
        await delay(500);
      }

      // Analyze results across bursts
      const burstSuccessRates: number[] = [];
      for (let i = 0; i < 5; i++) {
        const burstResults = allResults.filter(r => r.batch === i);
        const successRate = burstResults.filter(r => r.success).length / burstResults.length;
        burstSuccessRates.push(successRate);
      }

      // Success rates should be relatively consistent across bursts
      const avgSuccessRate =
        burstSuccessRates.reduce((a, b) => a + b, 0) / burstSuccessRates.length;
      expect(avgSuccessRate).toBeGreaterThan(0.7);

      // Check that bursts don't significantly degrade each other
      const successRateVariance = Math.max(...burstSuccessRates) - Math.min(...burstSuccessRates);
      expect(successRateVariance).toBeLessThan(0.5);
    });
  });

  describe('Resource Contention', () => {
    it('should handle memory pressure under load', async () => {
      // Create a server that simulates memory pressure (returns smaller responses under load)
      const server = await createMemoryPressureServer(BASE_PORT);
      servers.push(server);

      // Apply heavy load
      const promises = Array.from({ length: 50 }, () =>
        fetch(`http://localhost:${BASE_PORT}/api/tags`)
          .then(async res => {
            const data = await res.json();
            return {
              ok: res.ok,
              modelCount: data.models?.length || 0,
            };
          })
          .catch(() => ({ ok: false, modelCount: 0 }))
      );

      const results = await Promise.all(promises);

      const successful = results.filter(r => r.ok);
      const modelCounts = successful.map(r => r.modelCount);

      // Should have some responses with full model list and some with reduced lists
      const fullResponses = modelCounts.filter(count => count > 2).length;
      const reducedResponses = modelCounts.filter(count => count <= 2).length;

      expect(successful.length).toBeGreaterThan(0);
      // Under memory pressure, some responses should be truncated
      expect(reducedResponses).toBeGreaterThan(0);
    });

    it('should handle CPU-bound operations under load', async () => {
      // Create a server that simulates CPU-bound processing
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 500, // Moderate latency
      });
      servers.push(server);

      // Measure response times under increasing concurrent load
      const loadLevels = [1, 10, 25, 50];
      const responseTimes: number[] = [];

      for (const load of loadLevels) {
        const start = Date.now();
        const promises = Array.from({ length: load }, () =>
          fetch(`http://localhost:${BASE_PORT}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'test', prompt: 'hello world' }),
            signal: AbortSignal.timeout(10000),
          })
        );

        await Promise.allSettled(promises);
        const duration = Date.now() - start;
        responseTimes.push(duration);

        await delay(200); // Brief pause between load levels
      }

      // Response times should increase with load, but not exponentially
      expect(responseTimes[0]).toBeLessThan(responseTimes[1]);
      expect(responseTimes[1]).toBeLessThan(responseTimes[3]);

      // Check that the increase is roughly linear (not exponential)
      const ratio = responseTimes[3] / responseTimes[0];
      expect(ratio).toBeLessThan(10); // Should not be more than 10x slower
    });
  });

  describe('Load Spike Recovery', () => {
    it('should recover quickly after load spike subsides', async () => {
      const server = await mockServerFactory.healthy(BASE_PORT);
      servers.push(server);

      // Normal operation
      const normalResponse = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(normalResponse.ok).toBe(true);
      const normalTime = Date.now();

      // Load spike: 100 concurrent requests
      const spikePromises = Array.from({ length: 100 }, () =>
        fetch(`http://localhost:${BASE_PORT}/api/tags`, {
          signal: AbortSignal.timeout(10000),
        })
      );

      await Promise.allSettled(spikePromises);
      const postSpikeTime = Date.now();

      // Immediate post-spike request
      const immediateResponse = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(immediateResponse.ok).toBe(true);
      const immediateTime = Date.now();

      // Wait a bit for recovery
      await delay(1000);

      // Later request should be fast again
      const start = Date.now();
      const laterResponse = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      const laterLatency = Date.now() - start;

      expect(laterResponse.ok).toBe(true);
      expect(laterLatency).toBeLessThan(500); // Should be fast again
    });

    it('should handle oscillating load patterns', async () => {
      const server = await mockServerFactory.healthy(BASE_PORT);
      servers.push(server);

      const metrics: Array<{ load: number; avgLatency: number; successRate: number }> = [];

      // Oscillate between low and high load
      const pattern = [2, 20, 2, 50, 2, 30, 2, 10];

      for (const load of pattern) {
        const promises = Array.from({ length: load }, async () => {
          const start = Date.now();
          try {
            const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
              signal: AbortSignal.timeout(5000),
            });
            return { success: response.ok, latency: Date.now() - start };
          } catch {
            return { success: false, latency: 5000 };
          }
        });

        const results = await Promise.all(promises);
        const avgLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;
        const successRate = results.filter(r => r.success).length / results.length;

        metrics.push({ load, avgLatency, successRate });

        // Brief pause between load changes
        await delay(200);
      }

      // System should handle load oscillations
      const lowLoadMetrics = metrics.filter(m => m.load <= 5);
      const highLoadMetrics = metrics.filter(m => m.load > 20);

      // High load should have higher latency than low load
      const avgLowLatency =
        lowLoadMetrics.reduce((sum, m) => sum + m.avgLatency, 0) / lowLoadMetrics.length;
      const avgHighLatency =
        highLoadMetrics.reduce((sum, m) => sum + m.avgLatency, 0) / highLoadMetrics.length;

      expect(avgHighLatency).toBeGreaterThan(avgLowLatency);

      // But success rates should remain acceptable
      expect(metrics.every(m => m.successRate > 0.5)).toBe(true);
    });
  });
});

/**
 * Create a server that simulates memory pressure by returning fewer models under load
 */
async function createMemoryPressureServer(port: number): Promise<Server> {
  let requestCount = 0;

  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      requestCount++;

      // Simulate memory pressure: under high concurrent load, return fewer models
      const models =
        requestCount > 10
          ? ['smollm2:135m'] // Memory pressure: only small models
          : ['smollm2:135m', 'llama3.2:latest', 'mistral:latest', 'gemma3:4b']; // Normal: all models

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));

      // Slowly decrease request count to simulate load decrease
      setTimeout(() => (requestCount = Math.max(0, requestCount - 1)), 1000);
    });

    server.listen(port, () => {
      servers.push(server);
      resolve(server);
    });
  });
}
