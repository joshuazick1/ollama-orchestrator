import http from 'http';
import { AddressInfo } from 'net';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  CircuitBreaker,
  CircuitBreakerRegistry,
} from '../../src/circuit-breaker/circuit-breaker.js';
import {
  RecoveryTestCoordinator,
  resetRecoveryTestCoordinator,
} from '../../src/recovery-test-coordinator.js';
import { createMockOllamaServer } from '../utils/mock-server-factory.js';

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

describe('recovery-cycle integration – open→half-open→probe→close', () => {
  let mockServer: { server: http.Server; getRequestLog: () => string[]; getRequestCount: () => number };
  let serverPort: number;
  let closeServer: () => Promise<void>;
  let coordinator: RecoveryTestCoordinator;
  let registry: CircuitBreakerRegistry;

  beforeEach(async () => {
    resetRecoveryTestCoordinator();
    mockServer = createMockOllamaServer(0, { failGenerateFor: 0 });
    const started = await startServer(mockServer.server);
    serverPort = started.port;
    closeServer = started.close;

    registry = new CircuitBreakerRegistry({
      baseFailureThreshold: 1,
      adaptiveThresholds: false,
      openTimeout: 0,
    });

    coordinator = new RecoveryTestCoordinator({
      serverCooldownMs: 0,
      modelTestTimeoutMs: 5000,
    });

    const mockServerUrl = `http://127.0.0.1:${serverPort}`;
    coordinator.setServerUrlProvider(() => mockServerUrl);
    coordinator.setInFlightProvider(() => 0);
    coordinator.setIncrementInFlight(() => {});
    coordinator.setDecrementInFlight(() => {});
  });

  afterEach(async () => {
    await closeServer();
  });

  it('transitions breaker from open to closed via performCoordinatedRecoveryTest on success', async () => {
    const breaker = registry.getOrCreate('test-srv:llama3.1:8b', {
      baseFailureThreshold: 1,
      adaptiveThresholds: false,
      openTimeout: 0,
    });

    breaker.forceOpen();
    expect(breaker.getState()).toBe('open');

    breaker.forceHalfOpen();
    expect(breaker.getState()).toBe('half-open');

    const result = await coordinator.performCoordinatedRecoveryTest(breaker);
    expect(result).toBe(true);
  });

  it('returns false when server returns 503 for generate', async () => {
    await closeServer();
    mockServer = createMockOllamaServer(0, { failGenerateFor: 999 });
    const started = await startServer(mockServer.server);
    serverPort = started.port;
    closeServer = started.close;

    const mockServerUrl = `http://127.0.0.1:${serverPort}`;
    coordinator.setServerUrlProvider(() => mockServerUrl);

    const breaker = registry.getOrCreate('test-fail-srv:llama3.1:8b', {
      baseFailureThreshold: 1,
      adaptiveThresholds: false,
    });

    (breaker as any).nextRetryAt = Date.now() - 1;

    const result = await coordinator.performCoordinatedRecoveryTest(breaker);
    expect(result).toBe(false);
  });

  it('server-level breaker transitions from open to half-open via /api/tags probe', async () => {
    const serverBreaker = registry.getOrCreate('test-srv', {
      baseFailureThreshold: 1,
      adaptiveThresholds: false,
      openTimeout: 0,
    });

    serverBreaker.forceOpen();
    expect(serverBreaker.getState()).toBe('open');

    serverBreaker.forceHalfOpen();
    expect(serverBreaker.getState()).toBe('half-open');

    const result = await coordinator.performCoordinatedRecoveryTest(serverBreaker);
    expect(result).toBe(true);

    const requestLog = mockServer.getRequestLog();
    expect(requestLog.some(r => r.includes('/api/tags'))).toBe(true);
  });

  it('runActiveTests closes a half-open breaker on successful probe', async () => {
    const breaker = registry.getOrCreate('probe-srv:llama3.1:8b', {
      baseFailureThreshold: 1,
      recoverySuccessThreshold: 1,
      adaptiveThresholds: false,
      openTimeout: 0,
    });

    breaker.forceOpen();
    expect(breaker.getState()).toBe('open');

    breaker.forceHalfOpen();
    expect(breaker.getState()).toBe('half-open');

    const results = await coordinator.runActiveTests('probe-srv', [
      { breaker, model: 'llama3.1:8b' },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(breaker.getState()).toBe('closed');
  });

  it('runActiveTests with maxConcurrentPerServer=1 tests only one breaker at a time', async () => {
    const breakerA = registry.getOrCreate('seq-srv:modelA', {
      baseFailureThreshold: 1,
      recoverySuccessThreshold: 1,
      adaptiveThresholds: false,
      openTimeout: 0,
    });
    const breakerB = registry.getOrCreate('seq-srv:modelB', {
      baseFailureThreshold: 1,
      recoverySuccessThreshold: 1,
      adaptiveThresholds: false,
      openTimeout: 0,
    });
    const breakerC = registry.getOrCreate('seq-srv:modelC', {
      baseFailureThreshold: 1,
      recoverySuccessThreshold: 1,
      adaptiveThresholds: false,
      openTimeout: 0,
    });

    breakerA.forceHalfOpen();
    breakerB.forceHalfOpen();
    breakerC.forceHalfOpen();

    // With maxConcurrentPerServer=1, only one should be tested in this batch
    const results = await coordinator.runActiveTests('seq-srv', [
      { breaker: breakerA, model: 'modelA' },
      { breaker: breakerB, model: 'modelB' },
      { breaker: breakerC, model: 'modelC' },
    ]);

    expect(results).toHaveLength(1);
    // The others should NOT have been tested
    expect(breakerB.getState()).toBe('half-open');
    expect(breakerC.getState()).toBe('half-open');
  });
}, 30000);
