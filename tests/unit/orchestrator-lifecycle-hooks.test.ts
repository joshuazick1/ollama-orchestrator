import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AIOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type { ServerLifecycleCallback } from '../../src/orchestrator/orchestrator.js';
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
    getAllTimeouts: vi.fn().mockReturnValue([]),
  }),
  initOperationalStore: vi.fn(),
}));

describe('AIOrchestrator Lifecycle Hooks', () => {
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
  });

  describe('onServerAdded', () => {
    it('should fire callback with "added" event and AIServer when server is added', () => {
      const callback =
        vi.fn<
          (
            event: 'added' | 'removed',
            server: import('../../src/orchestrator/orchestrator.js').AIServer
          ) => void
        >();
      orchestrator.onServerAdded(callback);

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));

      expect(callback).toHaveBeenCalledTimes(1);
      const [event, server] = callback.mock.calls[0];
      expect(event).toBe('added');
      expect(server.id).toBe('server-1');
      expect(server.url).toBe('http://localhost:1');
    });

    it('should include serverAddedAt timestamp in added server event', () => {
      const beforeAdd = Date.now();
      const callback = vi.fn();
      orchestrator.onServerAdded(callback);

      orchestrator.addServer(createServer({ id: 'server-1' }));

      const [, server] = callback.mock.calls[0];
      expect(server.serverAddedAt).toBeGreaterThanOrEqual(beforeAdd);
      expect(server.serverAddedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should not fire callback after unsubscribe', () => {
      const callback = vi.fn();
      const unsubscribe = orchestrator.onServerAdded(callback);
      unsubscribe();

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow multiple subscribers and all should fire', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      orchestrator.onServerAdded(callback1);
      orchestrator.onServerAdded(callback2);

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should only fire added callback on add, not on remove', () => {
      const callback = vi.fn();
      orchestrator.onServerAdded(callback);

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      orchestrator.removeServer('server-1');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should allow unsubscribe to be called multiple times safely', () => {
      const callback = vi.fn();
      const unsubscribe = orchestrator.onServerAdded(callback);

      unsubscribe();
      unsubscribe();

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('onServerRemoved', () => {
    it('should fire callback with "removed" event and AIServer when server is removed', () => {
      const callback =
        vi.fn<
          (
            event: 'added' | 'removed',
            server: import('../../src/orchestrator/orchestrator.js').AIServer
          ) => void
        >();
      orchestrator.onServerRemoved(callback);

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      orchestrator.removeServer('server-1');

      expect(callback).toHaveBeenCalledTimes(1);
      const [event, server] = callback.mock.calls[0];
      expect(event).toBe('removed');
      expect(server.id).toBe('server-1');
      expect(server.url).toBe('http://localhost:1');
    });

    it('should not fire callback for non-existent server removal', () => {
      const callback = vi.fn();
      orchestrator.onServerRemoved(callback);

      orchestrator.removeServer('non-existent-id');

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not fire callback after unsubscribe', () => {
      const callback = vi.fn();
      const unsubscribe = orchestrator.onServerRemoved(callback);
      unsubscribe();

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      orchestrator.removeServer('server-1');

      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow multiple subscribers and all should fire on remove', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      orchestrator.onServerRemoved(callback1);
      orchestrator.onServerRemoved(callback2);

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      orchestrator.removeServer('server-1');

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should only fire removed callback on remove, not on add', () => {
      const callback = vi.fn();
      orchestrator.onServerRemoved(callback);

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should allow unsubscribe to be called multiple times safely', () => {
      const callback = vi.fn();
      const unsubscribe = orchestrator.onServerRemoved(callback);

      unsubscribe();
      unsubscribe();

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      orchestrator.removeServer('server-1');
      expect(callback).not.toHaveBeenCalled();
    });

    it('should fire callback even if other callbacks unsubscribe during iteration', () => {
      const callback1 = vi.fn(() => unsubscribe2());
      const callback2 = vi.fn();
      const unsubscribe1 = orchestrator.onServerRemoved(callback1);
      const unsubscribe2 = orchestrator.onServerRemoved(callback2);

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      orchestrator.removeServer('server-1');

      expect(callback1).toHaveBeenCalledTimes(1);
    });
  });

  describe('callback isolation', () => {
    it('should keep added and removed callbacks separate', () => {
      const addedCallback = vi.fn();
      const removedCallback = vi.fn();
      orchestrator.onServerAdded(addedCallback);
      orchestrator.onServerRemoved(removedCallback);

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      expect(addedCallback).toHaveBeenCalledTimes(1);
      expect(removedCallback).toHaveBeenCalledTimes(0);

      orchestrator.removeServer('server-1');
      expect(addedCallback).toHaveBeenCalledTimes(1);
      expect(removedCallback).toHaveBeenCalledTimes(1);
    });

    it('should not affect added callbacks when removed callback is unsubscribed', () => {
      const addedCallback = vi.fn();
      const removedCallback = vi.fn();
      const unsubRemoved = orchestrator.onServerRemoved(removedCallback);
      orchestrator.onServerAdded(addedCallback);
      unsubRemoved();

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      orchestrator.removeServer('server-1');

      expect(addedCallback).toHaveBeenCalledTimes(1);
      expect(removedCallback).not.toHaveBeenCalled();
    });

    it('should not affect removed callbacks when added callback is unsubscribed', () => {
      const addedCallback = vi.fn();
      const removedCallback = vi.fn();
      const unsubAdded = orchestrator.onServerAdded(addedCallback);
      orchestrator.onServerRemoved(removedCallback);
      unsubAdded();

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));
      orchestrator.removeServer('server-1');

      expect(addedCallback).not.toHaveBeenCalled();
      expect(removedCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe cleanup', () => {
    it('should only remove the unsubscribed callback, not others', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();
      const unsub1 = orchestrator.onServerAdded(callback1);
      orchestrator.onServerAdded(callback2);
      orchestrator.onServerAdded(callback3);
      unsub1();

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledTimes(1);
    });

    it('should handle interleaved subscribe/unsubscribe correctly', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();
      const unsub1 = orchestrator.onServerAdded(callback1);
      orchestrator.onServerAdded(callback2);
      const unsub3 = orchestrator.onServerAdded(callback3);
      unsub1();
      const unsub3Again = unsub3;
      unsub3Again();

      orchestrator.addServer(createServer({ id: 'server-1', url: 'http://localhost:1' }));

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).not.toHaveBeenCalled();
    });
  });

  describe('event payload integrity', () => {
    it('should include all server fields in added event payload', () => {
      const callback = vi.fn();
      orchestrator.onServerAdded(callback);

      orchestrator.addServer(
        createServer({
          id: 'server-1',
          url: 'http://localhost:11434',
          type: 'ollama',
          models: ['llama3:latest'],
          maxConcurrency: 8,
        })
      );

      const [, server] = callback.mock.calls[0];
      expect(server.id).toBe('server-1');
      expect(server.url).toBe('http://localhost:11434');
      expect(server.type).toBe('ollama');
      expect(server.models).toEqual([]);
      expect(server.maxConcurrency).toBe(8);
      expect(server.serverAddedAt).toBeGreaterThan(0);
    });

    it('should include serverAddedAt set by orchestrator, not passed-in value', () => {
      const beforeAdd = Date.now();
      const callback = vi.fn();
      orchestrator.onServerAdded(callback);

      const serverWithArbitraryAddedAt = {
        ...createServer({ id: 'server-1' }),
        serverAddedAt: 0,
      };
      delete (serverWithArbitraryAddedAt as Record<string, unknown>).serverAddedAt;

      orchestrator.addServer(createServer({ id: 'server-1' }));

      const [, server] = callback.mock.calls[0];
      expect(server.serverAddedAt).toBeGreaterThanOrEqual(beforeAdd);
    });
  });
});
