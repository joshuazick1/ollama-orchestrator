import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/orchestrator/orchestrator-instance.js');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getOrchestratorInstance } from '../../../src/orchestrator/orchestrator-instance.js';
import type { AIServer } from '../../../src/orchestrator/orchestrator.types.js';
import { PsPollCoordinator } from '../../../src/probe/ps-poll-coordinator.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);

function makeHealthyServer(id: string): AIServer {
  return {
    id,
    url: `http://127.0.0.1:700${id.replace('srv', '')}`,
    type: 'ollama',
    lastResponseTime: 0,
    models: [],
    healthy: true,
  };
}

describe('PsPollCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('start / stop', () => {
    it('starts and stops without error', () => {
      const coordinator = new PsPollCoordinator();
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => [],
      } as never);
      coordinator.start();
      coordinator.stop();
    });

    it('no-ops start if already running', () => {
      const coordinator = new PsPollCoordinator();
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => [],
      } as never);
      coordinator.start();
      coordinator.start();
      coordinator.stop();
    });

    it('does not start if disabled', () => {
      const coordinator = new PsPollCoordinator({ enabled: false });
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => [],
      } as never);
      coordinator.start();
      coordinator.stop();
    });

    it('schedules recurring poll after start', () => {
      const coordinator = new PsPollCoordinator({ intervalMs: 60_000 });
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => [],
      } as never);
      coordinator.start();
      const handle = (coordinator as never).intervalHandle;
      expect(handle).not.toBeNull();
      coordinator.stop();
    });
  });

  describe('getModelsOnServer / getServersWithModel', () => {
    it('returns empty set for unknown server', () => {
      const coordinator = new PsPollCoordinator();
      expect(coordinator.getModelsOnServer('unknown')).toEqual(new Set());
    });

    it('returns models for a polled server', async () => {
      const coordinator = new PsPollCoordinator();
      const servers = [makeHealthyServer('srv1')];
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => servers,
      } as never);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3' }, { name: 'mistral' }] }),
      }) as never;

      await coordinator.refreshServer('srv1');
      expect(coordinator.getModelsOnServer('srv1')).toEqual(new Set(['llama3', 'mistral']));
    });

    it('getServersWithModel returns server IDs with the model', async () => {
      const coordinator = new PsPollCoordinator();
      const servers = [makeHealthyServer('srv1'), makeHealthyServer('srv2')];
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => servers,
      } as never);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3' }] }),
      }) as never;

      await coordinator.refreshServer('srv1');
      await coordinator.refreshServer('srv2');

      expect(coordinator.getServersWithModel('llama3')).toEqual(new Set(['srv1', 'srv2']));
      expect(coordinator.getServersWithModel('nonexistent')).toEqual(new Set());
    });
  });

  describe('getStats', () => {
    it('returns zero stats when no servers polled', () => {
      const coordinator = new PsPollCoordinator();
      const stats = coordinator.getStats();
      expect(stats.serverCount).toBe(0);
      expect(stats.totalModels).toBe(0);
      expect(stats.oldestPoll).toBe(0);
    });

    it('aggregates model counts across servers', async () => {
      const coordinator = new PsPollCoordinator();
      const servers = [makeHealthyServer('srv1'), makeHealthyServer('srv2')];
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => servers,
      } as never);

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'llama3' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'mistral' }, { name: 'llama3' }] }),
        }) as never;

      await coordinator.refreshServer('srv1');
      await coordinator.refreshServer('srv2');

      const stats = coordinator.getStats();
      expect(stats.serverCount).toBe(2);
      expect(stats.totalModels).toBe(3);
    });
  });

  describe('refreshServer', () => {
    it('updates state on successful HTTP response', async () => {
      const coordinator = new PsPollCoordinator();
      const servers = [makeHealthyServer('srv1')];
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => servers,
      } as never);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3' }] }),
      }) as never;

      await coordinator.refreshServer('srv1');
      expect(coordinator.getModelsOnServer('srv1')).toEqual(new Set(['llama3']));
    });

    it('increments errorCount on failed fetch', async () => {
      const coordinator = new PsPollCoordinator({ maxErrorsBeforeBackoff: 3 });
      const servers = [makeHealthyServer('srv1')];
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => servers,
      } as never);

      global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as never;

      await coordinator.refreshServer('srv1');
      vi.advanceTimersByTime(100);

      const stats = coordinator.getStats();
      expect(stats.serverCount).toBe(1);
    });

    it('removes state for unhealthy server', async () => {
      const coordinator = new PsPollCoordinator();
      const servers = [makeHealthyServer('srv1')];
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => servers,
      } as never);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3' }] }),
      }) as never;

      await coordinator.refreshServer('srv1');
      expect(coordinator.getModelsOnServer('srv1')).toEqual(new Set(['llama3']));

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      }) as never;

      await coordinator.refreshServer('srv1');
      expect(coordinator.getModelsOnServer('srv1')).toEqual(new Set());
    });

    it('handles server not found in orchestrator', async () => {
      const coordinator = new PsPollCoordinator();
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => [],
      } as never);

      await coordinator.refreshServer('nonexistent');
      expect(coordinator.getModelsOnServer('nonexistent')).toEqual(new Set());
    });
  });

  describe('multiple servers', () => {
    it('tracks each server independently', async () => {
      const coordinator = new PsPollCoordinator();
      const servers = [
        makeHealthyServer('srv1'),
        makeHealthyServer('srv2'),
        makeHealthyServer('srv3'),
      ];
      mockGetOrchestratorInstance.mockReturnValue({
        getServers: () => servers,
      } as never);

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'model-a' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'model-b' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [{ name: 'model-c' }] }),
        }) as never;

      await coordinator.refreshServer('srv1');
      await coordinator.refreshServer('srv2');
      await coordinator.refreshServer('srv3');

      expect(coordinator.getModelsOnServer('srv1')).toEqual(new Set(['model-a']));
      expect(coordinator.getModelsOnServer('srv2')).toEqual(new Set(['model-b']));
      expect(coordinator.getModelsOnServer('srv3')).toEqual(new Set(['model-c']));
      expect(coordinator.getStats().serverCount).toBe(3);
    });
  });
});
