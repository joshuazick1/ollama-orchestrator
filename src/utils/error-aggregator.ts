import { logger } from './logger.js';

export interface ErrorAggregatorConfig {
  enabled: boolean;
  /** N servers that must hit rate limits within the window to trigger cluster mode */
  rateLimitThreshold: number;
  timeWindowMs: number;
  clusterBackoffMs: number;
  /** Optional cluster size for dynamic threshold calculation */
  clusterSize?: number;
}

export interface ClusterErrorSummary {
  rateLimitServers: Record<string, number[]>;
  rateLimitServerCount: number;
  totalRateLimitEvents: number;
}

export interface ClusterStatus {
  isRateLimited: boolean;
  rateLimitServerCount: number;
  totalRateLimitEvents: number;
  /** 0 when not rate limited */
  backoffMs: number;
  /** Epoch ms when cluster rate limit mode was triggered; undefined when inactive */
  triggeredAt?: number;
  threshold: number;
  windowMs: number;
  clusterBackoffMs: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: ErrorAggregatorConfig = {
  enabled: true,
  rateLimitThreshold: 5, // Higher threshold for large clusters - triggers when 5+ servers hit rate limits (not 2)
  timeWindowMs: 10000,
  clusterBackoffMs: 30000,
};

/**
 * Tracks rate limit errors across all servers in the cluster.
 * Not a singleton – each orchestrator instance owns one.
 */
export class ErrorAggregator {
  private config: ErrorAggregatorConfig;
  private rateLimitTimestamps: Map<string, number[]> = new Map();
  private clusterRateLimitTriggeredAt?: number;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(config: Partial<ErrorAggregatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.clusterSize !== undefined) {
      this.config.rateLimitThreshold = this.calculateDynamicThreshold(this.config.clusterSize);
    }
  }

  /**
   * Calculate threshold based on cluster size using percentage formula.
   * - clusterSize >= 10: 90% threshold
   * - clusterSize >= 4: 75% threshold
   * - clusterSize < 4: fixed threshold of 2
   */
  private calculateDynamicThreshold(clusterSize: number): number {
    if (clusterSize >= 10) {
      return Math.ceil(clusterSize * 0.9);
    } else if (clusterSize >= 4) {
      return Math.ceil(clusterSize * 0.75);
    }
    return 2;
  }

  /**
   * Set cluster size and recalculate threshold dynamically.
   */
  setClusterSize(size: number): void {
    this.config.clusterSize = size;
    this.config.rateLimitThreshold = this.calculateDynamicThreshold(size);
  }

  getClusterSize(): number | undefined {
    return this.config.clusterSize;
  }

  startPeriodicCleanup(intervalMs: number = 30000): void {
    this.stopPeriodicCleanup();
    this.cleanupInterval = setInterval(() => {
      this.pruneExpiredEntries();
    }, intervalMs);
    this.cleanupInterval.unref();
  }

  stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  recordError(serverId: string, errorType: 'rateLimited'): void {
    if (!this.config.enabled || errorType !== 'rateLimited') {
      return;
    }

    const now = Date.now();
    const windowStart = now - this.config.timeWindowMs;
    const existing = this.rateLimitTimestamps.get(serverId) ?? [];
    existing.push(now);
    this.rateLimitTimestamps.set(serverId, existing.filter(ts => ts >= windowStart));

    const distinctServersInWindow = this.countDistinctRateLimitServers();
    if (distinctServersInWindow >= this.config.rateLimitThreshold && !this.clusterRateLimitTriggeredAt) {
      this.clusterRateLimitTriggeredAt = now;
      logger.warn(
        `[ErrorAggregator] Cluster-wide rate limit detected: ${distinctServersInWindow} servers ` +
          `hit rate limits within ${this.config.timeWindowMs}ms. ` +
          `Adding ${this.config.clusterBackoffMs}ms backpressure.`
      );
    }
  }

  isClusterRateLimited(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    this.pruneExpiredEntries();
    const active = this.countDistinctRateLimitServers() >= this.config.rateLimitThreshold;
    if (!active && this.clusterRateLimitTriggeredAt !== undefined) {
      logger.info('[ErrorAggregator] Cluster rate limit cleared.');
      this.clusterRateLimitTriggeredAt = undefined;
    }
    return active;
  }

  getBackoffForCluster(): number {
    return this.isClusterRateLimited() ? this.config.clusterBackoffMs : 0;
  }

  getClusterStatus(): ClusterStatus {
    this.pruneExpiredEntries();
    const rateLimitServerCount = this.countDistinctRateLimitServers();
    const isRateLimited = this.config.enabled && rateLimitServerCount >= this.config.rateLimitThreshold;

    if (!isRateLimited && this.clusterRateLimitTriggeredAt !== undefined) {
      this.clusterRateLimitTriggeredAt = undefined;
    }

    let totalRateLimitEvents = 0;
    for (const timestamps of this.rateLimitTimestamps.values()) {
      totalRateLimitEvents += timestamps.length;
    }

    return {
      isRateLimited,
      rateLimitServerCount,
      totalRateLimitEvents,
      backoffMs: isRateLimited ? this.config.clusterBackoffMs : 0,
      triggeredAt: isRateLimited ? this.clusterRateLimitTriggeredAt : undefined,
      threshold: this.config.rateLimitThreshold,
      windowMs: this.config.timeWindowMs,
      clusterBackoffMs: this.config.clusterBackoffMs,
      enabled: this.config.enabled,
    };
  }

  getErrorSummary(): ClusterErrorSummary {
    this.pruneExpiredEntries();
    const rateLimitServers: Record<string, number[]> = {};
    let totalRateLimitEvents = 0;

    for (const [serverId, timestamps] of this.rateLimitTimestamps.entries()) {
      if (timestamps.length > 0) {
        rateLimitServers[serverId] = [...timestamps];
        totalRateLimitEvents += timestamps.length;
      }
    }

    return {
      rateLimitServers,
      rateLimitServerCount: Object.keys(rateLimitServers).length,
      totalRateLimitEvents,
    };
  }

  updateConfig(config: Partial<ErrorAggregatorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ErrorAggregatorConfig {
    return { ...this.config };
  }

  reset(): void {
    this.rateLimitTimestamps.clear();
    this.clusterRateLimitTriggeredAt = undefined;
  }

  private countDistinctRateLimitServers(): number {
    let count = 0;
    for (const timestamps of this.rateLimitTimestamps.values()) {
      if (timestamps.length > 0) {
        count++;
      }
    }
    return count;
  }

  private pruneExpiredEntries(): void {
    const windowStart = Date.now() - this.config.timeWindowMs;
    const toDelete: string[] = [];

    for (const [serverId, timestamps] of this.rateLimitTimestamps.entries()) {
      const pruned = timestamps.filter(ts => ts >= windowStart);
      if (pruned.length === 0) {
        toDelete.push(serverId);
      } else {
        this.rateLimitTimestamps.set(serverId, pruned);
      }
    }

    for (const key of toDelete) {
      this.rateLimitTimestamps.delete(key);
    }
  }
}
