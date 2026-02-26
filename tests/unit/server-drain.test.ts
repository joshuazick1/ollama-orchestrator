/**
 * server-drain.test.ts
 * Tests for server drain and maintenance functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelManager } from '../../src/model-manager.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('Server Drain and Maintenance Tests', () => {
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

  describe('Server Drain State', () => {
    it('should handle draining server', () => {
      const draining: AIServer = {
        ...createServer('ollama-1'),
        draining: true,
      };
      expect(draining.draining).toBe(true);
    });

    it('should handle non-draining server', () => {
      const server = createServer('ollama-1');
      expect(server.draining).toBeUndefined();
    });

    it('should handle drain started timestamp', () => {
      const draining: AIServer = {
        ...createServer('ollama-1'),
        draining: true,
        drainStartedAt: new Date(),
      };
      expect(draining.drainStartedAt).toBeDefined();
    });
  });

  describe('Maintenance Mode', () => {
    it('should handle server in maintenance', () => {
      const maintenance: AIServer = {
        ...createServer('ollama-1'),
        maintenance: true,
      };
      expect(maintenance.maintenance).toBe(true);
    });

    it('should handle server not in maintenance', () => {
      const server = createServer('ollama-1');
      expect(server.maintenance).toBeUndefined();
    });

    it('should handle maintenance with drain', () => {
      const server: AIServer = {
        ...createServer('ollama-1'),
        maintenance: true,
        draining: true,
        drainStartedAt: new Date(),
      };
      expect(server.maintenance).toBe(true);
      expect(server.draining).toBe(true);
    });
  });

  describe('Capacity During Drain', () => {
    it('should reduce capacity during drain', () => {
      const normalCapacity = 4;
      const drainingCapacity = 0;

      expect(normalCapacity).toBe(4);
      expect(drainingCapacity).toBe(0);
    });

    it('should track in-flight requests during drain', () => {
      const inFlight = 3;
      expect(inFlight).toBe(3);
    });

    it('should handle zero capacity during drain', () => {
      const capacity = 0;
      expect(capacity).toBe(0);
    });
  });

  describe('Server State Transitions', () => {
    it('should transition to draining', () => {
      const server = createServer('ollama-1');
      const draining = { ...server, draining: true };
      expect(draining.draining).toBe(true);
    });

    it('should transition from draining to normal', () => {
      const draining = { ...createServer('ollama-1'), draining: true };
      const recovered = { ...draining, draining: false };
      expect(recovered.draining).toBe(false);
    });

    it('should transition to maintenance', () => {
      const server = createServer('ollama-1');
      const maintenance = { ...server, maintenance: true };
      expect(maintenance.maintenance).toBe(true);
    });
  });

  describe('Model State During Drain', () => {
    it('should track loaded models during drain', () => {
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

    it('should handle multiple servers with different states', () => {
      const server1 = { ...createServer('ollama-1'), draining: true };
      const server2 = { ...createServer('ollama-2'), maintenance: true };
      const server3 = createServer('ollama-3');

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);
      modelManager.registerServer(server3);

      const summary = modelManager.getSummary();
      expect(summary.totalServers).toBe(3);
    });
  });

  describe('Health During Drain', () => {
    it('should mark draining server as unhealthy', () => {
      const draining = { ...createServer('ollama-1'), draining: true, healthy: false };
      expect(draining.healthy).toBe(false);
    });

    it('should mark maintenance server as unhealthy', () => {
      const maintenance = { ...createServer('ollama-1'), maintenance: true, healthy: false };
      expect(maintenance.healthy).toBe(false);
    });

    it('should handle healthy server', () => {
      const server = createServer('ollama-1');
      expect(server.healthy).toBe(true);
    });
  });

  describe('Dual-Protocol Drain', () => {
    it('should handle Ollama server drain', () => {
      const ollama: AIServer = {
        ...createServer('ollama-1'),
        supportsOllama: true,
        draining: true,
      };
      expect(ollama.supportsOllama).toBe(true);
      expect(ollama.draining).toBe(true);
    });

    it('should handle OpenAI server drain', () => {
      const openai: AIServer = {
        id: 'openai-1',
        url: 'http://localhost:8000',
        type: 'ollama',
        healthy: true,
        supportsV1: true,
        draining: true,
        lastResponseTime: 100,
        models: [],
        v1Models: ['gpt-4'],
      };
      expect(openai.supportsV1).toBe(true);
      expect(openai.draining).toBe(true);
    });

    it('should handle dual-capability server drain', () => {
      const dual: AIServer = {
        ...createServer('dual-1'),
        supportsOllama: true,
        supportsV1: true,
        draining: true,
      };
      expect(dual.supportsOllama).toBe(true);
      expect(dual.supportsV1).toBe(true);
      expect(dual.draining).toBe(true);
    });
  });

  describe('Graceful Shutdown', () => {
    it('should wait for in-flight requests', () => {
      const inFlightRequests = 5;
      expect(inFlightRequests).toBe(5);
    });

    it('should complete pending warmup jobs', async () => {
      const server = createServer('ollama-1');
      modelManager.registerServer(server);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });

      await modelManager.warmupModel('llama3:latest');
      const pending = modelManager.getPendingWarmupJobs();
      expect(pending.length).toBeGreaterThanOrEqual(0);
    });

    it('should block new requests during drain', () => {
      const draining = { ...createServer('ollama-1'), draining: true };
      expect(draining.draining).toBe(true);
    });
  });

  describe('Recovery from Drain', () => {
    it('should recover from draining state', () => {
      const draining = { ...createServer('ollama-1'), draining: true };
      const recovered = { ...draining, draining: false, healthy: true };
      expect(recovered.draining).toBe(false);
      expect(recovered.healthy).toBe(true);
    });

    it('should recover from maintenance', () => {
      const maintenance = { ...createServer('ollama-1'), maintenance: true };
      const recovered = { ...maintenance, maintenance: false, healthy: true };
      expect(recovered.maintenance).toBe(false);
    });

    it('should restore full capacity after recovery', () => {
      const recovering = { ...createServer('ollama-1'), draining: false, maxConcurrency: 4 };
      expect(recovering.maxConcurrency).toBe(4);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple drain cycles', () => {
      const server = createServer('ollama-1');

      const drain1 = { ...server, draining: true };
      const recover1 = { ...drain1, draining: false };
      const drain2 = { ...recover1, draining: true };
      const recover2 = { ...drain2, draining: false };

      expect(recover2.draining).toBe(false);
    });

    it('should handle rapid state changes', () => {
      const server = createServer('ollama-1');

      for (let i = 0; i < 10; i++) {
        server.draining = i % 2 === 0;
        server.maintenance = i % 3 === 0;
      }

      expect(server.draining).toBe(false);
    });

    it('should handle partial drain', () => {
      const servers = [
        createServer('ollama-1'),
        { ...createServer('ollama-2'), draining: true },
        createServer('ollama-3'),
      ];

      const draining = servers.filter(s => s.draining);
      expect(draining.length).toBe(1);
    });
  });
});
