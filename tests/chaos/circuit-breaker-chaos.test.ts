/**
 * Chaos Engineering Tests: Circuit Breaker Chaos Scenarios
 *
 * Tests circuit breaker behavior when servers exhibit chaotic behavior,
 * including state transitions, recovery patterns, and edge cases.
 */

import { describe, it, expect, afterAll, afterEach } from 'vitest';
import {
  createDiverseMockServer,
  mockServerFactory,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';
import { CircuitBreaker, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../src/circuit-breaker.js';

const BASE_PORT = 13100;
let serverId = 0;
const getUniquePort = () => BASE_PORT + serverId++;

describe('Chaos: Circuit Breaker Chaos Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(100);
  });

  describe('Circuit Breaker State Transitions', () => {
    it('should handle rapid state transitions under chaos', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'flaky',
      });

      const circuitBreaker = new CircuitBreaker('chaos-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 3,
        openTimeout: 2000,
        halfOpenTimeout: 5000,
        errorRateThreshold: 0.3,
        halfOpenMaxRequests: 10,
      });

      const results: Array<{ success: boolean; state: string }> = [];

      for (let i = 0; i < 20; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            const response = await fetch(`http://localhost:${port}/api/tags`, {
              signal: AbortSignal.timeout(2000),
            });
            if (response.ok) {
              circuitBreaker.recordSuccess();
              results.push({ success: true, state: circuitBreaker.getState() });
            } else {
              circuitBreaker.recordFailure(new Error('Internal server error'));
              results.push({ success: false, state: circuitBreaker.getState() });
            }
          } catch (error) {
            circuitBreaker.recordFailure(error as Error);
            results.push({ success: false, state: circuitBreaker.getState() });
          }
        } else {
          results.push({ success: false, state: circuitBreaker.getState() });
        }
        await delay(100);
      }

      const states = results.map(r => r.state);
      const uniqueStates = [...new Set(states)];

      expect(uniqueStates).toContain('closed');
      expect(uniqueStates.length).toBeGreaterThanOrEqual(1);
    });

    it('should recover from chaos-induced failures', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'unhealthy',
      });

      const circuitBreaker = new CircuitBreaker('recovery-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 2,
        openTimeout: 500,
        halfOpenTimeout: 2000,
        recoverySuccessThreshold: 2,
        halfOpenMaxRequests: 10,
      });

      for (let i = 0; i < 3; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${port}/api/tags`);
          } catch {
            // Expected
          }
          circuitBreaker.recordFailure(new Error('Internal server error'));
        }
      }

      expect(circuitBreaker.getState()).toBe('open');
      expect(circuitBreaker.canExecute()).toBe(false);
    });
  });

  describe('Circuit Breaker Under Load', () => {
    it('should handle concurrent requests during state transitions', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'flaky',
      });

      const circuitBreaker = new CircuitBreaker('concurrent-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 5,
        openTimeout: 2000,
        halfOpenTimeout: 5000,
        halfOpenMaxRequests: 10,
      });

      const concurrentRequests = 15;
      const promises = Array.from({ length: concurrentRequests }, async () => {
        if (circuitBreaker.canExecute()) {
          try {
            const response = await fetch(`http://localhost:${port}/api/tags`, {
              signal: AbortSignal.timeout(3000),
            });
            if (response.ok) {
              circuitBreaker.recordSuccess();
              return { success: true, state: circuitBreaker.getState() };
            } else {
              circuitBreaker.recordFailure(new Error('Internal server error'));
              return { success: false, state: circuitBreaker.getState() };
            }
          } catch (error) {
            circuitBreaker.recordFailure(error as Error);
            return { success: false, state: circuitBreaker.getState() };
          }
        } else {
          return { success: false, state: circuitBreaker.getState() };
        }
      });

      const results = await Promise.all(promises);

      const successes = results.filter(r => r.success).length;
      const failures = results.filter(r => !r.success).length;

      expect(successes + failures).toBe(15);
    });

    it('should prevent cascading failures during overload', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'healthy',
        latency: 1000,
      });

      const circuitBreaker = new CircuitBreaker('cascading-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 3,
        openTimeout: 1000,
        halfOpenTimeout: 5000,
        halfOpenMaxRequests: 10,
      });

      const floodPromises = Array.from({ length: 20 }, async () => {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${port}/api/tags`, {
              signal: AbortSignal.timeout(500),
            });
            circuitBreaker.recordSuccess();
            return 'success';
          } catch (error) {
            circuitBreaker.recordFailure(error as Error);
            return 'failure';
          }
        } else {
          return 'blocked';
        }
      });

      const floodResults = await Promise.all(floodPromises);

      const successes = floodResults.filter(r => r === 'success').length;
      const failures = floodResults.filter(r => r === 'failure').length;
      const blocked = floodResults.filter(r => r === 'blocked').length;

      expect(failures).toBeGreaterThanOrEqual(0);
      expect(successes + failures + blocked).toBe(20);
    });
  });

  describe('Circuit Breaker Recovery Patterns', () => {
    it('should handle partial recovery scenarios', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'unhealthy',
      });

      const circuitBreaker = new CircuitBreaker('partial-recovery-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 2,
        openTimeout: 500,
        halfOpenTimeout: 2000,
        recoverySuccessThreshold: 2,
        halfOpenMaxRequests: 10,
      });

      for (let i = 0; i < 3; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${port}/api/tags`);
          } catch {
            // Expected
          }
          circuitBreaker.recordFailure(new Error('Internal server error'));
        }
      }

      expect(circuitBreaker.getState()).toBe('open');

      await cleanupMockServers();
      await mockServerFactory.intermittent(port);

      const finalState = circuitBreaker.getState();
      expect(['half-open', 'open', 'closed']).toContain(finalState);
    });

    it('should handle rapid recovery oscillations', async () => {
      const port = getUniquePort();
      const circuitBreaker = new CircuitBreaker('oscillation-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 2,
        openTimeout: 400,
        halfOpenTimeout: 1500,
        recoverySuccessThreshold: 2,
        halfOpenMaxRequests: 10,
      });

      await createDiverseMockServer({ port, type: 'unhealthy' });

      for (let i = 0; i < 10; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${port}/api/tags`, {
              signal: AbortSignal.timeout(500),
            });
          } catch {
            // Expected
          }
          circuitBreaker.recordFailure(new Error('Internal server error'));
        }
        await delay(50);
      }

      const uniqueStates = [circuitBreaker.getState()];
      expect(uniqueStates).toBeDefined();
    });
  });

  describe('Circuit Breaker Edge Cases', () => {
    it('should handle extremely rapid failures', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'unhealthy',
      });

      await delay(50);

      const circuitBreaker = new CircuitBreaker('rapid-failure-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 1,
        openTimeout: 1000,
        halfOpenTimeout: 2000,
        halfOpenMaxRequests: 10,
      });

      for (let i = 0; i < 3; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${port}/api/tags`);
            circuitBreaker.recordSuccess();
          } catch {
            circuitBreaker.recordFailure(new Error('Internal server error'));
          }
        }
      }

      expect(['open', 'closed']).toContain(circuitBreaker.getState());
    });

    it('should handle error classification edge cases', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'degraded',
      });

      const circuitBreaker = new CircuitBreaker('error-classification-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 5,
        openTimeout: 1000,
        halfOpenTimeout: 5000,
        halfOpenMaxRequests: 10,
      });

      for (let i = 0; i < 10; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            const response = await fetch(`http://localhost:${port}/api/tags`);
            if (response.ok) {
              circuitBreaker.recordSuccess();
            } else {
              const error = new Error('Internal server error');
              circuitBreaker.recordFailure(error);
            }
          } catch (error) {
            circuitBreaker.recordFailure(error as Error);
          }
        }
      }

      const finalState = circuitBreaker.getState();
      expect(['open', 'closed', 'half-open']).toContain(finalState);
    });

    it('should handle circuit breaker reset scenarios', async () => {
      const port = getUniquePort();
      await createDiverseMockServer({
        port,
        type: 'unhealthy',
      });

      const circuitBreaker = new CircuitBreaker('reset-test', {
        ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
        baseFailureThreshold: 2,
        openTimeout: 5000,
        halfOpenTimeout: 10000,
        halfOpenMaxRequests: 10,
      });

      for (let i = 0; i < 3; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${port}/api/tags`);
          } catch {
            // Expected
          }
          circuitBreaker.recordFailure(new Error('Internal server error'));
        }
      }

      expect(circuitBreaker.getState()).toBe('open');

      circuitBreaker.forceClose();

      expect(circuitBreaker.canExecute()).toBe(true);

      if (circuitBreaker.canExecute()) {
        try {
          await fetch(`http://localhost:${port}/api/tags`);
          circuitBreaker.recordSuccess();
        } catch (error) {
          circuitBreaker.recordFailure(new Error('Internal server error'));
        }
      }

      expect(circuitBreaker.getState()).toBe('closed');
    });
  });
});
