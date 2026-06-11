import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';

import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getOrchestratorInstance,
  resetOrchestratorInstance,
} from '../../src/orchestrator/orchestrator-instance.js';
import { anthropicRouter } from '../../src/routes/anthropic.routes.js';
import { inferenceRouter } from '../../src/routes/inference.routes.js';
import { v1Router } from '../../src/routes/v1.routes.js';
import { createServer as createTestServer } from '../fixtures/factories.js';

import { makeRequest, setupIntegrationTest, teardownIntegrationTest } from './setup.js';

type ParsedResponse = {
  status: number;
  data: unknown;
  headers: Headers;
};

let rootServer: HttpServer;
let rootBaseUrl: string;
const backendServers: HttpServer[] = [];

describe('API edge cases integration tests', () => {
  beforeAll(async () => {
    process.env.ORCHESTRATOR_AUTH_ENABLED = 'false';
    process.env.ENABLE_AUTH = 'false';

    resetOrchestratorInstance();
    await setupIntegrationTest();
    await startRootApiServer();
  });

  afterAll(async () => {
    await closeBackendServers();
    clearRegisteredServers();

    if (rootServer) {
      await new Promise<void>(resolve => rootServer.close(() => resolve()));
    }

    await teardownIntegrationTest();
    resetOrchestratorInstance();
  });

  beforeEach(async () => {
    await closeBackendServers();
    clearRegisteredServers();
  });

  describe('validation failures via makeRequest()', () => {
    it('returns 400 for missing required fields across Ollama endpoints', async () => {
      const responses = await Promise.all([
        makeRequest('POST', '/api/orchestrator/generate', {}),
        makeRequest('POST', '/api/orchestrator/chat', {}),
        makeRequest('POST', '/api/orchestrator/embeddings', {}),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(400);
        expect(response.data).toMatchObject({ error: 'Validation failed' });
        expect(Array.isArray((response.data as { details?: unknown }).details)).toBe(true);
        assertNoInternals(response.data);
      });
    });

    it('returns 400 for invalid field types without leaking internals', async () => {
      const responses = await Promise.all([
        makeRequest('POST', '/api/orchestrator/generate', {
          model: 123,
          prompt: ['wrong'],
          stream: 'yes',
        }),
        makeRequest('POST', '/api/orchestrator/chat', {
          model: 'llama3:latest',
          messages: 'not-an-array',
        }),
        makeRequest('POST', '/api/orchestrator/embeddings', {
          model: false,
          prompt: { text: 'bad' },
        }),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(400);
        expect(response.data).toMatchObject({ error: 'Validation failed' });
        assertNoInternals(response.data);
      });
    });

    it('rejects oversized validated model and prompt payloads', async () => {
      const oversizedModel = 'm'.repeat(201);
      const oversizedPrompt = 'x'.repeat(100001);

      const responses = await Promise.all([
        makeRequest('POST', '/api/orchestrator/generate', {
          model: oversizedModel,
          prompt: 'small prompt',
        }),
        makeRequest('POST', '/api/orchestrator/generate', {
          model: 'llama3:latest',
          prompt: oversizedPrompt,
        }),
        makeRequest('POST', '/api/orchestrator/embeddings', {
          model: 'nomic-embed-text:latest',
          prompt: oversizedPrompt,
        }),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(400);
        expect(response.data).toMatchObject({ error: 'Validation failed' });
        expect(JSON.stringify(response.data)).toMatch(/too long/i);
        assertNoInternals(response.data);
      });
    });

    it('handles concurrent invalid requests without race conditions', async () => {
      const requests = Array.from({ length: 20 }, (_, index) =>
        makeRequest('POST', '/api/orchestrator/chat', {
          model: 'llama3:latest',
          messages: index % 2 === 0 ? [] : [{ role: 'user' }],
        })
      );

      const responses = await Promise.all(requests);

      expect(responses).toHaveLength(20);
      responses.forEach(response => {
        expect(response.status).toBe(400);
        expect(response.data).toMatchObject({ error: 'Validation failed' });
        assertNoInternals(response.data);
      });
    });
  });

  describe('raw parser and protocol edge cases', () => {
    it('returns a safe 400 response for malformed JSON', async () => {
      const response = await requestRaw('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json }',
      });

      expect(response.status).toBe(400);
      expect(response.data).toMatchObject({ error: 'Invalid JSON payload' });
      assertNoInternals(response.data);
    });

    it('rejects content-type mismatches across Ollama, OpenAI, and Anthropic endpoints', async () => {
      const responses = await Promise.all([
        requestRaw('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            model: 'llama3:latest',
            messages: [{ role: 'user', content: 'hi' }],
          }),
        }),
        requestRaw('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] }),
        }),
        requestRaw('/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-test',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 16,
          }),
        }),
      ]);

      expect(responses[0].status).toBe(400);
      expect(responses[1].status).toBe(400);
      expect(responses[2].status).toBe(400);
      expect(responses[1].data).toMatchObject({
        error: expect.objectContaining({ type: 'invalid_request_error' }),
      });
      expect(responses[2].data).toMatchObject({
        type: 'error',
        error: expect.objectContaining({ type: 'invalid_request_error' }),
      });
      responses.forEach(response => assertNoInternals(response.data));
    });

    it('rejects oversized message payloads before controller execution', async () => {
      const oversizedMessage = 'x'.repeat(11 * 1024 * 1024);
      const response = await requestRaw('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3:latest',
          messages: [{ role: 'user', content: oversizedMessage }],
        }),
      });

      expect(response.status).toBe(413);
      expect(response.data).toMatchObject({ error: 'Payload too large' });
      assertNoInternals(response.data);
    });

    it('returns 400 for invalid OpenAI and Anthropic request bodies', async () => {
      const [openAiResponse, anthropicResponse] = await Promise.all([
        requestRaw('/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-test', messages: 'wrong-type' }),
        }),
        requestRaw('/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({ model: 'claude-test', messages: [], max_tokens: 'bad-type' }),
        }),
      ]);

      expect(openAiResponse.status).toBe(400);
      expect(openAiResponse.data).toMatchObject({
        error: expect.objectContaining({
          type: 'invalid_request_error',
          param: 'messages',
        }),
      });

      expect(anthropicResponse.status).toBe(400);
      expect(anthropicResponse.data).toMatchObject({
        type: 'error',
        error: expect.objectContaining({ type: 'invalid_request_error' }),
      });

      assertNoInternals(openAiResponse.data);
      assertNoInternals(anthropicResponse.data);
    });
  });

  describe('encoding, timeout, and concurrency handling', () => {
    it('accepts UTF-8 and escaped control characters via makeRequest()', async () => {
      const backend = await startBackendServer();
      registerBackendServer({
        id: 'encoding-server',
        url: backend.url,
        models: ['encoding-model'],
        maxConcurrency: 50,
      });

      const responses = await Promise.all([
        makeRequest('POST', '/api/orchestrator/generate', {
          model: 'encoding-model',
          prompt: 'こんにちは世界 🌍 مرحبا',
          stream: false,
        }),
        makeRequest('POST', '/api/orchestrator/generate', {
          model: 'encoding-model',
          prompt: 'line1\u0000line2\u001fline3',
          stream: false,
        }),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.data).toMatchObject({ done: true });
      });
    });

    it('surfaces upstream timeouts as safe errors', async () => {
      const backend = await startBackendServer({ delayMs: 150 });
      registerBackendServer({
        id: 'timeout-server',
        url: backend.url,
        models: ['timeout-model'],
        maxConcurrency: 50,
      });

      const response = await requestRaw('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Timeout': '50',
        },
        body: JSON.stringify({
          model: 'timeout-model',
          prompt: 'timeout please',
          stream: false,
        }),
      });

      expect(response.status).toBe(500);
      expect(response.data).toMatchObject({ error: 'Generate request failed' });
      expect(JSON.stringify(response.data)).toMatch(/timeout/i);
      assertNoInternals(response.data);
    });

    it('handles 20 concurrent chat requests without race conditions', async () => {
      const backend = await startBackendServer();
      registerBackendServer({
        id: 'concurrent-server',
        url: backend.url,
        models: ['chat-model'],
        maxConcurrency: 100,
      });

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          requestRaw('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'chat-model',
              messages: [{ role: 'user', content: `hello-${index}` }],
              stream: false,
            }),
          })
        )
      );

      expect(responses).toHaveLength(20);
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.data).toMatchObject({
          done: true,
          message: { role: 'assistant', content: 'ok' },
        });
      });
    });
  });
});

async function startRootApiServer(): Promise<void> {
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', inferenceRouter);
  app.use('/v1', v1Router);
  app.use('/', anthropicRouter);

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (isPayloadTooLarge(err)) {
        res.status(413).json({ error: 'Payload too large' });
        return;
      }

      if (isJsonSyntaxError(err)) {
        res.status(400).json({ error: 'Invalid JSON payload' });
        return;
      }

      next(err);
    }
  );

  app.use(
    (_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: 'Internal server error' });
    }
  );

  rootServer = createServer(app);
  await new Promise<void>(resolve => rootServer.listen(0, '127.0.0.1', () => resolve()));
  const address = rootServer.address() as AddressInfo;
  rootBaseUrl = `http://127.0.0.1:${address.port}`;
}

async function requestRaw(path: string, init: RequestInit): Promise<ParsedResponse> {
  const response = await fetch(`${rootBaseUrl}${path}`, init);
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
}

async function startBackendServer(options: { delayMs?: number } = {}): Promise<{ url: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (options.delayMs) {
      await new Promise(resolve => setTimeout(resolve, options.delayMs));
    }

    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'POST' && req.url === '/api/generate') {
      res.end(JSON.stringify({ model: 'test-model', response: 'ok', done: true }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      res.end(
        JSON.stringify({
          model: 'test-model',
          message: { role: 'assistant', content: 'ok' },
          done: true,
        })
      );
      return;
    }

    if (req.method === 'POST' && req.url === '/api/embeddings') {
      res.end(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  backendServers.push(server);

  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}` };
}

function registerBackendServer(options: {
  id: string;
  url: string;
  models: string[];
  maxConcurrency: number;
}): void {
  const orchestrator = getOrchestratorInstance();
  const factoryServer = createTestServer({
    id: options.id,
    url: options.url,
    type: 'ollama',
    maxConcurrency: options.maxConcurrency,
    healthy: true,
    models: options.models,
    supportsOllama: true,
    supportsV1: true,
    supportsAnthropic: true,
  });

  orchestrator.addServer({
    id: factoryServer.id,
    url: factoryServer.url,
    type: factoryServer.type,
    maxConcurrency: factoryServer.maxConcurrency,
  });

  const registered = orchestrator.getServer(factoryServer.id);
  if (registered) {
    registered.healthy = true;
    registered.models = [...factoryServer.models];
    registered.supportsOllama = true;
    registered.supportsV1 = true;
    registered.supportsAnthropic = true;
    registered.maxConcurrency = options.maxConcurrency;
  }
}

function clearRegisteredServers(): void {
  const orchestrator = getOrchestratorInstance();
  orchestrator.getServers().forEach(server => orchestrator.removeServer(server.id));
}

async function closeBackendServers(): Promise<void> {
  await Promise.all(
    backendServers
      .splice(0)
      .map(server => new Promise<void>(resolve => server.close(() => resolve())))
  );
}

function assertNoInternals(data: unknown): void {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  expect(text).not.toMatch(/stack/i);
  expect(text).not.toMatch(/SyntaxError|ZodError|ValidationError/);
  expect(text).not.toContain('/root/');
  expect(text).not.toContain('node_modules');
}

function isJsonSyntaxError(err: unknown): err is SyntaxError & { body?: unknown } {
  return err instanceof SyntaxError && 'body' in err;
}

function isPayloadTooLarge(err: unknown): err is { type: string } {
  return !!err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large';
}
