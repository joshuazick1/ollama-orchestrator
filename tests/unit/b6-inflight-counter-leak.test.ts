/**
 * b6-inflight-counter-leak.test.ts
 *
 * Tests for B-6 fix: non-streaming ghost in-flight counter leak.
 *
 * Root cause: tryRequestOnServerNoRetry had four early-exit paths (circuit-breaker
 * half-open timeout, recovery failure, recovery error, circuit-breaker open) that
 * returned {success:false} before the try/catch block without decrementing the
 * counter that Phase 1/2 of tryRequestWithFailover had already incremented via
 * tryIncrementInFlight.
 *
 * The fix adds `if (alreadyIncremented) this.decrementInFlight(server.id, model)`
 * on each early-exit path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AIOrchestrator } from '../../src/orchestrator.js';
import { resetInFlightManager, getInFlightManager } from '../../src/utils/in-flight-manager.js';

describe('B-6: In-flight counter leak on early exits in tryRequestOnServerNoRetry', () => {
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

  /**
   * Helper: set up a server with a model and return it
   */
  function addHealthyServer(id: string, model: string, url?: string) {
    orchestrator.addServer({
      id,
      url: url ?? `http://localhost:${11434 + Math.floor(Math.random() * 1000)}`,
      type: 'ollama',
    });
    const server = orchestrator.getServer(id)!;
    server.healthy = true;
    server.models = [model];
    return server;
  }

  /**
   * Helper: open the server-level circuit breaker for a server
   */
  function openServerCircuitBreaker(serverId: string) {
    const cb = orchestrator['getCircuitBreaker'](serverId);
    for (let i = 0; i < 10; i++) {
      cb.recordFailure(new Error('test failure'));
    }
    expect(cb.getState()).toBe('open');
    return cb;
  }

  /**
   * Helper: open the model-level circuit breaker for a server:model
   */
  function openModelCircuitBreaker(serverId: string, model: string) {
    const cb = orchestrator['getModelCircuitBreaker'](serverId, model);
    for (let i = 0; i < 10; i++) {
      cb.recordFailure(new Error('test failure'));
    }
    expect(cb.getState()).toBe('open');
    return cb;
  }

  describe('tryRequestOnServerNoRetry with alreadyIncremented=true', () => {
    it('should decrement counter when circuit breaker is open (canExecute returns false)', async () => {
      const server = addHealthyServer('server-1', 'llama2');
      openServerCircuitBreaker('server-1');

      // Pre-increment (simulating Phase 1/2 of tryRequestWithFailover)
      orchestrator['incrementInFlight']('server-1', 'llama2');
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(1);

      const errors: any[] = [];
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        server,
        'llama2',
        async () => ({ success: true }),
        false,
        errors,
        undefined,
        true // alreadyIncremented
      );

      expect(result.success).toBe(false);
      // Counter must be back to 0 (B-6 fix)
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
    });

    it('should decrement counter when model circuit breaker is open', async () => {
      const server = addHealthyServer('server-1', 'llama2');
      openModelCircuitBreaker('server-1', 'llama2');

      orchestrator['incrementInFlight']('server-1', 'llama2');
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(1);

      const errors: any[] = [];
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        server,
        'llama2',
        async () => ({ success: true }),
        false,
        errors,
        undefined,
        true // alreadyIncremented
      );

      expect(result.success).toBe(false);
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
    });

    it('should NOT decrement counter when alreadyIncremented=false and circuit breaker is open', async () => {
      const server = addHealthyServer('server-1', 'llama2');
      openServerCircuitBreaker('server-1');

      // Do NOT pre-increment — alreadyIncremented=false
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);

      const errors: any[] = [];
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        server,
        'llama2',
        async () => ({ success: true }),
        false,
        errors,
        undefined,
        false // alreadyIncremented=false (default)
      );

      expect(result.success).toBe(false);
      // Should still be 0, no decrement below 0
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
    });

    it('should decrement counter on request failure in the try/catch (not a regression)', async () => {
      const server = addHealthyServer('server-1', 'llama2');

      orchestrator['incrementInFlight']('server-1', 'llama2');
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(1);

      const errors: any[] = [];
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        server,
        'llama2',
        async () => {
          throw new Error('Request timeout');
        },
        false,
        errors,
        undefined,
        true
      );

      expect(result.success).toBe(false);
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
    });

    it('should decrement counter on successful request (not a regression)', async () => {
      const server = addHealthyServer('server-1', 'llama2');

      orchestrator['incrementInFlight']('server-1', 'llama2');
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(1);

      const errors: any[] = [];
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        server,
        'llama2',
        async () => ({ result: 'ok' }),
        false,
        errors,
        undefined,
        true
      );

      expect(result.success).toBe(true);
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
    });
  });

  describe('tryRequestWithFailover end-to-end in-flight balance', () => {
    it('should have zero in-flight count after all phases fail', async () => {
      addHealthyServer('server-1', 'llama2', 'http://localhost:11434');
      addHealthyServer('server-2', 'llama2', 'http://localhost:11435');

      expect(getInFlightManager().getTotalInFlight('server-1')).toBe(0);
      expect(getInFlightManager().getTotalInFlight('server-2')).toBe(0);

      try {
        await orchestrator.tryRequestWithFailover('llama2', async () => {
          throw new Error('Server unreachable');
        });
      } catch {
        // Expected
      }

      // All counters must be back to 0 after exhausting all phases
      expect(getInFlightManager().getTotalInFlight('server-1')).toBe(0);
      expect(getInFlightManager().getTotalInFlight('server-2')).toBe(0);
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
      expect(getInFlightManager().getInFlight('server-2', 'llama2')).toBe(0);
    });

    it('should have zero in-flight count after successful request on first try', async () => {
      addHealthyServer('server-1', 'llama2', 'http://localhost:11434');

      const result = await orchestrator.tryRequestWithFailover('llama2', async () => ({
        response: 'hello',
      }));

      expect(result).toEqual({ response: 'hello' });
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
    });

    it('should have zero in-flight count after failover to second server succeeds', async () => {
      addHealthyServer('server-1', 'llama2', 'http://localhost:11434');
      addHealthyServer('server-2', 'llama2', 'http://localhost:11435');

      let firstCall = true;
      const result = await orchestrator.tryRequestWithFailover('llama2', async server => {
        if (firstCall && server.id === 'server-1') {
          firstCall = false;
          throw new Error('Server-1 down');
        }
        return { response: 'from server-2' };
      });

      expect(result).toEqual({ response: 'from server-2' });
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
      expect(getInFlightManager().getInFlight('server-2', 'llama2')).toBe(0);
    });

    it('should not accumulate counters across multiple failed failover cycles', async () => {
      addHealthyServer('server-1', 'llama2', 'http://localhost:11434');

      // Run multiple failing requests
      for (let i = 0; i < 5; i++) {
        try {
          await orchestrator.tryRequestWithFailover('llama2', async () => {
            throw new Error(`failure ${i}`);
          });
        } catch {
          // Expected
        }
      }

      // No leaks across multiple cycles
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
      expect(getInFlightManager().getTotalInFlight('server-1')).toBe(0);
    });
  });

  describe('tryRequestOnServerWithRetries in-flight balance', () => {
    it('should have zero in-flight count after all retries fail', async () => {
      const server = addHealthyServer('server-1', 'llama2');

      const errors: any[] = [];
      const result = await orchestrator['tryRequestOnServerWithRetries'](
        server,
        'llama2',
        async () => {
          throw new Error('timeout error');
        },
        false,
        {
          maxRetriesPerServer: 3,
          retryDelayMs: 1,
          backoffMultiplier: 1,
          maxRetryDelayMs: 10,
          retryableStatusCodes: [429, 503],
        },
        errors
      );

      expect(result.success).toBe(false);
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
    });

    it('should have zero in-flight count after retry succeeds', async () => {
      const server = addHealthyServer('server-1', 'llama2');

      let attempts = 0;
      const errors: any[] = [];
      const result = await orchestrator['tryRequestOnServerWithRetries'](
        server,
        'llama2',
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('timeout error');
          }
          return { done: true };
        },
        false,
        {
          maxRetriesPerServer: 3,
          retryDelayMs: 1,
          backoffMultiplier: 1,
          maxRetryDelayMs: 10,
          retryableStatusCodes: [429, 503],
        },
        errors
      );

      expect(result.success).toBe(true);
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
    });
  });

  describe('Multiple concurrent requests counter balance', () => {
    it('should correctly track and release counters for overlapping requests', async () => {
      addHealthyServer('server-1', 'llama2', 'http://localhost:11434');

      // Launch 3 concurrent requests — all succeed
      const promises = Array.from({ length: 3 }, (_, i) =>
        orchestrator.tryRequestWithFailover('llama2', async () => {
          // Simulate varying delays
          await new Promise(r => setTimeout(r, 10 + i * 5));
          return { result: i };
        })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(3);

      // All counters should be 0
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
    });

    it('should correctly track and release counters for mixed success/failure', async () => {
      addHealthyServer('server-1', 'llama2', 'http://localhost:11434');
      addHealthyServer('server-2', 'llama2', 'http://localhost:11435');

      let callCount = 0;
      const promises = Array.from({ length: 5 }, () =>
        orchestrator
          .tryRequestWithFailover('llama2', async () => {
            callCount++;
            // Some succeed, some fail
            if (callCount % 3 === 0) {
              throw new Error('intermittent failure');
            }
            return { ok: true };
          })
          .catch(() => null)
      );

      await Promise.all(promises);

      // All counters should be 0 regardless of mixed results
      expect(getInFlightManager().getInFlight('server-1', 'llama2')).toBe(0);
      expect(getInFlightManager().getInFlight('server-2', 'llama2')).toBe(0);
    });
  });

  describe('InFlightManager decrement floor behavior', () => {
    it('should not go below 0 on decrement', () => {
      const manager = getInFlightManager();
      // Decrement without any prior increment
      manager.decrementInFlight('server-x', 'model-y');
      expect(manager.getInFlight('server-x', 'model-y')).toBe(0);
    });

    it('should not go below 0 on multiple decrements after single increment', () => {
      const manager = getInFlightManager();
      manager.incrementInFlight('server-x', 'model-y');
      manager.decrementInFlight('server-x', 'model-y');
      manager.decrementInFlight('server-x', 'model-y');
      expect(manager.getInFlight('server-x', 'model-y')).toBe(0);
    });

    it('should handle bypass decrement correctly', () => {
      const manager = getInFlightManager();
      manager.incrementInFlight('server-x', 'model-y', true);
      expect(manager.getInFlight('server-x', 'model-y')).toBe(1);
      manager.decrementInFlight('server-x', 'model-y', true);
      expect(manager.getInFlight('server-x', 'model-y')).toBe(0);
    });
  });

  describe('tryIncrementInFlight atomicity', () => {
    it('should reject increment when at max concurrency', () => {
      const manager = getInFlightManager();
      // Fill to max
      manager.incrementInFlight('server-1', 'llama2');
      manager.incrementInFlight('server-1', 'llama2');
      manager.incrementInFlight('server-1', 'llama2');
      manager.incrementInFlight('server-1', 'llama2');

      // Try to add one more (maxConcurrency=4)
      const result = manager.tryIncrementInFlight('server-1', 'llama2', 4);
      expect(result).toBe(false);
      expect(manager.getTotalInFlight('server-1')).toBe(4);
    });

    it('should allow increment when below max concurrency', () => {
      const manager = getInFlightManager();
      manager.incrementInFlight('server-1', 'llama2');

      const result = manager.tryIncrementInFlight('server-1', 'llama2', 4);
      expect(result).toBe(true);
      expect(manager.getTotalInFlight('server-1')).toBe(2);
    });

    it('should count total across models for max concurrency check', () => {
      const manager = getInFlightManager();
      manager.incrementInFlight('server-1', 'model-a');
      manager.incrementInFlight('server-1', 'model-a');
      manager.incrementInFlight('server-1', 'model-b');
      manager.incrementInFlight('server-1', 'model-b');

      // total is 4, so tryIncrement with maxConcurrency=4 should fail
      const result = manager.tryIncrementInFlight('server-1', 'model-c', 4);
      expect(result).toBe(false);
    });
  });
});
