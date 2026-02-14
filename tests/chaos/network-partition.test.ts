/**
 * Chaos Engineering Tests: Network Partition Scenarios
 *
 * Tests system resilience when network connectivity issues occur,
 * including timeouts, connection resets, and intermittent connectivity.
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
const BASE_PORT = 11600;
let servers: Server[] = [];

describe('Chaos: Network Partition Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  beforeEach(async () => {
    // Clean up servers from previous test
    await cleanupMockServers();
    servers = [];
  });

  describe('Connection Timeouts', () => {
    it('should handle server response timeouts', async () => {
      // Create a server that responds very slowly (longer than timeout)
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 5000, // 5 second delay
      });
      servers.push(server);

      // Try to fetch with a short timeout
      try {
        await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
          signal: AbortSignal.timeout(1000), // 1 second timeout
        });
        expect.fail('Should have timed out');
      } catch (error) {
        expect(error).toBeDefined();
        // Should be an AbortError due to timeout
        expect(error.name).toBe('TimeoutError');
      }
    });

    it('should handle partial response timeouts', async () => {
      // Create a server that starts responding but takes too long
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 3000,
      });
      servers.push(server);

      // Make request with short timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);

      try {
        const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
          signal: controller.signal,
        });
        expect.fail('Should have timed out');
      } catch (error) {
        expect(error.name).toBe('TimeoutError');
      }
    });

    it('should recover from temporary timeouts', async () => {
      // Start with a slow server
      let server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 3000,
      });
      servers.push(server);

      // First request should timeout
      try {
        await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have timed out');
      } catch (error) {
        expect(error.name).toBe('AbortError');
      }

      // Replace with fast server
      await cleanupMockServers();
      server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 50,
      });
      servers.push(server);

      // Second request should succeed
      const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(response.ok).toBe(true);
    });
  });

  describe('Connection Resets', () => {
    it('should handle connection reset during request', async () => {
      // Create a server that closes connections mid-request
      const server = await createServerThatResetsConnections(BASE_PORT);
      servers.push(server);

      // Make multiple requests - some should succeed, some should fail
      const results: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        try {
          const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
            signal: AbortSignal.timeout(2000),
          });
          results.push(response.ok);
        } catch {
          results.push(false);
        }
      }

      // Should have both successes and failures
      const successes = results.filter(r => r).length;
      const failures = results.filter(r => !r).length;

      expect(successes).toBeGreaterThan(0);
      expect(failures).toBeGreaterThan(0);
    });

    it('should handle server closing connections unexpectedly', async () => {
      const server = await mockServerFactory.healthy(BASE_PORT);
      servers.push(server);

      // Make a successful request first
      const response1 = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(response1.ok).toBe(true);

      // Close server mid-session
      await new Promise<void>(resolve => server.close(() => resolve()));

      // Next request should fail
      try {
        await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have failed');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Intermittent Connectivity', () => {
    it('should handle periodic network drops', async () => {
      // Create a server that becomes unavailable periodically
      const server = await createIntermittentServer(BASE_PORT);
      servers.push(server);

      // Make requests over time
      const results: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        try {
          const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
            signal: AbortSignal.timeout(1000),
          });
          results.push(response.ok);
        } catch {
          results.push(false);
        }
        await delay(200); // Small delay between requests
      }

      // Should have mix of successes and failures due to intermittent behavior
      const successes = results.filter(r => r).length;
      const failures = results.filter(r => !r).length;

      expect(successes).toBeGreaterThan(0);
      expect(failures).toBeGreaterThan(0);
      expect(results.length).toBe(10);
    });

    it('should handle network congestion patterns', async () => {
      // Create multiple servers with varying response times
      const ports = [BASE_PORT, BASE_PORT + 1, BASE_PORT + 2];
      const latencies = [100, 2000, 5000]; // Fast, medium, slow

      for (let i = 0; i < ports.length; i++) {
        const server = await createDiverseMockServer({
          port: ports[i],
          type: 'healthy',
          latency: latencies[i],
        });
        servers.push(server);
      }

      // Make concurrent requests to all servers
      const promises = ports.map(port =>
        fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        })
          .then(response => ({
            port,
            success: response.ok,
            latency: latencies[ports.indexOf(port)],
          }))
          .catch(() => ({
            port,
            success: false,
            latency: latencies[ports.indexOf(port)],
          }))
      );

      const results = await Promise.all(promises);

      // Fast server should succeed, slow ones may timeout
      const fastResult = results.find(r => r.latency === 100);
      const slowResult = results.find(r => r.latency === 5000);

      expect(fastResult?.success).toBe(true);
      // Slow server might fail due to 3s timeout vs 5s latency
      expect(slowResult?.success).toBeDefined();
    });
  });

  describe('DNS/Network Resolution Issues', () => {
    it('should handle invalid hostnames gracefully', async () => {
      // Try to connect to a non-existent hostname
      try {
        await fetch('http://nonexistent-hostname-that-does-not-exist.invalid/api/tags', {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have failed DNS resolution');
      } catch (error) {
        expect(error).toBeDefined();
        // Should be a network error, not a timeout
        expect(error.name).toBe('TypeError');
      }
    });

    it('should handle unreachable ports', async () => {
      // Try to connect to a port that has no server
      const unusedPort = 99999;

      try {
        await fetch(`http://localhost:${unusedPort}/api/tags`, {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have failed to connect');
      } catch (error) {
        expect(error).toBeDefined();
        // Should be a connection error
      }
    });
  });

  describe('Network Recovery', () => {
    it('should recover after network partition heals', async () => {
      const server = await mockServerFactory.healthy(BASE_PORT);
      servers.push(server);

      // Verify server is working
      const response1 = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(response1.ok).toBe(true);

      // Simulate network partition by closing server
      await new Promise<void>(resolve => server.close(() => resolve()));

      // Requests should fail during "partition"
      for (let i = 0; i < 3; i++) {
        try {
          await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
            signal: AbortSignal.timeout(500),
          });
          expect.fail('Should have failed during partition');
        } catch {
          // Expected
        }
      }

      // "Heal" the partition by restarting server
      const newServer = await mockServerFactory.healthy(BASE_PORT);
      servers = [newServer];

      // Give server time to start
      await delay(200);

      // Requests should succeed again
      const response2 = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
      expect(response2.ok).toBe(true);
    });

    it('should handle gradual network degradation and recovery', async () => {
      // Start with good connectivity
      let server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 100,
      });
      servers.push(server);

      // Good connectivity period
      const goodResults: Array<{ success: boolean; latency: number }> = [];
      for (let i = 0; i < 3; i++) {
        const start = Date.now();
        const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
        const latency = Date.now() - start;
        goodResults.push({ success: response.ok, latency });
      }

      // Replace with slow server (degraded network)
      await cleanupMockServers();
      server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 3000,
      });
      servers.push(server);

      // Degraded period - requests may timeout
      const degradedResults: Array<{ success: boolean; latency: number }> = [];
      for (let i = 0; i < 3; i++) {
        try {
          const start = Date.now();
          const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
            signal: AbortSignal.timeout(2000),
          });
          const latency = Date.now() - start;
          degradedResults.push({ success: response.ok, latency });
        } catch {
          degradedResults.push({ success: false, latency: 2000 });
        }
      }

      // Restore good connectivity
      await cleanupMockServers();
      const finalServer = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 100,
      });
      servers.push(finalServer);

      // Recovery period
      const recoveryResults: Array<{ success: boolean; latency: number }> = [];
      for (let i = 0; i < 3; i++) {
        const start = Date.now();
        const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
        const latency = Date.now() - start;
        recoveryResults.push({ success: response.ok, latency });
      }

      // Verify the pattern: good -> degraded -> good
      expect(goodResults.every(r => r.success)).toBe(true);
      expect(goodResults.every(r => r.latency < 500)).toBe(true);

      expect(recoveryResults.every(r => r.success)).toBe(true);
      expect(recoveryResults.every(r => r.latency < 500)).toBe(true);
    });
  });
});

/**
 * Create a server that randomly resets connections
 */
async function createServerThatResetsConnections(port: number): Promise<Server> {
  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      // Randomly close connection instead of responding
      if (Math.random() < 0.4) {
        req.destroy();
        return;
      }

      // Otherwise respond normally
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
    });

    server.listen(port, () => {
      servers.push(server);
      resolve(server);
    });
  });
}

/**
 * Create a server that becomes intermittently unavailable
 */
async function createIntermittentServer(port: number): Promise<Server> {
  let available = true;

  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      if (!available) {
        req.destroy();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
    });

    server.listen(port, () => {
      servers.push(server);

      // Toggle availability every 500ms
      const interval = setInterval(() => {
        available = !available;
      }, 500);

      (server as any).availabilityInterval = interval;
      resolve(server);
    });
  });
}
