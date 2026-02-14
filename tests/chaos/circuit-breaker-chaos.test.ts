/**
 * Chaos Engineering Tests: Circuit Breaker Chaos Scenarios
 *
 * Tests circuit breaker behavior when servers exhibit chaotic behavior,
 * including state transitions, recovery patterns, and edge cases.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Server } from 'http';
import {
  createDiverseMockServer,
  mockServerFactory,
  createChaosServer,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';
import { CircuitBreaker } from '../../src/circuit-breaker.js';

// Test ports range to avoid conflicts
const BASE_PORT = 11800;
let servers: Server[] = [];

describe('Chaos: Circuit Breaker Chaos Scenarios', () => {
  afterAll(async () => {
    await cleanupMockServers();
  });

  beforeEach(async () => {
    // Clean up servers from previous test
    await cleanupMockServers();
    servers = [];
  });

  describe('Circuit Breaker State Transitions', () => {
    it('should handle rapid state transitions under chaos', async () => {
      // Create a chaos server that randomly switches behaviors
      const server = await createChaosServer(BASE_PORT);
      servers.push(server);

      const circuitBreaker = new CircuitBreaker('chaos-test', {
        baseFailureThreshold: 3,
        openTimeout: 1000,
        halfOpenTimeout: 5000,
        errorRateThreshold: 0.3, // Lower threshold to trigger opening
      });

      // Make requests and observe circuit breaker state changes
      const results: Array<{ success: boolean; state: string; timestamp: number }> = [];

      for (let i = 0; i < 20; i++) {
        if (circuitBreaker.canExecute()) {
          const start = Date.now();
          try {
            const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
              signal: AbortSignal.timeout(2000),
            });
            if (response.ok) {
              circuitBreaker.recordSuccess();
              results.push({
                success: true,
                state: circuitBreaker.getState(),
                timestamp: start,
              });
            } else {
              circuitBreaker.recordFailure(`HTTP ${response.status}`);
              results.push({
                success: false,
                state: circuitBreaker.getState(),
                timestamp: start,
              });
            }
          } catch (error) {
            circuitBreaker.recordFailure(error);
            results.push({
              success: false,
              state: circuitBreaker.getState(),
              timestamp: start,
            });
          }
        } else {
          results.push({
            success: false,
            state: circuitBreaker.getState(),
            timestamp: Date.now(),
          });
        }

        await delay(300); // Brief pause between requests
      }

      // Should have experienced various states due to chaos
      const states = results.map(r => r.state);
      const uniqueStates = [...new Set(states)];

      // Should have seen at least closed and open states
      expect(uniqueStates.length).toBeGreaterThanOrEqual(2);
      expect(uniqueStates).toContain('closed');
      expect(uniqueStates).toContain('open');
    });

    it('should recover from chaos-induced failures', async () => {
      // Start with a failing server
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'unhealthy',
      });
      servers.push(server);

      const circuitBreaker = new CircuitBreaker('recovery-test', {
        baseFailureThreshold: 2,
        openTimeout: 1500,
        halfOpenTimeout: 5000,
        recoverySuccessThreshold: 3,
        errorRateThreshold: 0.3,
      });

      // Circuit should open quickly
      for (let i = 0; i < 3; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${BASE_PORT}/api/tags`);
            circuitBreaker.recordSuccess();
          } catch (error) {
            circuitBreaker.recordFailure(error);
          }
        }
      }

      expect(circuitBreaker.getState()).toBe('open');

      // Replace with healthy server
      await cleanupMockServers();
      const newServer = await mockServerFactory.healthy(BASE_PORT);
      servers.push(newServer);

      // Wait for recovery timeout
      await delay(1600);

      // Circuit should attempt recovery (half-open)
      expect(circuitBreaker.getState()).toBe('half-open');

      // Make recovery requests
      let successCount = 0;
      for (let i = 0; i < 3; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
            if (response.ok) {
              circuitBreaker.recordSuccess();
              successCount++;
            } else {
              circuitBreaker.recordFailure(`HTTP ${response.status}`);
            }
          } catch (error) {
            circuitBreaker.recordFailure(error);
          }
        }
      }

      expect(successCount).toBeGreaterThan(0);
      // Circuit should close after successful recovery
      expect(circuitBreaker.getState()).toBe('closed');
    });
  });

  describe('Circuit Breaker Under Load', () => {
    it('should handle concurrent requests during state transitions', async () => {
      const server = await createChaosServer(BASE_PORT);
      servers.push(server);

      const circuitBreaker = new CircuitBreaker('concurrent-test', {
        baseFailureThreshold: 5,
        openTimeout: 2000,
        halfOpenTimeout: 5000,
      });

      // Simulate concurrent requests during chaos
      const concurrentRequests = 15;
      const promises = Array.from({ length: concurrentRequests }, async () => {
        if (circuitBreaker.canExecute()) {
          try {
            const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
              signal: AbortSignal.timeout(3000),
            });
            if (response.ok) {
              circuitBreaker.recordSuccess();
              return { success: true, state: circuitBreaker.getState() };
            } else {
              circuitBreaker.recordFailure(`HTTP ${response.status}`);
              return { success: false, state: circuitBreaker.getState() };
            }
          } catch (error) {
            circuitBreaker.recordFailure(error);
            return { success: false, state: circuitBreaker.getState() };
          }
        } else {
          return { success: false, state: circuitBreaker.getState() };
        }
      });

      const results = await Promise.all(promises);

      const successes = results.filter(r => r.success).length;
      const failures = results.filter(r => !r.success).length;

      // Should have mix of successes and failures due to circuit breaker
      expect(successes).toBeGreaterThan(0);
      expect(failures).toBeGreaterThan(0);

      // Check state distribution
      const states = results.map(r => r.state);
      const stateCounts = states.reduce(
        (acc, state) => {
          acc[state] = (acc[state] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      // Should see multiple states
      expect(Object.keys(stateCounts).length).toBeGreaterThan(1);
    });

    it('should prevent cascading failures during overload', async () => {
      // Create a slow server that causes timeouts
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'healthy',
        latency: 1000, // 1 second latency
      });
      servers.push(server);

      const circuitBreaker = new CircuitBreaker('cascading-test', {
        baseFailureThreshold: 3,
        openTimeout: 1000,
        halfOpenTimeout: 5000,
      });

      // Flood with requests that will timeout
      const floodPromises = Array.from({ length: 20 }, async () => {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
              signal: AbortSignal.timeout(500), // Short timeout
            });
            circuitBreaker.recordSuccess();
            return 'success';
          } catch (error) {
            circuitBreaker.recordFailure(error);
            return 'failure';
          }
        } else {
          return 'blocked';
        }
      });

      const start = Date.now();
      const floodResults = await Promise.all(floodPromises);
      const duration = Date.now() - start;

      const successes = floodResults.filter(r => r === 'success').length;
      const failures = floodResults.filter(r => r === 'failure').length;
      const blocked = floodResults.filter(r => r === 'blocked').length;

      // Most requests should fail due to timeouts
      expect(failures).toBeGreaterThan(successes);

      // Some requests should be blocked by circuit breaker
      expect(blocked).toBeGreaterThan(0);

      // Circuit should open to prevent further cascading
      expect(circuitBreaker.getState()).toBe('open');

      // After circuit opens, subsequent requests should be blocked fast
      const canExecuteAfter = circuitBreaker.canExecute();
      expect(canExecuteAfter).toBe(false);
    });
  });

  describe('Circuit Breaker Recovery Patterns', () => {
    it('should handle partial recovery scenarios', async () => {
      // Start with failing server
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'unhealthy',
      });
      servers.push(server);

      const circuitBreaker = new CircuitBreaker('partial-recovery-test', {
        baseFailureThreshold: 2,
        openTimeout: 1000,
        halfOpenTimeout: 5000,
        recoverySuccessThreshold: 3,
        errorRateThreshold: 0.3,
      });

      // Drive to open state
      for (let i = 0; i < 3; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${BASE_PORT}/api/tags`);
            circuitBreaker.recordSuccess();
          } catch (error) {
            circuitBreaker.recordFailure(error);
          }
        }
      }

      expect(circuitBreaker.getState()).toBe('open');

      // Replace with intermittent server (partial recovery)
      await cleanupMockServers();
      const newServer = await mockServerFactory.intermittent(BASE_PORT);
      servers.push(newServer);

      // Wait for recovery timeout
      await delay(1100);

      // Circuit should attempt recovery
      expect(circuitBreaker.getState()).toBe('half-open');

      // Make several requests during recovery
      const recoveryResults: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
            if (response.ok) {
              circuitBreaker.recordSuccess();
              recoveryResults.push(true);
            } else {
              circuitBreaker.recordFailure(`HTTP ${response.status}`);
              recoveryResults.push(false);
            }
          } catch (error) {
            circuitBreaker.recordFailure(error);
            recoveryResults.push(false);
          }
        }
        await delay(100);
      }

      // Intermittent server should give mixed results
      const recoverySuccesses = recoveryResults.filter(r => r).length;
      const recoveryFailures = recoveryResults.filter(r => !r).length;

      expect(recoverySuccesses).toBeGreaterThan(0);
      expect(recoveryFailures).toBeGreaterThan(0);

      // Circuit might stay half-open or go back to open depending on success threshold
      const finalState = circuitBreaker.getState();
      expect(['half-open', 'open', 'closed']).toContain(finalState);
    });

    it('should handle rapid recovery oscillations', async () => {
      const circuitBreaker = new CircuitBreaker('oscillation-test', {
        baseFailureThreshold: 2,
        openTimeout: 500,
        halfOpenTimeout: 2000,
        recoverySuccessThreshold: 2,
      });

      // Create a server that oscillates between healthy and unhealthy
      let isHealthy = false;

      const oscillatingServer = async () => {
        await cleanupMockServers();
        const server = await (isHealthy
          ? mockServerFactory.healthy(BASE_PORT)
          : createDiverseMockServer({ port: BASE_PORT, type: 'unhealthy' }));
        servers.push(server);
        isHealthy = !isHealthy;
      };

      // Start unhealthy
      await oscillatingServer();

      const stateTransitions: Array<{ state: string; timestamp: number }> = [];

      // Monitor state transitions over time
      for (let i = 0; i < 30; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`, {
              signal: AbortSignal.timeout(1000),
            });
            if (response.ok) {
              circuitBreaker.recordSuccess();
            } else {
              circuitBreaker.recordFailure(`HTTP ${response.status}`);
            }
          } catch (error) {
            circuitBreaker.recordFailure(error);
          }
        }

        stateTransitions.push({
          state: circuitBreaker.getState(),
          timestamp: Date.now(),
        });

        // Switch server health every 5 requests
        if (i > 0 && i % 5 === 0) {
          await oscillatingServer();
        }

        await delay(200);
      }

      // Should have seen multiple state transitions
      const states = stateTransitions.map(t => t.state);
      const uniqueStates = [...new Set(states)];

      expect(uniqueStates.length).toBeGreaterThan(2); // Should see closed, open, half-open
      expect(uniqueStates).toContain('closed');
      expect(uniqueStates).toContain('open');

      // Count transitions
      let transitionCount = 0;
      for (let i = 1; i < states.length; i++) {
        if (states[i] !== states[i - 1]) {
          transitionCount++;
        }
      }

      // Should have multiple transitions due to oscillating conditions
      expect(transitionCount).toBeGreaterThan(3);
    });
  });

  describe('Circuit Breaker Edge Cases', () => {
    it('should handle extremely rapid failures', async () => {
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'unhealthy',
      });
      servers.push(server);

      const circuitBreaker = new CircuitBreaker('rapid-failure-test', {
        baseFailureThreshold: 1, // Open immediately on first failure
        openTimeout: 100,
        halfOpenTimeout: 1000,
      });

      // Make rapid successive failures
      const failurePromises = Array.from({ length: 10 }, async () => {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${BASE_PORT}/api/tags`);
            circuitBreaker.recordSuccess();
            return 'success';
          } catch (error) {
            circuitBreaker.recordFailure(error);
            return 'failure';
          }
        } else {
          return 'blocked';
        }
      });

      const results = await Promise.all(failurePromises);

      const successes = results.filter(r => r === 'success').length;
      const failures = results.filter(r => r === 'failure').length;
      const blocked = results.filter(r => r === 'blocked').length;

      // All should fail or be blocked due to immediate circuit opening
      expect(successes).toBe(0);
      expect(failures + blocked).toBe(10);
      expect(circuitBreaker.getState()).toBe('open');
    });

    it('should handle error classification edge cases', async () => {
      // Create server that returns various error types
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'degraded', // Returns different error types
      });
      servers.push(server);

      const circuitBreaker = new CircuitBreaker('error-classification-test', {
        baseFailureThreshold: 5,
        openTimeout: 1000,
        halfOpenTimeout: 5000,
      });

      // Make requests that will get different types of errors
      const errorTypes: string[] = [];

      for (let i = 0; i < 15; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            const response = await fetch(`http://localhost:${BASE_PORT}/api/tags`);
            if (response.ok) {
              circuitBreaker.recordSuccess();
            } else {
              const error = `HTTP ${response.status}`;
              circuitBreaker.recordFailure(error);
              errorTypes.push(circuitBreaker.classifyError(error));
            }
          } catch (error) {
            circuitBreaker.recordFailure(error);
            errorTypes.push(circuitBreaker.classifyError(error));
          }
        }
      }

      // Should classify various error types
      const uniqueErrorTypes = [...new Set(errorTypes)];
      expect(uniqueErrorTypes.length).toBeGreaterThan(1);

      // Circuit should eventually open
      expect(circuitBreaker.getState()).toBe('open');
    });

    it('should handle circuit breaker reset scenarios', async () => {
      const server = await createDiverseMockServer({
        port: BASE_PORT,
        type: 'unhealthy',
      });
      servers.push(server);

      const circuitBreaker = new CircuitBreaker('reset-test', {
        baseFailureThreshold: 2,
        openTimeout: 5000, // Long recovery time
        halfOpenTimeout: 10000,
        errorRateThreshold: 0.3,
      });

      // Drive to open state
      for (let i = 0; i < 3; i++) {
        if (circuitBreaker.canExecute()) {
          try {
            await fetch(`http://localhost:${BASE_PORT}/api/tags`);
            circuitBreaker.recordSuccess();
          } catch (error) {
            circuitBreaker.recordFailure(error);
          }
        }
      }

      expect(circuitBreaker.getState()).toBe('open');

      // Manually reset circuit breaker (simulate administrative intervention)
      circuitBreaker.forceClose();

      // Next request should attempt execution
      expect(circuitBreaker.canExecute()).toBe(true);

      // Make request - should still fail since server is still unhealthy
      if (circuitBreaker.canExecute()) {
        try {
          await fetch(`http://localhost:${BASE_PORT}/api/tags`);
          circuitBreaker.recordSuccess();
          expect.fail('Should fail since server is still unhealthy');
        } catch (error) {
          circuitBreaker.recordFailure(error);
          // Expected - server is still unhealthy
        }
      }

      // But circuit should remain closed (not immediately reopen)
      expect(circuitBreaker.getState()).toBe('closed');
    });
  });
});
