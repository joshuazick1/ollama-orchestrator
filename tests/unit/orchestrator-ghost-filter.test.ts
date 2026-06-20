import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/storage/operational-store.js', () => ({
  getOperationalStore: () => ({
    addBan: vi.fn(),
    removeBan: vi.fn(),
    removeServerBans: vi.fn().mockReturnValue(0),
    removeModelBans: vi.fn().mockReturnValue(0),
    clearAllBans: vi.fn(),
    getActiveBans: vi.fn().mockReturnValue([]),
    runStartupMigrations: vi.fn(),
    close: vi.fn(),
  }),
  initOperationalStore: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockState = new Map<string, { models: Set<string>; lastPollAt: number }>();

vi.mock('../../src/probe/ps-poll-coordinator-instance.js', () => ({
  getPsPollCoordinator: () => ({
    getModelsOnServer: (serverId: string) => mockState.get(serverId)?.models ?? new Set<string>(),
    getServerLastPollAt: (serverId: string) => mockState.get(serverId)?.lastPollAt ?? 0,
    setServerModels: (serverId: string, models: string[], lastPollAt: number) => {
      mockState.set(serverId, { models: new Set(models), lastPollAt });
    },
    clearState: () => mockState.clear(),
  }),
  resetPsPollCoordinator: () => mockState.clear(),
}));

import { AIOrchestrator } from '../../src/orchestrator/orchestrator.js';
import { createServer } from '../fixtures/factories.js';
import { resetInFlightManager } from '../../src/utils/in-flight-manager.js';

describe('AIOrchestrator Ghost Filter', () => {
  let orchestrator: AIOrchestrator;

  beforeEach(() => {
    resetInFlightManager();
    mockState.clear();
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
    if (orchestrator['healthCheckScheduler']) {
      orchestrator['healthCheckScheduler'].stop();
    }
    if (orchestrator['probeScheduler']) {
      orchestrator['probeScheduler'].stop();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockState.clear();
  });

  describe('getServers with excludeGhosts', () => {
    it('returns all servers when excludeGhosts is not set', () => {
      orchestrator.addServer(
        createServer({ id: 'srv-1', models: ['llama3'], url: 'http://localhost:11434' })
      );
      orchestrator.addServer(
        createServer({ id: 'srv-2', models: [], url: 'http://localhost:11435' })
      );
      mockState.set('srv-1', { models: new Set(['llama3']), lastPollAt: Date.now() });
      mockState.set('srv-2', { models: new Set([]), lastPollAt: Date.now() });

      const servers = orchestrator.getServers();
      expect(servers).toHaveLength(2);
    });

    it('filters out ghost servers when excludeGhosts is true', () => {
      orchestrator.addServer(createServer({ id: 'srv-1', models: ['llama3'] }));
      orchestrator.addServer(createServer({ id: 'srv-2', models: [] }));
      mockState.set('srv-1', { models: new Set(['llama3']), lastPollAt: Date.now() });
      mockState.set('srv-2', { models: new Set([]), lastPollAt: Date.now() });

      const servers = orchestrator.getServers({ excludeGhosts: true });
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe('srv-1');
    });

    it('filters out servers with 0 models even if they have models in server.models', () => {
      orchestrator.addServer(createServer({ id: 'srv-1', models: ['llama3'] }));
      orchestrator.addServer(createServer({ id: 'srv-2', models: ['llama3'] }));
      mockState.set('srv-1', { models: new Set(['llama3']), lastPollAt: Date.now() });
      mockState.set('srv-2', { models: new Set([]), lastPollAt: Date.now() });

      const servers = orchestrator.getServers({ excludeGhosts: true });
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe('srv-1');
    });

    it('returns empty array when all servers are ghosts', () => {
      orchestrator.addServer(createServer({ id: 'srv-1', models: ['llama3'] }));
      orchestrator.addServer(createServer({ id: 'srv-2', models: ['mistral'] }));
      mockState.set('srv-1', { models: new Set([]), lastPollAt: Date.now() });
      mockState.set('srv-2', { models: new Set([]), lastPollAt: Date.now() });

      const servers = orchestrator.getServers({ excludeGhosts: true });
      expect(servers).toHaveLength(0);
    });

    it('handles servers not yet polled by PS coordinator', () => {
      orchestrator.addServer(createServer({ id: 'srv-1', models: ['llama3'] }));
      orchestrator.addServer(createServer({ id: 'srv-2', models: [] }));
      mockState.set('srv-1', { models: new Set(['llama3']), lastPollAt: Date.now() });

      const servers = orchestrator.getServers({ excludeGhosts: true });
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe('srv-1');
    });
  });

  describe('getServers with healthyOnly', () => {
    it('returns only healthy servers', () => {
      orchestrator.addServer(createServer({ id: 'srv-1', healthy: true }));
      orchestrator.addServer(createServer({ id: 'srv-2', healthy: false }));

      const servers = orchestrator.getServers({ healthyOnly: true });
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe('srv-1');
    });

    it('combines healthyOnly and excludeGhosts', () => {
      orchestrator.addServer(createServer({ id: 'srv-1', healthy: true, models: ['llama3'] }));
      orchestrator.addServer(createServer({ id: 'srv-2', healthy: true, models: [] }));
      orchestrator.addServer(createServer({ id: 'srv-3', healthy: false, models: [] }));
      mockState.set('srv-1', { models: new Set(['llama3']), lastPollAt: Date.now() });
      mockState.set('srv-2', { models: new Set([]), lastPollAt: Date.now() });

      const servers = orchestrator.getServers({ healthyOnly: true, excludeGhosts: true });
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe('srv-1');
    });
  });

  describe('cleanupGhostServers with PS poll data', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.now());
    });

    it('marks healthy server as ghost when PS poll shows 0 models for > staleThresholdMs', () => {
      const staleThresholdMs = 300000;
      orchestrator.addServer(createServer({ id: 'srv-1', healthy: true, models: [] }));
      mockState.set('srv-1', {
        models: new Set([]),
        lastPollAt: Date.now() - staleThresholdMs - 1000,
      });

      const removed = orchestrator.cleanupGhostServers();
      expect(removed).toBe(1);
    });

    it('does not mark server as ghost if PS poll has models', () => {
      const staleThresholdMs = 300000;
      orchestrator.addServer(createServer({ id: 'srv-1', healthy: true, models: ['llama3'] }));
      mockState.set('srv-1', {
        models: new Set(['llama3']),
        lastPollAt: Date.now() - staleThresholdMs - 1000,
      });

      const removed = orchestrator.cleanupGhostServers();
      expect(removed).toBe(0);
    });

    it('does not mark server as ghost if PS poll data is fresh', () => {
      const staleThresholdMs = 300000;
      orchestrator.addServer(createServer({ id: 'srv-1', healthy: true, models: [] }));
      mockState.set('srv-1', { models: new Set([]), lastPollAt: Date.now() - 1000 });

      const removed = orchestrator.cleanupGhostServers();
      expect(removed).toBe(0);
    });

    it('does not mark server as ghost if not yet polled', () => {
      const staleThresholdMs = 300000;
      orchestrator.addServer(createServer({ id: 'srv-1', healthy: true, models: [] }));

      const removed = orchestrator.cleanupGhostServers();
      expect(removed).toBe(0);
    });

    it('marks ghost servers and returns count without removing (removeOnCleanup=false by default)', () => {
      const staleThresholdMs = 300000;
      orchestrator.addServer(createServer({ id: 'srv-ghost-1', healthy: true, models: [] }));
      mockState.set('srv-ghost-1', {
        models: new Set([]),
        lastPollAt: Date.now() - staleThresholdMs - 1000,
      });

      const removed = orchestrator.cleanupGhostServers();
      expect(removed).toBe(1);
    });
  });
});
