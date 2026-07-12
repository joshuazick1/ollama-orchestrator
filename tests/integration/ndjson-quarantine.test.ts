import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';

import { detectNdjsonResponse, parseResponse } from '../../src/utils/fetch-with-timeout.js';
import { setupIntegrationTest, teardownIntegrationTest } from './setup.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { getQuarantinePool } from '../../src/utils/quarantine-pool.js';

let ndjsonServer: HttpServer;
let ndjsonPort: number;
let ndjsonCallCount = 0;

const NDJSON_BODY =
  '{"model":"qwen3.6:latest","done":false,"message":{"role":"assistant","content":"chunk 0"}}\n' +
  '{"model":"qwen3.6:latest","done":false,"message":{"role":"assistant","content":"chunk 1"}}\n' +
  '{"model":"qwen3.6:latest","done":true}';

const SERVER_ID_BASE = 'ndjson-mock-server';
let SERVER_ID = SERVER_ID_BASE;
let testCounter = 0;

function nextServerId(): string {
  testCounter++;
  return `${SERVER_ID_BASE}-${testCounter}`;
}

beforeAll(async () => {
  await setupIntegrationTest();

  ndjsonServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'qwen3.6:latest', size: 24_000_000_000 }] }));
    } else if (req.method === 'GET' && req.url === '/api/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '0.5.0' }));
    } else if (req.method === 'POST' && req.url === '/api/show') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'qwen3.6:latest' }));
    } else if (req.method === 'POST' && (req.url === '/api/chat' || req.url === '/api/generate')) {
      ndjsonCallCount++;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end(NDJSON_BODY);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    ndjsonServer.listen(0, '127.0.0.1', () => {
      ndjsonPort = (ndjsonServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (ndjsonServer) {
    await new Promise<void>((resolve) => ndjsonServer.close(() => resolve()));
  }
  await teardownIntegrationTest();
});

afterEach(async () => {
  try {
    getQuarantinePool().unquarantine(SERVER_ID);
  } catch {}
  const orchestrator = getOrchestratorInstance();
  try {
    orchestrator.removeServer(SERVER_ID);
  } catch {}
});

beforeEach(() => {
  SERVER_ID = nextServerId();
});

async function addServerWithModels(): Promise<void> {
  const orchestrator = getOrchestratorInstance();
  orchestrator.addServer({
    id: SERVER_ID,
    url: `http://127.0.0.1:${ndjsonPort}`,
    type: 'ollama',
    maxConcurrency: 2,
  } as never);

  const added = orchestrator.getServers().find((s: { id: string }) => s.id === SERVER_ID);
  if (added) {
    await orchestrator.updateServerStatus(added);
  }
}

async function tryChatViaOrchestrator(): Promise<void> {
  const orchestrator = getOrchestratorInstance();
  try {
    await orchestrator.tryRequestWithFailover(
      'qwen3.6:latest',
      async (server: { url: string }) => {
        const res = await fetch(`${server.url}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen3.6:latest',
            stream: false,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        });
        return (await parseResponse(res)) ?? {};
      },
      false,
      'ollama_generate',
      'ollama'
    );
  } catch {}
}

describe('NDJSON upstream response → automatic quarantine', () => {
  it('detectNdjsonResponse catches the misbehaving body', () => {
    const detection = detectNdjsonResponse(NDJSON_BODY);
    expect(detection).not.toBeNull();
    expect(detection?.lineCount).toBe(3);
    expect(detection?.preview).toContain('qwen3.6:latest');
  });

  it('routes a non-streaming chat request to the mock server', async () => {
    await addServerWithModels();
    const orchestrator = getOrchestratorInstance();
    const added = orchestrator.getServers().find((s: { id: string }) => s.id === SERVER_ID);
    expect(added).toBeTruthy();
    expect(added?.healthy).toBe(true);
    expect(added?.supportsOllama).toBe(true);
    expect(added?.models).toContain('qwen3.6:latest');

    const before = ndjsonCallCount;
    await tryChatViaOrchestrator();
    expect(ndjsonCallCount).toBeGreaterThan(before);
  }, 30000);

  it('places the NDJSON-responding server in the quarantine pool', async () => {
    await addServerWithModels();
    expect(getQuarantinePool().isQuarantined(SERVER_ID)).toBe(false);

    await tryChatViaOrchestrator();

    expect(getQuarantinePool().isQuarantined(SERVER_ID)).toBe(true);
    const entry = getQuarantinePool().getEntry(SERVER_ID);
    expect(entry?.reason).toBe('garbage-response');
    expect(entry?.evidence).toMatchObject({
      signals: expect.arrayContaining(['ndjson-streaming-format']),
    });
    expect(entry?.evidence.confidence).toBe(1.0);
  }, 30000);
});