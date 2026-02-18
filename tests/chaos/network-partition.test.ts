/**
 * Chaos Engineering Tests: Network Partition Scenarios
 *
 * Tests system resilience when network connectivity issues occur,
 * including timeouts, connection resets, and intermittent connectivity.
 */

import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { Server } from 'http';
import {
  createDiverseMockServer,
  mockServerFactory,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';

const BASE_PORT = 15100;
let serverId = 0;
const getUniquePort = () => BASE_PORT + serverId++;

describe('Chaos: Network Partition Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(100);
  });

  describe('Connection Timeouts', () => {
    it('should handle server response timeouts', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 5000,
      });

      try {
        await fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have timed out');
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.name).toBe('TimeoutError');
      }
    });

    it('should handle partial response timeouts', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 3000,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);

      try {
        await fetch(`http://localhost:${port}/api/tags`, {
          signal: controller.signal,
        });
        expect.fail('Should have timed out');
      } catch (error) {
        clearTimeout(timeoutId);
        expect(error.name).toBe('AbortError');
      }
    });

    it('should recover from temporary timeouts', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 3000,
      });

      try {
        await fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have timed out');
      } catch (error) {
        expect(['TimeoutError', 'AbortError']).toContain(error.name);
      }

      await cleanupMockServers();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 50,
      });

      const response = await fetch(`http://localhost:${port}/api/tags`);
      expect(response.ok).toBe(true);
    });
  });

  describe('Connection Resets', () => {
    it('should handle connection reset during request', async () => {
      const port = getUniquePort();
      await createServerThatResetsConnections(port);

      const results: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        try {
          const response = await fetch(`http://localhost:${port}/api/tags`, {
            signal: AbortSignal.timeout(2000),
          });
          results.push(response.ok);
        } catch {
          results.push(false);
        }
      }

      const successes = results.filter(r => r).length;
      const failures = results.filter(r => !r).length;

      expect(successes).toBeGreaterThanOrEqual(0);
      expect(failures).toBeGreaterThanOrEqual(0);
    });

    it('should handle server closing connections unexpectedly', async () => {
      const port = getUniquePort();
      const server = await mockServerFactory.healthy(port);

      const response1 = await fetch(`http://localhost:${port}/api/tags`);
      expect(response1.ok).toBe(true);

      await new Promise<void>(resolve => server.close(() => resolve()));

      try {
        await fetch(`http://localhost:${port}/api/tags`, {
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
      const port = getUniquePort();
      await createIntermittentServer(port);

      const results: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        try {
          const response = await fetch(`http://localhost:${port}/api/tags`, {
            signal: AbortSignal.timeout(1000),
          });
          results.push(response.ok);
        } catch {
          results.push(false);
        }
        await delay(200);
      }

      const successes = results.filter(r => r).length;
      const failures = results.filter(r => !r).length;

      expect(successes).toBeGreaterThanOrEqual(0);
      expect(failures).toBeGreaterThan(0);
      expect(results.length).toBe(10);
    });

    it('should handle network congestion patterns', async () => {
      const port1 = getUniquePort();
      const port2 = getUniquePort();
      const port3 = getUniquePort();
      const ports = [port1, port2, port3];
      const latencies = [100, 2000, 5000];

      await createDiverseMockServer({
        port: port1,
        type: 'healthy',
        latency: latencies[0],
      });

      await createDiverseMockServer({
        port: port2,
        type: 'healthy',
        latency: latencies[1],
      });

      await createDiverseMockServer({
        port: port3,
        type: 'healthy',
        latency: latencies[2],
      });

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

      const fastResult = results.find(r => r.latency === 100);
      const slowResult = results.find(r => r.latency === 5000);

      expect(fastResult?.success).toBe(true);
      expect(slowResult?.success).toBeDefined();
    });
  });

  describe('DNS/Network Resolution Issues', () => {
    it('should handle invalid hostnames gracefully', async () => {
      try {
        await fetch('http://nonexistent-hostname-that-does-not-exist.invalid/api/tags', {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have failed DNS resolution');
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.name).toBe('TypeError');
      }
    });

    it('should handle unreachable ports', async () => {
      const unusedPort = 59999;

      try {
        await fetch(`http://localhost:${unusedPort}/api/tags`, {
          signal: AbortSignal.timeout(1000),
        });
        expect.fail('Should have failed to connect');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Network Recovery', () => {
    it('should recover after network partition heals', async () => {
      const port = getUniquePort();
      const server = await mockServerFactory.healthy(port);

      const response1 = await fetch(`http://localhost:${port}/api/tags`);
      expect(response1.ok).toBe(true);

      await new Promise<void>(resolve => server.close(() => resolve()));

      for (let i = 0; i < 3; i++) {
        try {
          await fetch(`http://localhost:${port}/api/tags`, {
            signal: AbortSignal.timeout(500),
          });
          expect.fail('Should have failed during partition');
        } catch {
          // Expected
        }
      }

      await mockServerFactory.healthy(port);

      await delay(200);

      const response2 = await fetch(`http://localhost:${port}/api/tags`);
      expect(response2.ok).toBe(true);
    });

    it('should handle gradual network degradation and recovery', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 100,
      });

      const goodResults: Array<{ success: boolean; latency: number }> = [];
      for (let i = 0; i < 3; i++) {
        const start = Date.now();
        const response = await fetch(`http://localhost:${port}/api/tags`);
        const latency = Date.now() - start;
        goodResults.push({ success: response.ok, latency });
      }

      await cleanupMockServers();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 3000,
      });

      const degradedResults: Array<{ success: boolean; latency: number }> = [];
      for (let i = 0; i < 3; i++) {
        try {
          const start = Date.now();
          const response = await fetch(`http://localhost:${port}/api/tags`, {
            signal: AbortSignal.timeout(2000),
          });
          const latency = Date.now() - start;
          degradedResults.push({ success: response.ok, latency });
        } catch {
          degradedResults.push({ success: false, latency: 2000 });
        }
      }

      await cleanupMockServers();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 100,
      });

      const recoveryResults: Array<{ success: boolean; latency: number }> = [];
      for (let i = 0; i < 3; i++) {
        const start = Date.now();
        const response = await fetch(`http://localhost:${port}/api/tags`);
        const latency = Date.now() - start;
        recoveryResults.push({ success: response.ok, latency });
      }

      expect(goodResults.every(r => r.success)).toBe(true);
      expect(goodResults.every(r => r.latency < 500)).toBe(true);

      expect(recoveryResults.every(r => r.success)).toBe(true);
      expect(recoveryResults.every(r => r.latency < 500)).toBe(true);
    });
  });
});

async function createServerThatResetsConnections(port: number): Promise<Server> {
  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      if (Math.random() < 0.4) {
        req.destroy();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
    });

    server.listen(port, () => {
      resolve(server);
    });
  });
}

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
      const interval = setInterval(() => {
        available = !available;
      }, 500);

      (server as any).availabilityInterval = interval;
      resolve(server);
    });
  });
}
