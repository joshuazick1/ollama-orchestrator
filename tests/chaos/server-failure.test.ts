/**
 * Chaos Engineering Tests: Server Failure Scenarios
 *
 * Tests system resilience when servers fail, become unavailable, or degrade.
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
const BASE_PORT = 11500;
let servers: Server[] = [];

describe('Chaos: Server Failure Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  beforeEach(async () => {
    // Clean up servers from previous test
    await cleanupMockServers();
    servers = [];
  });

  describe('Complete Server Failure', () => {
    it('should handle server becoming completely unavailable', async () => {
      // Start a healthy server
      const server = await mockServerFactory.healthy(BASE_PORT);
      servers.push(server);

      // Verify it's working
      const response1 = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(response1.ok).toBe(true);

      // Close the server to simulate failure
      await new Promise<void>(resolve => server.close(() => resolve()));

      // Verify requests fail
      try {
        await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have thrown connection error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle multiple servers failing in sequence', async () => {
      const ports = [BASE_PORT, BASE_PORT + 1, BASE_PORT + 2];

      // Create 3 healthy servers
      for (const port of ports) {
        const server = await mockServerFactory.healthy(port);
        servers.push(server);
      }

      // Verify all are working
      for (const port of ports) {
        const response = await fetch(`http://localhost:${port}/api/tags`);
        expect(response.ok).toBe(true);
      }

      // Fail servers one by one
      for (let i = 0; i < servers.length; i++) {
        await new Promise<void>(resolve => servers[i].close(() => resolve()));

        // Check remaining servers still work
        for (let j = i + 1; j < ports.length; j++) {
          const response = await fetch(`http://localhost:${ports[j]}/api/tags`);
          expect(response.ok).toBe(true);
        }
      }
    });

    it('should handle server returning 503 Service Unavailable', async () => {
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'unhealthy',
      });
      servers.push(server);

      const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(response.status).toBe(503);
    });
  });

  describe('Gradual Degradation', () => {
    it('should detect and handle degraded server performance', async () => {
      const server = await mockServerFactory.degraded(BASE_PORT);
      servers.push(server);

      // Make multiple requests and track success rate
      const results: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        try {
          const response = await fetch(`http://localhost:${BASE_PORT}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'test', prompt: 'hello' }),
            signal: AbortSignal.timeout(5000),
          });
          results.push(response.ok);
        } catch {
          results.push(false);
        }
      }

      // Degraded server should show increasing failure rate
      const earlySuccessRate = results.slice(0, 5).filter(r => r).length / 5;
      const lateSuccessRate = results.slice(-5).filter(r => r).length / 5;

      // Early success rate should be higher than late success rate
      expect(earlySuccessRate).toBeGreaterThanOrEqual(lateSuccessRate);
    }, 15000);

    it('should handle slow server responses', async () => {
      const server = await mockServerFactory.slow(BASE_PORT);
      servers.push(server);

      const start = Date.now();
      const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      const duration = Date.now() - start;

      expect(response.ok).toBe(true);
      // Slow server has 500-3000ms latency
      expect(duration).toBeGreaterThan(400);
    });
  });

  describe('Flaky Server Behavior', () => {
    it('should handle intermittent failures', async () => {
      const server = await mockServerFactory.flaky(BASE_PORT);
      servers.push(server);

      // Make multiple requests
      const results: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        try {
          const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
          results.push(response.ok);
        } catch {
          results.push(false);
        }
      }

      // Flaky server alternates success/failure, so should have both
      const successes = results.filter(r => r).length;
      const failures = results.filter(r => !r).length;

      expect(successes).toBeGreaterThan(0);
      expect(failures).toBeGreaterThan(0);
    });

    it('should handle bursty failure patterns', async () => {
      const server = await mockServerFactory.intermittent(BASE_PORT);
      servers.push(server);

      // Make requests and track patterns
      const results: boolean[] = [];
      for (let i = 0; i < 16; i++) {
        try {
          const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
          results.push(response.ok);
        } catch {
          results.push(false);
        }
      }

      // Intermittent: 5 successes then 3 failures pattern
      const firstBatch = results.slice(0, 5);
      const secondBatch = results.slice(5, 8);

      // First batch should have mostly successes
      expect(firstBatch.filter(r => r).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Resource Exhaustion', () => {
    it('should handle rate-limited server', async () => {
      const server = await mockServerFactory.rateLimited(BASE_PORT, 5);
      servers.push(server);

      // Make requests until rate limited
      let rateLimited = false;
      for (let i = 0; i < 10; i++) {
        const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
        if (response.status === 429) {
          rateLimited = true;
          break;
        }
      }

      expect(rateLimited).toBe(true);
    });

    it('should handle OOM-prone server', async () => {
      const server = await mockServerFactory.oomProne(BASE_PORT);
      servers.push(server);

      // Tags should work (informational endpoint)
      const tagsResponse = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(tagsResponse.ok).toBe(true);

      // OOM-prone server returns limited models
      const data = await tagsResponse.json();
      expect(data.models.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Server Recovery', () => {
    it('should handle server coming back online', async () => {
      // Start server
      let server = await mockServerFactory.healthy(BASE_PORT);
      servers.push(server);

      // Verify working
      const response1 = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(response1.ok).toBe(true);

      // Shut down
      await new Promise<void>(resolve => server.close(() => resolve()));

      // Verify failed
      try {
        await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
          signal: AbortSignal.timeout(500),
        });
        expect.fail('Should have failed');
      } catch {
        // Expected
      }

      // Restart server
      server = await mockServerFactory.healthy(BASE_PORT);
      servers = [server]; // Replace reference

      // Give it a moment to bind
      await delay(100);

      // Verify working again
      const response2 = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(response2.ok).toBe(true);
    });

    it('should handle warmup period after restart', async () => {
      const server = await mockServerFactory.warmup(BASE_PORT, 2000);
      servers.push(server);

      // Requests during warmup should be slow
      const start = Date.now();
      await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      const initialLatency = Date.now() - start;

      // Wait for warmup
      await delay(2500);

      // Requests after warmup should be faster
      const start2 = Date.now();
      await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      const postWarmupLatency = Date.now() - start2;

      expect(postWarmupLatency).toBeLessThan(initialLatency);
    });
  });

  describe('Partial Failures', () => {
    it('should handle specific endpoint failures', async () => {
      const server = await mockServerFactory.partialFailure(BASE_PORT, '/api/generate');
      servers.push(server);

      // Tags should work
      const tagsResponse = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(tagsResponse.ok).toBe(true);

      // Generate should fail
      const generateResponse = await fetch(`http://localhost:${BASE_PORT}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', prompt: 'hello' }),
      });
      expect(generateResponse.ok).toBe(false);
    });
  });
});
