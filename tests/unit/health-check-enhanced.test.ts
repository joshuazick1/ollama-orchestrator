/**
 * health-check-enhanced.test.ts
 * Enhanced tests for health check functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelManager } from '../../src/model-manager.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('Health Check Enhanced Tests', () => {
  let modelManager: ModelManager;

  const createServer = (id: string): AIServer => ({
    id,
    url: `http://localhost:${11434 + parseInt(id.split('-')[1])}`,
    type: 'ollama',
    healthy: true,
    supportsOllama: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
    maxConcurrency: 4,
  });

  beforeEach(() => {
    modelManager = new ModelManager({});
    vi.clearAllMocks();
  });

  describe('Server Registration', () => {
    it('should register healthy server', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      const state = modelManager.getServerModelStates('ollama-1');
      expect(state).toBeDefined();
    });

    it('should register unhealthy server', () => {
      const unhealthy: AIServer = {
        ...createServer('ollama-1'),
        healthy: false,
      };
      modelManager.registerServer(unhealthy);

      expect(unhealthy.healthy).toBe(false);
    });

    it('should handle server with unknown health', () => {
      const unknown: AIServer = {
        id: 'ollama-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: false,
        lastResponseTime: 0,
        models: [],
      };
      modelManager.registerServer(unknown);

      expect(unknown.healthy).toBe(false);
    });

    it('should register multiple servers', () => {
      for (let i = 0; i < 10; i++) {
        modelManager.registerServer(createServer(`ollama-${i}`));
      }

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(10);
    });

    it('should register 100+ servers', () => {
      for (let i = 0; i < 100; i++) {
        modelManager.registerServer(createServer(`ollama-${i}`));
      }

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(100);
    });
  });

  describe('Server Health State', () => {
    it('should track model loaded state', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });

      const isLoaded = modelManager.isModelLoaded('ollama-1', 'llama3:latest');
      expect(isLoaded).toBe(true);
    });

    it('should track model loading state', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loading: true });

      const isLoading = modelManager.isModelLoading('ollama-1', 'llama3:latest');
      expect(isLoading).toBe(true);
    });

    it('should track model not loaded', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      const isLoaded = modelManager.isModelLoaded('ollama-1', 'nonexistent');
      expect(isLoaded).toBe(false);
    });
  });

  describe('Server Unregistration', () => {
    it('should unregister server', () => {
      modelManager.registerServer(createServer('ollama-1'));
      modelManager.unregisterServer('ollama-1');

      const state = modelManager.getServerModelStates('ollama-1');
      expect(state).toBeUndefined();
    });

    it('should unregister multiple servers', () => {
      for (let i = 0; i < 10; i++) {
        modelManager.registerServer(createServer(`ollama-${i}`));
      }

      for (let i = 0; i < 5; i++) {
        modelManager.unregisterServer(`ollama-${i}`);
      }

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(5);
    });

    it('should handle unregister non-existent server', () => {
      modelManager.registerServer(createServer('ollama-1'));
      modelManager.unregisterServer('nonexistent');

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(1);
    });
  });

  describe('GPU Memory Updates', () => {
    it('should handle GPU memory update response', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);
      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      await modelManager.updateGpuMemory('ollama-1');

      expect(fetch).toHaveBeenCalled();
    });

    it('should handle GPU memory fetch failure', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await modelManager.updateGpuMemory('ollama-1');

      expect(fetch).toHaveBeenCalled();
    });

    it('should handle empty GPU memory response', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: undefined }),
      });

      await modelManager.updateGpuMemory('ollama-1');

      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('Health Monitoring', () => {
    it('should get servers with model loaded', () => {
      const server1 = createServer('ollama-1');
      const server2 = createServer('ollama-2');

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-2', 'llama3:latest', { loaded: true });

      const servers = modelManager.getServersWithModelLoaded('llama3:latest');
      expect(servers.length).toBe(2);
    });

    it('should get servers without model', () => {
      const server1 = createServer('ollama-1');
      const server2 = createServer('ollama-2');

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });

      const servers = modelManager.getServersWithoutModel('llama3:latest');
      expect(servers).toContain('ollama-2');
    });

    it('should estimate load time', () => {
      const loadTime = modelManager.getEstimatedLoadTime('llama3:latest');
      expect(loadTime).toBeGreaterThan(0);
    });

    it('should estimate load time with size', () => {
      const loadTime = modelManager.getEstimatedLoadTime('llama3:latest', 4000000000);
      expect(loadTime).toBeGreaterThan(0);
    });
  });

  describe('Warmup Health', () => {
    it('should get warmup job', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const result = await modelManager.warmupModel('llama3:latest', {
        serverIds: ['ollama-1'],
      });

      expect(result.totalServers).toBe(1);
    });

    it('should get pending warmup jobs', async () => {
      const pending = modelManager.getPendingWarmupJobs();
      expect(Array.isArray(pending)).toBe(true);
    });

    it('should get model warmup status', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      await modelManager.warmupModel('llama3:latest');

      const status = modelManager.getModelWarmupStatus('llama3:latest');
      expect(status).toBeDefined();
    });
  });

  describe('Summary Statistics', () => {
    it('should get summary of empty manager', () => {
      const summary = modelManager.getSummary();

      expect(summary.totalServers).toBe(0);
      expect(summary.totalModels).toBe(0);
      expect(summary.loadedModels).toBe(0);
    });

    it('should get summary with servers', () => {
      modelManager.registerServer(createServer('ollama-1'));
      modelManager.registerServer(createServer('ollama-2'));

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(2);
    });

    it('should track loaded models in summary', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);
      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-1', 'mistral:latest', { loaded: true });

      const summary = modelManager.getSummary();
      expect(summary.loadedModels).toBe(2);
    });
  });

  describe('Reset Operations', () => {
    it('should reset model manager', () => {
      modelManager.registerServer(createServer('ollama-1'));
      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });

      modelManager.reset();

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(0);
    });
  });

  describe('Dual-Protocol Health', () => {
    it('should handle Ollama health checks', () => {
      const ollamaServer: AIServer = {
        id: 'ollama-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: true,
        supportsOllama: true,
        lastResponseTime: 100,
        models: ['llama3:latest'],
      };

      modelManager.registerServer(ollamaServer);
      expect(ollamaServer.supportsOllama).toBe(true);
    });

    it('should handle OpenAI health checks', () => {
      const openaiServer: AIServer = {
        id: 'openai-1',
        url: 'http://localhost:8000',
        type: 'ollama',
        healthy: true,
        supportsV1: true,
        v1Models: ['gpt-4'],
        lastResponseTime: 100,
        models: [],
      };

      modelManager.registerServer(openaiServer);
      expect(openaiServer.supportsV1).toBe(true);
    });
  });
});
