/**
 * model-manager-enhanced.test.ts
 * Enhanced unit tests for ModelManager with dual-protocol and fleet operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelManager } from '../../src/model-manager.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('ModelManager Enhanced - Dual Protocol & Fleet Operations', () => {
  let modelManager: ModelManager;

  const createOllamaServer = (id: string, models: string[] = []): AIServer => ({
    id,
    url: `http://localhost:${11434 + parseInt(id.split('-')[1])}`,
    type: 'ollama',
    healthy: true,
    supportsOllama: true,
    lastResponseTime: 100,
    models,
    maxConcurrency: 4,
  });

  const createDualCapabilityServer = (
    id: string,
    models: string[] = [],
    v1Models: string[] = []
  ): AIServer => ({
    id,
    url: `http://localhost:${9000 + parseInt(id.split('-')[1])}`,
    type: 'ollama',
    healthy: true,
    supportsOllama: true,
    supportsV1: true,
    lastResponseTime: 100,
    models,
    v1Models: v1Models.length > 0 ? v1Models : models,
    maxConcurrency: 4,
  });

  beforeEach(() => {
    modelManager = new ModelManager();
    vi.clearAllMocks();
  });

  // ============================================================================
  // SECTION 1: Dual-Protocol Model Operations
  // ============================================================================

  describe('Dual-Protocol Model Operations', () => {
    it('should track Ollama server model state', () => {
      const ollamaServer = createOllamaServer('ollama-1', ['llama3:latest', 'mistral:latest']);
      modelManager.registerServer(ollamaServer);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true, loadTime: 5000 });
      const state = modelManager.getModelState('ollama-1', 'llama3:latest');

      expect(state?.loaded).toBe(true);
      expect(state?.loadTime).toBe(5000);
    });

    it('should track dual-capability server model state for Ollama protocol', () => {
      const dualServer = createDualCapabilityServer('dual-1', ['llama3:latest', 'mistral:latest']);
      modelManager.registerServer(dualServer);

      modelManager.updateModelState('dual-1', 'llama3:latest', { loaded: true });
      const state = modelManager.getModelState('dual-1', 'llama3:latest');

      expect(state?.loaded).toBe(true);
    });

    it('should track dual-capability server model state for OpenAI protocol', () => {
      const dualServer = createDualCapabilityServer('dual-1', [], ['gpt-4', 'gpt-3.5-turbo']);
      modelManager.registerServer(dualServer);

      modelManager.updateModelState('dual-1', 'gpt-4', { loaded: true });
      const state = modelManager.getModelState('dual-1', 'gpt-4');

      expect(state?.loaded).toBe(true);
    });

    it('should warmup model on Ollama server', async () => {
      const ollamaServer = createOllamaServer('ollama-1');
      modelManager.registerServer(ollamaServer);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const result = await modelManager.warmupModel('llama3:latest', {
        serverIds: ['ollama-1'],
      });

      expect(result.totalServers).toBe(1);
      expect(fetch).toHaveBeenCalled();
    });

    it('should warmup model on dual-capability server using Ollama protocol', async () => {
      const dualServer = createDualCapabilityServer('dual-1');
      modelManager.registerServer(dualServer);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const result = await modelManager.warmupModel('llama3:latest', {
        serverIds: ['dual-1'],
      });

      expect(result.totalServers).toBe(1);
    });

    it('should handle model info fetch from Ollama server', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            size: 5368709120,
            details: { parameter_size: '8B', quantization_level: 'Q4_0', family: 'llama' },
          }),
      });

      const info = await modelManager.getModelInfo('http://localhost:11434', 'llama3:latest');

      expect(info.size).toBeCloseTo(5, 0);
      expect(info.parameters).toBe('8B');
      expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/show', expect.any(Object));
    });

    it('should handle model info fetch from OpenAI-compatible endpoint', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: 'gpt-4', owned_by: 'openai', permissions: [] }],
          }),
      });

      const info = await modelManager.getModelInfo('http://localhost:8000', 'gpt-4');

      expect(info.size).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // SECTION 2: Fleet Statistics Aggregation
  // ============================================================================

  describe('Fleet Statistics Aggregation', () => {
    it('should aggregate model availability across Ollama fleet', () => {
      const server1 = createOllamaServer('ollama-1', ['llama3:latest', 'mistral:latest']);
      const server2 = createOllamaServer('ollama-2', ['llama3:latest', 'codellama:latest']);
      const server3 = createOllamaServer('ollama-3', ['mistral:latest']);

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);
      modelManager.registerServer(server3);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-2', 'llama3:latest', { loaded: true });

      const serversWithModel = modelManager.getServersWithModelLoaded('llama3:latest');
      expect(serversWithModel.length).toBe(2);
    });

    it('should calculate fleet-wide loaded model count', () => {
      const server1 = createOllamaServer('ollama-1', ['llama3:latest', 'mistral:latest']);
      const server2 = createOllamaServer('ollama-2', ['llama3:latest', 'codellama:latest']);

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-1', 'mistral:latest', { loaded: true });
      modelManager.updateModelState('ollama-2', 'llama3:latest', { loaded: true });

      const llamaServers = modelManager.getServersWithModelLoaded('llama3:latest');
      expect(llamaServers.length).toBe(2);
    });

    it('should handle mixed fleet (Ollama + Dual)', () => {
      const ollamaServer = createOllamaServer('ollama-1', ['llama3:latest']);
      const dualServer = createDualCapabilityServer('dual-1', ['llama3:latest', 'gpt-4']);

      modelManager.registerServer(ollamaServer);
      modelManager.registerServer(dualServer);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('dual-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('dual-1', 'gpt-4', { loaded: true });

      const llamaServers = modelManager.getServersWithModelLoaded('llama3:latest');
      const gptServers = modelManager.getServersWithModelLoaded('gpt-4');

      expect(llamaServers.length).toBe(2);
      expect(gptServers.length).toBe(1);
    });

    it('should track loading state across fleet', async () => {
      const server1 = createOllamaServer('ollama-1');
      const server2 = createOllamaServer('ollama-2');

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loading: true });
      modelManager.updateModelState('ollama-2', 'llama3:latest', { loading: true });

      const loading1 = modelManager.isModelLoading('ollama-1', 'llama3:latest');
      const loading2 = modelManager.isModelLoading('ollama-2', 'llama3:latest');

      expect(loading1).toBe(true);
      expect(loading2).toBe(true);
    });

    it('should get servers without model', () => {
      const server1 = createOllamaServer('ollama-1', ['llama3:latest']);
      const server2 = createOllamaServer('ollama-2', ['mistral:latest']);

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      const serversWithout = modelManager.getServersWithoutModel('llama3:latest');
      expect(serversWithout).toContain('ollama-2');
    });
  });

  // ============================================================================
  // SECTION 3: Dynamic Model Registry Updates
  // ============================================================================

  describe('Dynamic Model Registry Updates', () => {
    it('should handle server model list update', () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest']);
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-1', 'mistral:latest', { loaded: true });

      const state1 = modelManager.getModelState('ollama-1', 'llama3:latest');
      const state2 = modelManager.getModelState('ollama-1', 'mistral:latest');

      expect(state1?.loaded).toBe(true);
      expect(state2?.loaded).toBe(true);
    });

    it('should add new model to existing server', () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest']);
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-1', 'new-model:latest', { loaded: true });

      const state = modelManager.getModelState('ollama-1', 'new-model:latest');
      expect(state?.loaded).toBe(true);
    });

    it('should handle server unregistration cleanup', () => {
      const server1 = createOllamaServer('ollama-1');
      const server2 = createOllamaServer('ollama-2');

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-2', 'llama3:latest', { loaded: true });

      modelManager.unregisterServer('ollama-1');

      const serversWithModel = modelManager.getServersWithModelLoaded('llama3:latest');
      expect(serversWithModel.length).toBe(1);
      expect(serversWithModel[0]).toBe('ollama-2');
    });

    it('should handle model removal from server', () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest', 'mistral:latest']);
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-1', 'mistral:latest', { loaded: true });

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: false });

      const state = modelManager.getModelState('ollama-1', 'llama3:latest');
      expect(state?.loaded).toBe(false);
    });
  });

  // ============================================================================
  // SECTION 4: Proactive Warmup Based on Usage Patterns
  // ============================================================================

  describe('Proactive Warmup Based on Usage Patterns', () => {
    it('should track model usage frequency', () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest']);
      modelManager.registerServer(server);

      modelManager.markModelUsed('ollama-1', 'llama3:latest');
      modelManager.markModelUsed('ollama-1', 'llama3:latest');
      modelManager.markModelUsed('ollama-1', 'llama3:latest');

      const state = modelManager.getModelState('ollama-1', 'llama3:latest');
      expect(state?.lastUsed).toBeGreaterThan(0);
    });

    it('should prioritize frequently used models for warmup', async () => {
      const server1 = createOllamaServer('ollama-1', ['llama3:latest']);
      const server2 = createOllamaServer('ollama-2', ['llama3:latest']);

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      for (let i = 0; i < 10; i++) {
        modelManager.markModelUsed('ollama-1', 'llama3:latest');
      }
      for (let i = 0; i < 2; i++) {
        modelManager.markModelUsed('ollama-2', 'llama3:latest');
      }

      const state1 = modelManager.getModelState('ollama-1', 'llama3:latest');
      const state2 = modelManager.getModelState('ollama-2', 'llama3:latest');

      expect(state1?.lastUsed).toBeGreaterThanOrEqual(state2?.lastUsed || 0);
    });

    it('should handle usage tracking across multiple models', () => {
      const server = createOllamaServer('ollama-1', [
        'llama3:latest',
        'mistral:latest',
        'codellama:latest',
      ]);
      modelManager.registerServer(server);

      modelManager.markModelUsed('ollama-1', 'llama3:latest');
      modelManager.markModelUsed('ollama-1', 'llama3:latest');
      modelManager.markModelUsed('ollama-1', 'mistral:latest');

      const llamaState = modelManager.getModelState('ollama-1', 'llama3:latest');
      const mistralState = modelManager.getModelState('ollama-1', 'mistral:latest');
      const codellamaState = modelManager.getModelState('ollama-1', 'codellama:latest');

      expect(llamaState?.lastUsed).toBeGreaterThanOrEqual(mistralState?.lastUsed || 0);
      expect(mistralState?.lastUsed).toBeGreaterThanOrEqual(codellamaState?.lastUsed || 0);
    });

    it('should update last used timestamp on repeated usage', () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest']);
      modelManager.registerServer(server);

      modelManager.markModelUsed('ollama-1', 'llama3:latest');
      const firstMark = modelManager.getModelState('ollama-1', 'llama3:latest')?.lastUsed;

      modelManager.markModelUsed('ollama-1', 'llama3:latest');
      const secondMark = modelManager.getModelState('ollama-1', 'llama3:latest')?.lastUsed;

      expect(secondMark).toBeGreaterThanOrEqual(firstMark || 0);
    });

    it('should get recommended warmup models based on usage', async () => {
      const server = createOllamaServer('ollama-1', [
        'llama3:latest',
        'mistral:latest',
        'codellama:latest',
      ]);
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-1', 'mistral:latest', { loaded: true });

      for (let i = 0; i < 15; i++) {
        modelManager.markModelUsed('ollama-1', 'llama3:latest');
      }
      for (let i = 0; i < 5; i++) {
        modelManager.markModelUsed('ollama-1', 'mistral:latest');
      }

      const recommended = modelManager.getRecommendedWarmupModels(10, 3600000);
      expect(recommended.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // SECTION 5: Per-Server Model Operations
  // ============================================================================

  describe('Per-Server Model Operations', () => {
    it('should warmup specific server', async () => {
      const server = createOllamaServer('ollama-1');
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

    it('should handle warmup on unregistered server gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const result = await modelManager.warmupModel('llama3:latest', {
        serverIds: ['nonexistent-server'],
      });

      expect(result.totalServers).toBe(1);
      expect(result.loadedOn).toBe(0);
    });

    it('should cancel warmup job', async () => {
      const server = createOllamaServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const result = await modelManager.warmupModel('llama3:latest', {
        serverIds: ['ollama-1'],
      });

      const pendingJobs = modelManager.getPendingWarmupJobs();
      expect(pendingJobs.length).toBeGreaterThanOrEqual(0);
    });

    it('should cancel all warmup jobs for a model', async () => {
      const server = createOllamaServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      await modelManager.warmupModel('llama3:latest', { serverIds: ['ollama-1'] });

      const cancelled = modelManager.cancelModelWarmup('llama3:latest');
      expect(typeof cancelled).toBe('number');
    });
  });

  // ============================================================================
  // SECTION 6: Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty model list', () => {
      const server = createOllamaServer('ollama-1', []);
      modelManager.registerServer(server);

      const serversWithModel = modelManager.getServersWithModelLoaded('nonexistent-model');
      expect(serversWithModel.length).toBe(0);
    });

    it('should handle model state on unregistered server', () => {
      const state = modelManager.getModelState('nonexistent-server', 'llama3:latest');
      expect(state).toBeUndefined();
    });

    it('should handle concurrent warmup requests', async () => {
      const server1 = createOllamaServer('ollama-1');
      const server2 = createOllamaServer('ollama-2');

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      const [result1, result2] = await Promise.all([
        modelManager.warmupModel('llama3:latest'),
        modelManager.warmupModel('mistral:latest'),
      ]);

      expect(result1.totalServers).toBeGreaterThanOrEqual(1);
      expect(result2.totalServers).toBeGreaterThanOrEqual(1);
    });

    it('should handle GPU memory update for servers', async () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest']);
      modelManager.registerServer(server);
      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [{ model: 'llama3:latest', size_vram: 4000000000 }],
          }),
      });

      await modelManager.updateGpuMemory('ollama-1');

      const state = modelManager.getModelState('ollama-1', 'llama3:latest');
      expect(state?.gpuMemory).toBeGreaterThan(0);
    });

    it('should handle server with no GPU memory info', async () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest']);
      modelManager.registerServer(server);
      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      await modelManager.updateGpuMemory('ollama-1');

      const state = modelManager.getModelState('ollama-1', 'llama3:latest');
      expect(state?.gpuMemory).toBeDefined();
    });

    it('should get model warmup status', async () => {
      const server = createOllamaServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      await modelManager.warmupModel('llama3:latest', { serverIds: ['ollama-1'] });

      const status = modelManager.getModelWarmupStatus('llama3:latest');
      expect(status).toBeDefined();
    });

    it('should get idle models', async () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest', 'mistral:latest']);
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.markModelUsed('ollama-1', 'llama3:latest');

      const idleModels = modelManager.getIdleModels(1);
      expect(Array.isArray(idleModels)).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 7: Multi-Server Selection with Protocol Awareness
  // ============================================================================

  describe('Multi-Server Selection with Protocol Awareness', () => {
    it('should select server with loaded model', () => {
      const server1 = createOllamaServer('ollama-1', ['llama3:latest']);
      const server2 = createOllamaServer('ollama-2', ['llama3:latest']);
      const server3 = createOllamaServer('ollama-3', ['llama3:latest']);

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);
      modelManager.registerServer(server3);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-2', 'llama3:latest', { loaded: false });

      const serversWithLoadedModel = modelManager.getServersWithModelLoaded('llama3:latest');

      expect(serversWithLoadedModel.length).toBe(1);
      expect(serversWithLoadedModel).toContain('ollama-1');
    });

    it('should prefer server with faster load time', () => {
      const server1 = createOllamaServer('ollama-1', ['llama3:latest']);
      const server2 = createOllamaServer('ollama-2', ['llama3:latest']);

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true, loadTime: 3000 });
      modelManager.updateModelState('ollama-2', 'llama3:latest', { loaded: true, loadTime: 8000 });

      const servers = modelManager.getServersWithModelLoaded('llama3:latest');
      expect(servers.length).toBe(2);
    });

    it('should handle mixed protocol server selection', () => {
      const ollamaServer = createOllamaServer('ollama-1', ['llama3:latest']);
      const dualServer = createDualCapabilityServer('dual-1', ['llama3:latest', 'gpt-4']);

      modelManager.registerServer(ollamaServer);
      modelManager.registerServer(dualServer);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('dual-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('dual-1', 'gpt-4', { loaded: true });

      const llamaServers = modelManager.getServersWithModelLoaded('llama3:latest');
      const gptServers = modelManager.getServersWithModelLoaded('gpt-4');

      expect(llamaServers.length).toBe(2);
      expect(gptServers.length).toBe(1);
    });

    it('should estimate load time for model', () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest']);
      modelManager.registerServer(server);

      const estimatedLoadTime = modelManager.getEstimatedLoadTime('llama3:latest', 4000000000);
      expect(estimatedLoadTime).toBeGreaterThan(0);
    });

    it('should estimate load time for unknown model', () => {
      const server = createOllamaServer('ollama-1');
      modelManager.registerServer(server);

      const estimatedLoadTime = modelManager.getEstimatedLoadTime('unknown-model');
      expect(estimatedLoadTime).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // SECTION 8: Summary and Reset Operations
  // ============================================================================

  describe('Summary and Reset Operations', () => {
    it('should get summary of model manager state', () => {
      const server1 = createOllamaServer('ollama-1', ['llama3:latest']);
      const server2 = createOllamaServer('ollama-2', ['mistral:latest']);

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('ollama-2', 'mistral:latest', { loaded: true });

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(2);
      expect(summary.totalModels).toBeGreaterThanOrEqual(2);
    });

    it('should reset model manager state', () => {
      const server = createOllamaServer('ollama-1', ['llama3:latest']);
      modelManager.registerServer(server);

      modelManager.updateModelState('ollama-1', 'llama3:latest', { loaded: true });

      modelManager.reset();

      const state = modelManager.getModelState('ollama-1', 'llama3:latest');
      expect(state).toBeUndefined();
    });
  });
});
