/**
 * Chaos Engineering Tests: Load Spike Scenarios
 *
 * Tests system behavior when load suddenly increases dramatically,
 * including queue management, backpressure, and performance degradation.
 */

import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { Server } from 'http';
import {
  createDiverseMockServer,
  mockServerFactory,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';

const BASE_PORT = 14100;
let serverId = 0;
const getUniquePort = () => BASE_PORT + serverId++;

describe('Chaos: Load Spike Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(100);
  });

  describe('Sudden Load Increases', () => {
    it('should handle sudden spike in concurrent requests', async () => {
      const port = getUniquePort();
      await mockServerFactory.healthy(port);

      const normalLoadPromises = Array.from({ length: 5 }, () =>
        fetch(`http://localhost:${port}/api/tags`)
      );

      const normalResults = await Promise.all(normalLoadPromises);
      expect(normalResults.every(r => r.ok)).toBe(true);

      const spikeLoadPromises = Array.from({ length: 50 }, () =>
        fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        })
      );

      const spikeStart = Date.now();
      const spikeResults = await Promise.allSettled(spikeLoadPromises);
      const spikeDuration = Date.now() - spikeStart;

      const fulfilled = spikeResults.filter(r => r.status === 'fulfilled').length;

      expect(fulfilled).toBeGreaterThan(0);
      expect(spikeDuration).toBeLessThan(10000);
    });

    it('should handle gradual load ramp-up', async () => {
      const port = getUniquePort();
      await mockServerFactory.healthy(port);

      const latencies: number[] = [];
      const successRates: number[] = [];

      const loadLevels = [1, 5, 10, 20, 50];

      for (const load of loadLevels) {
        const start = Date.now();
        const promises = Array.from({ length: load }, () =>
          fetch(`http://localhost:${port}/api/tags`, {
            signal: AbortSignal.timeout(10000),
          })
            .then(res => res.ok)
            .catch(() => false)
        );

        const results = await Promise.all(promises);
        const duration = Date.now() - start;

        latencies.push(duration);
        successRates.push(results.filter(r => r).length / load);

        await delay(100);
      }

      expect(latencies[0]).toBeLessThan(latencies[latencies.length - 1]);
      expect(successRates.every(rate => rate > 0.8)).toBe(true);
    });
  });

  describe('Queue Behavior Under Load', () => {
    it('should handle queue overflow scenarios', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 1000,
      });

      const requestCount = 100;
      const promises = Array.from({ length: requestCount }, () =>
        fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        })
      );

      const start = Date.now();
      const results = await Promise.allSettled(promises);
      const duration = Date.now() - start;

      const fulfilled = results.filter(r => r.status === 'fulfilled').length;
      const rejected = results.filter(r => r.status === 'rejected').length;

      expect(fulfilled).toBeGreaterThan(0);
      expect(rejected).toBeGreaterThanOrEqual(0);
      expect(fulfilled + rejected).toBe(requestCount);

      expect(duration).toBeGreaterThan(1000);
      expect(duration).toBeLessThan(15000);
    });

    it('should handle bursty traffic patterns', async () => {
      const port = getUniquePort();
      await mockServerFactory.healthy(port);

      const allResults: Array<{ success: boolean; latency: number; batch: number }> = [];

      for (let burst = 0; burst < 5; burst++) {
        const burstPromises = Array.from({ length: 20 }, async () => {
          const start = Date.now();
          try {
            const response = await fetch(`http://localhost:${port}/api/tags`, {
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

        await delay(500);
      }

      const burstSuccessRates: number[] = [];
      for (let i = 0; i < 5; i++) {
        const burstResults = allResults.filter(r => r.batch === i);
        const successRate = burstResults.filter(r => r.success).length / burstResults.length;
        burstSuccessRates.push(successRate);
      }

      const avgSuccessRate =
        burstSuccessRates.reduce((a, b) => a + b, 0) / burstSuccessRates.length;
      expect(avgSuccessRate).toBeGreaterThan(0.7);

      const successRateVariance = Math.max(...burstSuccessRates) - Math.min(...burstSuccessRates);
      expect(successRateVariance).toBeLessThan(0.5);
    });
  });

  describe('Resource Contention', () => {
    it('should handle memory pressure under load', async () => {
      const port = getUniquePort();
      await createMemoryPressureServer(port);

      const promises = Array.from({ length: 50 }, () =>
        fetch(`http://localhost:${port}/api/tags`)
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

      const fullResponses = modelCounts.filter(count => count > 2).length;
      const reducedResponses = modelCounts.filter(count => count <= 2).length;

      expect(successful.length).toBeGreaterThan(0);
      expect(reducedResponses).toBeGreaterThan(0);
    });

    it('should handle CPU-bound operations under load', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 500,
      });

      const loadLevels = [1, 10, 25, 50];
      const responseTimes: number[] = [];

      for (const load of loadLevels) {
        const promises = Array.from({ length: load }, () =>
          fetch(`http://localhost:${port}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'test', prompt: 'hello world' }),
            signal: AbortSignal.timeout(10000),
          })
        );

        const start = Date.now();
        await Promise.allSettled(promises);
        const duration = Date.now() - start;
        responseTimes.push(duration);

        await delay(200);
      }

      expect(responseTimes[0]).toBeLessThanOrEqual(responseTimes[1] + 100);
      expect(responseTimes[1]).toBeLessThanOrEqual(responseTimes[3] + 500);

      const ratio = responseTimes[3] / responseTimes[0];
      expect(ratio).toBeLessThan(15);
    });
  });

  describe('Load Spike Recovery', () => {
    it('should recover quickly after load spike subsides', async () => {
      const port = getUniquePort();
      await mockServerFactory.healthy(port);

      const normalResponse = await fetch(`http://localhost:${port}/api/tags`);
      expect(normalResponse.ok).toBe(true);

      const spikePromises = Array.from({ length: 100 }, () =>
        fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(10000),
        })
      );

      await Promise.allSettled(spikePromises);

      const immediateResponse = await fetch(`http://localhost:${port}/api/tags`);
      expect(immediateResponse.ok).toBe(true);

      await delay(1000);

      const start = Date.now();
      const laterResponse = await fetch(`http://localhost:${port}/api/tags`);
      const laterLatency = Date.now() - start;

      expect(laterResponse.ok).toBe(true);
      expect(laterLatency).toBeLessThan(1000);
    });

    it('should handle oscillating load patterns', async () => {
      const port = getUniquePort();
      await mockServerFactory.healthy(port);

      const metrics: Array<{ load: number; avgLatency: number; successRate: number }> = [];

      const pattern = [2, 20, 2, 50, 2, 30, 2, 10];

      for (const load of pattern) {
        const promises = Array.from({ length: load }, async () => {
          const start = Date.now();
          try {
            const response = await fetch(`http://localhost:${port}/api/tags`, {
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

        await delay(200);
      }

      const lowLoadMetrics = metrics.filter(m => m.load <= 5);
      const highLoadMetrics = metrics.filter(m => m.load > 20);

      const avgLowLatency =
        lowLoadMetrics.reduce((sum, m) => sum + m.avgLatency, 0) / lowLoadMetrics.length;
      const avgHighLatency =
        highLoadMetrics.reduce((sum, m) => sum + m.avgLatency, 0) / highLoadMetrics.length;

      expect(avgHighLatency).toBeGreaterThanOrEqual(avgLowLatency * 0.5);

      expect(metrics.every(m => m.successRate > 0.3)).toBe(true);
    });
  });
});

async function createMemoryPressureServer(port: number): Promise<Server> {
  let requestCount = 0;

  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      requestCount++;

      const models =
        requestCount > 10
          ? ['smollm2:135m']
          : ['smollm2:135m', 'llama3.2:latest', 'mistral:latest', 'gemma3:4b'];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));

      setTimeout(() => (requestCount = Math.max(0, requestCount - 1)), 1000);
    });

    server.listen(port, () => {
      resolve(server);
    });
  });
}
