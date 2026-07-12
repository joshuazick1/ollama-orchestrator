/**
 * routing-v1models-union.test.ts
 * Verifies the v1Models ∪ models union fix for routing candidate filtering.
 * Bug: (s.v1Models ?? s.models) skips servers where v1Models is non-null but
 * doesn't contain the target model, even if models does.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { AIOrchestrator } from '../../src/orchestrator/orchestrator.js';
import { resetInFlightManager } from '../../src/utils/in-flight-manager.js';

describe('routing v1Models union fix', () => {
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
    // Suppress persistence so addServer doesn't overwrite data/servers.json.
    // This test instantiates AIOrchestrator directly (no singleton mock), and
    // addServer would otherwise call saveServersToDisk on every test run,
    // wiping the production fleet config.
    orchestrator.setSuppressPersistence(true);
  });

  /**
   * Bug scenario: v1Models is non-null but doesn't contain the requested model.
   * models contains the model. Old code (v1Models ?? models) returned v1Models
   * and missed the model in models. Fixed code unions both lists.
   */
  it('should select server for openai request when model is in models but not in v1Models', async () => {
    orchestrator.addServer({
      id: 'dual-server-openai',
      url: 'http://localhost:8080',
      type: 'ollama',
      maxConcurrency: 4,
    });
    const s = orchestrator.getServer('dual-server-openai');
    if (s) {
      s.healthy = true;
      s.models = ['llama3.2:latest']; // contains the target model
      s.v1Models = ['gpt-4']; // non-null, but doesn't contain target
      s.supportsV1 = true;
      s.supportsOllama = false;
    }

    const serversTried: string[] = [];
    const result = await orchestrator.tryRequestWithFailover(
      'llama3.2:latest',
      async server => {
        serversTried.push(server.id);
        return { success: true };
      },
      false,
      'generate',
      'openai'
    );

    expect(result.success).toBe(true);
    expect(serversTried).toContain('dual-server-openai');
  });

  it('should select server for anthropic request when model is in models but not in v1Models', async () => {
    orchestrator.addServer({
      id: 'dual-server-anthropic',
      url: 'http://localhost:8080',
      type: 'ollama',
      maxConcurrency: 4,
    });
    const s = orchestrator.getServer('dual-server-anthropic');
    if (s) {
      s.healthy = true;
      s.models = ['llama3.2:latest'];
      s.v1Models = ['claude-3-haiku']; // non-null, wrong model
      s.supportsV1 = true;
      s.supportsAnthropic = true;
      s.supportsOllama = false;
    }

    const serversTried: string[] = [];
    const result = await orchestrator.tryRequestWithFailover(
      'llama3.2:latest',
      async server => {
        serversTried.push(server.id);
        return { success: true };
      },
      false,
      'generate',
      'anthropic'
    );

    expect(result.success).toBe(true);
    expect(serversTried).toContain('dual-server-anthropic');
  });

  /**
   * Verify v1Models-only servers still work (existing REC-47 coverage)
   */
  it('should select server when model is only in v1Models (models is empty)', async () => {
    orchestrator.addServer({
      id: 'v1models-only-server',
      url: 'http://localhost:8080',
      type: 'ollama',
      maxConcurrency: 4,
    });
    const s = orchestrator.getServer('v1models-only-server');
    if (s) {
      s.healthy = true;
      s.models = []; // empty
      s.v1Models = ['llama3.2:latest'];
      s.supportsV1 = true;
      s.supportsAnthropic = true;
      s.supportsOllama = false;
    }

    const serversTried: string[] = [];
    const result = await orchestrator.tryRequestWithFailover(
      'llama3.2:latest',
      async server => {
        serversTried.push(server.id);
        return { success: true };
      },
      false,
      'generate',
      'openai'
    );

    expect(result.success).toBe(true);
    expect(serversTried).toContain('v1models-only-server');
  });

  /**
   * Both v1Models and models contain the model — should still work
   */
  it('should select server when model is in both v1Models and models', async () => {
    orchestrator.addServer({
      id: 'both-lists-server',
      url: 'http://localhost:8080',
      type: 'ollama',
      maxConcurrency: 4,
    });
    const s = orchestrator.getServer('both-lists-server');
    if (s) {
      s.healthy = true;
      s.models = ['llama3.2:latest', 'qwen2.5:7b'];
      s.v1Models = ['llama3.2:latest', 'gpt-4'];
      s.supportsV1 = true;
      s.supportsAnthropic = true;
      s.supportsOllama = true;
    }

    const serversTried: string[] = [];
    const result = await orchestrator.tryRequestWithFailover(
      'llama3.2:latest',
      async server => {
        serversTried.push(server.id);
        return { success: true };
      },
      false,
      'generate',
      'openai'
    );

    expect(result.success).toBe(true);
    expect(serversTried).toContain('both-lists-server');
  });
});
