import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ConfigManager } from '../../../src/config/config.js';
import type { CapabilityProbeConfig } from '../../../src/config/schema.js';
import type { NegativeProbeResult } from '../../../src/orchestrator/probe-executor-negative.js';
import { EndpointRegistry } from '../../../src/probe/endpoint-registry.js';
import {
  CapabilityProbeScheduler,
  type ServerDescriptor,
} from '../../../src/probe/probe-scheduler.js';

function makeConfig(overrides: Partial<CapabilityProbeConfig> = {}): CapabilityProbeConfig {
  return {
    enabled: true,
    intervalMs: 300000,
    consecutiveFailureThreshold: 3,
    requestTimeoutMs: 5000,
    staggerOffsetMs: 30000,
    ...overrides,
  };
}

function makeConfigManager(config: CapabilityProbeConfig): ConfigManager {
  const manager = new ConfigManager();
  manager.updateSection('capabilityProbe', config);
  return manager;
}

const SERVERS: ServerDescriptor[] = [
  { id: 'srv1', url: 'http://127.0.0.1:7001', apiKey: undefined },
  { id: 'srv2', url: 'http://127.0.0.1:7002', apiKey: 'sk-test' },
];

function createMockProbeExecutor(results: Map<string, NegativeProbeResult>) {
  return vi
    .fn()
    .mockImplementation(
      async (
        tuple: { serverId: string; model: string; endpoint: string },
        _opts: { serverUrl: string; apiKey?: string; timeoutMs?: number }
      ): Promise<NegativeProbeResult> => {
        const key = `${tuple.serverId}:${tuple.endpoint}`;
        return (
          results.get(key) ?? {
            success: false,
            capabilityConfirmed: false,
            modelNotFound: false,
            endpointAbsent: false,
            midStreamError: false,
            suspicious: false,
            networkError: false,
            timedOut: false,
            retryable: false,
          }
        );
      }
    );
}

describe('CapabilityProbeScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start / stop', () => {
    it('starts and stops without error', () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig({ intervalMs: 60000 }));
      const scheduler = new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        serverListProvider: async () => [],
      });

      scheduler.start();
      scheduler.stop();
    });

    it('no-ops start if already running', () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig({ intervalMs: 60000 }));
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
      const scheduler = new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger,
        serverListProvider: async () => [],
      });

      scheduler.start();
      scheduler.start(); // second call no-ops
      scheduler.stop();
    });

    it('does not start if disabled in config', () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig({ enabled: false }));
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
      const scheduler = new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger,
        serverListProvider: async () => [],
      });

      scheduler.start();
      // Should log disabled message
      expect(
        (logger.info as ReturnType<typeof vi.fn>).mock.calls.some((c: unknown[]) =>
          String(c[0]).includes('disabled')
        )
      ).toBe(true);
    });
  });

  describe('runOnce', () => {
    it('no-ops when disabled', async () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig({ enabled: false }));
      const result = await new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        serverListProvider: async () => SERVERS,
      }).runOnce();

      expect(result.confirmed).toBe(0);
      expect(result.revoked).toBe(0);
    });

    it('calls probe executor for each endpoint on each server', async () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig());
      const probeExecutor = vi.fn().mockResolvedValue({
        success: true,
        capabilityConfirmed: true,
        modelNotFound: false,
        endpointAbsent: false,
        midStreamError: false,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: false,
      });

      await new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        serverListProvider: async () => SERVERS,
        probeExecutor,
      }).runOnce();

      // 2 servers x 11 endpoints = 22 calls
      expect(probeExecutor).toHaveBeenCalledTimes(22);
    });

    it('on modelNotFound: calls recordFailure with threshold', async () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig({ consecutiveFailureThreshold: 3 }));
      const results = new Map<string, NegativeProbeResult>();
      results.set('srv1:ollama_chat', {
        success: false,
        capabilityConfirmed: true,
        modelNotFound: true,
        endpointAbsent: false,
        midStreamError: false,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: false,
      });
      const probeExecutor = createMockProbeExecutor(results);
      const recordFailureSpy = vi.spyOn(registry, 'recordFailure');

      await new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        serverListProvider: async () => [SERVERS[0]],
        probeExecutor,
      }).runOnce();

      expect(recordFailureSpy).toHaveBeenCalledWith('srv1', 'ollama_chat', 3);
    });

    it('after N consecutive failures: endpoint is soft-revoked', async () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig({ consecutiveFailureThreshold: 3 }));

      // Pre-declare the endpoints that will be probed (only 7 tracked endpoints)
      const trackedEndpoints = [
        'ollama_chat',
        'ollama_generate',
        'ollama_embeddings',
        'openai_chat',
        'openai_completions',
        'openai_embeddings',
        'anthropic_messages',
      ] as const;
      for (const ep of trackedEndpoints) {
        registry.declare('srv1', ep);
      }

      const results = new Map<string, NegativeProbeResult>();
      for (const ep of trackedEndpoints) {
        results.set(`srv1:${ep}`, {
          success: false,
          capabilityConfirmed: true,
          modelNotFound: true,
          endpointAbsent: false,
          midStreamError: false,
          suspicious: false,
          networkError: false,
          timedOut: false,
          retryable: false,
        });
      }
      const probeExecutor = createMockProbeExecutor(results);

      // Run 3 times to hit threshold
      const scheduler = new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        serverListProvider: async () => [SERVERS[0]],
        probeExecutor,
      });

      await scheduler.runOnce();
      await scheduler.runOnce();
      await scheduler.runOnce();

      // After 3 runs, all endpoints should have 3 consecutive failures
      for (const ep of trackedEndpoints) {
        expect(registry.getConsecutiveFailures('srv1', ep)).toBe(3);
      }
      // getActiveEndpoints should return empty (soft-revoked)
      expect(registry.getActiveEndpoints('srv1', 'llama3').length).toBe(0);
    });

    it('on endpointAbsent: calls softRevoke immediately', async () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig());
      const results = new Map<string, NegativeProbeResult>();
      results.set('srv1:ollama_chat', {
        success: false,
        capabilityConfirmed: false,
        modelNotFound: false,
        endpointAbsent: true,
        midStreamError: false,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: false,
      });
      const probeExecutor = createMockProbeExecutor(results);
      const softRevokeSpy = vi.spyOn(registry, 'softRevoke');

      await new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        serverListProvider: async () => [SERVERS[0]],
        probeExecutor,
      }).runOnce();

      expect(softRevokeSpy).toHaveBeenCalledWith('srv1', 'ollama_chat');
    });

    it('on suspicious: logs warning but does NOT auto-revoke', async () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig());
      const results = new Map<string, NegativeProbeResult>();
      results.set('srv1:ollama_chat', {
        success: true,
        capabilityConfirmed: false,
        modelNotFound: false,
        endpointAbsent: false,
        midStreamError: false,
        suspicious: true,
        networkError: false,
        timedOut: false,
        retryable: false,
      });
      const probeExecutor = createMockProbeExecutor(results);
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
      const softRevokeSpy = vi.spyOn(registry, 'softRevoke');

      await new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger,
        serverListProvider: async () => [SERVERS[0]],
        probeExecutor,
      }).runOnce();

      expect(softRevokeSpy).not.toHaveBeenCalled();
      expect(
        (logger.warn as ReturnType<typeof vi.fn>).mock.calls.some((c: unknown[]) =>
          String(c[0]).includes('no validation')
        )
      ).toBe(true);
    });

    it('on capabilityConfirmed: calls confirm()', async () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig());
      const results = new Map<string, NegativeProbeResult>();
      results.set('srv1:ollama_chat', {
        success: true,
        capabilityConfirmed: true,
        modelNotFound: false,
        endpointAbsent: false,
        midStreamError: false,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: false,
      });
      const probeExecutor = createMockProbeExecutor(results);
      const confirmSpy = vi.spyOn(registry, 'confirm');

      await new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        serverListProvider: async () => [SERVERS[0]],
        probeExecutor,
      }).runOnce();

      expect(confirmSpy).toHaveBeenCalledWith('srv1', 'ollama_chat');
    });

    it('on 429: defers server by retryAfterMs', async () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig());
      const results = new Map<string, NegativeProbeResult>();
      results.set('srv1:ollama_chat', {
        success: true,
        capabilityConfirmed: false,
        modelNotFound: false,
        endpointAbsent: false,
        midStreamError: false,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: true,
        retryAfterMs: 120000,
        status: 429,
      });
      const probeExecutor = createMockProbeExecutor(results);

      const scheduler = new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        serverListProvider: async () => [SERVERS[0]],
        probeExecutor,
      });

      // First run - gets 429
      const result1 = await scheduler.runOnce();
      expect(result1.rateLimited).toBe(true);

      // Advance time but not past the retry window
      vi.advanceTimersByTime(60000);
      vi.useRealTimers();

      // Run again - should skip srv1
      const result2 = await scheduler.runOnce();
      expect(result2.errors.length).toBe(0); // No errors because srv1 was skipped

      vi.useFakeTimers();
    });

    it('runOnce with serverId filters to that server only', async () => {
      const registry = new EndpointRegistry();
      const configManager = makeConfigManager(makeConfig());
      const probeExecutor = vi.fn().mockResolvedValue({
        success: true,
        capabilityConfirmed: true,
        modelNotFound: false,
        endpointAbsent: false,
        midStreamError: false,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: false,
      });

      await new CapabilityProbeScheduler({
        endpointRegistry: registry,
        configManager,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
        serverListProvider: async () => SERVERS,
        probeExecutor,
      }).runOnce('srv1');

      // Only srv1's 11 endpoints should be called
      expect(probeExecutor).toHaveBeenCalledTimes(11);
    });
  });
});
