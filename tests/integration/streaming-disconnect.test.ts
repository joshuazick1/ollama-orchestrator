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

interface MockOllamaServer {
  server: Server;
  port: number;
  aborted: boolean;
  close(): Promise<void>;
}

const VALID_MODEL = 'smollm2:135m';

async function createStreamingOllamaMock(opts: {
  chunkIntervalMs?: number;
  totalChunks?: number;
}): Promise<MockOllamaServer> {
  const chunkIntervalMs = opts.chunkIntervalMs ?? 50;
  const totalChunks = opts.totalChunks ?? 100;

  let aborted = false;
  let chunkCount = 0;

  const server = await new Promise<Server>(resolve => {
    const s = createServer((req: IncomingMessage, res: ServerResponse) => {
      req.on('aborted', () => {
        aborted = true;
      });

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

        const interval = setInterval(() => {
          chunkCount++;
          if (chunkCount > totalChunks) {
            clearInterval(interval);
            res.end();
            return;
          }
          try {
            const payload =
              chunkCount === totalChunks
                ? JSON.stringify({
                    model: VALID_MODEL,
                    response: '',
                    done: true,
                    eval_count: chunkCount,
                  }) + '\n'
                : JSON.stringify({
                    model: VALID_MODEL,
                    response: `tok${chunkCount}`,
                    done: false,
                  }) + '\n';
            const ok = res.write(payload);
            if (!ok) {
              res.once('drain', () => {});
            }
          } catch (e) {
            clearInterval(interval);
          }
        }, chunkIntervalMs);

        res.on('close', () => {
          clearInterval(interval);
        });
        return;
      }

      if (req.url === '/api/show' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ context_length: 4096 }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });

  const port = (server.address() as AddressInfo).port;

  return {
    server,
    port,
    get aborted() {
      return aborted;
    },
    async close() {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    },
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

describe('B22 fix: streaming client disconnect cleanup', () => {
  beforeEach(async () => {
    resetOrchestratorInstance();
    await setupIntegrationTest();
    await loginAsAdmin();
  });

  afterEach(async () => {
    await teardownIntegrationTest();
  });

  it('clears in-flight tracking after a streaming client aborts (single request)', async () => {
    const mock = await createStreamingOllamaMock({ chunkIntervalMs: 30, totalChunks: 200 });
    try {
      const addRes = await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: 'mock-1',
        url: `http://127.0.0.1:${mock.port}`,
        type: 'ollama',
      });
      expect(addRes.status).toBe(200);

      const baseUrl = getIntegrationTestBaseUrl();
      const controller = new AbortController();
      const streamPromise = fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: VALID_MODEL,
          prompt: 'Count to 100',
          stream: true,
        }),
        signal: controller.signal,
      }).catch(() => null);

      await new Promise(r => setTimeout(r, 150));
      controller.abort();
      await streamPromise;

      await new Promise(r => setTimeout(r, 500));
      const after = getInFlightTotal();
      expect(after).toBe(0);
    } finally {
      await mock.close();
    }
  }, 15000);

  it('keeps in-flight at 0 after 10 concurrent streaming aborts', async () => {
    const mock = await createStreamingOllamaMock({ chunkIntervalMs: 30, totalChunks: 200 });
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
            prompt: `count ${i}`,
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
      const after = getInFlightTotal();
      expect(after).toBe(0);
    } finally {
      await mock.close();
    }
  }, 30000);
});
