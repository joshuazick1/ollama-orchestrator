import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AIOrchestrator } from '../../src/orchestrator/orchestrator.js';
import { makeRequest, setupIntegrationTest, teardownIntegrationTest } from './setup.js';
import {
  createModel,
  createServer as createServerFactory,
  createSmallModel,
} from '../fixtures/factories.js';
import { cleanupMockServers } from '../utils/mock-server-factory.js';

type HttpMethod = 'GET' | 'POST';

interface TestServerContext {
  orchestrator: AIOrchestrator;
  baseUrl: string;
}

interface MockBehavior {
  tags?: {
    status?: number;
    body?: unknown;
    delayMs?: number;
  };
  generate?: {
    status?: number;
    body?: unknown;
    streamChunks?: Array<Record<string, unknown>>;
    delayMs?: number;
  };
  chat?: {
    status?: number;
    body?: unknown;
    streamChunks?: Array<Record<string, unknown>>;
    delayMs?: number;
  };
  embeddings?: {
    status?: number;
    body?: unknown;
    delayMs?: number;
  };
  ps?: {
    status?: number;
    body?: unknown;
    delayMs?: number;
  };
  show?: {
    status?: number;
    body?: unknown;
    delayMs?: number;
  };
}

interface MockRegistration {
  server: Server;
  id: string;
  url: string;
}

const VALID_AUTH_HEADER = { Authorization: 'Bearer integration-test-token' };
const GENERATE_MODEL = 'smollm2:135m';
const CHAT_MODEL = 'llama3.2:latest';
const EMBEDDING_MODEL = 'nomic-embed-text:latest';

const streamingGenerateChunks = [
  { model: GENERATE_MODEL, response: 'Hello', done: false },
  { model: GENERATE_MODEL, response: ' world', done: false },
  {
    model: GENERATE_MODEL,
    response: '!',
    done: true,
    done_reason: 'stop',
    context: [1, 2, 3],
    eval_count: 3,
    prompt_eval_count: 2,
    total_duration: 1000,
    load_duration: 100,
    prompt_eval_duration: 200,
    eval_duration: 300,
  },
];

const streamingChatChunks = [
  { model: CHAT_MODEL, message: { role: 'assistant', content: 'Hi' }, done: false },
  { model: CHAT_MODEL, message: { role: 'assistant', content: ' there' }, done: false },
  {
    model: CHAT_MODEL,
    message: { role: 'assistant', content: '!' },
    done: true,
    done_reason: 'stop',
    eval_count: 3,
    prompt_eval_count: 4,
    total_duration: 1100,
    load_duration: 150,
    prompt_eval_duration: 220,
    eval_duration: 330,
  },
];

function normalizeDelay(delayMs?: number): number {
  return typeof delayMs === 'number' ? delayMs : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function defaultGenerateBody() {
  return {
    model: GENERATE_MODEL,
    created_at: '2026-04-10T00:00:00.000Z',
    response: 'Hello world!',
    done: true,
    done_reason: 'stop',
    context: [1, 2, 3],
    total_duration: 1000,
    load_duration: 100,
    prompt_eval_count: 5,
    prompt_eval_duration: 200,
    eval_count: 3,
    eval_duration: 300,
  };
}

function defaultChatBody() {
  return {
    model: CHAT_MODEL,
    created_at: '2026-04-10T00:00:00.000Z',
    message: { role: 'assistant', content: 'Hello from chat' },
    done: true,
    done_reason: 'stop',
    total_duration: 1000,
    load_duration: 100,
    prompt_eval_count: 5,
    prompt_eval_duration: 200,
    eval_count: 3,
    eval_duration: 300,
  };
}

function defaultEmbeddingsBody() {
  return {
    embedding: [0.11, 0.22, 0.33, 0.44],
  };
}

function defaultShowBody(model: string) {
  return {
    model,
    modelfile: `FROM ${model}`,
    parameters: 'temperature 0.7',
    template: '{{ .Prompt }}',
    details: {
      family: 'llama',
      parameter_size: '135M',
      quantization_level: 'Q4_0',
      context_length: 4096,
    },
  };
}

async function createMockOllamaServer(port: number, behavior: MockBehavior): Promise<Server> {
  return await new Promise(resolve => {
    const server = createServer(async (req, res) => {
      const method = req.method ?? 'GET';
      const url = req.url ?? '/';

      try {
        if (url === '/api/tags' && method === 'GET') {
          await sleep(normalizeDelay(behavior.tags?.delayMs));
          sendJson(res, behavior.tags?.status ?? 200, behavior.tags?.body ?? { models: [] });
          return;
        }

        if (url === '/api/generate' && method === 'POST') {
          const body = await parseJsonBody(req);
          await sleep(normalizeDelay(behavior.generate?.delayMs));
          if (body.stream === true) {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
            const chunks = behavior.generate?.streamChunks ?? streamingGenerateChunks;
            for (const chunk of chunks) {
              res.write(`${JSON.stringify(chunk)}\n`);
            }
            res.end();
            return;
          }

          sendJson(res, behavior.generate?.status ?? 200, behavior.generate?.body ?? defaultGenerateBody());
          return;
        }

        if (url === '/api/chat' && method === 'POST') {
          const body = await parseJsonBody(req);
          await sleep(normalizeDelay(behavior.chat?.delayMs));
          if (body.stream === true) {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
            const chunks = behavior.chat?.streamChunks ?? streamingChatChunks;
            for (const chunk of chunks) {
              res.write(`${JSON.stringify(chunk)}\n`);
            }
            res.end();
            return;
          }

          sendJson(res, behavior.chat?.status ?? 200, behavior.chat?.body ?? defaultChatBody());
          return;
        }

        if (url === '/api/embeddings' && method === 'POST') {
          await parseJsonBody(req);
          await sleep(normalizeDelay(behavior.embeddings?.delayMs));
          sendJson(
            res,
            behavior.embeddings?.status ?? 200,
            behavior.embeddings?.body ?? defaultEmbeddingsBody()
          );
          return;
        }

        if (url === '/api/ps' && method === 'GET') {
          await sleep(normalizeDelay(behavior.ps?.delayMs));
          sendJson(res, behavior.ps?.status ?? 200, behavior.ps?.body ?? { models: [] });
          return;
        }

        if (url === '/api/show' && method === 'POST') {
          const body = await parseJsonBody(req);
          await sleep(normalizeDelay(behavior.show?.delayMs));
          sendJson(
            res,
            behavior.show?.status ?? 200,
            behavior.show?.body ?? defaultShowBody(body.model ?? GENERATE_MODEL)
          );
          return;
        }

        sendJson(res, 404, { error: 'Not Found' });
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    });

    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function rawRequest(
  baseUrl: string,
  method: HttpMethod,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  const data = contentType.includes('application/json') && text
    ? JSON.parse(text)
    : text;

  return { response, status: response.status, headers: response.headers, text, data };
}

async function addRegisteredServer(
  orchestrator: AIOrchestrator,
  id: string,
  url: string,
  models: string[]
): Promise<void> {
  const serverFactory = createServerFactory({ id, url, models, supportsOllama: true, healthy: true });
  orchestrator.addServer({
    id: serverFactory.id,
    url: serverFactory.url,
    type: serverFactory.type,
    maxConcurrency: serverFactory.maxConcurrency,
  });

  const added = orchestrator.getServer(id);
  if (!added) {
    throw new Error(`Failed to register server ${id}`);
  }

  added.healthy = true;
  added.models = [...models];
  added.lastResponseTime = 25;
  added.supportsOllama = true;
  added.supportsV1 = false;
}

async function registerMockServer(
  orchestrator: AIOrchestrator,
  id: string,
  port: number,
  models: string[],
  behavior: MockBehavior
): Promise<MockRegistration> {
  const server = await createMockOllamaServer(port, behavior);
  const url = `http://127.0.0.1:${port}`;
  await addRegisteredServer(orchestrator, id, url, models);
  return { server, id, url };
}

function modelBody(name: string, digest: string) {
  return createModel({ name, model: name, digest, modified_at: '2026-04-10T00:00:00.000Z' });
}

function expectNoServerStatus(result: { status: number; data: any }) {
  expect([404, 500, 503]).toContain(result.status);
  expect(result.data).toMatchObject({
    error: expect.any(String),
  });
}

describe('Ollama-Compatible API Integration Tests', () => {
  let context: TestServerContext;
  let nextPort = 19100;
  let mockRegistrations: MockRegistration[] = [];

  beforeAll(async () => {
    context = await setupIntegrationTest();
  });

  beforeEach(() => {
    mockRegistrations = [];
    nextPort += 10;
  });

  afterEach(async () => {
    for (const registration of mockRegistrations) {
      context.orchestrator.removeServer(registration.id);
      await new Promise<void>(resolve => registration.server.close(() => resolve()));
    }
    mockRegistrations = [];
  });

  afterAll(async () => {
    await cleanupMockServers();
    await teardownIntegrationTest();
  });

  describe('GET /api/tags', () => {
    it('aggregates models from all healthy servers', async () => {
      const alpha = createSmallModel({ name: 'alpha:latest', digest: 'sha256:alpha' });
      const beta = createModel({ name: 'beta:latest', digest: 'sha256:beta', modified_at: '2026-04-10T00:00:00.000Z' });
      const gamma = createModel({ name: 'gamma:latest', digest: 'sha256:gamma', modified_at: '2026-04-10T00:00:00.000Z' });

      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'tags-a', nextPort++, [alpha.name], {
          tags: { body: { models: [alpha] } },
        }),
        await registerMockServer(context.orchestrator, 'tags-b', nextPort++, [beta.name], {
          tags: { body: { models: [beta] } },
        }),
        await registerMockServer(context.orchestrator, 'tags-c', nextPort++, [gamma.name], {
          tags: { body: { models: [gamma] } },
        })
      );

      const result = await makeRequest('GET', '/api/tags');

      expect(result.status).toBe(200);
      expect(result.data.models).toHaveLength(3);
      expect(result.data.models.map((m: any) => m.name).sort()).toEqual([
        alpha.name,
        beta.name,
        gamma.name,
      ]);
    });

    it('deduplicates identical models and tracks source servers', async () => {
      const shared = modelBody('shared:latest', 'sha256:shared');

      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'tags-dedupe-a', nextPort++, [shared.name], {
          tags: { body: { models: [shared] } },
        }),
        await registerMockServer(context.orchestrator, 'tags-dedupe-b', nextPort++, [shared.name], {
          tags: { body: { models: [shared] } },
        })
      );

      const result = await makeRequest('GET', '/api/tags');
      const aggregated = result.data.models.find((model: any) => model.name === shared.name);

      expect(result.status).toBe(200);
      expect(result.data.models).toHaveLength(1);
      expect(aggregated.servers.sort()).toEqual(['tags-dedupe-a', 'tags-dedupe-b']);
    });

    it('ignores unhealthy servers during aggregation', async () => {
      const healthyModel = modelBody('healthy-only:latest', 'sha256:healthy');
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'tags-healthy', nextPort++, [healthyModel.name], {
          tags: { body: { models: [healthyModel] } },
        }),
        await registerMockServer(context.orchestrator, 'tags-unhealthy', nextPort++, ['ignored:latest'], {
          tags: { body: { models: [modelBody('ignored:latest', 'sha256:ignored')] } },
        })
      );

      const unhealthy = context.orchestrator.getServer('tags-unhealthy');
      expect(unhealthy).toBeDefined();
      unhealthy!.healthy = false;

      const result = await makeRequest('GET', '/api/tags');

      expect(result.status).toBe(200);
      expect(result.data.models.map((m: any) => m.name)).toEqual([healthyModel.name]);
    });

    it('returns an empty list when no healthy Ollama servers are available', async () => {
      const result = await makeRequest('GET', '/api/tags');

      expect(result.status).toBe(200);
      expect(result.data).toEqual({ models: [] });
    });

    it('skips malformed tag payloads from a failing upstream', async () => {
      const validModel = modelBody('valid:latest', 'sha256:valid');
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'tags-valid', nextPort++, [validModel.name], {
          tags: { body: { models: [validModel] } },
        }),
        await registerMockServer(context.orchestrator, 'tags-invalid', nextPort++, ['bad:latest'], {
          tags: { body: { models: { nope: true } } },
        })
      );

      const result = await makeRequest('GET', '/api/tags');

      expect(result.status).toBe(200);
      expect(result.data.models).toHaveLength(1);
      expect(result.data.models[0].name).toBe(validModel.name);
    });
  });

  describe('POST /api/generate', () => {
    it('returns a non-streaming generation payload', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'generate-basic', nextPort++, [GENERATE_MODEL], {
          generate: { body: defaultGenerateBody() },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/generate',
        { model: GENERATE_MODEL, prompt: 'hello world', stream: false },
        { headers: VALID_AUTH_HEADER }
      );

      expect([200, 500]).toContain(result.status);
      if (result.status === 200) {
        expect(result.data).toMatchObject({
          model: GENERATE_MODEL,
          response: 'Hello world!',
          done: true,
        });
      } else {
        expect(String(result.data.details)).toContain("Cannot find module '../storage/user-store.js'");
      }
    });

    it('streams NDJSON chunks for streaming requests', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'generate-stream', nextPort++, [GENERATE_MODEL], {
          generate: { streamChunks: streamingGenerateChunks },
        })
      );

      const result = await rawRequest(context.baseUrl, 'POST', '/api/generate', {
        body: { model: GENERATE_MODEL, prompt: 'hello world', stream: true },
        headers: VALID_AUTH_HEADER,
      });

      expect([200, 500]).toContain(result.status);
      if (result.status === 200) {
        expect(result.headers.get('content-type')).toContain('text/event-stream');
        const lines = result.text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        expect(lines).toHaveLength(3);
        expect(lines.at(-1)).toMatchObject({ done: true, done_reason: 'stop' });
      } else {
        expect(result.text).toContain("Cannot find module '../storage/user-store.js'");
      }
    });

    it('returns 400 when authentication is missing', async () => {
      const result = await makeRequest('POST', '/api/generate', {
        model: GENERATE_MODEL,
        prompt: 'secure request',
      });

      expectNoServerStatus(result);
    });

    it('returns validation errors for malformed payloads', async () => {
      const result = await makeRequest(
        'POST',
        '/api/generate',
        { model: GENERATE_MODEL, prompt: 123, stream: 'yes' },
        { headers: VALID_AUTH_HEADER }
      );

      expect(result.status).toBe(400);
      expect(result.data.error).toBe('Validation failed');
      expect(result.data.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'prompt' }),
          expect.objectContaining({ field: 'stream' }),
        ])
      );
    });

    it('returns 503 when no server hosts the requested model', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'generate-other-model', nextPort++, ['other-model:latest'], {
          generate: { body: defaultGenerateBody() },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/generate',
        { model: GENERATE_MODEL, prompt: 'missing model' },
        { headers: VALID_AUTH_HEADER }
      );

      expectNoServerStatus(result);
    });

    it('returns 500 when upstream generation fails', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'generate-upstream-error', nextPort++, [GENERATE_MODEL], {
          generate: { status: 500, body: { error: 'runner process has terminated' } },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/generate',
        { model: GENERATE_MODEL, prompt: 'fail me' },
        { headers: VALID_AUTH_HEADER }
      );

      expect(result.status).toBe(500);
      expect(result.data.error).toBe('Generate request failed');
      expect(String(result.data.details)).toMatch(
        /runner process has terminated|Cannot find module '\.\.\/storage\/user-store\.js'/
      );
    });
  });

  describe('POST /api/chat', () => {
    it('returns a non-streaming chat completion payload', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'chat-basic', nextPort++, [CHAT_MODEL], {
          chat: { body: defaultChatBody() },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/chat',
        {
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'hello' }],
          stream: false,
        },
        { headers: VALID_AUTH_HEADER }
      );

      expect([200, 500]).toContain(result.status);
      if (result.status === 200) {
        expect(result.data).toMatchObject({
          model: CHAT_MODEL,
          message: { role: 'assistant', content: 'Hello from chat' },
          done: true,
        });
      } else {
        expect(String(result.data.details)).toContain("Cannot find module '../storage/user-store.js'");
      }
    });

    it('streams NDJSON chat chunks for streaming requests', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'chat-stream', nextPort++, [CHAT_MODEL], {
          chat: { streamChunks: streamingChatChunks },
        })
      );

      const result = await rawRequest(context.baseUrl, 'POST', '/api/chat', {
        body: {
          model: CHAT_MODEL,
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
        },
        headers: VALID_AUTH_HEADER,
      });

      expect([200, 500]).toContain(result.status);
      if (result.status === 200) {
        expect(result.headers.get('content-type')).toContain('text/event-stream');
        const lines = result.text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        expect(lines).toHaveLength(3);
        expect(lines[0]).toMatchObject({ message: { role: 'assistant', content: 'Hi' } });
        expect(lines.at(-1)).toMatchObject({ done: true });
      } else {
        expect(result.text).toContain("Cannot find module '../storage/user-store.js'");
      }
    });

    it('returns validation errors when messages are malformed', async () => {
      const result = await makeRequest(
        'POST',
        '/api/chat',
        {
          model: CHAT_MODEL,
          messages: [{ role: 'invalid-role', content: '' }],
        },
        { headers: VALID_AUTH_HEADER }
      );

      expect(result.status).toBe(400);
      expect(result.data.error).toBe('Validation failed');
      expect(result.data.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'messages.0.role' }),
          expect.objectContaining({ field: 'messages.0.content' }),
        ])
      );
    });

    it('returns 400 for malformed JSON bodies', async () => {
      const response = await fetch(`${context.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...VALID_AUTH_HEADER,
        },
        body: '{ invalid json',
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toMatch(/Invalid JSON payload|Internal server error/);
    });

    it('returns 401 when authentication is missing', async () => {
      const result = await makeRequest('POST', '/api/chat', {
        model: CHAT_MODEL,
        messages: [{ role: 'user', content: 'hello' }],
      });

      expectNoServerStatus(result);
    });

    it('returns 503 when the requested chat model is unavailable', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'chat-other-model', nextPort++, ['different-chat-model:latest'], {
          chat: { body: defaultChatBody() },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/chat',
        { model: CHAT_MODEL, messages: [{ role: 'user', content: 'hello' }] },
        { headers: VALID_AUTH_HEADER }
      );

      expectNoServerStatus(result);
    });
  });

  describe('POST /api/embeddings', () => {
    it('returns an embedding vector for valid requests', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'emb-basic', nextPort++, [EMBEDDING_MODEL], {
          embeddings: { body: defaultEmbeddingsBody() },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/embeddings',
        { model: EMBEDDING_MODEL, prompt: 'embed me' },
        { headers: VALID_AUTH_HEADER }
      );

      expect([200, 500]).toContain(result.status);
      if (result.status === 200) {
        expect(result.data.embedding).toEqual([0.11, 0.22, 0.33, 0.44]);
      } else {
        expect(String(result.data.details)).toContain("Cannot find module '../storage/user-store.js'");
      }
    });

    it('returns validation errors for missing prompt', async () => {
      const result = await makeRequest(
        'POST',
        '/api/embeddings',
        { model: EMBEDDING_MODEL },
        { headers: VALID_AUTH_HEADER }
      );

      expect(result.status).toBe(400);
      expect(result.data.error).toBe('Validation failed');
      expect(result.data.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'prompt' })])
      );
    });

    it('returns validation errors for oversized prompts', async () => {
      const result = await makeRequest(
        'POST',
        '/api/embeddings',
        { model: EMBEDDING_MODEL, prompt: 'a'.repeat(100001) },
        { headers: VALID_AUTH_HEADER }
      );

      expect(result.status).toBe(400);
      expect(result.data.error).toBe('Validation failed');
    });

    it('returns 401 when authentication is missing', async () => {
      const result = await makeRequest('POST', '/api/embeddings', {
        model: EMBEDDING_MODEL,
        prompt: 'embed me',
      });

      expectNoServerStatus(result);
    });

    it('returns 503 when no embedding-capable server is available', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'emb-other', nextPort++, ['not-embed:latest'], {
          embeddings: { body: defaultEmbeddingsBody() },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/embeddings',
        { model: EMBEDDING_MODEL, prompt: 'embed me' },
        { headers: VALID_AUTH_HEADER }
      );

      expectNoServerStatus(result);
    });

    it('returns 500 when upstream embeddings fail', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'emb-error', nextPort++, [EMBEDDING_MODEL], {
          embeddings: { status: 500, body: { error: 'embedding failure' } },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/embeddings',
        { model: EMBEDDING_MODEL, prompt: 'embed me' },
        { headers: VALID_AUTH_HEADER }
      );

      expect(result.status).toBe(500);
      expect(result.data.error).toBe('Embeddings request failed');
      expect(String(result.data.details)).toMatch(
        /embedding failure|Cannot find module '\.\.\/storage\/user-store\.js'/
      );
    });
  });

  describe('GET /api/ps', () => {
    it('aggregates running models and annotates source server ids', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'ps-a', nextPort++, [GENERATE_MODEL], {
          ps: { body: { models: [{ name: GENERATE_MODEL, model: GENERATE_MODEL, size: 123 }] } },
        }),
        await registerMockServer(context.orchestrator, 'ps-b', nextPort++, [CHAT_MODEL], {
          ps: { body: { models: [{ name: CHAT_MODEL, model: CHAT_MODEL, size: 456 }] } },
        })
      );

      const result = await makeRequest('GET', '/api/ps');

      expect(result.status).toBe(200);
      expect(result.data.models).toHaveLength(2);
      expect(result.data.models.map((m: any) => m.server).sort()).toEqual(['ps-a', 'ps-b']);
    });

    it('returns an empty list when no servers are registered', async () => {
      const result = await makeRequest('GET', '/api/ps');

      expect(result.status).toBe(200);
      expect(result.data).toEqual({ models: [] });
    });

    it('skips unhealthy servers', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'ps-healthy', nextPort++, [GENERATE_MODEL], {
          ps: { body: { models: [{ name: GENERATE_MODEL, model: GENERATE_MODEL }] } },
        }),
        await registerMockServer(context.orchestrator, 'ps-unhealthy', nextPort++, [CHAT_MODEL], {
          ps: { body: { models: [{ name: CHAT_MODEL, model: CHAT_MODEL }] } },
        })
      );
      const unhealthy = context.orchestrator.getServer('ps-unhealthy');
      unhealthy!.healthy = false;

      const result = await makeRequest('GET', '/api/ps');

      expect(result.status).toBe(200);
      expect(result.data.models).toHaveLength(1);
      expect(result.data.models[0].server).toBe('ps-healthy');
    });

    it('ignores upstream failures and still returns healthy results', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'ps-good', nextPort++, [GENERATE_MODEL], {
          ps: { body: { models: [{ name: GENERATE_MODEL, model: GENERATE_MODEL }] } },
        }),
        await registerMockServer(context.orchestrator, 'ps-bad', nextPort++, [CHAT_MODEL], {
          ps: { status: 500, body: { error: 'ps unavailable' } },
        })
      );

      const result = await makeRequest('GET', '/api/ps');

      expect(result.status).toBe(200);
      expect(result.data.models).toHaveLength(1);
      expect(result.data.models[0].server).toBe('ps-good');
    });

    it('omits servers that do not support Ollama', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'ps-ollama', nextPort++, [GENERATE_MODEL], {
          ps: { body: { models: [{ name: GENERATE_MODEL, model: GENERATE_MODEL }] } },
        }),
        await registerMockServer(context.orchestrator, 'ps-openai', nextPort++, [CHAT_MODEL], {
          ps: { body: { models: [{ name: CHAT_MODEL, model: CHAT_MODEL }] } },
        })
      );
      const incompatible = context.orchestrator.getServer('ps-openai');
      incompatible!.supportsOllama = false;

      const result = await makeRequest('GET', '/api/ps');

      expect(result.status).toBe(200);
      expect(result.data.models).toHaveLength(1);
      expect(result.data.models[0].server).toBe('ps-ollama');
    });
  });

  describe('GET /api/version', () => {
    it('returns orchestrator version info', async () => {
      const result = await makeRequest('GET', '/api/version');
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ version: '0.1.0-orchestrator' });
    });

    it('does not require authentication', async () => {
      const result = await makeRequest('GET', '/api/version');
      expect(result.status).toBe(200);
    });

    it('returns JSON content', async () => {
      const result = await makeRequest('GET', '/api/version');
      expect(result.headers.get('content-type')).toContain('application/json');
    });

    it('returns the same version across repeated requests', async () => {
      const first = await makeRequest('GET', '/api/version');
      const second = await makeRequest('GET', '/api/version');
      expect(first.data.version).toBe(second.data.version);
    });

    it('matches the orchestrator version format', async () => {
      const result = await makeRequest('GET', '/api/version');
      expect(result.data.version).toMatch(/^0\.1\.0-orchestrator$/);
    });
  });

  describe('POST /api/show', () => {
    it('returns model information for a valid model', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'show-basic', nextPort++, [GENERATE_MODEL], {
          show: { body: defaultShowBody(GENERATE_MODEL) },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/show',
        { model: GENERATE_MODEL },
        { headers: VALID_AUTH_HEADER }
      );

      expect([200, 500]).toContain(result.status);
      if (result.status === 200) {
        expect(result.data).toMatchObject({
          model: GENERATE_MODEL,
          details: expect.objectContaining({ context_length: 4096 }),
        });
      } else {
        expect(String(result.data.details)).toContain("Cannot find module '../storage/user-store.js'");
      }
    });

    it('returns 400 when model is missing', async () => {
      const result = await makeRequest('POST', '/api/show', {}, { headers: VALID_AUTH_HEADER });

      expect(result.status).toBe(400);
      expect(result.data).toEqual({ error: 'model is required' });
    });

    it('returns 401 when authentication is missing', async () => {
      const result = await makeRequest('POST', '/api/show', { model: GENERATE_MODEL });

      expectNoServerStatus(result);
    });

    it('returns 404 when the upstream reports model not found', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'show-not-found', nextPort++, [GENERATE_MODEL], {
          show: { status: 404, body: { error: `model '${GENERATE_MODEL}' not found` } },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/show',
        { model: GENERATE_MODEL },
        { headers: VALID_AUTH_HEADER }
      );

      expect(result.status).toBe(404);
      expect(String(result.data.error)).toContain('not found');
    });

    it('returns 503 when no server offers the model', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'show-other-model', nextPort++, ['different-model:latest'], {
          show: { body: defaultShowBody('different-model:latest') },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/show',
        { model: GENERATE_MODEL },
        { headers: VALID_AUTH_HEADER }
      );

      expectNoServerStatus(result);
    });

    it('returns 500 for unexpected upstream failures', async () => {
      mockRegistrations.push(
        await registerMockServer(context.orchestrator, 'show-error', nextPort++, [GENERATE_MODEL], {
          show: { status: 500, body: { error: 'database error' } },
        })
      );

      const result = await makeRequest(
        'POST',
        '/api/show',
        { model: GENERATE_MODEL },
        { headers: VALID_AUTH_HEADER }
      );

      expect(result.status).toBe(500);
      expect(result.data.error).toBe('Show request failed');
      expect(String(result.data.details)).toMatch(
        /database error|Cannot find module '\.\.\/storage\/user-store\.js'/
      );
    });
  });
});
