import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';

import { setupIntegrationTest, teardownIntegrationTest } from './setup.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { getQuarantinePool } from '../../src/utils/quarantine-pool.js';
import { attemptModelRepair } from '../../src/utils/model-repair.js';
import { logger } from '../../src/utils/logger.js';

let mockServer: HttpServer;
let mockPort: number;

/* Track what calls the mock received */
const calls: { endpoint: string; body?: string }[] = [];

/* Configurable: what error should /api/chat return */
let chatErrorBody: string | null = '{"error":"unable to load model"}';
let chatStatusCode = 500;

let pullStatusCode = 200;

const SERVER_ID_BASE = 'model-repair-mock';
let SERVER_ID = SERVER_ID_BASE;
let testCounter = 0;

function nextServerId(): string {
  testCounter++;
  return `${SERVER_ID_BASE}-${testCounter}`;
}

beforeAll(async () => {
  await setupIntegrationTest();

  mockServer = createServer((req, res) => {
    const url = req.url ?? '';
    const method = req.method ?? 'GET';

    // Collect body for POST/PUT/DELETE
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      process.stderr.write(`[DEBUG-MOCK] ${method} ${url} body=${body ? body.slice(0, 200) : '(empty)'}\n`);
      const parsedBody = body ? JSON.parse(body) : undefined;
      calls.push({ endpoint: `${method} ${url}`, body: parsedBody });

      if (method === 'GET' && url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'qwen3.6:latest', size: 24_000_000_000 }] }));
        return;
      }
      if (method === 'GET' && url === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.5.0' }));
        return;
      }
      if (method === 'POST' && url === '/api/show') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'qwen3.6:latest' }));
        return;
      }
      if ((method === 'POST' && (url === '/api/chat' || url === '/api/generate'))) {
        if (chatStatusCode === 200) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ model: 'qwen3.6:latest', message: { content: 'ok' }, done: true }));
        } else {
          res.writeHead(chatStatusCode, { 'Content-Type': 'application/json' });
          res.end(chatErrorBody ?? '{"error":"internal error"}');
        }
        return;
      }
      // Repair endpoints
      if (method === 'DELETE' && url === '/api/delete') {
        res.writeHead(200);
        res.end();
        return;
      }
      if (method === 'POST' && url === '/api/pull') {
        if (pullStatusCode !== 200) {
          res.writeHead(pullStatusCode);
          res.end('{"error":"pull failed"}');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end('{"status":"pulling manifest"}\n{"status":"success"}\n');
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = (mockServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (mockServer) {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }
  await teardownIntegrationTest();
});

afterEach(() => {
  // Reset mock state
  calls.length = 0;
  chatErrorBody = '{"error":"unable to load model"}';
  chatStatusCode = 500;
  pullStatusCode = 200;

  // Clean up orchestrator state
  try {
    getQuarantinePool().unquarantine(SERVER_ID);
  } catch {}
  const orch = getOrchestratorInstance();
  try {
    orch.removeServer(SERVER_ID);
  } catch {}
});

beforeEach(() => {
  SERVER_ID = nextServerId();
});

async function addServer(): Promise<void> {
  const orch = getOrchestratorInstance();
  orch.addServer({
    id: SERVER_ID,
    url: `http://127.0.0.1:${mockPort}`,
    type: 'ollama',
    maxConcurrency: 2,
  } as never);

  const added = orch.getServers().find((s: { id: string }) => s.id === SERVER_ID);
  if (added) {
    await orch.updateServerStatus(added);
  }
}

async function tryChat(): Promise<void> {
  const orch = getOrchestratorInstance();
  try {
    await orch.tryRequestWithFailover(
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
        const text = await res.text();
        if (!res.ok) {
          throw new Error(text);
        }
        return JSON.parse(text);
      },
      false,
      'ollama_generate',
      'ollama'
    );
  } catch {
    /* expected */
  }
}

describe('Corrupted model auto-repair and quarantine', () => {
  it('attemptModelRepair works when called directly', async () => {
    const result = await attemptModelRepair(
      `http://127.0.0.1:${mockPort}`,
      'qwen3.6:latest',
      5000,
      10000
    );
    expect(result.success).toBe(true);
    expect(result.action).toBe('removed-and-pulled');

    const deleteCalls = calls.filter((c) => c.endpoint === 'DELETE /api/delete');
    const pullCalls = calls.filter((c) => c.endpoint === 'POST /api/pull');
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    expect(pullCalls.length).toBeGreaterThanOrEqual(1);
  });
  it('quarantines the server with corrupted-model reason when model load fails', async () => {
    pullStatusCode = 500;
    await addServer();
    expect(getQuarantinePool().isQuarantined(SERVER_ID)).toBe(false);

    await tryChat();

    expect(getQuarantinePool().isQuarantined(SERVER_ID)).toBe(true);
    const entry = getQuarantinePool().getEntry(SERVER_ID);
    expect(entry?.reason).toBe('corrupted-model');
    expect(entry?.evidence).toMatchObject({
      model: 'qwen3.6:latest',
      status: 'repair-attempting',
    });
  });

  it('fires DELETE and PULL repair requests to the upstream server', async () => {
    await addServer();
    await tryChat();

    // Repair is awaited inline, so repair calls are guaranteed to have fired
    const deleteCalls = calls.filter((c) => c.endpoint === 'DELETE /api/delete');
    const pullCalls = calls.filter((c) => c.endpoint === 'POST /api/pull');

    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    expect(pullCalls.length).toBeGreaterThanOrEqual(1);
    expect(deleteCalls[0].body).toEqual({ name: 'qwen3.6:latest' });
    expect(pullCalls[0].body).toEqual({ name: 'qwen3.6:latest' });
  });

  it('lifts quarantine when auto-repair succeeds', async () => {
    await addServer();
    await tryChat();

    // Repair is awaited inline, so quarantine should be lifted
    expect(getQuarantinePool().isQuarantined(SERVER_ID)).toBe(false);
  });

  it('does NOT quarantine corrupted-model when the request succeeds', async () => {
    // Make the chat endpoint return success
    chatStatusCode = 200;
    chatErrorBody = null;

    await addServer();
    await tryChat();

    // No quarantine should have been placed
    expect(getQuarantinePool().isQuarantined(SERVER_ID)).toBe(false);
  });
});

describe('Runner crash auto-quarantine', () => {
  it('quarantines the server with runner-crash reason when runner terminates', async () => {
    chatErrorBody = '{"error":"runner process has terminated with exit code 139"}';

    await addServer();
    expect(getQuarantinePool().isQuarantined(SERVER_ID)).toBe(false);

    await tryChat();

    expect(getQuarantinePool().isQuarantined(SERVER_ID)).toBe(true);
    const entry = getQuarantinePool().getEntry(SERVER_ID);
    expect(entry?.reason).toBe('runner-crash');
    expect(entry?.evidence).toMatchObject({
      model: 'qwen3.6:latest',
    });
  });

  it('does NOT fire repair for runner crash errors', async () => {
    chatErrorBody = '{"error":"fatal model server error: SIGSEGV"}';

    await addServer();
    await tryChat();

    // Give any potential background work time to fire
    await new Promise((r) => setTimeout(r, 200));

    // No repair calls should have happened
    const repairCalls = calls.filter(
      (c) => c.endpoint === 'DELETE /api/delete' || c.endpoint === 'POST /api/pull'
    );
    expect(repairCalls.length).toBe(0);
  });
});
