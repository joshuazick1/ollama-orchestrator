import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createServer } from '../../fixtures/factories.js';

vi.mock('../../../src/storage/operational-store.js', () => ({
  getOperationalStore: () => ({
    addBan: vi.fn(),
    removeBan: vi.fn(),
    removeServerBans: vi.fn().mockReturnValue(0),
    removeModelBans: vi.fn().mockReturnValue(0),
    clearAllBans: vi.fn(),
    getActiveBans: vi.fn().mockReturnValue([]),
    getAllTimeouts: vi.fn().mockReturnValue({}),
    runStartupMigrations: vi.fn(),
    close: vi.fn(),
  }),
  initOperationalStore: vi.fn(),
}));

import { AIOrchestrator } from '../../../src/orchestrator/orchestrator.js';
import { resetInFlightManager } from '../../../src/utils/in-flight-manager.js';

describe('Auto-populate v1Models from discovery', () => {
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

  it('should auto-populate v1Models from /v1/models discovery when v1Models is empty', async () => {
    const discoveredModels = ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo'];
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: [] }),
        });
      }
      if (url.includes('/api/version')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: '0.1.0' }),
        });
      }
      if (url.includes('/v1/models')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: discoveredModels.map(id => ({ id })) }),
        });
      }
      return Promise.reject(new Error('Not found'));
    });

    const server = createServer({ id: 'server-v1-discovery', type: 'openai', v1Models: undefined });
    expect(server.v1Models).toBeUndefined();
    orchestrator.addServer(server);

    await orchestrator.updateServerStatus(orchestrator.getServer('server-v1-discovery')!);

    const updatedServer = orchestrator.getServer('server-v1-discovery');
    expect(updatedServer?.v1Models).toEqual(discoveredModels);
    expect(updatedServer?.discoveredV1Models).toEqual(discoveredModels);
  });

  it('should not overwrite existing v1Models with discovered models', async () => {
    const existingModels = ['existing-model-1', 'existing-model-2'];
    const discoveredModels = ['gpt-4', 'gpt-3.5-turbo'];
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: [] }),
        });
      }
      if (url.includes('/api/version')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: '0.1.0' }),
        });
      }
      if (url.includes('/v1/models')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: discoveredModels.map(id => ({ id })) }),
        });
      }
      return Promise.reject(new Error('Not found'));
    });

    const server = createServer({
      id: 'server-with-v1models',
      type: 'openai',
      v1Models: existingModels,
    });
    orchestrator.addServer(server);

    await orchestrator.updateServerStatus(orchestrator.getServer('server-with-v1models')!);

    const updatedServer = orchestrator.getServer('server-with-v1models');
    expect(updatedServer?.v1Models).toEqual(existingModels);
    expect(updatedServer?.discoveredV1Models).toEqual(discoveredModels);
  });

  it('should not populate v1Models when v1Models is an empty array', async () => {
    const discoveredModels = ['gpt-4', 'gpt-3.5-turbo'];
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: [] }),
        });
      }
      if (url.includes('/api/version')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: '0.1.0' }),
        });
      }
      if (url.includes('/v1/models')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: discoveredModels.map(id => ({ id })) }),
        });
      }
      return Promise.reject(new Error('Not found'));
    });

    const server = createServer({
      id: 'server-empty-v1models',
      type: 'openai',
      v1Models: [],
    });
    orchestrator.addServer(server);

    await orchestrator.updateServerStatus(orchestrator.getServer('server-empty-v1models')!);

    const updatedServer = orchestrator.getServer('server-empty-v1models');
    expect(updatedServer?.v1Models).toEqual(discoveredModels);
    expect(updatedServer?.discoveredV1Models).toEqual(discoveredModels);
  });
});
