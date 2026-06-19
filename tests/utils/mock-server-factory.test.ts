import { createServer, Server } from 'http';

import { describe, it, expect, afterEach, beforeEach } from 'vitest';

import {
  modelNotFound,
  notSupported,
  rateLimitedOnInvalid,
  html404,
  modelListingOllama,
  modelListingOpenAI,
  modelListingBoth,
  noModelListing,
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
  return { status: response.status, body, headers: response.headers };
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

  describe('modelListingOllama', () => {
    let server: Server;

    it('returns 3 models from /api/tags', async () => {
      server = await modelListingOllama(TEST_PORT_BASE + 51);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 51}/api/tags`);
      expect(result.status).toBe(200);
      expect(result.body.models).toHaveLength(3);
      expect(result.body.models[0].name).toBe('llama3:8b');
      expect(result.body.models[1].name).toBe('mistral:7b');
      expect(result.body.models[2].name).toBe('qwen2:1.5b');
    });

    it('/v1/models returns 404', async () => {
      server = await modelListingOllama(TEST_PORT_BASE + 52);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 52}/v1/models`);
      expect(result.status).toBe(404);
    });

    it('/api/ps returns success', async () => {
      server = await modelListingOllama(TEST_PORT_BASE + 53);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 53}/api/ps`);
      expect(result.status).toBe(200);
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

  describe('modelListingOpenAI', () => {
    let server: Server;

    it('returns 3 models from /v1/models', async () => {
      server = await modelListingOpenAI(TEST_PORT_BASE + 61);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 61}/v1/models`);
      expect(result.status).toBe(200);
      expect(result.body.object).toBe('list');
      expect(result.body.data).toHaveLength(3);
      expect(result.body.data[0].id).toBe('gpt-4');
      expect(result.body.data[1].id).toBe('gpt-3.5-turbo');
      expect(result.body.data[2].id).toBe('claude-3-opus');
    });

    it('/api/tags returns 404', async () => {
      server = await modelListingOpenAI(TEST_PORT_BASE + 62);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 62}/api/tags`);
      expect(result.status).toBe(404);
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

  describe('modelListingBoth', () => {
    let server: Server;

    it('returns 2 models from /api/tags', async () => {
      server = await modelListingBoth(TEST_PORT_BASE + 71);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 71}/api/tags`);
      expect(result.status).toBe(200);
      expect(result.body.models).toHaveLength(2);
      expect(result.body.models[0].name).toBe('llama3:8b');
      expect(result.body.models[1].name).toBe('mistral:7b');
    });

    it('returns 2 models from /v1/models', async () => {
      server = await modelListingBoth(TEST_PORT_BASE + 72);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 72}/v1/models`);
      expect(result.status).toBe(200);
      expect(result.body.object).toBe('list');
      expect(result.body.data).toHaveLength(2);
      expect(result.body.data[0].id).toBe('gpt-4');
      expect(result.body.data[1].id).toBe('claude-3-sonnet');
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

  describe('noModelListing', () => {
    let server: Server;

    it('/api/tags returns 500', async () => {
      server = await noModelListing(TEST_PORT_BASE + 81);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 81}/api/tags`);
      expect(result.status).toBe(500);
    });

    it('/v1/models returns 500', async () => {
      server = await noModelListing(TEST_PORT_BASE + 82);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 82}/v1/models`);
      expect(result.status).toBe(500);
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

    it('modelListingOllama is exported via mockServerFactory', async () => {
      const server = await mockServerFactory.modelListingOllama(TEST_PORT_BASE + 51);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 51}/api/tags`);
      expect(result.status).toBe(200);
      expect(result.body.models).toHaveLength(3);
      return new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    });

    it('modelListingOpenAI is exported via mockServerFactory', async () => {
      const server = await mockServerFactory.modelListingOpenAI(TEST_PORT_BASE + 62);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 62}/v1/models`);
      expect(result.status).toBe(200);
      expect(result.body.data).toHaveLength(3);
      return new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    });

    it('modelListingBoth is exported via mockServerFactory', async () => {
      const server = await mockServerFactory.modelListingBoth(TEST_PORT_BASE + 71);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 71}/api/tags`);
      expect(result.status).toBe(200);
      expect(result.body.models).toHaveLength(2);
      return new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    });

    it('noModelListing is exported via mockServerFactory', async () => {
      const server = await mockServerFactory.noModelListing(TEST_PORT_BASE + 81);
      const result = await fetchJson(`http://localhost:${TEST_PORT_BASE + 81}/api/tags`);
      expect(result.status).toBe(500);
      return new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    });
  });
});
