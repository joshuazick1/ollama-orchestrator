/**
 * metrics-aggregator.ts
 * Historical metrics tracking with sliding windows
 */

import type {
  MetricsWindow,
  ServerModelMetrics,
  RequestContext,
  TimeWindow,
  LatencyPercentiles,
  GlobalMetrics,
  MetricsExport,
} from '../orchestrator.types.js';

import { MetricsPersistence, type MetricsData } from './metrics-persistence.js';

/**
 * Configuration for metrics decay
 */
export interface MetricsDecayConfig {
  enabled: boolean; // Whether to apply decay to stale metrics
  halfLifeMs: number; // Time for metrics to decay to 50% influence (default: 5 minutes)
  minDecayFactor: number; // Minimum decay factor to prevent complete zero-out (default: 0.1)
  staleThresholdMs: number; // Metrics older than this are considered stale (default: 2 minutes)
}

export const DEFAULT_METRICS_DECAY_CONFIG: MetricsDecayConfig = {
  enabled: true,
  halfLifeMs: 5 * 60 * 1000, // 5 minutes
  minDecayFactor: 0.1, // 10% minimum influence
  staleThresholdMs: 2 * 60 * 1000, // 2 minutes
};

/**
 * Aggregates metrics across multiple time windows
 */
export class MetricsAggregator {
  private metrics: Map<string, ServerModelMetrics> = new Map();
  private windowSizes: Record<TimeWindow, number> = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  };
  private maxRecentLatencies = 1000; // Keep last 1000 latencies for percentile calc
  private maxRecentTTFTs = 500; // Keep last 500 TTFT measurements for percentile calc
  private maxRecentStreamingDurations = 500; // Keep last 500 streaming durations
  private persistence: MetricsPersistence;
  private decayConfig: MetricsDecayConfig;

  constructor(decayConfig: Partial<MetricsDecayConfig> = {}) {
    this.persistence = new MetricsPersistence();
    this.decayConfig = { ...DEFAULT_METRICS_DECAY_CONFIG, ...decayConfig };
  }

  /**
   * Initialize the aggregator - load persisted data
   */
  async initialize(): Promise<void> {
    await this.persistence.initialize();
    const persistedData = await this.persistence.load();
    if (persistedData) {
      // Load persisted metrics into the map, ensuring all required windows exist
      for (const [key, metrics] of Object.entries(persistedData.servers)) {
        // Ensure all time windows exist in persisted metrics
        for (const windowSize of Object.keys(this.windowSizes) as TimeWindow[]) {
          if (!metrics.windows[windowSize]) {
            metrics.windows[windowSize] = this.createEmptyWindow(metrics.lastUpdated);
          }
        }
        this.metrics.set(key, metrics);
      }
    }
  }

  /**
   * Record a request completion
   */
  recordRequest(context: RequestContext): void {
    const key = `${context.serverId}:${context.model}`;
    const now = Date.now();

    let metrics = this.metrics.get(key);
    if (!metrics) {
      metrics = this.createEmptyMetrics(context.serverId!, context.model);
      this.metrics.set(key, metrics);
    }

    // Update windows
    const duration = context.duration ?? 0;
    const success = context.success;
    const tokensGenerated = context.tokensGenerated ?? 0;
    const tokensPrompt = context.tokensPrompt ?? 0;

    // Update all time windows
    (Object.keys(this.windowSizes) as TimeWindow[]).forEach(window => {
      this.updateWindow(
        metrics.windows[window],
        duration,
        success,
        tokensGenerated,
        tokensPrompt,
        now
      );
    });

    // Update recent latencies for percentile calculation
    metrics.recentLatencies.push(duration);
    if (metrics.recentLatencies.length > this.maxRecentLatencies) {
      metrics.recentLatencies.shift();
    }

    // Recalculate percentiles
    metrics.percentiles = this.calculatePercentiles(metrics.recentLatencies);

    // Track streaming metrics if applicable
    if (context.streaming && metrics.streamingMetrics) {
      // Track TTFT (time to first token)
      if (context.ttft && context.ttft > 0) {
        metrics.streamingMetrics.recentTTFTs.push(context.ttft);
        if (metrics.streamingMetrics.recentTTFTs.length > this.maxRecentTTFTs) {
          metrics.streamingMetrics.recentTTFTs.shift();
        }
        metrics.streamingMetrics.ttftPercentiles = this.calculatePercentiles(
          metrics.streamingMetrics.recentTTFTs
        );
        metrics.streamingMetrics.avgTTFT = this.calculateAvgTTFT(
          metrics.streamingMetrics.recentTTFTs
        );
      }

      // Track total streaming duration
      if (context.streamingDuration && context.streamingDuration > 0) {
        metrics.streamingMetrics.recentStreamingDurations.push(context.streamingDuration);
        if (
          metrics.streamingMetrics.recentStreamingDurations.length >
          this.maxRecentStreamingDurations
        ) {
          metrics.streamingMetrics.recentStreamingDurations.shift();
        }
        metrics.streamingMetrics.streamingDurationPercentiles = this.calculatePercentiles(
          metrics.streamingMetrics.recentStreamingDurations
        );
      }
    }

    // Update derived metrics
    metrics.successRate = this.calculateSuccessRate(metrics.windows['5m']);
    metrics.throughput = this.calculateThroughput(metrics.windows['5m']);
    metrics.avgTokensPerRequest = this.calculateAvgTokens(metrics.windows['5m']);
    metrics.lastUpdated = now;

    // Schedule persistence save
    this.persistence.scheduleSave(this.getMetricsData());
  }

  /**
   * Track in-flight request count
   */
  incrementInFlight(serverId: string, model: string): void {
    const key = `${serverId}:${model}`;
    let metrics = this.metrics.get(key);
    if (!metrics) {
      metrics = this.createEmptyMetrics(serverId, model);
      this.metrics.set(key, metrics);
    }
    metrics.inFlight++;
  }

  /**
   * Decrement in-flight request count
   */
  decrementInFlight(serverId: string, model: string): void {
    const key = `${serverId}:${model}`;
    const metrics = this.metrics.get(key);
    if (metrics) {
      metrics.inFlight = Math.max(0, metrics.inFlight - 1);
    }
  }

  /**
   * Get metrics for a specific server:model
   * Applies decay to stale metrics if enabled
   */
  getMetrics(serverId: string, model: string): ServerModelMetrics | undefined {
    const metrics = this.metrics.get(`${serverId}:${model}`);
    if (!metrics) {
      return undefined;
    }

    // Apply decay if enabled
    if (this.decayConfig.enabled) {
      return this.applyDecay(metrics);
    }

    return metrics;
  }

  /**
   * Get raw metrics without decay applied (for internal use)
   */
  getRawMetrics(serverId: string, model: string): ServerModelMetrics | undefined {
    return this.metrics.get(`${serverId}:${model}`);
  }

  /**
   * Apply time-based decay to stale metrics
   * Uses exponential decay based on half-life
   */
  private applyDecay(metrics: ServerModelMetrics): ServerModelMetrics {
    const now = Date.now();
    const age = now - metrics.lastUpdated;

    // If metrics are fresh, return as-is
    if (age < this.decayConfig.staleThresholdMs) {
      return metrics;
    }

    // Calculate decay factor using exponential decay formula: factor = 2^(-age/halfLife)
    const decayFactor = Math.max(
      this.decayConfig.minDecayFactor,
      Math.pow(2, -age / this.decayConfig.halfLifeMs)
    );

    // Create a copy with decayed values
    // Decay affects confidence in historical data, so we blend towards defaults
    const decayedMetrics: ServerModelMetrics = {
      ...metrics,
      // Success rate decays towards 1 (optimistic) since we have less confidence in old failure data
      successRate: this.decayTowards(metrics.successRate, 1, decayFactor),
      // Throughput decays towards 0 since old throughput data is less relevant
      throughput: metrics.throughput * decayFactor,
      // Percentiles decay towards higher values (more conservative estimates)
      percentiles: {
        p50: this.decayTowards(
          metrics.percentiles.p50,
          metrics.percentiles.p50 * 1.5,
          1 - decayFactor
        ),
        p95: this.decayTowards(
          metrics.percentiles.p95,
          metrics.percentiles.p95 * 1.5,
          1 - decayFactor
        ),
        p99: this.decayTowards(
          metrics.percentiles.p99,
          metrics.percentiles.p99 * 1.5,
          1 - decayFactor
        ),
      },
      // Streaming metrics decay similarly
      streamingMetrics: metrics.streamingMetrics
        ? {
            ...metrics.streamingMetrics,
            avgTTFT: this.decayTowards(
              metrics.streamingMetrics.avgTTFT,
              metrics.streamingMetrics.avgTTFT * 1.5,
              1 - decayFactor
            ),
            ttftPercentiles: {
              p50: this.decayTowards(
                metrics.streamingMetrics.ttftPercentiles.p50,
                metrics.streamingMetrics.ttftPercentiles.p50 * 1.5,
                1 - decayFactor
              ),
              p95: this.decayTowards(
                metrics.streamingMetrics.ttftPercentiles.p95,
                metrics.streamingMetrics.ttftPercentiles.p95 * 1.5,
                1 - decayFactor
              ),
              p99: this.decayTowards(
                metrics.streamingMetrics.ttftPercentiles.p99,
                metrics.streamingMetrics.ttftPercentiles.p99 * 1.5,
                1 - decayFactor
              ),
            },
            streamingDurationPercentiles: {
              p50: this.decayTowards(
                metrics.streamingMetrics.streamingDurationPercentiles.p50,
                metrics.streamingMetrics.streamingDurationPercentiles.p50 * 1.5,
                1 - decayFactor
              ),
              p95: this.decayTowards(
                metrics.streamingMetrics.streamingDurationPercentiles.p95,
                metrics.streamingMetrics.streamingDurationPercentiles.p95 * 1.5,
                1 - decayFactor
              ),
              p99: this.decayTowards(
                metrics.streamingMetrics.streamingDurationPercentiles.p99,
                metrics.streamingMetrics.streamingDurationPercentiles.p99 * 1.5,
                1 - decayFactor
              ),
            },
          }
        : undefined,
      // Mark as decayed with decay factor for transparency
      _decayFactor: decayFactor,
    } as ServerModelMetrics & { _decayFactor?: number };

    return decayedMetrics;
  }

  /**
   * Blend a value towards a target based on decay factor
   */
  private decayTowards(current: number, target: number, blendFactor: number): number {
    return current + (target - current) * blendFactor;
  }

  /**
   * Get the current decay configuration
   */
  getDecayConfig(): MetricsDecayConfig {
    return { ...this.decayConfig };
  }

  /**
   * Update decay configuration
   */
  setDecayConfig(config: Partial<MetricsDecayConfig>): void {
    this.decayConfig = { ...this.decayConfig, ...config };
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, ServerModelMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Get global aggregated metrics
   */
  getGlobalMetrics(): GlobalMetrics {
    let totalRequests = 0;
    let totalErrors = 0;
    let totalTokens = 0;
    let latencySum = 0;
    let latencyCount = 0;

    for (const metrics of this.metrics.values()) {
      const window = metrics.windows['5m'];
      totalRequests += window.count;
      totalErrors += window.errors;
      totalTokens += window.tokensGenerated;
      latencySum += window.latencySum;
      latencyCount += window.count;
    }

    const avgLatency = latencyCount > 0 ? latencySum / latencyCount : 0;
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;
    const requestsPerSecond = totalRequests / 300; // 5 minutes

    return {
      totalRequests,
      totalErrors,
      totalTokens,
      requestsPerSecond,
      avgLatency,
      errorRate,
    };
  }

  /**
   * Export metrics in structured format
   */
  exportMetrics(): MetricsExport {
    const servers: MetricsExport['servers'] = {};

    for (const [key, metrics] of this.metrics.entries()) {
      const colonIdx = key.indexOf(':');
      const serverId = key.slice(0, colonIdx);
      const model = key.slice(colonIdx + 1);
      if (!servers[serverId]) {
        servers[serverId] = {
          healthy: true, // This will be updated by orchestrator
          inFlight: 0,
          queued: 0,
          models: {},
        };
      }

      servers[serverId].inFlight += metrics.inFlight;
      servers[serverId].models[model] = {
        windows: metrics.windows,
        percentiles: metrics.percentiles,
        successRate: metrics.successRate,
        throughput: metrics.throughput,
        avgTokensPerRequest: metrics.avgTokensPerRequest,
      };
    }

    return {
      timestamp: Date.now(),
      global: this.getGlobalMetrics(),
      servers,
    };
  }

  /**
   * Clean up old metrics data
   */
  pruneOldMetrics(maxAge = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [key, metrics] of this.metrics.entries()) {
      if (now - metrics.lastUpdated > maxAge && metrics.inFlight === 0) {
        this.metrics.delete(key);
      }
    }
  }

  /**
   * Get metrics data for persistence
   */
  private getMetricsData(): MetricsData {
    const servers: Record<string, ServerModelMetrics> = {};
    for (const [key, metrics] of this.metrics.entries()) {
      servers[key] = metrics;
    }
    return {
      timestamp: Date.now(),
      servers,
    };
  }

  /**
   * Create empty metrics structure
   */
  private createEmptyMetrics(serverId: string, model: string): ServerModelMetrics {
    const now = Date.now();
    return {
      serverId,
      model,
      inFlight: 0,
      queued: 0,
      windows: {
        '1m': this.createEmptyWindow(now),
        '5m': this.createEmptyWindow(now),
        '15m': this.createEmptyWindow(now),
        '1h': this.createEmptyWindow(now),
        '24h': this.createEmptyWindow(now),
      },
      percentiles: { p50: 0, p95: 0, p99: 0 },
      successRate: 1,
      throughput: 0,
      avgTokensPerRequest: 0,
      streamingMetrics: {
        recentTTFTs: [],
        ttftPercentiles: { p50: 0, p95: 0, p99: 0 },
        avgTTFT: 0,
        recentStreamingDurations: [],
        streamingDurationPercentiles: { p50: 0, p95: 0, p99: 0 },
      },
      lastUpdated: now,
      recentLatencies: [],
    };
  }

  /**
   * Create empty window
   */
  private createEmptyWindow(now: number): MetricsWindow {
    return {
      startTime: now,
      endTime: now,
      count: 0,
      latencySum: 0,
      latencySquaredSum: 0,
      minLatency: Infinity,
      maxLatency: 0,
      errors: 0,
      tokensGenerated: 0,
      tokensPrompt: 0,
    };
  }

  /**
   * Update a time window with new data
   */
  private updateWindow(
    window: MetricsWindow,
    duration: number,
    success: boolean,
    tokensGenerated: number,
    tokensPrompt: number,
    now: number
  ): void {
    // Roll window if needed
    if (now > window.endTime) {
      // Check if we should reset or slide
      const maxWindowSize = this.getWindowSizeFromEndTime(window.endTime);
      if (now - window.startTime > maxWindowSize) {
        // Reset window
        window.startTime = now - maxWindowSize;
        window.count = 0;
        window.latencySum = 0;
        window.latencySquaredSum = 0;
        window.minLatency = Infinity;
        window.maxLatency = 0;
        window.errors = 0;
        window.tokensGenerated = 0;
        window.tokensPrompt = 0;
      }
    }

    window.endTime = now;
    window.count++;
    window.latencySum += duration;
    window.latencySquaredSum += duration * duration;
    window.minLatency = Math.min(window.minLatency, duration);
    window.maxLatency = Math.max(window.maxLatency, duration);

    if (!success) {
      window.errors++;
    }

    window.tokensGenerated += tokensGenerated;
    window.tokensPrompt += tokensPrompt;
  }

  /**
   * Get window size from end time
   */
  private getWindowSizeFromEndTime(_endTime: number): number {
    // Determine which window this belongs to based on typical usage
    // This is a simplification - in practice, each window tracks independently
    return this.windowSizes['1h'];
  }

  /**
   * Calculate percentiles from latency array
   */
  private calculatePercentiles(latencies: number[]): LatencyPercentiles {
    if (latencies.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      p50: this.getPercentile(sorted, len, 0.5),
      p95: this.getPercentile(sorted, len, 0.95),
      p99: this.getPercentile(sorted, len, 0.99),
    };
  }

  /**
   * Get percentile value from sorted array
   */
  private getPercentile(sorted: number[], len: number, percentile: number): number {
    if (len === 0) {
      return 0;
    }
    if (len === 1) {
      return sorted[0];
    }

    const index = Math.ceil(len * percentile) - 1;
    return sorted[Math.max(0, Math.min(index, len - 1))];
  }

  /**
   * Calculate success rate from window
   */
  private calculateSuccessRate(window: MetricsWindow): number {
    if (window.count === 0) {
      return 1;
    }
    return (window.count - window.errors) / window.count;
  }

  /**
   * Calculate throughput (requests per minute)
   */
  private calculateThroughput(window: MetricsWindow): number {
    const duration = window.endTime - window.startTime;
    if (duration === 0) {
      return 0;
    }
    return (window.count / duration) * 60 * 1000;
  }

  /**
   * Calculate average tokens per request
   */
  private calculateAvgTokens(window: MetricsWindow): number {
    if (window.count === 0) {
      return 0;
    }
    return window.tokensGenerated / window.count;
  }

  /**
   * Calculate average TTFT from array
   */
  private calculateAvgTTFT(ttfts: number[]): number {
    if (ttfts.length === 0) {
      return 0;
    }
    return ttfts.reduce((sum, ttft) => sum + ttft, 0) / ttfts.length;
  }

  /**
   * Shutdown the aggregator - flush persistence
   */
  async shutdown(): Promise<void> {
    const data = this.getMetricsData();
    await this.persistence.shutdown(data);
  }

  /**
   * Reset all metrics - useful for testing or manual reset
   */
  reset(): void {
    this.metrics.clear();
  }
}
