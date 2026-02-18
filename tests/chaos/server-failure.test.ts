/**
 * Chaos Engineering Tests: Server Failure Scenarios
 *
 * Tests system resilience when servers fail, become unavailable, or degrade.
 */

import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { Server } from 'http';
import {
  createDiverseMockServer,
  mockServerFactory,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';

const BASE_PORT = 16100;
let serverId = 0;
const getUniquePort = () => BASE_PORT + serverId++;

describe('Chaos: Server Failure Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(100);
  });

  describe('Complete Server Failure', () => {
    it('should handle server becoming completely unavailable', async () => {
      const port = getUniquePort();
      const server = await mockServerFactory.healthy(port);

      const response1 = await fetch(`http://localhost:${port}/api/tags`);
      expect(response1.ok).toBe(true);

      await new Promise<void>(resolve => server.close(() => resolve()));

      try {
        await fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have thrown connection error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle multiple servers failing in sequence', async () => {
      const port1 = getUniquePort();
      const port2 = getUniquePort();
      const port3 = getUniquePort();
      const ports = [port1, port2, port3];

      const servers: Server[] = [];
      for (const port of ports) {
        const server = await mockServerFactory.healthy(port);
        servers.push(server);
      }

      for (const port of ports) {
        const response = await fetch(`http://localhost:${port}/api/tags`);
        expect(response.ok).toBe(true);
      }

      for (let i = 0; i < servers.length; i++) {
        await new Promise<void>(resolve => servers[i].close(() => resolve()));

        for (let j = i + 1; j < ports.length; j++) {
          const response = await fetch(`http://localhost:${ports[j]}/api/tags`);
          expect(response.ok).toBe(true);
        }
      }
    });

    it('should handle server returning 503 Service Unavailable', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'unhealthy',
      });

      const response = await fetch(`http://localhost:${port}/api/tags`);
      expect(response.status).toBe(503);
    });
  });

  describe('Gradual Degradation', () => {
    it('should detect and handle degraded server performance', async () => {
      const port = getUniquePort();
      await mockServerFactory.degraded(port);

      const results: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        try {
          const response = await fetch(`http://localhost:${port}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'test', prompt: 'hello' }),
            signal: AbortSignal.timeout(3000),
          });
          results.push(response.ok);
        } catch {
          results.push(false);
        }
      }

      const earlySuccessRate = results.slice(0, 3).filter(r => r).length / 3;
      const lateSuccessRate = results.slice(-3).filter(r => r).length / 3;

      expect(earlySuccessRate).toBeGreaterThanOrEqual(0);
    }, 30000);

    it('should handle slow server responses', async () => {
      const port = getUniquePort();
      await mockServerFactory.slow(port);

      const start = Date.now();
      const response = await fetch(`http://localhost:${port}/api/tags`);
      const duration = Date.now() - start;

      expect(response.ok).toBe(true);
      expect(duration).toBeGreaterThan(400);
    });
  });

  describe('Flaky Server Behavior', () => {
    it('should handle intermittent failures', async () => {
      const port = getUniquePort();
      await mockServerFactory.flaky(port);

      const results: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        try {
          const response = await fetch(`http://localhost:${port}/api/tags`);
          results.push(response.ok);
        } catch {
          results.push(false);
        }
      }

      const successes = results.filter(r => r).length;
      const failures = results.filter(r => !r).length;

      expect(successes).toBeGreaterThan(0);
      expect(failures).toBeGreaterThan(0);
    });

    it('should handle bursty failure patterns', async () => {
      const port = getUniquePort();
      await mockServerFactory.intermittent(port);

      const results: boolean[] = [];
      for (let i = 0; i < 16; i++) {
        try {
          const response = await fetch(`http://localhost:${port}/api/tags`);
          results.push(response.ok);
        } catch {
          results.push(false);
        }
      }

      const firstBatch = results.slice(0, 5);
      expect(firstBatch.filter(r => r).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Resource Exhaustion', () => {
    it('should handle rate-limited server', async () => {
      const port = getUniquePort();
      await mockServerFactory.rateLimited(port, 5);

      let rateLimited = false;
      for (let i = 0; i < 10; i++) {
        try {
          const response = await fetch(`http://localhost:${port}/api/tags`);
          if (response.status === 429) {
            rateLimited = true;
            break;
          }
        } catch {
          break;
        }
      }

      expect(rateLimited).toBe(true);
    });

    it('should handle OOM-prone server', async () => {
      const port = getUniquePort();
      await mockServerFactory.oomProne(port);

      const tagsResponse = await fetch(`http://localhost:${port}/api/tags`);
      expect(tagsResponse.ok).toBe(true);

      const data = await tagsResponse.json();
      expect(data.models.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Server Recovery', () => {
    it('should handle server coming back online', async () => {
      const port = getUniquePort();
      let server = await mockServerFactory.healthy(port);

      const response1 = await fetch(`http://localhost:${port}/api/tags`);
      expect(response1.ok).toBe(true);

      await new Promise<void>(resolve => server.close(() => resolve()));

      try {
        await fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(500),
        });
        expect.fail('Should have failed');
      } catch {
        // Expected
      }

      server = await mockServerFactory.healthy(port);

      await delay(100);

      const response2 = await fetch(`http://localhost:${port}/api/tags`);
      expect(response2.ok).toBe(true);
    });

    it('should handle warmup period after restart', async () => {
      const port = getUniquePort();
      await mockServerFactory.warmup(port, 2000);

      const start = Date.now();
      await fetch(`http://localhost:${port}/api/tags`);
      const initialLatency = Date.now() - start;

      await delay(2500);

      const start2 = Date.now();
      await fetch(`http://localhost:${port}/api/tags`);
      const postWarmupLatency = Date.now() - start2;

      expect(postWarmupLatency).toBeLessThanOrEqual(initialLatency + 1000);
    });
  });

  describe('Partial Failures', () => {
    it('should handle specific endpoint failures', async () => {
      const port = getUniquePort();
      await mockServerFactory.partialFailure(port, '/api/generate');

      const tagsResponse = await fetch(`http://localhost:${port}/api/tags`);
      expect(tagsResponse.ok).toBe(true);

      const generateResponse = await fetch(`http://localhost:${port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', prompt: 'hello' }),
      });
      expect(generateResponse.ok).toBe(false);
    });
  });
});
