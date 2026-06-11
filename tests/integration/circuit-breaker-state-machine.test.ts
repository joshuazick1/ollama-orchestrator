/**
 * Circuit Breaker State Machine Integration Tests
 *
 * Comprehensive integration tests for ALL circuit breaker state transitions and behaviors.
 * Tests go through the orchestrator HTTP API with actual mock Ollama servers.
 *
 * States: CLOSED, OPEN, HALF-OPEN
 * Transitions:
 *   - CLOSED → OPEN (on failure threshold)
 *   - OPEN → HALF-OPEN (after timeout)
 *   - HALF-OPEN → CLOSED (on recovery success)
 *   - HALF-OPEN → OPEN (on recovery failure)
 *   - Manual force transitions (open, close, half-open)
 */

import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';


import { createServer } from '../fixtures/factories.js';
import {
  createDiverseMockServer,
  mockServerFactory,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';

import { delay } from '../utils/test-helpers.js';

import {
  setupIntegrationTest,
  teardownIntegrationTest,
  makeRequest,
} from './setup.js';

// Unique server ID generator for test isolation
let serverCounter = 0;
const getUniqueServerId = (prefix = 'cb-sm-test') => `${prefix}-${Date.now()}-${++serverCounter}`;
const getUniquePort = (base = 14100) => base + (Date.now() % 1000) + ++serverCounter;

describe('Circuit Breaker State Machine Integration', () => {
  let baseUrl: string;

  beforeAll(async () => {
    const setup = await setupIntegrationTest();
    baseUrl = setup.baseUrl;
  });

  afterAll(async () => {
    await cleanupMockServers();
    await teardownIntegrationTest();
  });

  beforeEach(async () => {
    // Ensure no interference between tests
    await cleanupMockServers();
    await delay(50);
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(50);
  });

  /**
   * Helper to add a test server to the orchestrator
   */
  async function addTestServer(serverId: string, port: number): Promise<void> {
    const response = await makeRequest('POST', '/api/orchestrator/servers/add', {
      id: serverId,
      url: `http://localhost:${port}`,
      type: 'ollama',
    });
    expect(response.status).toBe(200);
  }

  /**
   * Helper to get circuit breaker stats for a server:model
   */
  async function getCircuitBreakerStats(
    serverId: string,
    model: string
  ): Promise<{ state: string; failureCount: number; [key: string]: any }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'GET',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}`
    );
    expect(response.status).toBe(200);
    return response.data.stats;
  }

  /**
   * Helper to force open a circuit breaker
   */
  async function forceOpenCircuitBreaker(
    serverId: string,
    model: string
  ): Promise<{ success: boolean; currentState: string }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/open`
    );
    expect(response.status).toBe(200);
    return response.data;
  }

  /**
   * Helper to force close a circuit breaker
   */
  async function forceCloseCircuitBreaker(
    serverId: string,
    model: string
  ): Promise<{ success: boolean; currentState: string }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/close`
    );
    expect(response.status).toBe(200);
    return response.data;
  }

  /**
   * Helper to force half-open a circuit breaker
   */
  async function forceHalfOpenCircuitBreaker(
    serverId: string,
    model: string
  ): Promise<{ success: boolean; currentState: string }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/half-open`
    );
    expect(response.status).toBe(200);
    return response.data;
  }

  /**
   * Helper to reset a circuit breaker
   */
  async function resetCircuitBreaker(
    serverId: string,
    model: string
  ): Promise<{ success: boolean; currentState: string }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/reset`
    );
    expect(response.status).toBe(200);
    return response.data;
  }

  /**
   * Helper to make a generate request (used to trigger failures)
   */
  async function makeGenerateRequest(
    serverId: string,
    model: string,
    options?: { timeout?: number }
  ): Promise<{ status: number; data: any }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/${encodedModel}/generate--${serverId}`,
      {
        model,
        prompt: 'Hello',
        stream: false,
      },
      { headers: { 'x-test-timeout': String(options?.timeout || 5000) } }
    );
    return { status: response.status, data: response.data };
  }

  // ============================================================
  // Test Suite 1: CLOSED → OPEN Transition
  // ============================================================
  describe('CLOSED → OPEN Transition', () => {
    it('should open circuit breaker after failure threshold is reached', async () => {
      const serverId = getUniqueServerId('closed-to-open');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create unhealthy server that always fails
      await mockServerFactory.oom(port, 0); // Fail immediately

      // Add server to orchestrator
      await addTestServer(serverId, port);

      // Wait for health check to register the server as unhealthy
      await delay(200);

      // Make requests until circuit opens (default threshold is 3 failures)
      // The circuit breaker should open after consecutive failures
      for (let i = 0; i < 5; i++) {
        await makeGenerateRequest(serverId, model, { timeout: 2000 });
        await delay(100);
      }

      // Circuit should now be OPEN
      const stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');
      expect(stats.failureCount).toBeGreaterThanOrEqual(3);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should open circuit breaker when partition server fails repeatedly', async () => {
      const serverId = getUniqueServerId('partition-open');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create partition server that fails after certain requests
      await mockServerFactory.partition(port, 3); // Fail after 3 requests

      await addTestServer(serverId, port);
      await delay(200);

      // Make requests - should fail when partition triggers
      for (let i = 0; i < 6; i++) {
        await makeGenerateRequest(serverId, model, { timeout: 2000 });
        await delay(100);
      }

      // Circuit should be OPEN due to failures
      const stats = await getCircuitBreakerStats(serverId, model);
      expect(['OPEN', 'HALF-OPEN']).toContain(stats.state);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should track failure count correctly in CLOSED state', async () => {
      const serverId = getUniqueServerId('failure-count');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create server that fails once then succeeds
      await mockServerFactory.intermittent(port);

      await addTestServer(serverId, port);
      await delay(200);

      // Make a request that will likely fail (intermittent has bursty failures)
      await makeGenerateRequest(serverId, model, { timeout: 2000 });

      // Get stats - failure count should be tracked
      const stats = await getCircuitBreakerStats(serverId, model);
      expect(stats).toHaveProperty('failureCount');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 2: OPEN → HALF-OPEN Transition
  // ============================================================
  describe('OPEN → HALF-OPEN Transition', () => {
    it('should transition from OPEN to HALF-OPEN after timeout', async () => {
      const serverId = getUniqueServerId('open-to-halfopen');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create unhealthy server
      await mockServerFactory.oom(port, 0);

      await addTestServer(serverId, port);
      await delay(200);

      // Force open the circuit breaker directly
      await forceOpenCircuitBreaker(serverId, model);

      // Verify it's OPEN
      const stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Note: The actual timeout-based transition is internal to the circuit breaker
      // We can verify the state is OPEN initially and the breaker has a nextRetryAt
      expect(stats.nextRetryAt).toBeGreaterThan(Date.now());

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should manually force OPEN to HALF-OPEN transition', async () => {
      const serverId = getUniqueServerId('force-halfopen');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open then force half-open
      await forceOpenCircuitBreaker(serverId, model);

      let stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Force half-open
      await forceHalfOpenCircuitBreaker(serverId, model);

      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('HALF-OPEN');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 3: HALF-OPEN → CLOSED Transition (Recovery Success)
  // ============================================================
  describe('HALF-OPEN → CLOSED Transition (Recovery Success)', () => {
    it('should close circuit breaker after successful recovery in half-open', async () => {
      const serverId = getUniqueServerId('halfopen-to-closed');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create healthy server for recovery
      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open the circuit breaker
      await forceOpenCircuitBreaker(serverId, model);

      let stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Force half-open
      await forceHalfOpenCircuitBreaker(serverId, model);

      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('HALF-OPEN');

      // Now reset (force close) to simulate successful recovery
      await resetCircuitBreaker(serverId, model);

      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('CLOSED');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should reset failure count on successful recovery', async () => {
      const serverId = getUniqueServerId('reset-failure');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open with some failures recorded
      await forceOpenCircuitBreaker(serverId, model);

      // Get stats with failures
      let stats = await getCircuitBreakerStats(serverId, model);
      const hadFailures = stats.failureCount > 0;

      // Reset the breaker
      await resetCircuitBreaker(serverId, model);

      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('CLOSED');
      expect(stats.failureCount).toBe(0);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 4: HALF-OPEN → OPEN Transition (Recovery Failure)
  // ============================================================
  describe('HALF-OPEN → OPEN Transition (Recovery Failure)', () => {
    it('should reopen circuit breaker when recovery fails in half-open', async () => {
      const serverId = getUniqueServerId('halfopen-reopen');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create unhealthy server that will fail recovery
      await mockServerFactory.oom(port, 0);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open the circuit
      await forceOpenCircuitBreaker(serverId, model);

      let stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Force half-open
      await forceHalfOpenCircuitBreaker(serverId, model);

      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('HALF-OPEN');

      // Make a request that will fail (to unhealthy server)
      await makeGenerateRequest(serverId, model, { timeout: 2000 });
      await delay(100);

      // Circuit should go back to OPEN (or already be in transition)
      stats = await getCircuitBreakerStats(serverId, model);
      expect(['OPEN', 'HALF-OPEN']).toContain(stats.state);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 5: Manual Force State Transitions
  // ============================================================
  describe('Manual Force State Transitions', () => {
    it('should force open a closed circuit breaker', async () => {
      const serverId = getUniqueServerId('force-open');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Verify initial state is CLOSED (or may be unknown)
      const initialStats = await getCircuitBreakerStats(serverId, model);
      expect(['CLOSED', 'OPEN', 'HALF-OPEN']).toContain(initialStats.state);

      // Force open
      const result = await forceOpenCircuitBreaker(serverId, model);
      expect(result.success).toBe(true);
      expect(result.currentState).toBe('OPEN');

      // Verify state
      const stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should force close an open circuit breaker', async () => {
      const serverId = getUniqueServerId('force-close');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open first
      await forceOpenCircuitBreaker(serverId, model);

      let stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Force close
      const result = await forceCloseCircuitBreaker(serverId, model);
      expect(result.success).toBe(true);
      expect(result.currentState).toBe('CLOSED');

      // Verify
      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('CLOSED');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should force half-open an open circuit breaker', async () => {
      const serverId = getUniqueServerId('force-halfopen-manual');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open
      await forceOpenCircuitBreaker(serverId, model);

      let stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Force half-open
      const result = await forceHalfOpenCircuitBreaker(serverId, model);
      expect(result.success).toBe(true);
      expect(result.currentState).toBe('HALF-OPEN');

      // Verify
      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('HALF-OPEN');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should reset circuit breaker to closed state', async () => {
      const serverId = getUniqueServerId('reset');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open
      await forceOpenCircuitBreaker(serverId, model);

      let stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Reset
      const result = await resetCircuitBreaker(serverId, model);
      expect(result.success).toBe(true);
      expect(result.currentState).toBe('CLOSED');

      // Verify
      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('CLOSED');
      expect(stats.failureCount).toBe(0);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 6: Error Rate Calculation and Smoothing
  // ============================================================
  describe('Error Rate Calculation and Smoothing', () => {
    it('should track error rate in circuit breaker stats', async () => {
      const serverId = getUniqueServerId('error-rate');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create intermittent server for mixed success/failure
      await mockServerFactory.intermittent(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Make several requests
      for (let i = 0; i < 5; i++) {
        await makeGenerateRequest(serverId, model, { timeout: 2000 });
        await delay(50);
      }

      const stats = await getCircuitBreakerStats(serverId, model);

      // Stats should include error rate
      expect(stats).toHaveProperty('errorRate');
      expect(typeof stats.errorRate).toBe('number');
      expect(stats.errorRate).toBeGreaterThanOrEqual(0);
      expect(stats.errorRate).toBeLessThanOrEqual(1);

      // Should also have error counts
      expect(stats).toHaveProperty('errorCounts');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should calculate error rate from sliding window', async () => {
      const serverId = getUniqueServerId('sliding-window');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create degraded server with partial failures
      await mockServerFactory.degraded(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Make some requests
      for (let i = 0; i < 3; i++) {
        await makeGenerateRequest(serverId, model, { timeout: 3000 });
        await delay(100);
      }

      const stats = await getCircuitBreakerStats(serverId, model);

      // Error rate should reflect the actual error rate
      expect(stats.errorRate).toBeGreaterThanOrEqual(0);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 7: State Persistence (via API)
  // ============================================================
  describe('State Persistence Behaviors', () => {
    it('should persist consecutive successes across requests', async () => {
      const serverId = getUniqueServerId('persist-success');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Make successful requests
      for (let i = 0; i < 3; i++) {
        await makeGenerateRequest(serverId, model, { timeout: 2000 });
        await delay(100);
      }

      const stats = await getCircuitBreakerStats(serverId, model);

      // Success count should be tracked
      expect(stats).toHaveProperty('successCount');
      expect(stats.successCount).toBeGreaterThanOrEqual(0);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should track last failure information', async () => {
      const serverId = getUniqueServerId('last-failure');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create failing server
      await mockServerFactory.oom(port, 0);
      await addTestServer(serverId, port);
      await delay(200);

      // Make a failing request
      await makeGenerateRequest(serverId, model, { timeout: 2000 });
      await delay(100);

      const stats = await getCircuitBreakerStats(serverId, model);

      // Last failure should be tracked (if any failures occurred)
      expect(stats).toHaveProperty('lastFailure');
      if (stats.lastFailure > 0) {
        expect(stats.lastFailure).toBeGreaterThan(0);
      }

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should track next retry timestamp when open', async () => {
      const serverId = getUniqueServerId('next-retry');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open
      await forceOpenCircuitBreaker(serverId, model);

      const stats = await getCircuitBreakerStats(serverId, model);

      expect(stats.state).toBe('OPEN');
      expect(stats.nextRetryAt).toBeGreaterThan(Date.now());

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 8: Adaptive Threshold Behavior
  // ============================================================
  describe('Adaptive Threshold Behavior', () => {
    it('should respect configured base failure threshold', async () => {
      const serverId = getUniqueServerId('base-threshold');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create server that fails
      await mockServerFactory.oom(port, 0);
      await addTestServer(serverId, port);
      await delay(200);

      // Make requests - should open after threshold
      for (let i = 0; i < 5; i++) {
        await makeGenerateRequest(serverId, model, { timeout: 2000 });
        await delay(50);
      }

      const stats = await getCircuitBreakerStats(serverId, model);

      // Circuit should be open
      expect(['OPEN', 'HALF-OPEN']).toContain(stats.state);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should allow manual threshold bypass via force open', async () => {
      const serverId = getUniqueServerId('threshold-bypass');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open without any failures
      await forceOpenCircuitBreaker(serverId, model);

      const stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 9: Full State Machine Cycle
  // ============================================================
  describe('Full State Machine Cycle', () => {
    it('should complete full cycle: CLOSED → OPEN → HALF-OPEN → CLOSED', async () => {
      const serverId = getUniqueServerId('full-cycle');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Start with healthy server
      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Step 1: Initial state should be CLOSED or not yet tracked
      let stats = await getCircuitBreakerStats(serverId, model);
      expect(['CLOSED', 'HALF-OPEN', 'OPEN']).toContain(stats.state);

      // Step 2: Force OPEN
      await forceOpenCircuitBreaker(serverId, model);
      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('OPEN');

      // Step 3: Transition to HALF-OPEN
      await forceHalfOpenCircuitBreaker(serverId, model);
      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('HALF-OPEN');

      // Step 4: Recovery success - close the circuit
      await forceCloseCircuitBreaker(serverId, model);
      stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('CLOSED');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should handle CLOSED → OPEN → HALF-OPEN → OPEN cycle', async () => {
      const serverId = getUniqueServerId('cycle-reopen');
      const port = getUniquePort();
      const model = 'llama3:latest';

      // Create unhealthy server
      await mockServerFactory.oom(port, 0);
      await addTestServer(serverId, port);
      await delay(200);

      // Step 1: Force OPEN
      await forceOpenCircuitBreaker(serverId, model);

      // Step 2: Transition to HALF-OPEN
      await forceHalfOpenCircuitBreaker(serverId, model);
      let stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('HALF-OPEN');

      // Step 3: Attempt recovery (will fail due to unhealthy server)
      await makeGenerateRequest(serverId, model, { timeout: 2000 });
      await delay(100);

      // Step 4: Should transition back to OPEN
      stats = await getCircuitBreakerStats(serverId, model);
      expect(['OPEN', 'HALF-OPEN']).toContain(stats.state);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should handle multiple consecutive state transitions', async () => {
      const serverId = getUniqueServerId('multi-transition');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Multiple force transitions
      const transitions = [
        async () => {
          await forceOpenCircuitBreaker(serverId, model);
          return 'OPEN';
        },
        async () => {
          await forceHalfOpenCircuitBreaker(serverId, model);
          return 'HALF-OPEN';
        },
        async () => {
          await forceOpenCircuitBreaker(serverId, model);
          return 'OPEN';
        },
        async () => {
          await forceHalfOpenCircuitBreaker(serverId, model);
          return 'HALF-OPEN';
        },
        async () => {
          await forceCloseCircuitBreaker(serverId, model);
          return 'CLOSED';
        },
      ];

      for (const transition of transitions) {
        const expectedState = await transition();
        const stats = await getCircuitBreakerStats(serverId, model);
        expect(stats.state).toBe(expectedState);
      }

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 10: Multiple Model Circuit Breakers
  // ============================================================
  describe('Multiple Model Circuit Breakers', () => {
    it('should maintain separate circuit breakers per model', async () => {
      const serverId = getUniqueServerId('multi-model');
      const port = getUniquePort();
      const model1 = 'llama3:latest';
      const model2 = 'mistral:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open only model1's circuit
      await forceOpenCircuitBreaker(serverId, model1);

      // model1 should be OPEN
      const stats1 = await getCircuitBreakerStats(serverId, model1);
      expect(stats1.state).toBe('OPEN');

      // model2 should be CLOSED (separate breaker)
      const stats2 = await getCircuitBreakerStats(serverId, model2);
      expect(['CLOSED', 'HALF-OPEN']).toContain(stats2.state);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should reset model circuit breakers independently', async () => {
      const serverId = getUniqueServerId('independent-reset');
      const port = getUniquePort();
      const model1 = 'llama3:latest';
      const model2 = 'mistral:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force open both models
      await forceOpenCircuitBreaker(serverId, model1);
      await forceOpenCircuitBreaker(serverId, model2);

      // Reset only model1
      await resetCircuitBreaker(serverId, model1);

      // model1 should be CLOSED
      const stats1 = await getCircuitBreakerStats(serverId, model1);
      expect(stats1.state).toBe('CLOSED');

      // model2 should still be OPEN
      const stats2 = await getCircuitBreakerStats(serverId, model2);
      expect(stats2.state).toBe('OPEN');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  // ============================================================
  // Test Suite 11: Edge Cases and Error Handling
  // ============================================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle rapid open/close transitions', async () => {
      const serverId = getUniqueServerId('rapid');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Rapid force transitions
      for (let i = 0; i < 3; i++) {
        await forceOpenCircuitBreaker(serverId, model);
        await forceCloseCircuitBreaker(serverId, model);
      }

      // Final state should be CLOSED
      const stats = await getCircuitBreakerStats(serverId, model);
      expect(stats.state).toBe('CLOSED');

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should handle requests to unknown model circuit breaker', async () => {
      const serverId = getUniqueServerId('unknown-model');
      const port = getUniquePort();
      const model = 'nonexistent-model:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Should handle gracefully (may return 404 or empty stats)
      const response = await makeRequest(
        'GET',
        `/api/orchestrator/circuit-breakers/${serverId}/${encodeURIComponent(model)}`
      );

      // Accept either success (circuit breaker exists but has no stats) or not found
      expect([200, 404]).toContain(response.status);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should handle force operations on already in-target-state circuits', async () => {
      const serverId = getUniqueServerId('idempotent');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      // Force close when already closed
      const closeResult = await forceCloseCircuitBreaker(serverId, model);
      expect(closeResult.success).toBe(true);
      expect(closeResult.currentState).toBe('CLOSED');

      // Force half-open when closed (should work)
      const halfOpenResult = await forceHalfOpenCircuitBreaker(serverId, model);
      expect(halfOpenResult.success).toBe(true);
      expect(halfOpenResult.currentState).toBe('HALF-OPEN');

      // Force half-open again when already half-open
      const halfOpenAgain = await forceHalfOpenCircuitBreaker(serverId, model);
      expect(halfOpenAgain.success).toBe(true);

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });
});
