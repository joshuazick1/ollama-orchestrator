import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { getInFlightManager } from '../../src/utils/in-flight-manager.js';

import {
  setupIntegrationTest,
  teardownIntegrationTest,
  loginAsAdmin,
  makeRequest,
  getIntegrationTestBaseUrl,
} from './setup.js';

const VALID_MODEL = 'smollm2:135m';

async function createSlowStreamingMock(): Promise<{
  server: Server;
  port: number;
  close: () => Promise<void>;
}> {
  const server = await new Promise<Server>(resolve => {
    const s = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/api/tags' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: VALID_MODEL }] }));
        return;
      }

      if (req.url === '/api/generate' && req.method === 'POST') {
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        let count = 0;
        const interval = setInterval(() => {
          count++;
          try {
            res.write(
              JSON.stringify({ model: VALID_MODEL, response: `t${count}`, done: false }) + '\n'
            );
          } catch (e) {
            clearInterval(interval);
          }
        }, 50);
        res.on('close', () => clearInterval(interval));
        return;
      }

      if (req.url === '/api/show' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ context_length: 4096 }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });

  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
      }),
  };
}

function getInFlightTotal(): number {
  const manager = getInFlightManager();
  const summary = manager.getInFlightDetailed();
  let total = 0;
  for (const v of Object.values(summary)) {
    total += v.total;
  }
  return total;
}

function getStreamingRequestCount(): number {
  return getInFlightManager().getAllStreamingRequests().length;
}

describe('B22 fix: concurrent streaming disconnect cleanup', () => {
  beforeEach(async () => {
    resetOrchestratorInstance();
    await setupIntegrationTest();
    await loginAsAdmin();
  });

  afterEach(async () => {
    await teardownIntegrationTest();
  });

  it('in-flight and streamingRequests are both 0 after 10 concurrent aborts', async () => {
    const mock = await createSlowStreamingMock();
    try {
      const addRes = await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: 'mock-1',
        url: `http://127.0.0.1:${mock.port}`,
        type: 'ollama',
      });
      expect(addRes.status).toBe(200);

      const baseUrl = getIntegrationTestBaseUrl();
      const controllers: AbortController[] = [];
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        const controller = new AbortController();
        controllers.push(controller);
        const p = fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: VALID_MODEL,
            prompt: `c${i}`,
            stream: true,
          }),
          signal: controller.signal,
        }).catch(() => null);
        promises.push(p);
      }

      await new Promise(r => setTimeout(r, 250));
      for (const c of controllers) {
        c.abort();
      }
      await Promise.allSettled(promises);

      await new Promise(r => setTimeout(r, 1500));
      const inFlight = getInFlightTotal();
      const streaming = getStreamingRequestCount();
      expect(inFlight).toBe(0);
      expect(streaming).toBe(0);
    } finally {
      await mock.close();
    }
  }, 30000);

  it('subsequent simple (non-streaming) requests succeed after 10 streaming aborts', async () => {
    const mock = await createSlowStreamingMock();
    try {
      const addRes = await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: 'mock-1',
        url: `http://127.0.0.1:${mock.port}`,
        type: 'ollama',
      });
      expect(addRes.status).toBe(200);

      const baseUrl = getIntegrationTestBaseUrl();
      const controllers: AbortController[] = [];
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        const controller = new AbortController();
        controllers.push(controller);
        const p = fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: VALID_MODEL,
            prompt: `c${i}`,
            stream: true,
          }),
          signal: controller.signal,
        }).catch(() => null);
        promises.push(p);
      }

      await new Promise(r => setTimeout(r, 200));
      for (const c of controllers) {
        c.abort();
      }
      await Promise.allSettled(promises);

      await new Promise(r => setTimeout(r, 1000));

      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: VALID_MODEL,
            prompt: 'hi',
            stream: false,
          }),
        });
        results.push(res.status);
      }

      const ok = results.filter(s => s === 200).length;
      expect(ok).toBeGreaterThanOrEqual(4);
    } finally {
      await mock.close();
    }
  }, 30000);
});
