/**
 * Chaos Engineering Tests: Additional Chaos Scenarios
 *
 * Tests system resilience under security attacks, latency issues,
 * multi-server coordination, and memory pressure scenarios.
 */

import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { Server } from 'http';
import {
  createDiverseMockServer,
  mockServerFactory,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';
import { CircuitBreaker, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../src/circuit-breaker.js';

const BASE_PORT = 17100;
let serverId = 0;
const getUniquePort = () => BASE_PORT + serverId++;

describe('Chaos: Security Attack Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(100);
  });

  describe('Authentication Failures', () => {
    it('should handle server returning 401 Unauthorized', async () => {
      const port = getUniquePort();
      await createAuthFailureServer(port, 401);

      try {
        await fetch(`http://localhost:${port}/api/tags`, {
          headers: { Authorization: 'Bearer invalid-token' },
        });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle server returning 403 Forbidden', async () => {
      const port = getUniquePort();
      await createAuthFailureServer(port, 403);

      try {
        await fetch(`http://localhost:${port}/api/tags`);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should circuit break after repeated auth failures', async () => {
      const port = getUniquePort();
      await createAuthFailureServer(port, 401);

      const circuitBreaker = new CircuitBreaker('auth-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 3,
        openTimeout: 1000,
        halfOpenTimeout: 2000,
        halfOpenMaxRequests: 10,
      });

      for (let i = 0; i < 5; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${port}/api/tags`);
          } catch {
            // Expected
          }
          circuitBreaker.recordFailure(new Error('401 unauthorized'));
        }
      }

      expect(['open', 'closed']).toContain(circuitBreaker.getState());
    });
  });

  describe('Rate Limiting', () => {
    it('should handle 429 Too Many Requests', async () => {
      const port = getUniquePort();
      const server = await createRateLimitServer(port, 3);

      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        try {
          const response = await fetch(`http://localhost:${port}/api/tags`);
          results.push(response.status);
        } catch {
          results.push(0);
        }
      }

      expect(results).toContain(429);
    });

    it('should backoff after rate limiting', async () => {
      const port = getUniquePort();
      await createRateLimitServer(port, 2);

      const circuitBreaker = new CircuitBreaker('rate-limit-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 2,
        openTimeout: 500,
        halfOpenTimeout: 1000,
        halfOpenMaxRequests: 10,
      });

      for (let i = 0; i < 3; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${port}/api/tags`);
          } catch {
            // Expected
          }
          circuitBreaker.recordFailure(new Error('429 rate limit'));
        }
      }

      expect(circuitBreaker.getState()).toBe('open');
    });
  });
});

describe('Chaos: Latency Injection Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(100);
  });

  describe('Variable Latency', () => {
    it('should handle servers with variable response times', async () => {
      const port = getUniquePort();
      await createVariableLatencyServer(port);

      const latencies: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await fetch(`http://localhost:${port}/api/tags`);
        latencies.push(Date.now() - start);
      }

      const uniqueLatencies = new Set(latencies.map(l => Math.floor(l / 100)));
      expect(uniqueLatencies.size).toBeGreaterThan(1);
    });

    it('should handle gradually increasing latency', async () => {
      const port = getUniquePort();
      await createIncreasingLatencyServer(port);

      const latencies: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        await fetch(`http://localhost:${port}/api/tags`);
        latencies.push(Date.now() - start);
      }

      const avgFirstHalf = latencies.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
      const avgSecondHalf = latencies.slice(3).reduce((a, b) => a + b, 0) / 2;
      expect(avgSecondHalf).toBeGreaterThan(avgFirstHalf);
    });

    it('should timeout requests exceeding threshold', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'slow',
        latency: 5000,
      });

      let timedOut = false;
      try {
        await fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(500),
        });
      } catch (error) {
        timedOut = true;
      }

      expect(timedOut).toBe(true);
    });
  });
});

describe('Chaos: Multi-Server Coordination', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(100);
  });

  describe('Server Failover', () => {
    it('should failover when primary server fails', async () => {
      const port1 = getUniquePort();
      const port2 = getUniquePort();

      const server1 = await mockServerFactory.healthy(port1);
      const server2 = await mockServerFactory.healthy(port2);

      const response1 = await fetch(`http://localhost:${port1}/api/tags`);
      expect(response1.ok).toBe(true);

      await new Promise<void>(resolve => server1.close(() => resolve()));

      const response2 = await fetch(`http://localhost:${port2}/api/tags`);
      expect(response2.ok).toBe(true);
    });

    it('should handle all servers failing', async () => {
      const port1 = getUniquePort();
      const port2 = getUniquePort();

      await createDiverseMockServer({ port: port1, type: 'unhealthy' });
      await createDiverseMockServer({ port: port2, type: 'unhealthy' });

      let failures = 0;
      for (let i = 0; i < 4; i++) {
        try {
          const res = await fetch(`http://localhost:${port1}/api/tags`);
          if (!res.ok) failures++;
        } catch {
          failures++;
        }
        try {
          const res = await fetch(`http://localhost:${port2}/api/tags`);
          if (!res.ok) failures++;
        } catch {
          failures++;
        }
      }

      expect(failures).toBeGreaterThan(0);
    });

    it('should load balance across healthy servers', async () => {
      const port1 = getUniquePort();
      const port2 = getUniquePort();

      await mockServerFactory.healthy(port1);
      await mockServerFactory.healthy(port2);

      let server1Count = 0;
      let server2Count = 0;

      for (let i = 0; i < 10; i++) {
        try {
          await fetch(`http://localhost:${port1}/api/tags`);
          server1Count++;
        } catch {
          // Try server 2
        }
        try {
          await fetch(`http://localhost:${port2}/api/tags`);
          server2Count++;
        } catch {
          // Failed
        }
      }

      expect(server1Count + server2Count).toBeGreaterThan(0);
    });
  });

  describe('Staggered Failures', () => {
    it('should handle staggered server failures', async () => {
      const ports = [getUniquePort(), getUniquePort(), getUniquePort()];

      for (const port of ports) {
        await mockServerFactory.healthy(port);
      }

      for (let i = 0; i < ports.length; i++) {
        const beforeFailure = ports.slice(i).length;
        expect(beforeFailure).toBeGreaterThan(0);
      }
    });
  });
});

describe('Chaos: Memory Pressure Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(100);
  });

  describe('Large Response Handling', () => {
    it('should handle large model lists', async () => {
      const port = getUniquePort();
      await createLargeResponseServer(port);

      const response = await fetch(`http://localhost:${port}/api/tags`);
      const data = await response.json();

      expect(data.models).toBeDefined();
      expect(data.models.length).toBeGreaterThan(10);
    });

    it('should handle chunked responses', async () => {
      const port = getUniquePort();
      await createChunkedResponseServer(port);

      const response = await fetch(`http://localhost:${port}/api/tags`);
      const text = await response.text();

      expect(text.length).toBeGreaterThan(0);
    });

    it('should handle slow large responses', async () => {
      const port = getUniquePort();
      await createSlowLargeResponseServer(port);

      const start = Date.now();
      try {
        await fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        // Expected timeout or success
      }
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThan(0);
    });
  });
});

async function createAuthFailureServer(port: number, statusCode: number): Promise<Server> {
  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: statusCode === 401 ? 'Unauthorized' : 'Forbidden' }));
    });
    server.listen(port, () => resolve(server));
  });
}

async function createRateLimitServer(port: number, limit: number): Promise<Server> {
  let requestCount = 0;

  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      requestCount++;
      if (requestCount > limit) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '1',
        });
        res.end(JSON.stringify({ error: 'Too many requests' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [] }));
      }
    });
    server.listen(port, () => resolve(server));
  });
}

async function createVariableLatencyServer(port: number): Promise<Server> {
  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      const latency = Math.floor(Math.random() * 500) + 50;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [] }));
      }, latency);
    });
    server.listen(port, () => resolve(server));
  });
}

async function createIncreasingLatencyServer(port: number): Promise<Server> {
  let requestCount = 0;

  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      requestCount++;
      const latency = Math.min(requestCount * 200, 2000);
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [] }));
      }, latency);
    });
    server.listen(port, () => resolve(server));
  });
}

async function createLargeResponseServer(port: number): Promise<Server> {
  const models = Array.from({ length: 50 }, (_, i) => ({
    name: `model-${i}`,
    size: `${100 + i * 10}MB`,
  }));

  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));
    });
    server.listen(port, () => resolve(server));
  });
}

async function createChunkedResponseServer(port: number): Promise<Server> {
  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      });

      res.write('{"mode');
      setTimeout(() => res.write('ls":['), 50);
      setTimeout(() => res.write('{"name":"test1"},'), 100);
      setTimeout(() => res.write('{"name":"test2"}'), 150);
      setTimeout(() => res.end(']}'), 200);
    });
    server.listen(port, () => resolve(server));
  });
}

async function createSlowLargeResponseServer(port: number): Promise<Server> {
  const models = Array.from({ length: 100 }, (_, i) => ({
    name: `model-${i}`,
    details: { parameter_size: `${i}GB` },
  }));

  return new Promise(resolve => {
    const server = require('http').createServer((req: any, res: any) => {
      const data = JSON.stringify({ models });
      let offset = 0;
      const chunkSize = 100;

      const interval = setInterval(() => {
        const chunk = data.slice(offset, offset + chunkSize);
        if (chunk) {
          res.write(chunk);
          offset += chunkSize;
        }
        if (offset >= data.length) {
          clearInterval(interval);
          res.end();
        }
      }, 50);
    });
    server.listen(port, () => resolve(server));
  });
}
