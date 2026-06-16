import http from 'http';
import { AddressInfo } from 'net';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ProbeOrchestrator } from '../../src/probe/probe-orchestrator.js';
import { RecoveryDriver } from '../../src/probe/recovery-driver.js';
import type { Tuple, ProbeState } from '../../src/probe/types.js';
import { createMockOllamaServer } from '../utils/mock-server-factory.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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

describe('recovery-cycle integration – UNHEALTHY→RECOVERING→HEALTHY', () => {
  let mockServer: {
    server: http.Server;
    getRequestLog: () => string[];
    getRequestCount: () => number;
  };
  let serverPort: number;
  let closeServer: () => Promise<void>;
  let orchestrator: ProbeOrchestrator;
  let driver: RecoveryDriver;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setupHealthyServer(failGenerateFor = 0) {
    if (mockServer) {
      await closeServer();
    }
    mockServer = createMockOllamaServer(0, { failGenerateFor });
    const started = await startServer(mockServer.server);
    serverPort = started.port;
    closeServer = started.close;
  }

  it('transitions probe from UNHEALTHY to RECOVERING on success', async () => {
    await setupHealthyServer(0);

    orchestrator = new ProbeOrchestrator();
    driver = new RecoveryDriver(orchestrator, {
      recoveryBackoffMs: [0],
      recoverySuccessThreshold: 1,
      probeTimeoutMs: 5000,
      maxConcurrentProbes: 10,
    });

    const tuple: Tuple = {
      serverId: 'test-srv',
      model: 'llama3.1:8b',
      endpoint: 'ollama_chat',
    };

    orchestrator.setStateForTesting(tuple, 'UNHEALTHY');

    const result = await orchestrator.recordProbeResult(tuple, true);
    expect(result).toBe('RECOVERING');
  });

  it('returns false when server returns 503 for generate', async () => {
    await setupHealthyServer(999);

    orchestrator = new ProbeOrchestrator();
    driver = new RecoveryDriver(orchestrator, {
      recoveryBackoffMs: [0],
      recoverySuccessThreshold: 1,
      probeTimeoutMs: 5000,
      maxConcurrentProbes: 10,
    });

    const tuple: Tuple = {
      serverId: 'test-fail-srv',
      model: 'llama3.1:8b',
      endpoint: 'ollama_chat',
    };

    orchestrator.setStateForTesting(tuple, 'UNHEALTHY');

    const result = await orchestrator.recordProbeResult(tuple, false, {
      kind: 'transient',
      retryable: true,
    });
    expect(result).toBe('UNHEALTHY');
  });

  it('transitions from UNHEALTHY to RECOVERING after probe success', async () => {
    await setupHealthyServer(0);

    orchestrator = new ProbeOrchestrator();

    const tuple: Tuple = {
      serverId: 'test-srv',
      model: 'llama3.1:8b',
      endpoint: 'ollama_chat',
    };

    orchestrator.setStateForTesting(tuple, 'UNHEALTHY');

    const result = await orchestrator.recordProbeResult(tuple, true);
    expect(result).toBe('RECOVERING');

    const requestLog = mockServer.getRequestLog();
    expect(requestLog.some(r => r.includes('/api/tags') || r.includes('/api/generate'))).toBe(true);
  });

  it('closes a RECOVERING probe on successful probe', async () => {
    await setupHealthyServer(0);

    orchestrator = new ProbeOrchestrator();

    const tuple: Tuple = {
      serverId: 'probe-srv',
      model: 'llama3.1:8b',
      endpoint: 'ollama_chat',
    };

    orchestrator.setStateForTesting(tuple, 'RECOVERING');

    const results = [];
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1000);
      const result = await orchestrator.recordProbeResult(tuple, true);
      results.push(result);
    }

    expect(results[results.length - 1]).toBe('HEALTHY');
  });

  it('multiple RECOVERING probes are deduplicated by markProbing', async () => {
    await setupHealthyServer(0);

    orchestrator = new ProbeOrchestrator();

    const tupleA: Tuple = { serverId: 'seq-srv', model: 'modelA', endpoint: 'ollama_chat' };
    const tupleB: Tuple = { serverId: 'seq-srv', model: 'modelB', endpoint: 'ollama_chat' };
    const tupleC: Tuple = { serverId: 'seq-srv', model: 'modelC', endpoint: 'ollama_chat' };

    orchestrator.setStateForTesting(tupleA, 'RECOVERING');
    orchestrator.setStateForTesting(tupleB, 'RECOVERING');
    orchestrator.setStateForTesting(tupleC, 'RECOVERING');

    const resultA = orchestrator.markProbing(tupleA);
    const resultB = orchestrator.markProbing(tupleB);
    const resultC = orchestrator.markProbing(tupleC);

    const trueCount = [resultA, resultB, resultC].filter(r => r === true).length;
    expect(trueCount).toBe(1);
  });
}, 30000);
