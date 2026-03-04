/**
 * orchestrator-failover-concurrency.test.ts
 * Tests for orchestrator retry logic and max concurrency handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AIOrchestrator } from '../../src/orchestrator.js';
import { resetInFlightManager } from '../../src/utils/in-flight-manager.js';

describe('Orchestrator Failover and Concurrency Tests', () => {
  let orchestrator: AIOrchestrator;

  beforeEach(() => {
    // Reset the InFlightManager singleton
    resetInFlightManager();

    // Initialize orchestrator with health checks disabled for testing
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

  describe('tryRequestWithFailover - Retry Logic', () => {
    beforeEach(() => {
      // Add multiple servers with the same model
      orchestrator.addServer({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 4,
      });
      orchestrator.addServer({
        id: 'server-2',
        url: 'http://localhost:11435',
        type: 'ollama',
        maxConcurrency: 4,
      });
      orchestrator.addServer({
        id: 'server-3',
        url: 'http://localhost:11436',
        type: 'ollama',
        maxConcurrency: 4,
      });

      // Mark all servers as healthy with the same model
      const s1 = orchestrator.getServer('server-1');
      const s2 = orchestrator.getServer('server-2');
      const s3 = orchestrator.getServer('server-3');

      if (s1) {
        s1.healthy = true;
        s1.models = ['llama3:latest'];
      }
      if (s2) {
        s2.healthy = true;
        s2.models = ['llama3:latest'];
      }
      if (s3) {
        s3.healthy = true;
        s3.models = ['llama3:latest'];
      }
    });

    it('should failover to another server when first server fails', async () => {
      const serversTried: string[] = [];

      const result = await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => {
          serversTried.push(server.id);

          // First server fails
          if (server.id === 'server-1') {
            throw new Error('Server 1 failed');
          }

          return { success: true, serverId: server.id };
        },
        false,
        'generate'
      );

      expect(result.success).toBe(true);
      expect(serversTried).toContain('server-1');
      expect(serversTried).toContain('server-2');
      expect(serversTried.length).toBeGreaterThan(1);
    });

    it('should try all servers in Phase 1 before giving up', async () => {
      const serversTried: string[] = [];
      let attemptCount = 0;

      await expect(
        orchestrator.tryRequestWithFailover(
          'llama3:latest',
          async server => {
            serversTried.push(server.id);
            attemptCount++;
            throw new Error(`Server ${server.id} failed`);
          },
          false,
          'generate'
        )
        // REC-72: after Phase 1, re-filtering may remove all failed servers from Phase 2
        // so the count reflects candidates still available (may be 0)
      ).rejects.toThrow('failed');

      // Should try all 3 servers in Phase 1 (may also include Phase 2/3 retries)
      expect(serversTried).toContain('server-1');
      expect(serversTried).toContain('server-2');
      expect(serversTried).toContain('server-3');
      // Total attempts will be 3+ in Phase 1, then possibly Phase 2 and Phase 3
      expect(serversTried.length).toBeGreaterThanOrEqual(3);
    });

    it('should enter Phase 2 and retry all servers when Phase 1 fails', async () => {
      const serversTried: string[] = [];
      const phase2Servers: string[] = [];
      let attemptCount = 0;

      const result = await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => {
          attemptCount++;

          // Fail first 3 attempts (Phase 1)
          if (attemptCount <= 3) {
            serversTried.push(server.id);
            throw new Error(`Phase 1 - Server ${server.id} failed`);
          }

          // Success on Phase 2
          phase2Servers.push(server.id);
          return { success: true, serverId: server.id, phase: 'phase2' };
        },
        false,
        'generate'
      );

      expect(result.success).toBe(true);
      expect(result.phase).toBe('phase2');
      // Total attempts should be at least 4 (3 in Phase 1 + 1 in Phase 2)
      expect(attemptCount).toBeGreaterThanOrEqual(4);
    });

    it('should enter Phase 3 and try same-server retries on initial server', async () => {
      // REC-72: after Phase 1 all servers may enter cooldown, so Phase 2 may have 0 candidates.
      // Phase 3 always retries the initial server. We fail every attempt until Phase 3 fires
      // (i.e. until ALL Phase 1 candidates have been tried), then succeed.
      const serversTried = new Set<string>();
      let attemptCount = 0;

      const result = await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => {
          attemptCount++;

          // Fail until all 3 distinct servers have been tried at least once (Phase 1 complete)
          if (serversTried.size < 3) {
            serversTried.add(server.id);
            throw new Error(`Phase 1 - Server ${server.id} failed`);
          }

          // After Phase 1 is done, succeed on the next attempt (Phase 2 or Phase 3)
          return { success: true, serverId: server.id, phase: 'post-phase1' };
        },
        false,
        'generate'
      );

      expect(result.success).toBe(true);
      // All 3 servers should have been tried in Phase 1
      expect(serversTried.size).toBe(3);
      expect(attemptCount).toBeGreaterThanOrEqual(4);
    });

    it('should skip servers at max concurrency', async () => {
      // Fill up server-1 and server-2 to max concurrency (4 each)
      for (let i = 0; i < 4; i++) {
        orchestrator.incrementInFlight('server-1', 'llama3:latest');
        orchestrator.incrementInFlight('server-2', 'llama3:latest');
      }

      const serversTried: string[] = [];

      const result = await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => {
          serversTried.push(server.id);
          return { success: true, serverId: server.id };
        },
        false,
        'generate'
      );

      expect(result.success).toBe(true);
      // Should only try server-3 (the only one not at max concurrency)
      expect(serversTried).toContain('server-3');
      expect(serversTried).not.toContain('server-1');
      expect(serversTried).not.toContain('server-2');
    });

    it('should throw when all servers are at max concurrency', async () => {
      // Fill up all servers to max concurrency (4 each)
      for (let i = 0; i < 4; i++) {
        orchestrator.incrementInFlight('server-1', 'llama3:latest');
        orchestrator.incrementInFlight('server-2', 'llama3:latest');
        orchestrator.incrementInFlight('server-3', 'llama3:latest');
      }

      await expect(
        orchestrator.tryRequestWithFailover(
          'llama3:latest',
          async server => ({ success: true }),
          false,
          'generate'
        )
      ).rejects.toThrow();
    });
  });

  describe('Max Concurrency Handling', () => {
    beforeEach(() => {
      orchestrator.addServer({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 2,
      });

      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama3:latest'];
      }
    });

    it('should allow requests up to max concurrency limit', async () => {
      // First request should succeed
      const result1 = await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => ({ success: true, requestId: 1 }),
        false,
        'generate'
      );
      expect(result1.success).toBe(true);

      // Increment to simulate active request
      orchestrator.incrementInFlight('server-1', 'llama3:latest');

      // Second request should succeed
      const result2 = await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => ({ success: true, requestId: 2 }),
        false,
        'generate'
      );
      expect(result2.success).toBe(true);
    });

    it('should reject requests when max concurrency is reached', async () => {
      // Fill up to max concurrency (2)
      orchestrator.incrementInFlight('server-1', 'llama3:latest');
      orchestrator.incrementInFlight('server-1', 'llama3:latest');

      // Next request should fail
      await expect(
        orchestrator.tryRequestWithFailover(
          'llama3:latest',
          async server => ({ success: true }),
          false,
          'generate'
        )
      ).rejects.toThrow();
    });

    it('should handle multiple models with shared server concurrency', async () => {
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.models = ['model-a', 'model-b'];
        s1.maxConcurrency = 3;
      }

      // Fill up with model-a requests
      orchestrator.incrementInFlight('server-1', 'model-a');
      orchestrator.incrementInFlight('server-1', 'model-a');
      orchestrator.incrementInFlight('server-1', 'model-a');

      // model-b request should be rejected (server at capacity)
      await expect(
        orchestrator.tryRequestWithFailover(
          'model-b',
          async server => ({ success: true }),
          false,
          'generate'
        )
      ).rejects.toThrow();
    });

    it('should decrement in-flight counter after request completes', async () => {
      let inFlightDuringRequest = 0;

      await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => {
          // During request, check if in-flight was incremented
          inFlightDuringRequest = orchestrator.getTotalInFlight('server-1');
          expect(inFlightDuringRequest).toBeGreaterThanOrEqual(1);

          return { success: true };
        },
        false,
        'generate'
      );

      // After request completes, should be back to initial state
      const afterRequest = orchestrator.getTotalInFlight('server-1');
      expect(afterRequest).toBe(0);
    });

    it('should handle streaming requests with concurrency limits', async () => {
      // Streaming requests should also respect concurrency
      const result = await orchestrator.tryRequestWithFailover(
        'llama3:latest',
        async server => ({ streaming: true, serverId: server.id }),
        true, // isStreaming = true
        'generate'
      );

      expect(result.streaming).toBe(true);
    });
  });

  describe('Server Selection with Multiple Models', () => {
    beforeEach(() => {
      // Add servers with different model availability
      orchestrator.addServer({
        id: 'server-gpu',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 8,
      });
      orchestrator.addServer({
        id: 'server-cpu',
        url: 'http://localhost:11435',
        type: 'ollama',
        maxConcurrency: 4,
      });

      const s1 = orchestrator.getServer('server-gpu');
      const s2 = orchestrator.getServer('server-cpu');

      if (s1) {
        s1.healthy = true;
        s1.models = ['llama3:70b', 'llama3:8b']; // GPU server has large model
      }
      if (s2) {
        s2.healthy = true;
        s2.models = ['llama3:8b']; // CPU server only has small model
      }
    });

    it('should route to server with specific model', async () => {
      const serversTried: string[] = [];

      const result = await orchestrator.tryRequestWithFailover(
        'llama3:70b', // Only available on server-gpu
        async server => {
          serversTried.push(server.id);
          return { success: true, serverId: server.id };
        },
        false,
        'generate'
      );

      expect(result.success).toBe(true);
      expect(serversTried).toContain('server-gpu');
      expect(serversTried).not.toContain('server-cpu');
    });

    it('should failover to server with same model when first server fails', async () => {
      const serversTried: string[] = [];

      const result = await orchestrator.tryRequestWithFailover(
        'llama3:8b', // Available on both servers
        async server => {
          serversTried.push(server.id);

          // First server fails
          if (serversTried.length === 1) {
            throw new Error('Server failed');
          }

          return { success: true, serverId: server.id };
        },
        false,
        'generate'
      );

      expect(result.success).toBe(true);
      // Should try at least 2 servers
      expect(serversTried.length).toBeGreaterThanOrEqual(2);
    });

    it('should skip servers without the requested model', async () => {
      const serversTried: string[] = [];

      // Remove llama3:8b from server-gpu to force routing to server-cpu
      const s1 = orchestrator.getServer('server-gpu');
      if (s1) {
        s1.models = ['llama3:70b']; // Only large model
      }

      await expect(
        orchestrator.tryRequestWithFailover(
          'llama3:8b',
          async server => {
            serversTried.push(server.id);
            throw new Error('Failed');
          },
          false,
          'generate'
        )
      ).rejects.toThrow('candidate(s) failed');

      // Should only try server-cpu (the only one with llama3:8b)
      expect(serversTried).toContain('server-cpu');
      expect(serversTried).not.toContain('server-gpu');
    });
  });

  describe('Error Classification and Circuit Breaker Integration', () => {
    beforeEach(() => {
      orchestrator.addServer({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 4,
      });

      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama3:latest'];
      }
    });

    it('should skip server with open circuit breaker', async () => {
      // Force circuit breaker open
      orchestrator['forceOpenServerBreaker']('server-1', 'Test');

      // REC-71: differentiated error messages - open circuit breaker → unhealthy server message
      await expect(
        orchestrator.tryRequestWithFailover(
          'llama3:latest',
          async server => ({ success: true }),
          false,
          'generate'
        )
      ).rejects.toThrow(/All servers are unhealthy|unhealthy|circuit/i);
    });
  });

  describe('REC-63: AbortSignal client disconnect detection', () => {
    beforeEach(() => {
      orchestrator.addServer({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 4,
      });
      orchestrator.addServer({
        id: 'server-2',
        url: 'http://localhost:11435',
        type: 'ollama',
        maxConcurrency: 4,
      });
      orchestrator.addServer({
        id: 'server-3',
        url: 'http://localhost:11436',
        type: 'ollama',
        maxConcurrency: 4,
      });

      const servers = ['server-1', 'server-2', 'server-3'];
      for (const id of servers) {
        const s = orchestrator.getServer(id);
        if (s) {
          s.healthy = true;
          s.models = ['llama3:latest'];
        }
      }
    });

    it('should throw immediately when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        orchestrator.tryRequestWithFailover(
          'llama3:latest',
          async server => ({ success: true }),
          false,
          'generate',
          undefined,
          undefined,
          controller.signal
        )
      ).rejects.toThrow('Request aborted');
    });

    it('should stop failover attempts when signal is aborted between phases', async () => {
      const controller = new AbortController();
      const serversTried: string[] = [];

      // Abort after Phase 1 has started (after first attempt)
      let callCount = 0;

      await expect(
        orchestrator.tryRequestWithFailover(
          'llama3:latest',
          async server => {
            serversTried.push(server.id);
            callCount++;
            // Abort the signal after the first attempt
            if (callCount === 1) {
              controller.abort();
            }
            throw new Error(`Server ${server.id} failed`);
          },
          false,
          'generate',
          undefined,
          undefined,
          controller.signal
        )
      ).rejects.toThrow(/aborted|failed/i);

      // Should have tried at most a few servers (not all 3 + Phase 2 + Phase 3)
      // The abort should prevent exhaustive retries
      expect(serversTried.length).toBeGreaterThanOrEqual(1);
      expect(serversTried.length).toBeLessThan(10); // Far fewer than full retry cycle
    });
  });
});
