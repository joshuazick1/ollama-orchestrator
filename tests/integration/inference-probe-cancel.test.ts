import http from 'http';
import { AddressInfo } from 'net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InferenceProbeScheduler } from '../../src/inference-probe-scheduler.js';

function createMockOllamaServer() {
  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    if (path === '/api/generate') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: 'test response', done: true }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return { server };
}

async function startServer(
  server: http.Server
): Promise<{ port: number; close: () => Promise<void> }> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

describe('InferenceProbeScheduler - probe cancellation', () => {
  let mockServer: ReturnType<typeof createMockOllamaServer>;
  let serverPort: number;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    mockServer = createMockOllamaServer();
    const started = await startServer(mockServer.server);
    serverPort = started.port;
    closeServer = started.close;
  });

  afterEach(async () => {
    await closeServer();
  });

  it('should expose cancelProbe method', () => {
    const scheduler = new InferenceProbeScheduler(
      {
        enabled: true,
        intervalMs: 60000,
        maxConcurrentProbes: 2,
        maxProbesPerServer: 1,
        probeTimeoutMs: 30000,
        cooldownAfterUserRequestMs: 300000,
        minSamplesForCoverage: 5,
        onlyDuringLowTraffic: false,
        lowTrafficThreshold: 0.3,
      },
      () => [
        {
          id: 'srv-1',
          url: `http://127.0.0.1:${serverPort}`,
          maxConcurrency: 4,
          models: ['llama3'],
          supportsOllama: true,
          healthy: true,
        },
      ],
      () => ({ recordRequest: vi.fn() }) as any,
      () => ({ recordRequest: vi.fn() }) as any,
      () => ({ getOrCreate: () => ({ recordSuccess: vi.fn(), recordFailure: vi.fn() }) }),
      () => ({ isClusterRateLimited: () => false }) as any
    );
    expect(typeof scheduler.cancelProbe).toBe('function');
  });

  it('should expose getActiveProbeId method', () => {
    const scheduler = new InferenceProbeScheduler(
      {
        enabled: true,
        intervalMs: 60000,
        maxConcurrentProbes: 2,
        maxProbesPerServer: 1,
        probeTimeoutMs: 30000,
        cooldownAfterUserRequestMs: 300000,
        minSamplesForCoverage: 5,
        onlyDuringLowTraffic: false,
        lowTrafficThreshold: 0.3,
      },
      () => [
        {
          id: 'srv-1',
          url: `http://127.0.0.1:${serverPort}`,
          maxConcurrency: 4,
          models: ['llama3'],
          supportsOllama: true,
          healthy: true,
        },
      ],
      () => ({ recordRequest: vi.fn() }) as any,
      () => ({ recordRequest: vi.fn() }) as any,
      () => ({ getOrCreate: () => ({ recordSuccess: vi.fn(), recordFailure: vi.fn() }) }),
      () => ({ isClusterRateLimited: () => false }) as any
    );
    expect(typeof scheduler.getActiveProbeId).toBe('function');
  });

  it('should store and retrieve active probe id', () => {
    const scheduler = new InferenceProbeScheduler(
      {
        enabled: true,
        intervalMs: 60000,
        maxConcurrentProbes: 2,
        maxProbesPerServer: 1,
        probeTimeoutMs: 30000,
        cooldownAfterUserRequestMs: 300000,
        minSamplesForCoverage: 5,
        onlyDuringLowTraffic: false,
        lowTrafficThreshold: 0.3,
      },
      () => [
        {
          id: 'srv-1',
          url: `http://127.0.0.1:${serverPort}`,
          maxConcurrency: 4,
          models: ['llama3'],
          supportsOllama: true,
          healthy: true,
        },
      ],
      () => ({ recordRequest: vi.fn() }) as any,
      () => ({ recordRequest: vi.fn() }) as any,
      () => ({ getOrCreate: () => ({ recordSuccess: vi.fn(), recordFailure: vi.fn() }) }),
      () => ({ isClusterRateLimited: () => false }) as any
    );

    expect(scheduler.getActiveProbeId('srv-1', 'llama3')).toBeUndefined();
  });
});
