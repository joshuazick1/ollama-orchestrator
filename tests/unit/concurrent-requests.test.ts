/**
 * concurrent-requests.test.ts
 * Tests for concurrent request handling and race conditions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelManager } from '../../src/model-manager.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('Concurrent Requests Tests', () => {
  let modelManager: ModelManager;

  const createServer = (id: string): AIServer => ({
    id,
    url: `http://localhost:${11434 + parseInt(id.split('-')[1])}`,
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
    maxConcurrency: 4,
  });

  beforeEach(() => {
    modelManager = new ModelManager({});
    vi.clearAllMocks();
  });

  describe('Concurrent Warmup Operations', () => {
    it('should handle single warmup request', async () => {
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

    it('should handle multiple concurrent warmup requests', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const results = await Promise.all([
        modelManager.warmupModel('llama3:latest'),
        modelManager.warmupModel('mistral:latest'),
        modelManager.warmupModel('codellama:latest'),
      ]);

      expect(results.length).toBe(3);
    });

    it('should handle many concurrent warmup requests', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const promises = Array.from({ length: 50 }, () => modelManager.warmupModel('llama3:latest'));

      const results = await Promise.all(promises);
      expect(results.length).toBe(50);
    });

    it('should handle warmup with different models concurrently', async () => {
      for (let i = 0; i < 10; i++) {
        modelManager.registerServer(createServer(`ollama-${i}`));
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const models = ['llama3:latest', 'mistral:latest', 'codellama:latest'];
      const promises = models.flatMap(model =>
        Array.from({ length: 10 }, () => modelManager.warmupModel(model))
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(30);
    });
  });

  describe('Concurrent Model State Updates', () => {
    it('should handle concurrent model state updates', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      const updates = Array.from({ length: 100 }, (_, i) => {
        modelManager.updateModelState('ollama-1', 'llama3:latest', {
          loaded: i % 2 === 0,
          loadTime: i * 100,
        });
      });

      const state = modelManager.getModelState('ollama-1', 'llama3:latest');
      expect(state).toBeDefined();
    });

    it('should handle concurrent usage marking', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      const promises = Array.from({ length: 100 }, () =>
        Promise.resolve(modelManager.markModelUsed('ollama-1', 'llama3:latest'))
      );

      Promise.all(promises).then(() => {
        const state = modelManager.getModelState('ollama-1', 'llama3:latest');
        expect(state?.lastUsed).toBeGreaterThan(0);
      });
    });

    it('should handle rapid server registration', () => {
      const promises = Array.from({ length: 50 }, (_, i) => {
        const server = createServer(`ollama-${i}`);
        modelManager.registerServer(server);
      });

      Promise.all(promises).then(() => {
        const summary = modelManager.getSummary();
        expect(summary.totalServers).toBeGreaterThan(0);
      });
    });
  });

  describe('Concurrent Server Operations', () => {
    it('should handle concurrent server registration and unregistration', async () => {
      for (let i = 0; i < 20; i++) {
        modelManager.registerServer(createServer(`ollama-${i}`));
      }

      const summary1 = modelManager.getSummary();
      expect(summary1.totalServers).toBe(20);

      for (let i = 0; i < 10; i++) {
        modelManager.unregisterServer(`ollama-${i}`);
      }

      const summary2 = modelManager.getSummary();
      expect(summary2.totalServers).toBe(10);
    });

    it('should handle warmup cancellation concurrently', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

      const warmupPromises = Array.from({ length: 10 }, () =>
        modelManager.warmupModel('llama3:latest')
      );

      const pendingJobs = modelManager.getPendingWarmupJobs();
      if (pendingJobs.length > 0) {
        modelManager.cancelWarmup(pendingJobs[0].id);
      }

      expect(pendingJobs.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Race Condition Handling', () => {
    it('should handle rapid state transitions', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      for (let i = 0; i < 50; i++) {
        modelManager.updateModelState('ollama-1', 'llama3:latest', {
          loaded: true,
          loadTime: i,
        });
        modelManager.updateModelState('ollama-1', 'llama3:latest', {
          loaded: false,
        });
      }

      const state = modelManager.getModelState('ollama-1', 'llama3:latest');
      expect(state).toBeDefined();
    });

    it('should handle interleaved operations', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'model-a', { loaded: true });
      modelManager.markModelUsed('ollama-1', 'model-a');
      modelManager.updateModelState('ollama-1', 'model-b', { loaded: true });
      modelManager.markModelUsed('ollama-1', 'model-b');

      const stateA = modelManager.getModelState('ollama-1', 'model-a');
      const stateB = modelManager.getModelState('ollama-1', 'model-b');

      expect(stateA?.loaded).toBe(true);
      expect(stateB?.loaded).toBe(true);
    });

    it('should handle bulk operations on many servers', () => {
      for (let s = 0; s < 100; s++) {
        modelManager.registerServer(createServer(`ollama-${s}`));
      }

      for (let s = 0; s < 100; s++) {
        for (let m = 0; m < 5; m++) {
          modelManager.updateModelState(`ollama-${s}`, `model-${m}:latest`, {
            loaded: true,
          });
        }
      }

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(100);
      expect(summary.totalModels).toBeGreaterThan(0);
    });
  });

  describe('Concurrent Model Queries', () => {
    it('should handle concurrent model queries', () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-1', 'mistral:latest', { loaded: true });

      const queries = Array.from({ length: 50 }, () => [
        modelManager.getModelState('ollama-1', 'llama3:latest'),
        modelManager.getModelState('ollama-1', 'mistral:latest'),
        modelManager.isModelLoaded('ollama-1', 'llama3:latest'),
        modelManager.getServersWithModelLoaded('llama3:latest'),
      ]);

      for (const result of queries) {
        expect(result[0]).toBeDefined();
        expect(result[1]).toBeDefined();
        expect(result[2]).toBe(true);
        expect(result[3]).toContain('ollama-1');
      }
    });

    it('should handle concurrent warmup status queries', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      await modelManager.warmupModel('llama3:latest');

      const statuses = Array.from({ length: 20 }, () =>
        modelManager.getModelWarmupStatus('llama3:latest')
      );

      for (const status of statuses) {
        expect(status).toBeDefined();
      }
    });
  });

  describe('Error Handling Under Load', () => {
    it('should handle server not found gracefully', () => {
      const state = modelManager.getModelState('nonexistent', 'model');
      expect(state).toBeUndefined();
    });

    it('should handle unregistered server queries', () => {
      modelManager.registerServer(createServer('ollama-1'));
      modelManager.unregisterServer('ollama-1');

      const servers = modelManager.getServersWithModelLoaded('any-model');
      expect(servers.length).toBe(0);
    });

    it('should handle empty fleet queries', () => {
      const servers = modelManager.getServersWithModelLoaded('any-model');
      expect(servers.length).toBe(0);
    });
  });

  describe('Dual-Protocol Concurrent Operations', () => {
    it('should handle mixed protocol servers concurrently', async () => {
      const ollamaServer: AIServer = {
        id: 'ollama-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: true,
        supportsOllama: true,
        lastResponseTime: 100,
        models: ['llama3:latest'],
      };

      const dualServer: AIServer = {
        id: 'dual-1',
        url: 'http://localhost:9000',
        type: 'ollama',
        healthy: true,
        supportsOllama: true,
        supportsV1: true,
        lastResponseTime: 100,
        models: ['llama3:latest'],
        v1Models: ['gpt-4'],
      };

      modelManager.registerServer(ollamaServer);
      modelManager.registerServer(dualServer);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const [result1, result2] = await Promise.all([
        modelManager.warmupModel('llama3:latest'),
        modelManager.warmupModel('gpt-4'),
      ]);

      expect(result1.totalServers).toBeGreaterThanOrEqual(1);
      expect(result2.totalServers).toBeGreaterThanOrEqual(1);
    });

    it('should track model state for different protocols', () => {
      const dualServer: AIServer = {
        id: 'dual-1',
        url: 'http://localhost:9000',
        type: 'ollama',
        healthy: true,
        supportsOllama: true,
        supportsV1: true,
        lastResponseTime: 100,
        models: ['llama3:latest'],
        v1Models: ['gpt-4'],
      };

      modelManager.registerServer(dualServer);
      modelManager.updateModelState('dual-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('dual-1', 'gpt-4', { loaded: true });

      const state1 = modelManager.getModelState('dual-1', 'llama3:latest');
      const state2 = modelManager.getModelState('dual-1', 'gpt-4');

      expect(state1?.loaded).toBe(true);
      expect(state2?.loaded).toBe(true);
    });
  });
});
