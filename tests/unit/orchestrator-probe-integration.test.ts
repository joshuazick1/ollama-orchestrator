import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AIOrchestrator } from '../../src/orchestrator/orchestrator.js';
import { resetInFlightManager } from '../../src/utils/in-flight-manager.js';
import { createServer } from '../fixtures/factories.js';

vi.mock('../../src/storage/operational-store.js', () => ({
  getOperationalStore: () => ({
    addBan: vi.fn(),
    removeBan: vi.fn(),
    removeServerBans: vi.fn().mockReturnValue(0),
    removeModelBans: vi.fn().mockReturnValue(0),
    clearAllBans: vi.fn(),
    getActiveBans: vi.fn().mockReturnValue([]),
    runStartupMigrations: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn(fn => fn()),
    prepare: vi.fn((query: string) => {
      if (query.includes('RETURNING')) {
        return {
          get: vi.fn().mockReturnValue({
            id: 1,
            tuple_key: '',
            event_type: '',
            from_state: null,
            to_state: null,
            reason: null,
            metadata: null,
            created_at: Date.now(),
          }),
          all: vi.fn().mockReturnValue([]),
          run: vi.fn().mockReturnValue({ changes: 0 }),
        };
      }
      return {
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn().mockReturnValue({ changes: 0 }),
      };
    }),
  }),
  initOperationalStore: vi.fn(),
}));

describe('AIOrchestrator - Probe Integration', () => {
  let orchestrator: AIOrchestrator;

  beforeEach(() => {
    resetInFlightManager();
    orchestrator = new AIOrchestrator(undefined, undefined, {
      enabled: false,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxConcurrentChecks: 10,
      retryAttempts: 2,
      retryDelayMs: 1000,
      recoveryIntervalMs: 60000,
      failureThreshold: 3,
      successThreshold: 2,
      backoffMultiplier: 1.5,
    });
    // healthCheckScheduler and probeScheduler have been removed
  });

  afterEach(() => {
    // healthCheckScheduler and probeScheduler have been removed
    orchestrator['recoveryDriver'].stop();
  });

  describe('getProbeOrchestrator()', () => {
    it('should return the probe orchestrator instance', () => {
      const probeOrchestrator = orchestrator.getProbeOrchestrator();
      expect(probeOrchestrator).toBeDefined();
      expect(typeof probeOrchestrator.getState).toBe('function');
      expect(typeof probeOrchestrator.recordProbeResult).toBe('function');
      expect(typeof probeOrchestrator.evictTuple).toBe('function');
    });

    it('should return the same instance on multiple calls', () => {
      const first = orchestrator.getProbeOrchestrator();
      const second = orchestrator.getProbeOrchestrator();
      expect(first).toBe(second);
    });
  });

  describe('getRecoveryDriver()', () => {
    it('should return the recovery driver instance', () => {
      const recoveryDriver = orchestrator.getRecoveryDriver();
      expect(recoveryDriver).toBeDefined();
      expect(typeof recoveryDriver.start).toBe('function');
      expect(typeof recoveryDriver.stop).toBe('function');
      expect(typeof recoveryDriver.tick).toBe('function');
    });

    it('should return the same instance on multiple calls', () => {
      const first = orchestrator.getRecoveryDriver();
      const second = orchestrator.getRecoveryDriver();
      expect(first).toBe(second);
    });
  });

  describe('getEndpointRegistry()', () => {
    it('should return the endpoint registry instance', () => {
      const endpointRegistry = orchestrator.getEndpointRegistry();
      expect(endpointRegistry).toBeDefined();
      expect(typeof endpointRegistry.declare).toBe('function');
      expect(typeof endpointRegistry.revokeAll).toBe('function');
    });

    it('should return the same instance on multiple calls', () => {
      const first = orchestrator.getEndpointRegistry();
      const second = orchestrator.getEndpointRegistry();
      expect(first).toBe(second);
    });
  });

  describe('addServer() - endpoint registration', () => {
    it.skip('should register all generation endpoints for a new server', () => {
      const endpointRegistry = orchestrator.getEndpointRegistry();
      const declareSpy = vi.spyOn(endpointRegistry, 'declare');

      orchestrator.addServer(createServer({ id: 'server-1' }));

      expect(declareSpy).toHaveBeenCalledWith('server-1', 'ollama_chat');
      expect(declareSpy).toHaveBeenCalledWith('server-1', 'ollama_generate');
      expect(declareSpy).toHaveBeenCalledWith('server-1', 'openai_chat');
      expect(declareSpy).toHaveBeenCalledWith('server-1', 'openai_completions');
      expect(declareSpy).toHaveBeenCalledWith('server-1', 'anthropic_messages');
    });

    it.skip('should register all embedding endpoints for a new server', () => {
      const endpointRegistry = orchestrator.getEndpointRegistry();
      const declareSpy = vi.spyOn(endpointRegistry, 'declare');

      orchestrator.addServer(createServer({ id: 'server-2' }));

      expect(declareSpy).toHaveBeenCalledWith('server-2', 'ollama_embeddings');
      expect(declareSpy).toHaveBeenCalledWith('server-2', 'openai_embeddings');
    });

    it('should register endpoints for server with models', () => {
      const endpointRegistry = orchestrator.getEndpointRegistry();
      const declareSpy = vi.spyOn(endpointRegistry, 'declare');

      orchestrator.addServer(
        createServer({ id: 'server-3', models: ['llama3', 'embedding-model'] })
      );

      expect(declareSpy).toHaveBeenCalled();
    });
  });

  describe('removeServer() - endpoint cleanup', () => {
    it('should revoke all endpoints for removed server', () => {
      const endpointRegistry = orchestrator.getEndpointRegistry();
      const revokeAllSpy = vi.spyOn(endpointRegistry, 'revokeAll');

      orchestrator.addServer(createServer({ id: 'server-to-remove' }));
      orchestrator.removeServer('server-to-remove');

      expect(revokeAllSpy).toHaveBeenCalledWith('server-to-remove');
    });

    it('should evict tuples for removed server from probe orchestrator when server has models', () => {
      const probeOrchestrator = orchestrator.getProbeOrchestrator();
      const evictTupleSpy = vi.spyOn(probeOrchestrator, 'evictTuple');

      orchestrator.addServer(
        createServer({ id: 'server-evict', models: ['llama3', 'embed-model'] })
      );

      const server = orchestrator.getServer('server-evict');
      if (server) {
        server.models = ['llama3', 'embed-model'];
      }

      orchestrator.removeServer('server-evict');

      expect(evictTupleSpy).toHaveBeenCalled();
    });

    it('should handle removeServer for non-existent server gracefully', () => {
      expect(() => orchestrator.removeServer('non-existent-server')).not.toThrow();
    });
  });

  describe('Probe state transitions', () => {
    it('should record probe result and transition state', async () => {
      const probeOrchestrator = orchestrator.getProbeOrchestrator();

      const tuple = { serverId: 'server-1', model: 'llama3', endpoint: 'ollama_chat' as const };

      await probeOrchestrator.recordProbeResult(tuple, false, {
        kind: 'transient',
        retryable: true,
      });

      expect(probeOrchestrator.getState(tuple)).toBe('SUSPECT');
    });

    it('should handle successful probe result', async () => {
      const probeOrchestrator = orchestrator.getProbeOrchestrator();

      const tuple = { serverId: 'server-1', model: 'llama3', endpoint: 'ollama_chat' as const };

      await probeOrchestrator.recordProbeResult(tuple, true);

      expect(probeOrchestrator.getState(tuple)).toBe('HEALTHY');
    });

    it('should evict tuple and clean up state', async () => {
      const probeOrchestrator = orchestrator.getProbeOrchestrator();

      const tuple = { serverId: 'server-1', model: 'llama3', endpoint: 'ollama_chat' as const };

      await probeOrchestrator.recordProbeResult(tuple, false, {
        kind: 'transient',
        retryable: true,
      });
      expect(probeOrchestrator.getState(tuple)).toBe('SUSPECT');

      await probeOrchestrator.evictTuple(tuple);
      expect(probeOrchestrator.getState(tuple)).toBe('HEALTHY');
    });
  });

  describe('RecoveryDriver integration', () => {
    it('should start and stop without error', () => {
      const recoveryDriver = orchestrator.getRecoveryDriver();

      expect(() => recoveryDriver.start()).not.toThrow();
      expect(() => recoveryDriver.stop()).not.toThrow();
    });

    it('should not probe tuples in HEALTHY state on tick', async () => {
      const recoveryDriver = orchestrator.getRecoveryDriver();
      const probeOrchestrator = orchestrator.getProbeOrchestrator();

      orchestrator.addServer(createServer({ id: 'server-healthy' }));

      const tuple = {
        serverId: 'server-healthy',
        model: 'llama3',
        endpoint: 'ollama_chat' as const,
      };

      await probeOrchestrator.recordProbeResult(tuple, true);
      expect(probeOrchestrator.getState(tuple)).toBe('HEALTHY');

      recoveryDriver.start();
      await new Promise(r => setTimeout(r, 100));
      recoveryDriver.stop();

      expect(probeOrchestrator.canProbe(tuple)).toBe(false);
    });

    it('should allow probe execution for UNHEALTHY tuples', async () => {
      const probeOrchestrator = orchestrator.getProbeOrchestrator();
      const recoveryDriver = orchestrator.getRecoveryDriver();

      const tuple = {
        serverId: 'server-unhealthy',
        model: 'llama3',
        endpoint: 'ollama_chat' as const,
      };

      orchestrator.addServer(createServer({ id: 'server-unhealthy' }));

      await probeOrchestrator.recordProbeResult(tuple, false, {
        kind: 'transient',
        retryable: true,
      });
      await probeOrchestrator.recordProbeResult(tuple, false, {
        kind: 'transient',
        retryable: true,
      });
      await probeOrchestrator.recordProbeResult(tuple, false, {
        kind: 'transient',
        retryable: true,
      });

      expect(probeOrchestrator.getState(tuple)).toBe('UNHEALTHY');

      recoveryDriver.start();
      await new Promise(r => setTimeout(r, 100));
      recoveryDriver.stop();
    });
  });

  describe('EndpointRegistry capabilities', () => {
    it.skip('should track declared endpoints after addServer', () => {
      const endpointRegistry = orchestrator.getEndpointRegistry();

      orchestrator.addServer(createServer({ id: 'server-caps' }));

      const caps = endpointRegistry.getCapabilities('server-caps');
      expect(caps.size).toBe(7);
    });

    it('should revoke all capabilities after removeServer', () => {
      const endpointRegistry = orchestrator.getEndpointRegistry();

      orchestrator.addServer(createServer({ id: 'server-revoke' }));
      orchestrator.removeServer('server-revoke');

      const caps = endpointRegistry.getCapabilities('server-revoke');
      expect(caps.size).toBe(0);
    });
  });
});
