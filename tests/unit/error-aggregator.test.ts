import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { ErrorAggregator } from '../../src/utils/error-aggregator.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

describe('ErrorAggregator', () => {
  let aggregator: ErrorAggregator;

  beforeEach(() => {
    aggregator = new ErrorAggregator({
      enabled: true,
      rateLimitThreshold: 5,
      timeWindowMs: 10000,
      clusterBackoffMs: 30000,
    });
  });

  afterEach(() => {
    aggregator.stopPeriodicCleanup();
  });

  describe('recordError', () => {
    it('ignores non-rateLimited error types', () => {
      aggregator.recordError('server-1', 'rateLimited');
      const summary = aggregator.getErrorSummary();
      expect(summary.rateLimitServerCount).toBe(1);
    });

    it('tracks multiple servers independently', () => {
      aggregator.recordError('server-1', 'rateLimited');
      aggregator.recordError('server-2', 'rateLimited');
      aggregator.recordError('server-3', 'rateLimited');
      const summary = aggregator.getErrorSummary();
      expect(summary.rateLimitServerCount).toBe(3);
    });

    it('counts multiple errors from the same server as one server', () => {
      aggregator.recordError('server-1', 'rateLimited');
      aggregator.recordError('server-1', 'rateLimited');
      aggregator.recordError('server-1', 'rateLimited');
      const summary = aggregator.getErrorSummary();
      expect(summary.rateLimitServerCount).toBe(1);
      expect(summary.totalRateLimitEvents).toBe(3);
    });

    it('does nothing when disabled', () => {
      const disabled = new ErrorAggregator({ enabled: false });
      disabled.recordError('server-1', 'rateLimited');
      disabled.recordError('server-2', 'rateLimited');
      disabled.recordError('server-3', 'rateLimited');
      disabled.recordError('server-4', 'rateLimited');
      disabled.recordError('server-5', 'rateLimited');
      expect(disabled.isClusterRateLimited()).toBe(false);
      disabled.stopPeriodicCleanup();
    });
  });

  describe('isClusterRateLimited', () => {
    it('returns false when fewer than threshold servers have errors', () => {
      for (let i = 0; i < 4; i++) {
        aggregator.recordError(`server-${i}`, 'rateLimited');
      }
      expect(aggregator.isClusterRateLimited()).toBe(false);
    });

    it('returns true when threshold servers have errors', () => {
      for (let i = 0; i < 5; i++) {
        aggregator.recordError(`server-${i}`, 'rateLimited');
      }
      expect(aggregator.isClusterRateLimited()).toBe(true);
    });

    it('returns true with more than threshold servers', () => {
      for (let i = 0; i < 8; i++) {
        aggregator.recordError(`server-${i}`, 'rateLimited');
      }
      expect(aggregator.isClusterRateLimited()).toBe(true);
    });

    it('returns false after time window expires', async () => {
      const shortWindow = new ErrorAggregator({
        enabled: true,
        rateLimitThreshold: 3,
        timeWindowMs: 50,
        clusterBackoffMs: 30000,
      });

      for (let i = 0; i < 3; i++) {
        shortWindow.recordError(`server-${i}`, 'rateLimited');
      }
      expect(shortWindow.isClusterRateLimited()).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(shortWindow.isClusterRateLimited()).toBe(false);
      shortWindow.stopPeriodicCleanup();
    });

    it('clears clusterRateLimitTriggeredAt after entries expire and allows re-trigger', async () => {
      const shortWindow = new ErrorAggregator({
        enabled: true,
        rateLimitThreshold: 3,
        timeWindowMs: 50,
        clusterBackoffMs: 30000,
      });

      // Trigger cluster rate limit
      for (let i = 0; i < 3; i++) {
        shortWindow.recordError(`server-${i}`, 'rateLimited');
      }
      expect(shortWindow.isClusterRateLimited()).toBe(true);

      // Wait for entries to expire
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(shortWindow.isClusterRateLimited()).toBe(false);

      // New errors should be able to re-trigger cluster rate limit
      for (let i = 0; i < 3; i++) {
        shortWindow.recordError(`server-new-${i}`, 'rateLimited');
      }
      expect(shortWindow.isClusterRateLimited()).toBe(true);
      shortWindow.stopPeriodicCleanup();
    });
  });

  describe('getBackoffForCluster', () => {
    it('returns 0 when not rate limited', () => {
      expect(aggregator.getBackoffForCluster()).toBe(0);
    });

    it('returns clusterBackoffMs when rate limited', () => {
      for (let i = 0; i < 5; i++) {
        aggregator.recordError(`server-${i}`, 'rateLimited');
      }
      expect(aggregator.getBackoffForCluster()).toBe(30000);
    });
  });

  describe('getClusterStatus', () => {
    it('returns correct status when not rate limited', () => {
      const status = aggregator.getClusterStatus();
      expect(status.isRateLimited).toBe(false);
      expect(status.rateLimitServerCount).toBe(0);
      expect(status.backoffMs).toBe(0);
      expect(status.threshold).toBe(5);
      expect(status.windowMs).toBe(10000);
      expect(status.clusterBackoffMs).toBe(30000);
      expect(status.enabled).toBe(true);
      expect(status.triggeredAt).toBeUndefined();
    });

    it('returns correct status when rate limited', () => {
      for (let i = 0; i < 5; i++) {
        aggregator.recordError(`server-${i}`, 'rateLimited');
      }
      const status = aggregator.getClusterStatus();
      expect(status.isRateLimited).toBe(true);
      expect(status.rateLimitServerCount).toBe(5);
      expect(status.backoffMs).toBe(30000);
      expect(status.triggeredAt).toBeDefined();
    });
  });

  describe('getErrorSummary', () => {
    it('returns empty summary initially', () => {
      const summary = aggregator.getErrorSummary();
      expect(summary.rateLimitServers).toEqual({});
      expect(summary.rateLimitServerCount).toBe(0);
      expect(summary.totalRateLimitEvents).toBe(0);
    });

    it('includes all servers with errors', () => {
      aggregator.recordError('server-1', 'rateLimited');
      aggregator.recordError('server-2', 'rateLimited');
      aggregator.recordError('server-1', 'rateLimited');
      const summary = aggregator.getErrorSummary();
      expect(summary.rateLimitServerCount).toBe(2);
      expect(summary.totalRateLimitEvents).toBe(3);
      expect(summary.rateLimitServers['server-1']).toHaveLength(2);
      expect(summary.rateLimitServers['server-2']).toHaveLength(1);
    });
  });

  describe('reset', () => {
    it('clears all tracked state', () => {
      for (let i = 0; i < 5; i++) {
        aggregator.recordError(`server-${i}`, 'rateLimited');
      }
      expect(aggregator.isClusterRateLimited()).toBe(true);
      aggregator.reset();
      expect(aggregator.isClusterRateLimited()).toBe(false);
      expect(aggregator.getErrorSummary().rateLimitServerCount).toBe(0);
    });
  });

  describe('updateConfig', () => {
    it('changes threshold at runtime', () => {
      aggregator.recordError('server-1', 'rateLimited');
      aggregator.recordError('server-2', 'rateLimited');
      expect(aggregator.isClusterRateLimited()).toBe(false);

      aggregator.updateConfig({ rateLimitThreshold: 2 });
      expect(aggregator.isClusterRateLimited()).toBe(true);
    });

    it('can disable at runtime', () => {
      for (let i = 0; i < 5; i++) {
        aggregator.recordError(`server-${i}`, 'rateLimited');
      }
      expect(aggregator.isClusterRateLimited()).toBe(true);
      aggregator.updateConfig({ enabled: false });
      expect(aggregator.isClusterRateLimited()).toBe(false);
    });
  });

  describe('TTL-based cleanup', () => {
    it('prunes entries outside the time window when recording new errors', async () => {
      const shortWindow = new ErrorAggregator({
        enabled: true,
        rateLimitThreshold: 5,
        timeWindowMs: 50,
        clusterBackoffMs: 30000,
      });

      shortWindow.recordError('server-1', 'rateLimited');
      expect(shortWindow.getErrorSummary().rateLimitServerCount).toBe(1);

      await new Promise(resolve => setTimeout(resolve, 100));

      shortWindow.recordError('server-2', 'rateLimited');
      const summary = shortWindow.getErrorSummary();
      expect(summary.rateLimitServerCount).toBe(1);
      expect(Object.keys(summary.rateLimitServers)).toContain('server-2');
      expect(Object.keys(summary.rateLimitServers)).not.toContain('server-1');
      shortWindow.stopPeriodicCleanup();
    });
  });
});
