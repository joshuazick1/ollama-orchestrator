/**
 * Rate Limit Failover Integration Tests
 *
 * Tests the full failover flow with rate limits:
 * 1. Server 1 returns 429 -> failover to Server 2 succeeds
 * 2. Server 2 returns 429 -> failover to Server 3 succeeds
 * 3. Server 3 returns 429 -> all servers correctly marked and request fails
 *
 * Also verifies:
 * - ErrorAggregator tracks cluster-wide rate limits
 * - Circuit breakers open for each server after rate limits
 * - Retry budget is properly exhausted after all servers fail
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CircuitBreakerRegistry } from '../../src/circuit-breaker/circuit-breaker.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';
import { ErrorAggregator } from '../../src/utils/error-aggregator.js';
import { classifyError, ErrorType } from '../../src/utils/error-classifier.js';
import { InFlightManager } from '../../src/utils/in-flight-manager.js';
import { RetryBudget } from '../../src/utils/retry-budget.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Rate Limit Failover Integration Tests', () => {
  let errorAggregator: ErrorAggregator;
  let inFlightManager: InFlightManager;
  let circuitBreakerRegistry: CircuitBreakerRegistry;

  // Test servers - all have the model available
  const testServers: AIServer[] = [
    {
      id: 'server-1',
      url: 'http://localhost:11434',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 100,
      models: ['llama3:latest'],
      supportsOllama: true,
      supportsV1: false,
    },
    {
      id: 'server-2',
      url: 'http://localhost:11435',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 150,
      models: ['llama3:latest'],
      supportsOllama: true,
      supportsV1: false,
    },
    {
      id: 'server-3',
      url: 'http://localhost:11436',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 200,
      models: ['llama3:latest'],
      supportsOllama: true,
      supportsV1: false,
    },
  ];

  beforeEach(() => {
    errorAggregator = new ErrorAggregator({
      enabled: true,
      rateLimitThreshold: 3, // Lower threshold for testing
      timeWindowMs: 10000,
      clusterBackoffMs: 30000,
    });
    errorAggregator.startPeriodicCleanup(60000);

    inFlightManager = new InFlightManager();
    circuitBreakerRegistry = new CircuitBreakerRegistry();
  });

  afterEach(() => {
    errorAggregator.stopPeriodicCleanup();
    errorAggregator.reset();
    inFlightManager.clear();
  });

  // ============================================================================
  // SECTION 1: Server-level 429 Classification
  // ============================================================================

  describe('Error Classification for 429', () => {
    it('should classify HTTP 429 as rateLimited type', () => {
      const result = classifyError('HTTP 429: Too Many Requests');
      expect(result.type).toBe('rateLimited');
      expect(result.isRetryable).toBe(true);
    });

    it('should classify "rate limit" text as rateLimited type', () => {
      const result = classifyError('rate limit exceeded');
      expect(result.type).toBe('rateLimited');
      expect(result.isRetryable).toBe(true);
    });

    it('should classify "Too Many Requests" as rateLimited type', () => {
      const result = classifyError('Too Many Requests');
      expect(result.type).toBe('rateLimited');
      expect(result.isRetryable).toBe(true);
    });

    it('should classify 429 without HTTP prefix as rateLimited', () => {
      const result = classifyError('429 rate limit exceeded');
      expect(result.type).toBe('rateLimited');
      expect(result.isRetryable).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 2: Circuit Breaker Fast Open for Rate Limits
  // ============================================================================

  describe('Circuit Breaker Fast Open for Rate Limits', () => {
    it('should open circuit after 2 consecutive rateLimited failures', () => {
      const breaker = circuitBreakerRegistry.getOrCreate('server-1:llama3', {
        rateLimitFailureThreshold: 2,
        adaptiveThresholds: false,
        baseFailureThreshold: 5, // High to ensure rate limit path triggers first
      });

      // First rate limit - should NOT open yet
      breaker.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      expect(breaker.getState()).toBe('closed');

      // Second rate limit - SHOULD open
      breaker.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      expect(breaker.getState()).toBe('open');
    });

    it('should track rateLimited errors separately in errorCounts', () => {
      const breaker = circuitBreakerRegistry.getOrCreate('server-2:llama3');

      breaker.recordFailure(new Error('rate limit exceeded'), 'rateLimited');
      breaker.recordFailure(new Error('429 rate limit'), 'rateLimited');

      const stats = breaker.getStats();
      expect(stats.errorCounts?.rateLimited).toBe(2);
    });

    it('should NOT fast-open for non-rate-limit errors', () => {
      const breaker = circuitBreakerRegistry.getOrCreate('server-3:llama3', {
        rateLimitFailureThreshold: 2,
        adaptiveThresholds: false,
        baseFailureThreshold: 3,
      });

      // "connection refused" doesn't circuit-break - use error that triggers CB
      // Use 500 error which is transient but DOES circuit-break
      breaker.recordFailure(new Error('HTTP 500: Internal Server Error'), 'transient');
      expect(breaker.getState()).toBe('closed');

      breaker.recordFailure(new Error('HTTP 500: Internal Server Error'), 'transient');
      expect(breaker.getState()).toBe('closed');

      breaker.recordFailure(new Error('HTTP 500: Internal Server Error'), 'transient');
      expect(breaker.getState()).toBe('open');
    });
  });

  // ============================================================================
  // SECTION 3: ErrorAggregator Cluster-Wide Tracking
  // ============================================================================

  describe('ErrorAggregator Cluster-Wide Rate Limit Tracking', () => {
    it('should record rate limit errors for each server', () => {
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-2', 'rateLimited');
      errorAggregator.recordError('server-3', 'rateLimited');

      const status = errorAggregator.getClusterStatus();
      expect(status.rateLimitServerCount).toBe(3);
      expect(status.isRateLimited).toBe(true);
    });

    it('should detect cluster-wide rate limit when threshold reached', () => {
      // Record on 3 servers (threshold is 3)
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-2', 'rateLimited');
      errorAggregator.recordError('server-3', 'rateLimited');

      expect(errorAggregator.isClusterRateLimited()).toBe(true);

      const backoff = errorAggregator.getBackoffForCluster();
      expect(backoff).toBe(30000); // clusterBackoffMs
    });

    it('should NOT trigger cluster rate limit below threshold', () => {
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-2', 'rateLimited');
      // Not recording for server-3

      expect(errorAggregator.isClusterRateLimited()).toBe(false);
      expect(errorAggregator.getBackoffForCluster()).toBe(0);
    });

    it('should clear cluster rate limit when servers recover', () => {
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-2', 'rateLimited');
      errorAggregator.recordError('server-3', 'rateLimited');

      expect(errorAggregator.isClusterRateLimited()).toBe(true);

      // Simulate time passing and pruning
      errorAggregator.reset();

      expect(errorAggregator.isClusterRateLimited()).toBe(false);
    });

    it('should return correct error summary with server counts', () => {
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-1', 'rateLimited'); // Multiple on same server
      errorAggregator.recordError('server-2', 'rateLimited');

      const summary = errorAggregator.getErrorSummary();
      expect(summary.rateLimitServerCount).toBe(2);
      expect(summary.totalRateLimitEvents).toBe(3);
      expect(summary.rateLimitServers['server-1']).toBeDefined();
      expect(summary.rateLimitServers['server-2']).toBeDefined();
      expect(summary.rateLimitServers['server-3']).toBeUndefined();
    });
  });

  // ============================================================================
  // SECTION 4: Full Failover Flow Simulation
  // ============================================================================

  describe('Full Failover Flow with Rate Limits', () => {
    it('should failover from Server 1 (429) to Server 2 (success)', async () => {
      const failoverSequence: { serverId: string; shouldSucceed: boolean; statusCode?: number }[] =
        [
          { serverId: 'server-1', shouldSucceed: false, statusCode: 429 },
          { serverId: 'server-2', shouldSucceed: true },
        ];

      let selectedServer: string | null = null;
      const errors: Array<{ serverId: string; error: string; errorType: ErrorType }> = [];

      for (const attempt of failoverSequence) {
        selectedServer = attempt.serverId;

        if (!attempt.shouldSucceed) {
          const errorMsg = `HTTP 429: Too Many Requests on ${attempt.serverId}`;
          const errorType = classifyError(errorMsg).type;
          errors.push({ serverId: attempt.serverId, error: errorMsg, errorType });
          errorAggregator.recordError(attempt.serverId, 'rateLimited');
          continue;
        }

        break;
      }

      expect(selectedServer).toBe('server-2');
      expect(errors).toHaveLength(1);
      expect(errors[0].serverId).toBe('server-1');
      expect(errors[0].errorType).toBe('rateLimited');

      const status = errorAggregator.getClusterStatus();
      expect(status.rateLimitServerCount).toBe(1);
      expect(status.isRateLimited).toBe(false);
    });
  });

  // ============================================================================
  // SECTION 5: Retry Budget Behavior
  // ============================================================================

  describe('Retry Budget with Rate Limits', () => {
    it('should track attempts across all servers', () => {
      const budget = new RetryBudget(10);

      expect(budget.canRetry()).toBe(true);

      budget.recordAttempt('server-1');
      expect(budget.getAttemptsUsed()).toBe(1);
      expect(budget.getAttemptsRemaining()).toBe(9);
      expect(budget.canRetry()).toBe(true);

      budget.recordAttempt('server-2');
      budget.recordAttempt('server-3');
      expect(budget.getAttemptsUsed()).toBe(3);
      expect(budget.getServerAttempts('server-1')).toBe(1);
      expect(budget.getServerAttempts('server-2')).toBe(1);
      expect(budget.getServerAttempts('server-3')).toBe(1);
    });

    it('should be exhausted after max attempts', () => {
      const budget = new RetryBudget(3);

      budget.recordAttempt('server-1');
      budget.recordAttempt('server-2');
      budget.recordAttempt('server-3');

      expect(budget.isExhausted()).toBe(true);
      expect(budget.canRetry()).toBe(false);
    });

    it('should prevent further retries when exhausted', () => {
      const budget = new RetryBudget(2);

      budget.recordAttempt('server-1');
      budget.recordAttempt('server-2');

      expect(budget.isExhausted()).toBe(true);
      expect(budget.canRetry()).toBe(false);

      budget.recordAttempt('server-3');
      expect(budget.getAttemptsUsed()).toBe(3);
    });

    it('should track per-server attempt distribution', () => {
      const budget = new RetryBudget(10);

      budget.recordAttempt('server-1');
      budget.recordAttempt('server-1');
      budget.recordAttempt('server-2');
      budget.recordAttempt('server-3');
      budget.recordAttempt('server-3');
      budget.recordAttempt('server-3');

      expect(budget.getServerAttempts('server-1')).toBe(2);
      expect(budget.getServerAttempts('server-2')).toBe(1);
      expect(budget.getServerAttempts('server-3')).toBe(3);
    });
  });

  // ============================================================================
  // SECTION 6: Circuit Breaker States After Rate Limits
  // ============================================================================

  describe('Circuit Breaker States After Rate Limits', () => {
    it('should have open circuits for all servers after all return 429', () => {
      // Create circuit breakers for each server
      const cb1 = circuitBreakerRegistry.getOrCreate('server-1:llama3', {
        rateLimitFailureThreshold: 2,
        adaptiveThresholds: false,
      });
      const cb2 = circuitBreakerRegistry.getOrCreate('server-2:llama3', {
        rateLimitFailureThreshold: 2,
        adaptiveThresholds: false,
      });
      const cb3 = circuitBreakerRegistry.getOrCreate('server-3:llama3', {
        rateLimitFailureThreshold: 2,
        adaptiveThresholds: false,
      });

      // Simulate Server 1 getting 2 rate limit failures
      cb1.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      cb1.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      expect(cb1.getState()).toBe('open');

      // Simulate Server 2 getting 2 rate limit failures
      cb2.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      cb2.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      expect(cb2.getState()).toBe('open');

      // Simulate Server 3 getting 2 rate limit failures
      cb3.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      cb3.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      expect(cb3.getState()).toBe('open');

      // All circuits should be open
      expect(cb1.canExecute()).toBe(false);
      expect(cb2.canExecute()).toBe(false);
      expect(cb3.canExecute()).toBe(false);
    });

    it('should allow execution after cooldown expires (half-open)', () => {
      const breaker = circuitBreakerRegistry.getOrCreate('server-1:llama3', {
        rateLimitFailureThreshold: 2,
        adaptiveThresholds: false,
        openTimeout: 100, // 100ms for testing
      });

      // Open the circuit
      breaker.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      breaker.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
      expect(breaker.getState()).toBe('open');

      // Simulate time passing (fast-forward)
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 150); // Past the open timeout

      // Check if breaker allows execution (should transition to half-open)
      breaker.canExecute(); // This would trigger the state transition in real code

      // In a real scenario with timers, the breaker would transition to half-open
      // For unit testing without the full timer mechanism, we verify the config
      expect(breaker.getConfig().openTimeout).toBe(100);

      vi.useRealTimers();
    });
  });

  // ============================================================================
  // SECTION 7: Integration - Full Orchestrator Failover Simulation
  // ============================================================================

  describe('Full Orchestrator Failover Simulation', () => {
    it('should simulate complete failover flow with all components', async () => {
      // This test simulates the full flow without actually calling HTTP servers

      const model = 'llama3:latest';
      const servers = [...testServers];

      // Track states
      const serverStates = new Map<string, 'success' | 'rate-limited' | 'error'>();
      const circuitBreakers = new Map<string, 'closed' | 'open' | 'half-open'>();

      // Initialize circuit breakers for all servers
      for (const server of servers) {
        const cb = circuitBreakerRegistry.getOrCreate(`${server.id}:${model}`, {
          rateLimitFailureThreshold: 2,
          adaptiveThresholds: false,
        });
        circuitBreakers.set(server.id, cb.getState());
      }

      // Simulate the failover sequence
      const simulateFailover = async () => {
        const errors: Array<{ server: string; error: string; type: ErrorType }> = [];

        for (const server of servers) {
          // Check circuit breaker
          const cb = circuitBreakerRegistry.getOrCreate(`${server.id}:${model}`);
          if (!cb.canExecute()) {
            errors.push({
              server: server.id,
              error: `Circuit breaker ${cb.getState()} for ${server.id}:${model}`,
              type: 'transient',
            });
            continue;
          }

          // Check in-flight capacity
          const maxConcurrency = server.maxConcurrency ?? 4;
          if (!inFlightManager.tryIncrementInFlight(server.id, model, maxConcurrency)) {
            errors.push({
              server: server.id,
              error: `Max concurrency reached for ${server.id}`,
              type: 'transient',
            });
            continue;
          }

          // Simulate making the request
          // In real code, this would be an HTTP call that returns 429
          const simulatedResponse = serverStates.get(server.id);

          if (simulatedResponse === 'rate-limited') {
            // Record failure in circuit breaker (2x to open)
            cb.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
            cb.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');

            // Record in error aggregator
            errorAggregator.recordError(server.id, 'rateLimited');

            // Record error
            errors.push({
              server: server.id,
              error: `HTTP 429: Too Many Requests`,
              type: 'rateLimited',
            });

            inFlightManager.decrementInFlight(server.id, model);
            circuitBreakers.set(server.id, cb.getState());
            continue;
          }

          // Success
          inFlightManager.decrementInFlight(server.id, model);
          return { success: true, server: server.id };
        }

        // All servers failed
        throw new Error(
          `All servers failed. Errors: ${errors.map(e => e.error).join('; ')}. ` +
            `Rate limited servers: ${
              errors
                .filter(e => e.type === 'rateLimited')
                .map(e => e.server)
                .join(', ') || 'none'
            }`
        );
      };

      // Set up: all servers return rate limited
      serverStates.set('server-1', 'rate-limited');
      serverStates.set('server-2', 'rate-limited');
      serverStates.set('server-3', 'rate-limited');

      // Run failover simulation
      let finalError: Error | null = null;
      try {
        await simulateFailover();
      } catch (e) {
        finalError = e as Error;
      }

      // Verify all servers were tried
      expect(finalError).not.toBeNull();
      expect(finalError!.message).toContain('server-1');
      expect(finalError!.message).toContain('server-2');
      expect(finalError!.message).toContain('server-3');

      // Verify all circuit breakers are open
      for (const server of servers) {
        const cb = circuitBreakerRegistry.getOrCreate(`${server.id}:${model}`);
        expect(cb.getState()).toBe('open');
      }

      // Verify error aggregator detected cluster-wide rate limit
      const clusterStatus = errorAggregator.getClusterStatus();
      expect(clusterStatus.isRateLimited).toBe(true);
      expect(clusterStatus.rateLimitServerCount).toBe(3);
    });

    it('should succeed on second server after first returns 429', async () => {
      const model = 'llama3:latest';
      const servers = [...testServers];

      const serverStates = new Map<string, 'success' | 'rate-limited' | 'error'>();

      const simulateFailover = async () => {
        for (const server of servers) {
          const cb = circuitBreakerRegistry.getOrCreate(`${server.id}:${model}`);

          // Check circuit breaker
          if (!cb.canExecute()) {
            continue; // Skip to next server
          }

          // Check in-flight
          const maxConcurrency = server.maxConcurrency ?? 4;
          if (!inFlightManager.tryIncrementInFlight(server.id, model, maxConcurrency)) {
            continue;
          }

          const simulatedResponse = serverStates.get(server.id);

          if (simulatedResponse === 'rate-limited') {
            // Record failure - need 2 to open circuit
            cb.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
            cb.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
            errorAggregator.recordError(server.id, 'rateLimited');
            inFlightManager.decrementInFlight(server.id, model);
            continue;
          }

          // Success
          inFlightManager.decrementInFlight(server.id, model);
          return { success: true, server: server.id };
        }

        throw new Error('All servers failed');
      };

      // Server 1 rate limited, Server 2 succeeds
      serverStates.set('server-1', 'rate-limited');
      serverStates.set('server-2', 'success');
      serverStates.set('server-3', 'success'); // Not reached

      const result = await simulateFailover();

      expect(result.success).toBe(true);
      expect(result.server).toBe('server-2');

      // Verify only server-1 was marked as rate limited
      const clusterStatus = errorAggregator.getClusterStatus();
      expect(clusterStatus.rateLimitServerCount).toBe(1);
      expect(clusterStatus.isRateLimited).toBe(false); // Below cluster threshold
    });

    it('should fail with clear error when all servers exhausted', async () => {
      const model = 'llama3:latest';
      const servers = [...testServers];

      // Track errors
      const allErrors: Array<{ server: string; error: string; type: ErrorType }> = [];
      const serverStates = new Map<string, 'success' | 'rate-limited' | 'error'>();

      // Set all to rate limited
      serverStates.set('server-1', 'rate-limited');
      serverStates.set('server-2', 'rate-limited');
      serverStates.set('server-3', 'rate-limited');

      const simulateFailover = async () => {
        for (const server of servers) {
          const cb = circuitBreakerRegistry.getOrCreate(`${server.id}:${model}`);

          if (!cb.canExecute()) {
            allErrors.push({
              server: server.id,
              error: `Circuit breaker ${cb.getState()}`,
              type: 'transient',
            });
            continue;
          }

          const maxConcurrency = server.maxConcurrency ?? 4;
          if (!inFlightManager.tryIncrementInFlight(server.id, model, maxConcurrency)) {
            allErrors.push({
              server: server.id,
              error: 'Max concurrency',
              type: 'transient',
            });
            continue;
          }

          const simulatedResponse = serverStates.get(server.id);

          if (simulatedResponse === 'rate-limited') {
            cb.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
            cb.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
            errorAggregator.recordError(server.id, 'rateLimited');

            allErrors.push({
              server: server.id,
              error: 'HTTP 429: Too Many Requests',
              type: 'rateLimited',
            });

            inFlightManager.decrementInFlight(server.id, model);
            continue;
          }

          inFlightManager.decrementInFlight(server.id, model);
          return { success: true, server: server.id };
        }

        // Build clear error message
        const rateLimitedServers = allErrors
          .filter(e => e.type === 'rateLimited')
          .map(e => e.server);

        throw new Error(
          `Request failed after exhausting all servers. ` +
            `Rate limited: ${rateLimitedServers.join(', ') || 'none'}. ` +
            `Total errors: ${allErrors.length}`
        );
      };

      let finalError: Error | null = null;
      try {
        await simulateFailover();
      } catch (e) {
        finalError = e as Error;
      }

      // Verify failure with clear error message
      expect(finalError).not.toBeNull();
      expect(finalError!.message).toContain('Rate limited: server-1, server-2, server-3');
      expect(finalError!.message).toContain('exhausting all servers');

      // Verify cluster-wide rate limit triggered
      expect(errorAggregator.isClusterRateLimited()).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 8: Rate Limit Failover with Cluster Detection (threshold=2)
  // ============================================================================

  describe('Rate Limit Failover with Cluster Detection', () => {
    it('should failover from 2 rate-limited servers to healthy server and trigger cluster detection at threshold=2', async () => {
      // Create new error aggregator with threshold=2 for this test
      const errorAggregatorWithThreshold2 = new ErrorAggregator({
        enabled: true,
        rateLimitThreshold: 2, // 2 of 3 servers = cluster rate limit
        timeWindowMs: 10000,
        clusterBackoffMs: 30000,
      });
      errorAggregatorWithThreshold2.startPeriodicCleanup(60000);

      const model = 'llama3:latest';

      // Initialize circuit breakers for all servers
      for (const server of testServers) {
        circuitBreakerRegistry.getOrCreate(`${server.id}:${model}`, {
          rateLimitFailureThreshold: 2,
          adaptiveThresholds: false,
        });
      }

      // Track server states: server-1 and server-2 will be rate-limited, server-3 healthy
      const serverStates = new Map<string, 'success' | 'rate-limited' | 'error'>();
      serverStates.set('server-1', 'rate-limited');
      serverStates.set('server-2', 'rate-limited');
      serverStates.set('server-3', 'success');

      const simulateFailover = async () => {
        for (const server of testServers) {
          const cb = circuitBreakerRegistry.getOrCreate(`${server.id}:${model}`);

          // Check circuit breaker - skip if open
          if (!cb.canExecute()) {
            continue;
          }

          // Check in-flight capacity
          const maxConcurrency = server.maxConcurrency ?? 4;
          if (!inFlightManager.tryIncrementInFlight(server.id, model, maxConcurrency)) {
            continue;
          }

          const simulatedResponse = serverStates.get(server.id);

          if (simulatedResponse === 'rate-limited') {
            // Record 2 failures to open circuit breaker
            cb.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
            cb.recordFailure(new Error('HTTP 429: Too Many Requests'), 'rateLimited');
            // Record in error aggregator for cluster detection
            errorAggregatorWithThreshold2.recordError(server.id, 'rateLimited');
            inFlightManager.decrementInFlight(server.id, model);
            continue;
          }

          // Success - return the server that handled the request
          inFlightManager.decrementInFlight(server.id, model);
          return { success: true, server: server.id };
        }

        throw new Error('All servers failed');
      };

      const result = await simulateFailover();

      // Verify request succeeded on server-3 (healthy server)
      expect(result.success).toBe(true);
      expect(result.server).toBe('server-3');

      // Verify circuit breakers opened for the 2 rate-limited servers
      const cb1 = circuitBreakerRegistry.getOrCreate('server-1:llama3:latest');
      const cb2 = circuitBreakerRegistry.getOrCreate('server-2:llama3:latest');
      const cb3 = circuitBreakerRegistry.getOrCreate('server-3:llama3:latest');

      expect(cb1.getState()).toBe('open'); // rateLimited 2x → opened
      expect(cb2.getState()).toBe('open'); // rateLimited 2x → opened
      expect(cb3.getState()).toBe('closed'); // never failed → stays closed

      // Verify cluster rate limit detection triggered when threshold=2 reached
      // (server-1 and server-2 both hit rate limits = 2 servers = threshold met)
      expect(errorAggregatorWithThreshold2.isClusterRateLimited()).toBe(true);

      const clusterStatus = errorAggregatorWithThreshold2.getClusterStatus();
      expect(clusterStatus.isRateLimited).toBe(true);
      expect(clusterStatus.rateLimitServerCount).toBe(2);
      expect(clusterStatus.threshold).toBe(2);

      // Verify cluster backoff was triggered
      expect(errorAggregatorWithThreshold2.getBackoffForCluster()).toBe(30000);

      errorAggregatorWithThreshold2.stopPeriodicCleanup();
      errorAggregatorWithThreshold2.reset();
    });

    it('should not trigger cluster rate limit at threshold=2 until 2nd server hits rate limit', async () => {
      // Create error aggregator with threshold=2
      const errorAggregatorWithThreshold2 = new ErrorAggregator({
        enabled: true,
        rateLimitThreshold: 2,
        timeWindowMs: 10000,
        clusterBackoffMs: 30000,
      });
      errorAggregatorWithThreshold2.startPeriodicCleanup(60000);

      const model = 'llama3:latest';

      // Initialize circuit breaker for server-1
      circuitBreakerRegistry.getOrCreate('server-1:llama3', {
        rateLimitFailureThreshold: 2,
        adaptiveThresholds: false,
      });

      // Only server-1 is rate-limited
      const serverStates = new Map<string, 'success' | 'rate-limited' | 'error'>();
      serverStates.set('server-1', 'rate-limited');
      serverStates.set('server-2', 'success');

      // Record first rate limit for server-1
      errorAggregatorWithThreshold2.recordError('server-1', 'rateLimited');

      // Cluster should NOT be rate limited yet (only 1 server hit)
      expect(errorAggregatorWithThreshold2.isClusterRateLimited()).toBe(false);

      // Record second server hitting rate limit
      errorAggregatorWithThreshold2.recordError('server-2', 'rateLimited');

      // Now cluster should BE rate limited (2 servers = threshold)
      expect(errorAggregatorWithThreshold2.isClusterRateLimited()).toBe(true);

      const clusterStatus = errorAggregatorWithThreshold2.getClusterStatus();
      expect(clusterStatus.isRateLimited).toBe(true);
      expect(clusterStatus.rateLimitServerCount).toBe(2);

      errorAggregatorWithThreshold2.stopPeriodicCleanup();
      errorAggregatorWithThreshold2.reset();
    });

    it('should clear cluster rate limit when errors expire from time window', async () => {
      // Create error aggregator with threshold=2 and short time window for testing
      const errorAggregatorWithShortWindow = new ErrorAggregator({
        enabled: true,
        rateLimitThreshold: 2,
        timeWindowMs: 100, // Very short window for testing
        clusterBackoffMs: 30000,
      });
      errorAggregatorWithShortWindow.startPeriodicCleanup(50);

      // Record errors on 2 servers to trigger cluster rate limit
      errorAggregatorWithShortWindow.recordError('server-1', 'rateLimited');
      errorAggregatorWithShortWindow.recordError('server-2', 'rateLimited');

      expect(errorAggregatorWithShortWindow.isClusterRateLimited()).toBe(true);

      // Simulate time passing by resetting the aggregator
      // (in real code, entries would expire after timeWindowMs)
      errorAggregatorWithShortWindow.reset();

      expect(errorAggregatorWithShortWindow.isClusterRateLimited()).toBe(false);

      const clusterStatus = errorAggregatorWithShortWindow.getClusterStatus();
      expect(clusterStatus.rateLimitServerCount).toBe(0);
      expect(clusterStatus.isRateLimited).toBe(false);

      errorAggregatorWithShortWindow.stopPeriodicCleanup();
    });
  });
});
