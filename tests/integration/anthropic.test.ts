import { createServer } from 'http';
import { AddressInfo } from 'net';

import express from 'express';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { anthropicRouter } from '../../src/routes/orchestrator.js';

let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v1', anthropicRouter);

  server = createServer(app);
  await new Promise<void>(resolve => {
    server.listen(0, 'localhost', () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://localhost:${address.port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  let data: unknown;
  const ct = response.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, data };
}

describe('POST /v1/messages', () => {
  const validBody = {
    model: 'claude-3-opus-20240229',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 100,
  };

  const anthropicHeader = { 'anthropic-version': '2023-06-01' };

  it('returns 400 when anthropic-version header is missing', async () => {
    const { status, data } = await post('/v1/messages', validBody);

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).type).toBe('error');
    expect(((data as Record<string, unknown>).error as Record<string, unknown>).type).toBe(
      'invalid_request_error'
    );
    expect(((data as Record<string, unknown>).error as Record<string, unknown>).message).toMatch(
      /anthropic-version/i
    );
  });

  it('returns 400 when thinking field is present', async () => {
    const { status, data } = await post(
      '/v1/messages',
      { ...validBody, thinking: { type: 'enabled', budget_tokens: 500 } },
      anthropicHeader
    );

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).type).toBe('error');
    expect(((data as Record<string, unknown>).error as Record<string, unknown>).message).toMatch(
      /thinking/i
    );
  });

  it('returns 400 when cache_control field is present', async () => {
    const { status, data } = await post(
      '/v1/messages',
      { ...validBody, cache_control: { type: 'ephemeral' } },
      anthropicHeader
    );

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).type).toBe('error');
    expect(((data as Record<string, unknown>).error as Record<string, unknown>).message).toMatch(
      /cache_control/i
    );
  });

  it('returns 400 when model is missing', async () => {
    const { model: _model, ...bodyWithoutModel } = validBody;
    const { status, data } = await post('/v1/messages', bodyWithoutModel, anthropicHeader);

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).type).toBe('error');
    expect(((data as Record<string, unknown>).error as Record<string, unknown>).type).toBe(
      'invalid_request_error'
    );
  });

  it('returns 503 when no healthy Anthropic servers are available', async () => {
    const { status, data } = await post('/v1/messages', validBody, anthropicHeader);

    expect(status).toBe(503);
    expect((data as Record<string, unknown>).type).toBe('error');
    expect(((data as Record<string, unknown>).error as Record<string, unknown>).type).toBe(
      'overloaded_error'
    );
  });

  it('passes validation and reaches orchestrator for syntactically valid requests', async () => {
    const { status } = await post('/v1/messages', validBody, anthropicHeader);

    expect(status).not.toBe(400);
  });
});
