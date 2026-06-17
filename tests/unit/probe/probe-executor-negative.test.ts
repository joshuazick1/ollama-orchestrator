/**
 * probe-executor-negative.test.ts
 * TDD RED phase: Tests for the negative probe executor.
 * These tests MUST FAIL because the implementation doesn't exist yet.
 *
 * The negative probe sends an intentionally invalid request
 * (with impossible model name) and inspects the response to detect
 * server-side capability gaps.
 */

import http from 'http';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// The import path doesn't exist yet - this is intentional (RED phase)
import { probeExecutorNegative } from '../../../src/orchestrator/probe-executor-negative.js';
import type { NegativeProbeResult } from '../../../src/orchestrator/probe-executor-negative.js';

/**
 * Inline mock server factory - creates ephemeral HTTP servers for testing.
 * This pattern is preferred for RED phase since T7's reusable mocks aren't ready.
 */
function createMockServer(
  handler: http.RequestListener
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        close: () =>
          new Promise<void>(res => {
            server.close(() => res());
          }),
      });
    });
  });
}

describe('probeExecutorNegative', () => {
  // ========================================================================
  // 7 INFERENCE ENDPOINTS - Response Classification Tests
  // ========================================================================
  // Each inference endpoint has multiple classification scenarios:
  // - 404 + JSON {"error":"model 'X' not found"} → capabilityConfirmed: true, modelNotFound: true
  // - 404 + HTML "404 page not found" → capabilityConfirmed: false, endpointAbsent: true
  // - 200 + NDJSON error → capabilityConfirmed: true, midStreamError: true
  // - 200 + valid response (no validation) → capabilityConfirmed: false, suspicious: true
  // - 429 + Retry-After → returns classification, respects backoff
  // - Network error → classified correctly

  describe('ollama_chat (POST /api/chat) - inference endpoint', () => {
    it('classifies 404 + model-not-found JSON as capabilityConfirmed=true, modelNotFound=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: "model '__neg_probe_definitely_not_a_model_xyz_12345__' not found",
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.modelNotFound).toBe(true);
        expect(result.endpointAbsent).toBe(false);
      } finally {
        await server.close();
      }
    });

    it('classifies 404 + HTML body as capabilityConfirmed=false, endpointAbsent=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('404 page not found');
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.endpointAbsent).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + NDJSON error stream as capabilityConfirmed=true, midStreamError=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write('{"error":"model not loaded"}\n');
        res.write('{"done":true}\n');
        res.end();
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.midStreamError).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + valid response as capabilityConfirmed=false, suspicious=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: '__neg_probe__',
            message: { role: 'assistant', content: 'hello' },
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.suspicious).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 429 + Retry-After header correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(60000);
      } finally {
        await server.close();
      }
    });

    it('classifies network error correctly', async () => {
      // Server that immediately closes connection
      const server = await createMockServer((req, res) => {
        res.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_chat' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.capabilityConfirmed).toBe(false);
      expect(result.networkError).toBe(true);
    });
  });

  describe('ollama_generate (POST /api/generate) - inference endpoint', () => {
    it('classifies 404 + model-not-found JSON as capabilityConfirmed=true, modelNotFound=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: "model '__neg_probe_definitely_not_a_model_xyz_12345__' not found",
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_generate' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.modelNotFound).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 404 + HTML as capabilityConfirmed=false, endpointAbsent=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body>404 Not Found</body></html>');
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_generate' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.endpointAbsent).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + NDJSON error as capabilityConfirmed=true, midStreamError=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write('{"error":"something went wrong"}\n');
        res.write('{"done":true}\n');
        res.end();
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_generate' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.midStreamError).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + valid response as capabilityConfirmed=false, suspicious=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: '__neg_probe__', response: 'hello', done: true }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_generate' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.suspicious).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 429 with Retry-After header correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '120' });
        res.end(JSON.stringify({ error: 'rate limit exceeded', retry_after: 120 }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_generate' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(120000);
      } finally {
        await server.close();
      }
    });

    it('classifies network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        req.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_generate' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.capabilityConfirmed).toBe(false);
      expect(result.networkError).toBe(true);
    });
  });

  describe('ollama_embeddings (POST /api/embeddings) - inference endpoint', () => {
    it('classifies 404 + model-not-found JSON as capabilityConfirmed=true, modelNotFound=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: "model '__neg_probe_definitely_not_a_model_xyz_12345__' not found",
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_embeddings' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.modelNotFound).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 404 + HTML as capabilityConfirmed=false, endpointAbsent=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('404 page not found');
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_embeddings' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.endpointAbsent).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + valid response as capabilityConfirmed=false, suspicious=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: '__neg_probe__', embedding: [0.1, 0.2, 0.3] }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_embeddings' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.suspicious).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 429 correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_embeddings' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(30000);
      } finally {
        await server.close();
      }
    });

    it('classifies network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_embeddings' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.capabilityConfirmed).toBe(false);
      expect(result.networkError).toBe(true);
    });
  });

  describe('openai_chat (POST /v1/chat/completions) - inference endpoint', () => {
    it('classifies 404 + model-not-found JSON as capabilityConfirmed=true, modelNotFound=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: "model '__neg_probe_definitely_not_a_model_xyz_12345__' not found",
              type: 'invalid_request_error',
            },
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.modelNotFound).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 404 + HTML as capabilityConfirmed=false, endpointAbsent=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>Not Found</body></html>');
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.endpointAbsent).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + NDJSON error as capabilityConfirmed=true, midStreamError=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write('{"error":{"message":"model not available","type":"invalid_request_error"}}\n');
        res.write('{"choices":[{"finish_reason":"stop"}]}\n');
        res.end();
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.midStreamError).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + valid response as capabilityConfirmed=false, suspicious=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model: '__neg_probe__',
            choices: [{ message: { role: 'assistant', content: 'hi' } }],
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.suspicious).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 429 correctly with Retry-After', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '90' });
        res.end(
          JSON.stringify({ error: { message: 'rate limit exceeded', type: 'rate_limit_error' } })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(90000);
      } finally {
        await server.close();
      }
    });

    it('classifies network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_chat' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.capabilityConfirmed).toBe(false);
      expect(result.networkError).toBe(true);
    });
  });

  describe('openai_completions (POST /v1/completions) - inference endpoint', () => {
    it('classifies 404 + model-not-found JSON as capabilityConfirmed=true, modelNotFound=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: "The model '__neg_probe_definitely_not_a_model_xyz_12345__' does not exist",
              type: 'invalid_request_error',
            },
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_completions' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.modelNotFound).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 404 + HTML as capabilityConfirmed=false, endpointAbsent=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('404 Not Found');
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_completions' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.endpointAbsent).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + NDJSON error as capabilityConfirmed=true, midStreamError=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write('{"error":{"message":"invalid model","type":"invalid_request_error"}}\n');
        res.write('{"choices":[{"text":"hello"}]}\n');
        res.end();
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_completions' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.midStreamError).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + valid response as capabilityConfirmed=false, suspicious=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: '__neg_probe__', choices: [{ text: 'hello' }] }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_completions' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.suspicious).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 429 correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '45' });
        res.end(
          JSON.stringify({ error: { message: 'rate limit exceeded', type: 'rate_limit_error' } })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_completions' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(45000);
      } finally {
        await server.close();
      }
    });

    it('classifies network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        req.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_completions' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.capabilityConfirmed).toBe(false);
      expect(result.networkError).toBe(true);
    });
  });

  describe('openai_embeddings (POST /v1/embeddings) - inference endpoint', () => {
    it('classifies 404 + model-not-found JSON as capabilityConfirmed=true, modelNotFound=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message: "model '__neg_probe_definitely_not_a_model_xyz_12345__' not found",
              type: 'invalid_request_error',
            },
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_embeddings' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.modelNotFound).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 404 + HTML as capabilityConfirmed=false, endpointAbsent=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('404 page not found');
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_embeddings' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.endpointAbsent).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + valid response as capabilityConfirmed=false, suspicious=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: '__neg_probe__', data: [{ embedding: [0.1, 0.2] }] }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_embeddings' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.suspicious).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 429 correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '15' });
        res.end(
          JSON.stringify({ error: { message: 'rate limit exceeded', type: 'rate_limit_error' } })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_embeddings' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(15000);
      } finally {
        await server.close();
      }
    });

    it('classifies network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_embeddings' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.capabilityConfirmed).toBe(false);
      expect(result.networkError).toBe(true);
    });
  });

  describe('anthropic_messages (POST /v1/messages) - inference endpoint', () => {
    it('classifies 404 + model-not-found JSON as capabilityConfirmed=true, modelNotFound=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              type: 'invalid_request',
              message: "model '__neg_probe_definitely_not_a_model_xyz_12345__' not found",
            },
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'anthropic_messages' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.modelNotFound).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 404 + HTML as capabilityConfirmed=false, endpointAbsent=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body>Not Found</body></html>');
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'anthropic_messages' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.endpointAbsent).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + NDJSON error as capabilityConfirmed=true, midStreamError=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write('{"error":{"type":"error","message":"model unavailable"}}\n');
        res.write('{"type":"message","id":"msg_123"}\n');
        res.end();
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'anthropic_messages' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(true);
        expect(result.midStreamError).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 200 + valid response as capabilityConfirmed=false, suspicious=true', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            type: 'message',
            id: 'msg_123',
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
          })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'anthropic_messages' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.capabilityConfirmed).toBe(false);
        expect(result.suspicious).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('classifies 429 correctly with Retry-After', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '120' });
        res.end(JSON.stringify({ error: { type: 'rate_limit', message: 'rate limit exceeded' } }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'anthropic_messages' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(120000);
      } finally {
        await server.close();
      }
    });

    it('classifies network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        req.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'anthropic_messages' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.capabilityConfirmed).toBe(false);
      expect(result.networkError).toBe(true);
    });
  });

  // ========================================================================
  // 4 ADMIN/LISTING ENDPOINTS - Success Verification Tests
  // ========================================================================
  // For admin endpoints, the negative probe should reach them and return success.
  // These endpoints don't require model capability verification.

  describe('ollama_tags (GET /api/tags) - admin endpoint', () => {
    it('returns success when server is reachable', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3:latest' }] }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_tags' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.success).toBe(true);
        expect(result.capabilityConfirmed).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('handles 429 rate limited response', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_tags' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(30000);
      } finally {
        await server.close();
      }
    });

    it('handles network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_tags' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.networkError).toBe(true);
    });
  });

  describe('ollama_ps (GET /api/ps) - admin endpoint', () => {
    it('returns success when server is reachable', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [] }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_ps' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.success).toBe(true);
        expect(result.capabilityConfirmed).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('handles 429 rate limited response', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_ps' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(60000);
      } finally {
        await server.close();
      }
    });

    it('handles network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        req.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_ps' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.networkError).toBe(true);
    });
  });

  describe('ollama_version (GET /api/version) - admin endpoint', () => {
    it('returns success when server is reachable', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.5.0' }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_version' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.success).toBe(true);
        expect(result.capabilityConfirmed).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('handles 429 rate limited response', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_version' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(30000);
      } finally {
        await server.close();
      }
    });

    it('handles network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_version' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.networkError).toBe(true);
    });
  });

  describe('openai_models (GET /v1/models) - admin endpoint', () => {
    it('returns success when server is reachable', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'llama3:latest' }] }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_models' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.success).toBe(true);
        expect(result.capabilityConfirmed).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('handles 429 rate limited response', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '90' });
        res.end(
          JSON.stringify({ error: { message: 'rate limit exceeded', type: 'rate_limit_error' } })
        );
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_models' },
          { serverUrl: `http://127.0.0.1:${server.port}` }
        );
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(90000);
      } finally {
        await server.close();
      }
    });

    it('handles network error correctly', async () => {
      const server = await createMockServer((req, res) => {
        res.destroy();
      });
      await server.close();

      const result = await probeExecutorNegative(
        { serverId: 'srv1', model: '__neg_probe__', endpoint: 'openai_models' },
        { serverUrl: `http://127.0.0.1:${server.port}` }
      );
      expect(result.networkError).toBe(true);
    });
  });

  // ========================================================================
  // EDGE CASES & BOUNDARY CONDITIONS
  // ========================================================================

  describe('timeout handling', () => {
    it('respects custom timeoutMs option', async () => {
      // Server that never responds
      const server = await createMockServer((req, res) => {
        // Hang indefinitely
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}`, timeoutMs: 100 }
        );
        expect(result.networkError).toBe(true);
        expect(result.timedOut).toBe(true);
      } finally {
        await server.close();
      }
    });
  });

  describe('apiKey passthrough', () => {
    it('passes Authorization header when apiKey is provided', async () => {
      let receivedHeaders: Record<string, string> = {};
      const server = await createMockServer((req, res) => {
        receivedHeaders = req.headers as Record<string, string>;
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'model not found' }));
      });
      try {
        await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_chat' },
          { serverUrl: `http://127.0.0.1:${server.port}`, apiKey: 'test-secret-key' }
        );
        expect(receivedHeaders['authorization']).toBe('Bearer test-secret-key');
      } finally {
        await server.close();
      }
    });
  });

  describe('serverUrl trailing slash handling', () => {
    it('handles serverUrl with trailing slash', async () => {
      const server = await createMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [] }));
      });
      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv1', model: '__neg_probe__', endpoint: 'ollama_tags' },
          { serverUrl: `http://127.0.0.1:${server.port}/` }
        );
        expect(result.success).toBe(true);
      } finally {
        await server.close();
      }
    });
  });
});
