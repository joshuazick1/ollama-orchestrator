import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createServer, Server } from 'http';
import {
  modelNotFound,
  notSupported,
  rateLimitedOnInvalid,
  html404,
  mockServerFactory,
} from './mock-server-factory.js';

const TEST_PORT_BASE = 45000;

async function fetchJson(
  url: string,
  options?: { method?: string; body?: string }
): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(url, {
    method: options?.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body,
  } as any);
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers as Headers };
}

describe('mock-server-factory negative probe variants', () => {
  describe('modelNotFound', () => {
    let server: Server;

    it('server starts and listens on the given port', async () => {
      server = await modelNotFound(TEST_PORT_BASE + 1);
      const { status } = await fetchJson(`http://localhost:${TEST_PORT_BASE + 1}/api/tags`);
      expect(status).toBe(200);
    });

    it('POST to /api/chat returns 404 with model not found error', async () => {
      server = await modelNotFound(TEST_PORT_BASE + 2);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 2}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model: 'test', messages: [] }),
      });
      expect(result.status).toBe(404);
      expect(result.body.error).toContain('__neg_probe_definitely_not_a_model_xyz_12345__');
      expect(result.body.error).toContain('not found');
    });

    it('GET to /api/tags returns success', async () => {
      server = await modelNotFound(TEST_PORT_BASE + 3);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 3}/api/tags`);
      expect(result.status).toBe(200);
      expect(result.body).toHaveProperty('status');
    });

    afterEach(() => {
      return new Promise<void>(resolve => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    });
  });

  describe('notSupported', () => {
    let server: Server;

    it('server starts and listens on the given port', async () => {
      server = await notSupported(TEST_PORT_BASE + 11);
      const { status } = await fetchJson(`http://localhost:${TEST_PORT_BASE + 11}/api/tags`);
      expect(status).toBe(200);
    });

    it('POST to /api/chat returns 404 HTML', async () => {
      server = await notSupported(TEST_PORT_BASE + 12);
      const response = await fetch(`http://localhost:${TEST_PORT_BASE + 12}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [] }),
      } as any);
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe('404 page not found');
    });

    it('GET to /api/tags returns success', async () => {
      server = await notSupported(TEST_PORT_BASE + 13);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 13}/api/tags`);
      expect(result.status).toBe(200);
      expect(result.body).toHaveProperty('status');
    });

    afterEach(() => {
      return new Promise<void>(resolve => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    });
  });

  describe('rateLimitedOnInvalid', () => {
    let server: Server;

    it('server starts and listens on the given port', async () => {
      server = await rateLimitedOnInvalid(TEST_PORT_BASE + 21);
      const { status } = await fetchJson(`http://localhost:${TEST_PORT_BASE + 21}/api/tags`);
      expect(status).toBe(200);
    });

    it('POST to /api/chat returns 429 with Retry-After header', async () => {
      server = await rateLimitedOnInvalid(TEST_PORT_BASE + 22);
      const response = await fetch(`http://localhost:${TEST_PORT_BASE + 22}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [] }),
      } as any);
      expect(response.status).toBe(429);
      const retryAfter = response.headers.get('Retry-After');
      expect(retryAfter).toBe('5');
      const result = await response.json();
      expect(result.error).toBe('rate limit exceeded');
    });

    it('GET to /api/tags returns success', async () => {
      server = await rateLimitedOnInvalid(TEST_PORT_BASE + 23);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 23}/api/tags`);
      expect(result.status).toBe(200);
      expect(result.body).toHaveProperty('status');
    });

    afterEach(() => {
      return new Promise<void>(resolve => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    });
  });

  describe('html404', () => {
    let server: Server;

    it('server starts and listens on the given port', async () => {
      server = await html404(TEST_PORT_BASE + 31);
      const response = await fetch(`http://localhost:${TEST_PORT_BASE + 31}/api/tags`);
      expect(response.status).toBe(404);
    });

    it('POST to /api/chat returns 404 HTML', async () => {
      server = await html404(TEST_PORT_BASE + 32);
      const response = await fetch(`http://localhost:${TEST_PORT_BASE + 32}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [] }),
      } as any);
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe('404 page not found');
    });

    it('GET to /api/tags returns 404 HTML (all endpoints broken)', async () => {
      server = await html404(TEST_PORT_BASE + 33);
      const response = await fetch(`http://localhost:${TEST_PORT_BASE + 33}/api/tags`);
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe('404 page not found');
    });

    afterEach(() => {
      return new Promise<void>(resolve => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    });
  });

  describe('mockServerFactory entries', () => {
    it('modelNotFound is exported via mockServerFactory', async () => {
      const server = await mockServerFactory.modelNotFound(TEST_PORT_BASE + 41);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 41}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model: 'test', messages: [] }),
      });
      expect(result.status).toBe(404);
      return new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    });

    it('notSupported is exported via mockServerFactory', async () => {
      const server = await mockServerFactory.notSupported(TEST_PORT_BASE + 42);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 42}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model: 'test', messages: [] }),
      });
      expect(result.status).toBe(404);
      return new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    });

    it('rateLimitedOnInvalid is exported via mockServerFactory', async () => {
      const server = await mockServerFactory.rateLimitedOnInvalid(TEST_PORT_BASE + 43);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 43}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model: 'test', messages: [] }),
      });
      expect(result.status).toBe(429);
      return new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    });

    it('html404 is exported via mockServerFactory', async () => {
      const server = await mockServerFactory.html404(TEST_PORT_BASE + 44);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 44}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model: 'test', messages: [] }),
      });
      expect(result.status).toBe(404);
      return new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    });
  });
});
