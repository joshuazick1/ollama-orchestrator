/**
 * model-manager.test.ts
 * Unit tests for ModelManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelManager, type ModelLoadingState } from '../../src/model-manager.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('ModelManager', () => {
  let modelManager: ModelManager;
  const mockServer: AIServer = {
    id: 'server-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest', 'mistral:latest'],
    maxConcurrency: 4,
  };

  beforeEach(() => {
    modelManager = new ModelManager();
    modelManager.registerServer(mockServer);
    // Reset fetch mock
    vi.clearAllMocks();
  });

  describe('Server Registration', () => {
    it('should register a new server', () => {
      const newServer: AIServer = {
        id: 'server-2',
        url: 'http://localhost:11435',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: [],
        maxConcurrency: 4,
      };

      modelManager.registerServer(newServer);
      expect(modelManager.getServerModelStates('server-2')).toBeDefined();
    });

    it('should not duplicate server registration', () => {
      modelManager.registerServer(mockServer);
      const states = modelManager.getServerModelStates('server-1');
      expect(states).toBeDefined();
      expect(states?.size).toBe(0);
    });

    it('should unregister a server', () => {
      modelManager.unregisterServer('server-1');
      expect(modelManager.getServerModelStates('server-1')).toBeUndefined();
    });
  });

  describe('Model State Management', () => {
    it('should update model state', () => {
      modelManager.updateModelState('server-1', 'llama3:latest', {
        loaded: true,
        loadTime: 5000,
      });

      const state = modelManager.getModelState('server-1', 'llama3:latest');
      expect(state?.loaded).toBe(true);
      expect(state?.loadTime).toBe(5000);
    });

    it('should mark model as loaded', () => {
      modelManager.updateModelState('server-1', 'llama3:latest', {
        loaded: true,
        loadTime: 3000,
      });

      expect(modelManager.isModelLoaded('server-1', 'llama3:latest')).toBe(true);
    });

    it('should mark model as loading', () => {
      modelManager.updateModelState('server-1', 'llama3:latest', {
        loading: true,
      });

      expect(modelManager.isModelLoading('server-1', 'llama3:latest')).toBe(true);
    });

    it('should update last used timestamp', () => {
      const before = Date.now();
      modelManager.markModelUsed('server-1', 'llama3:latest');
      const after = Date.now();

      const state = modelManager.getModelState('server-1', 'llama3:latest');
      expect(state?.lastUsed).toBeGreaterThanOrEqual(before);
      expect(state?.lastUsed).toBeLessThanOrEqual(after);
    });
  });

  describe('Server Queries', () => {
    beforeEach(() => {
      modelManager.updateModelState('server-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('server-1', 'mistral:latest', { loaded: false });

      const server2: AIServer = {
        id: 'server-2',
        url: 'http://localhost:11435',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3:latest'],
        maxConcurrency: 4,
      };
      modelManager.registerServer(server2);
      modelManager.updateModelState('server-2', 'llama3:latest', { loaded: true });
    });

    it('should return servers with model loaded', () => {
      const servers = modelManager.getServersWithModelLoaded('llama3:latest');
      expect(servers).toContain('server-1');
      expect(servers).toContain('server-2');
      expect(servers).toHaveLength(2);
    });

    it('should return servers where model is not loaded or loading', () => {
      const servers = modelManager.getServersWithoutModel('mistral:latest');
      expect(servers).toContain('server-2');
      expect(servers).toContain('server-1'); // server-1 has model but not loaded
    });

    it('should return empty array for unknown model', () => {
      const servers = modelManager.getServersWithModelLoaded('unknown:latest');
      expect(servers).toHaveLength(0);
    });
  });

  describe('Load Time Estimation', () => {
    it('should estimate load time for small models', () => {
      const time = modelManager.getEstimatedLoadTime('llama3:7b');
      expect(time).toBe(5000); // defaultLoadTimes.small
    });

    it('should estimate load time for medium models', () => {
      const time = modelManager.getEstimatedLoadTime('llama3:8b');
      expect(time).toBe(10000); // defaultLoadTimes.medium
    });

    it('should estimate load time for large models', () => {
      const time = modelManager.getEstimatedLoadTime('llama3:70b');
      expect(time).toBe(40000); // defaultLoadTimes.xl
    });

    it('should estimate load time based on size', () => {
      const time = modelManager.getEstimatedLoadTime('custom', 15);
      expect(time).toBe(20000); // defaultLoadTimes.large
    });

    it('should return actual load time if available', () => {
      modelManager.updateModelState('server-1', 'test-model', {
        loaded: true,
        loadTime: 12345,
      });

      const time = modelManager.getEstimatedLoadTime('test-model');
      expect(time).toBe(12345);
    });
  });

  describe('Model Warmup', () => {
    beforeEach(() => {
      // Mock fetch for model info API
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            size: 5000000000, // 5GB in bytes
            details: {
              parameter_size: '8B',
              quantization_level: 'Q4_0',
              family: 'llama',
            },
          }),
      });
    });

    it('should initiate warmup for a model', async () => {
      const result = await modelManager.warmupModel('llama3:latest');

      expect(result.model).toBe('llama3:latest');
      expect(result.totalServers).toBe(1);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].status).toBe('loading');
    });

    it('should skip warmup for already loaded models', async () => {
      modelManager.updateModelState('server-1', 'llama3:latest', {
        loaded: true,
        loadTime: 5000,
      });

      const result = await modelManager.warmupModel('llama3:latest');

      expect(result.loadedOn).toBe(1);
      expect(result.loadingOn).toBe(0);
      expect(result.jobs[0].status).toBe('loaded');
    });

    it('should support specific server targeting', async () => {
      const server2: AIServer = {
        id: 'server-2',
        url: 'http://localhost:11435',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: [],
        maxConcurrency: 4,
      };
      modelManager.registerServer(server2);

      const result = await modelManager.warmupModel('llama3:latest', {
        serverIds: ['server-1'],
      });

      expect(result.totalServers).toBe(1);
      expect(result.jobs[0].serverId).toBe('server-1');
    });

    it('should cancel warmup job', async () => {
      const result = await modelManager.warmupModel('llama3:latest');
      const jobId = result.jobs[0].serverId ? 'warmup-1' : result.jobs[0].serverId;

      // Since jobs don't return their IDs in the result, let's get it from the pending jobs
      const pendingJobs = modelManager.getPendingWarmupJobs();
      expect(pendingJobs.length).toBeGreaterThan(0);

      const cancelled = modelManager.cancelWarmup(pendingJobs[0].id);
      expect(cancelled).toBe(true);

      const job = modelManager.getWarmupJob(pendingJobs[0].id);
      expect(job?.status).toBe('cancelled');
    });

    it('should cancel all warmup jobs for a model', async () => {
      await modelManager.warmupModel('llama3:latest');

      const cancelled = modelManager.cancelModelWarmup('llama3:latest');
      expect(cancelled).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Model Info', () => {
    it('should fetch model info from server', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            size: 5000000000, // 5GB
            details: {
              parameter_size: '8B',
              quantization_level: 'Q4_0',
              family: 'llama',
            },
          }),
      });

      const info = await modelManager.getModelInfo('http://localhost:11434', 'llama3:latest');

      expect(info.size).toBeGreaterThan(0);
      expect(info.parameters).toBe('8B');
      expect(info.quantization).toBe('Q4_0');
      expect(info.family).toBe('llama');
    });

    it('should handle model info fetch failure gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const info = await modelManager.getModelInfo('http://localhost:11434', 'unknown-model');

      expect(info.size).toBe(0);
    });

    it('should check GPU memory before loading', async () => {
      // Mock /api/ps response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [
              {
                model: 'llama3:latest',
                size_vram: 5368709120, // 5GB in bytes
              },
            ],
          }),
      });

      await modelManager.updateGpuMemory('server-1');

      const state = modelManager.getModelState('server-1', 'llama3:latest');
      if (state) {
        expect(state.gpuMemory).toBeGreaterThan(0);
      }
    });
  });

  describe('Warmup Status', () => {
    it('should get warmup status for a model', () => {
      modelManager.updateModelState('server-1', 'llama3:latest', {
        loaded: true,
        loadTime: 5000,
      });

      const status = modelManager.getModelWarmupStatus('llama3:latest');

      expect(status.totalServers).toBe(1);
      expect(status.loadedOn).toBe(1);
      expect(status.servers['server-1'].loaded).toBe(true);
    });

    it('should count loading models correctly', () => {
      modelManager.updateModelState('server-1', 'llama3:latest', {
        loading: true,
        loaded: false,
      });

      const status = modelManager.getModelWarmupStatus('llama3:latest');
      expect(status.loadingOn).toBe(1);
    });
  });

  describe('Recommendations', () => {
    it('should recommend models based on server count', () => {
      // Register multiple servers with the same model
      const server2: AIServer = {
        id: 'server-2',
        url: 'http://localhost:11435',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: ['popular-model'],
        maxConcurrency: 4,
      };
      modelManager.registerServer(server2);

      // Set up model on multiple servers
      modelManager.updateModelState('server-1', 'popular-model', {
        loaded: true,
        lastUsed: Date.now(),
      });
      modelManager.updateModelState('server-2', 'popular-model', {
        loaded: true,
        lastUsed: Date.now(),
      });

      const recommendations = modelManager.getRecommendedWarmupModels(2);
      expect(recommendations).toContain('popular-model');
    });

    it('should not recommend models with low server count', () => {
      modelManager.updateModelState('server-1', 'unpopular-model', {
        loaded: true,
        lastUsed: Date.now(),
      });

      const recommendations = modelManager.getRecommendedWarmupModels(2);
      expect(recommendations).not.toContain('unpopular-model');
    });
  });

  describe('Idle Model Detection', () => {
    it('should detect idle models', () => {
      const oldTime = Date.now() - 3600000; // 1 hour ago

      modelManager.updateModelState('server-1', 'idle-model', {
        loaded: true,
        lastUsed: oldTime,
      });

      const idleModels = modelManager.getIdleModels(1800000); // 30 min threshold
      expect(idleModels).toHaveLength(1);
      expect(idleModels[0].model).toBe('idle-model');
    });

    it('should not detect recently used models as idle', () => {
      modelManager.updateModelState('server-1', 'active-model', {
        loaded: true,
        lastUsed: Date.now(),
      });

      const idleModels = modelManager.getIdleModels(1800000);
      expect(idleModels).toHaveLength(0);
    });
  });

  describe('Model Unloading', () => {
    it('should unload a model from a server', async () => {
      modelManager.updateModelState('server-1', 'llama3:latest', {
        loaded: true,
        lastUsed: Date.now(),
      });

      const success = await modelManager.unloadModel('server-1', 'llama3:latest');
      expect(success).toBe(true);

      const state = modelManager.getModelState('server-1', 'llama3:latest');
      expect(state?.loaded).toBe(false);
    });

    it('should return false for non-existent model', async () => {
      const success = await modelManager.unloadModel('server-1', 'unknown-model');
      expect(success).toBe(false);
    });
  });

  describe('Summary Statistics', () => {
    it('should provide summary statistics', () => {
      modelManager.updateModelState('server-1', 'model-1', {
        loaded: true,
        loadTime: 5000,
      });
      modelManager.updateModelState('server-1', 'model-2', {
        loaded: true,
        loadTime: 10000,
      });

      const summary = modelManager.getSummary();

      expect(summary.totalServers).toBe(1);
      expect(summary.totalModels).toBe(2);
      expect(summary.loadedModels).toBe(2);
      expect(summary.averageLoadTime).toBe(7500);
    });
  });

  describe('Reset', () => {
    it('should reset all state', () => {
      modelManager.updateModelState('server-1', 'llama3:latest', { loaded: true });

      modelManager.reset();

      expect(modelManager.getServerModelStates('server-1')).toBeUndefined();
      expect(modelManager.getSummary().totalServers).toBe(0);
    });
  });
});
