/**
 * v1-model-matching.test.ts
 * Tests for REC-47 (v1Models for OpenAI servers) and REC-48 (resolveModelName in failover)
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { AIOrchestrator } from '../../src/orchestrator.js';
import { resetInFlightManager } from '../../src/utils/in-flight-manager.js';

describe('Wave 3 REC-47/48: v1Models matching and resolveModelName in failover', () => {
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

  describe('REC-47: OpenAI server uses v1Models list for matching', () => {
    it('should select server with matching v1Models for openai capability request', async () => {
      orchestrator.addServer({
        id: 'openai-server',
        url: 'http://localhost:8080',
        type: 'ollama',
        maxConcurrency: 4,
      });
      const s = orchestrator.getServer('openai-server');
      if (s) {
        s.healthy = true;
        s.models = []; // No ollama models
        s.v1Models = ['gpt-4'];
        s.supportsV1 = true;
        s.supportsOllama = false;
      }

      const serversTried: string[] = [];
      const result = await orchestrator.tryRequestWithFailover(
        'gpt-4',
        async server => {
          serversTried.push(server.id);
          return { success: true };
        },
        false,
        'generate',
        'openai' // required capability
      );

      expect(result.success).toBe(true);
      expect(serversTried).toContain('openai-server');
    });

    it('should NOT select server with only v1Models when ollama capability required', async () => {
      orchestrator.addServer({
        id: 'openai-only-server',
        url: 'http://localhost:8080',
        type: 'ollama',
        maxConcurrency: 4,
      });
      const s = orchestrator.getServer('openai-only-server');
      if (s) {
        s.healthy = true;
        s.models = []; // No ollama models
        s.v1Models = ['gpt-4'];
        s.supportsV1 = true;
        s.supportsOllama = false;
      }

      // Requesting ollama capability — server has no s.models entries
      await expect(
        orchestrator.tryRequestWithFailover(
          'gpt-4',
          async server => ({ success: true }),
          false,
          'generate',
          'ollama' // required capability
        )
      ).rejects.toThrow();
    });

    it('should select ollama server using models list (not v1Models) for ollama requests', async () => {
      orchestrator.addServer({
        id: 'ollama-server',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 4,
      });
      const s = orchestrator.getServer('ollama-server');
      if (s) {
        s.healthy = true;
        s.models = ['llama3:latest'];
        s.v1Models = [];
        s.supportsOllama = true;
        s.supportsV1 = false;
      }

      const serversTried: string[] = [];
      const result = await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => {
          serversTried.push(server.id);
          return { success: true };
        },
        false,
        'generate',
        'ollama'
      );

      expect(result.success).toBe(true);
      expect(serversTried).toContain('ollama-server');
    });

    it('should select dual-capability server for both request types', async () => {
      orchestrator.addServer({
        id: 'dual-server',
        url: 'http://localhost:8080',
        type: 'ollama',
        maxConcurrency: 4,
      });
      const s = orchestrator.getServer('dual-server');
      if (s) {
        s.healthy = true;
        s.models = ['llama3:latest'];
        s.v1Models = ['gpt-4'];
        s.supportsOllama = true;
        s.supportsV1 = true;
      }

      // OpenAI capability request
      const openaiResult = await orchestrator.tryRequestWithFailover(
        'gpt-4',
        async server => ({ success: true, serverId: server.id }),
        false,
        'generate',
        'openai'
      );
      expect(openaiResult.success).toBe(true);

      // Ollama capability request
      const ollamaResult = await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => ({ success: true, serverId: server.id }),
        false,
        'generate',
        'ollama'
      );
      expect(ollamaResult.success).toBe(true);
    });
  });

  describe('REC-48: resolveModelName applied in failover path', () => {
    it('should match model "llama3" to server with "llama3:latest"', async () => {
      orchestrator.addServer({
        id: 'ollama-server',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 4,
      });
      const s = orchestrator.getServer('ollama-server');
      if (s) {
        s.healthy = true;
        s.models = ['llama3:latest']; // Note: stored with :latest tag
      }

      // Request without :latest — resolveModelName should handle this
      const serversTried: string[] = [];
      const result = await orchestrator.tryRequestWithFailover(
        'llama3', // No :latest suffix
        async server => {
          serversTried.push(server.id);
          return { success: true };
        },
        false,
        'generate'
      );

      expect(result.success).toBe(true);
      expect(serversTried).toContain('ollama-server');
    });

    it('should match "gpt-4" to server with "gpt-4" in v1Models (exact)', async () => {
      orchestrator.addServer({
        id: 'openai-server',
        url: 'http://localhost:8080',
        type: 'ollama',
        maxConcurrency: 4,
      });
      const s = orchestrator.getServer('openai-server');
      if (s) {
        s.healthy = true;
        s.models = [];
        s.v1Models = ['gpt-4'];
        s.supportsV1 = true;
        s.supportsOllama = false;
      }

      const serversTried: string[] = [];
      const result = await orchestrator.tryRequestWithFailover(
        'gpt-4',
        async server => {
          serversTried.push(server.id);
          return { success: true };
        },
        false,
        'generate',
        'openai'
      );

      expect(result.success).toBe(true);
      expect(serversTried).toContain('openai-server');
    });

    it('should not match model "unknown-model" to any server', async () => {
      orchestrator.addServer({
        id: 'ollama-server',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 4,
      });
      const s = orchestrator.getServer('ollama-server');
      if (s) {
        s.healthy = true;
        s.models = ['llama3:latest'];
      }

      await expect(
        orchestrator.tryRequestWithFailover(
          'unknown-model',
          async server => ({ success: true }),
          false,
          'generate'
        )
      ).rejects.toThrow();
    });
  });
});
