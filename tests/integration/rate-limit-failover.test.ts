import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';
import { ErrorAggregator } from '../../src/utils/error-aggregator.js';
import { classifyError, ErrorType } from '../../src/utils/error-classifier.js';
import { InFlightManager } from '../../src/utils/in-flight-manager.js';
import { RetryBudget } from '../../src/utils/retry-budget.js';

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
      rateLimitThreshold: 3,
      timeWindowMs: 10000,
      clusterBackoffMs: 30000,
    });
    errorAggregator.startPeriodicCleanup(60000);

    inFlightManager = new InFlightManager();
  });

  afterEach(() => {
    errorAggregator.stopPeriodicCleanup();
    errorAggregator.reset();
    inFlightManager.clear();
  });

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

  describe('ErrorAggregator Cluster-Wide Tracking', () => {
    it('should record rate limit errors for each server', () => {
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-2', 'rateLimited');
      errorAggregator.recordError('server-3', 'rateLimited');

      const status = errorAggregator.getClusterStatus();
      expect(status.rateLimitServerCount).toBe(3);
      expect(status.isRateLimited).toBe(true);
    });

    it('should detect cluster-wide rate limit when threshold reached', () => {
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-2', 'rateLimited');
      errorAggregator.recordError('server-3', 'rateLimited');

      expect(errorAggregator.isClusterRateLimited()).toBe(true);

      const backoff = errorAggregator.getBackoffForCluster();
      expect(backoff).toBe(30000);
    });

    it('should NOT trigger cluster rate limit below threshold', () => {
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-2', 'rateLimited');

      expect(errorAggregator.isClusterRateLimited()).toBe(false);
      expect(errorAggregator.getBackoffForCluster()).toBe(0);
    });

    it('should clear cluster rate limit when servers recover', () => {
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-2', 'rateLimited');
      errorAggregator.recordError('server-3', 'rateLimited');

      expect(errorAggregator.isClusterRateLimited()).toBe(true);

      errorAggregator.reset();

      expect(errorAggregator.isClusterRateLimited()).toBe(false);
    });

    it('should return correct error summary with server counts', () => {
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-1', 'rateLimited');
      errorAggregator.recordError('server-2', 'rateLimited');

      const summary = errorAggregator.getErrorSummary();
      expect(summary.rateLimitServerCount).toBe(2);
      expect(summary.totalRateLimitEvents).toBe(3);
      expect(summary.rateLimitServers['server-1']).toBeDefined();
      expect(summary.rateLimitServers['server-2']).toBeDefined();
      expect(summary.rateLimitServers['server-3']).toBeUndefined();
    });
  });

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

  describe('Full Orchestrator Failover Simulation', () => {
    it('should simulate complete failover flow with all components', async () => {
      const model = 'llama3:latest';
      const servers = [...testServers];

      const serverStates = new Map<string, 'success' | 'rate-limited' | 'error'>();

      const simulateFailover = async () => {
        const errors: Array<{ server: string; error: string; type: ErrorType }> = [];

        for (const server of servers) {
          const maxConcurrency = server.maxConcurrency ?? 4;
          if (!inFlightManager.tryIncrementInFlight(server.id, model, maxConcurrency)) {
            errors.push({
              server: server.id,
              error: `Max concurrency reached for ${server.id}`,
              type: 'transient',
            });
            continue;
          }

          const simulatedResponse = serverStates.get(server.id);

          if (simulatedResponse === 'rate-limited') {
            errorAggregator.recordError(server.id, 'rateLimited');

            errors.push({
              server: server.id,
              error: `HTTP 429: Too Many Requests`,
              type: 'rateLimited',
            });

            inFlightManager.decrementInFlight(server.id, model);
            continue;
          }

          inFlightManager.decrementInFlight(server.id, model);
          return { success: true, server: server.id };
        }

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

      serverStates.set('server-1', 'rate-limited');
      serverStates.set('server-2', 'rate-limited');
      serverStates.set('server-3', 'rate-limited');

      let finalError: Error | null = null;
      try {
        await simulateFailover();
      } catch (e) {
        finalError = e as Error;
      }

      expect(finalError).not.toBeNull();
      expect(finalError!.message).toContain('server-1');
      expect(finalError!.message).toContain('server-2');
      expect(finalError!.message).toContain('server-3');

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
          const maxConcurrency = server.maxConcurrency ?? 4;
          if (!inFlightManager.tryIncrementInFlight(server.id, model, maxConcurrency)) {
            continue;
          }

          const simulatedResponse = serverStates.get(server.id);

          if (simulatedResponse === 'rate-limited') {
            errorAggregator.recordError(server.id, 'rateLimited');
            inFlightManager.decrementInFlight(server.id, model);
            continue;
          }

          inFlightManager.decrementInFlight(server.id, model);
          return { success: true, server: server.id };
        }

        throw new Error('All servers failed');
      };

      serverStates.set('server-1', 'rate-limited');
      serverStates.set('server-2', 'success');
      serverStates.set('server-3', 'success');

      const result = await simulateFailover();

      expect(result.success).toBe(true);
      expect(result.server).toBe('server-2');

      const clusterStatus = errorAggregator.getClusterStatus();
      expect(clusterStatus.rateLimitServerCount).toBe(1);
      expect(clusterStatus.isRateLimited).toBe(false);
    });

    it('should fail with clear error when all servers exhausted', async () => {
      const model = 'llama3:latest';
      const servers = [...testServers];

      const allErrors: Array<{ server: string; error: string; type: ErrorType }> = [];
      const serverStates = new Map<string, 'success' | 'rate-limited' | 'error'>();

      serverStates.set('server-1', 'rate-limited');
      serverStates.set('server-2', 'rate-limited');
      serverStates.set('server-3', 'rate-limited');

      const simulateFailover = async () => {
        for (const server of servers) {
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

      expect(finalError).not.toBeNull();
      expect(finalError!.message).toContain('Rate limited: server-1, server-2, server-3');
      expect(finalError!.message).toContain('exhausting all servers');

      expect(errorAggregator.isClusterRateLimited()).toBe(true);
    });
  });

  describe('Rate Limit Failover with Cluster Detection', () => {
    it('should failover from 2 rate-limited servers to healthy server and trigger cluster detection at threshold=2', async () => {
      const errorAggregatorWithThreshold2 = new ErrorAggregator({
        enabled: true,
        rateLimitThreshold: 2,
        timeWindowMs: 10000,
        clusterBackoffMs: 30000,
      });
      errorAggregatorWithThreshold2.startPeriodicCleanup(60000);

      const model = 'llama3:latest';

      const serverStates = new Map<string, 'success' | 'rate-limited' | 'error'>();
      serverStates.set('server-1', 'rate-limited');
      serverStates.set('server-2', 'rate-limited');
      serverStates.set('server-3', 'success');

      const simulateFailover = async () => {
        for (const server of testServers) {
          const maxConcurrency = server.maxConcurrency ?? 4;
          if (!inFlightManager.tryIncrementInFlight(server.id, model, maxConcurrency)) {
            continue;
          }

          const simulatedResponse = serverStates.get(server.id);

          if (simulatedResponse === 'rate-limited') {
            errorAggregatorWithThreshold2.recordError(server.id, 'rateLimited');
            inFlightManager.decrementInFlight(server.id, model);
            continue;
          }

          inFlightManager.decrementInFlight(server.id, model);
          return { success: true, server: server.id };
        }

        throw new Error('All servers failed');
      };

      const result = await simulateFailover();

      expect(result.success).toBe(true);
      expect(result.server).toBe('server-3');

      expect(errorAggregatorWithThreshold2.isClusterRateLimited()).toBe(true);

      const clusterStatus = errorAggregatorWithThreshold2.getClusterStatus();
      expect(clusterStatus.isRateLimited).toBe(true);
      expect(clusterStatus.rateLimitServerCount).toBe(2);
      expect(clusterStatus.threshold).toBe(2);

      expect(errorAggregatorWithThreshold2.getBackoffForCluster()).toBe(30000);

      errorAggregatorWithThreshold2.stopPeriodicCleanup();
      errorAggregatorWithThreshold2.reset();
    });

    it('should not trigger cluster rate limit at threshold=2 until 2nd server hits rate limit', async () => {
      const errorAggregatorWithThreshold2 = new ErrorAggregator({
        enabled: true,
        rateLimitThreshold: 2,
        timeWindowMs: 10000,
        clusterBackoffMs: 30000,
      });
      errorAggregatorWithThreshold2.startPeriodicCleanup(60000);

      errorAggregatorWithThreshold2.recordError('server-1', 'rateLimited');

      expect(errorAggregatorWithThreshold2.isClusterRateLimited()).toBe(false);

      errorAggregatorWithThreshold2.recordError('server-2', 'rateLimited');

      expect(errorAggregatorWithThreshold2.isClusterRateLimited()).toBe(true);

      const clusterStatus = errorAggregatorWithThreshold2.getClusterStatus();
      expect(clusterStatus.isRateLimited).toBe(true);
      expect(clusterStatus.rateLimitServerCount).toBe(2);

      errorAggregatorWithThreshold2.stopPeriodicCleanup();
      errorAggregatorWithThreshold2.reset();
    });

    it('should clear cluster rate limit when errors expire from time window', async () => {
      const errorAggregatorWithShortWindow = new ErrorAggregator({
        enabled: true,
        rateLimitThreshold: 2,
        timeWindowMs: 100,
        clusterBackoffMs: 30000,
      });
      errorAggregatorWithShortWindow.startPeriodicCleanup(50);

      errorAggregatorWithShortWindow.recordError('server-1', 'rateLimited');
      errorAggregatorWithShortWindow.recordError('server-2', 'rateLimited');

      expect(errorAggregatorWithShortWindow.isClusterRateLimited()).toBe(true);

      errorAggregatorWithShortWindow.reset();

      expect(errorAggregatorWithShortWindow.isClusterRateLimited()).toBe(false);

      const clusterStatus = errorAggregatorWithShortWindow.getClusterStatus();
      expect(clusterStatus.rateLimitServerCount).toBe(0);
      expect(clusterStatus.isRateLimited).toBe(false);

      errorAggregatorWithShortWindow.stopPeriodicCleanup();
    });
  });
});
