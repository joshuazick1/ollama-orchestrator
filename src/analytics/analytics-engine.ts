/**
 * analytics-engine.ts
 * Analytics and reporting engine for historical metrics
 */

import path from 'path';

import { JsonFileHandler } from '../config/jsonFileHandler.js';
import {
  getDecisionHistory,
  type DecisionEvent,
  type ServerModelTrend,
} from '../decision-history.js';
import type {
  ServerModelMetrics,
  MetricsWindow,
  TimeWindow,
  RequestContext,
} from '../orchestrator.types.js';
import { getRequestHistory, type RequestRecord, type RequestStats } from '../request-history.js';
import { getMetricsStore } from '../storage/metrics-store.js';
import { logger } from '../utils/logger.js';
import { Statistics } from '../utils/statistics.js';

export type AnalyticsTimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | 'custom';

export interface TimeRange {
  start: number;
  end: number;
}

export interface TopModelData {
  model: string;
  requests: number;
  percentage: number;
  avgLatency: number;
  errorRate: number;
}

export interface ServerPerformanceData {
  id: string;
  requests: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  throughput: number;
  utilization: number;
  score: number;
}

export interface ErrorAnalysisData {
  totalErrors: number;
  byType: Record<string, number>;
  byServer: Record<string, number>;
  byModel: Record<string, number>;
  trend: 'increasing' | 'decreasing' | 'stable';
  recentErrors: Array<{
    timestamp: number;
    serverId: string;
    model: string;
    errorType: string;
    message: string;
  }>;
}

export interface CapacityData {
  current: {
    totalCapacity: number;
    usedCapacity: number;
    availableCapacity: number;
    queueDepth: number;
    saturation: number;
  };
  forecast: {
    nextHour: {
      predictedSaturation: number;
      confidence: number;
      recommendation: 'scale-up' | 'scale-down' | 'stable';
    };
    next24Hours: {
      predictedSaturation: number;
      confidence: number;
      recommendation: 'scale-up' | 'scale-down' | 'stable';
    };
  };
  trends: {
    requestsPerHour: number[];
    saturationLevels: number[];
    timestamps: number[];
  };
  recommendations: string[];
}

export interface TrendAnalysis {
  metric: string;
  direction: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  confidence: number;
}

/**
 * Shape of the persisted analytics engine JSON file
 */
interface PersistedAnalyticsData {
  timestamp: number;
  requestHistory: RequestContext[];
  errorHistory: Array<{
    timestamp: number;
    serverId: string;
    model: string;
    errorType: string;
    message: string;
  }>;
}

/**
 * Hourly summary snapshot for long-term trend analysis (REC-33)
 */
export interface MetricsSummarySnapshot {
  timestamp: number;
  servers: {
    [serverId: string]: {
      [model: string]: {
        avgLatency: number;
        avgTokenThroughput: number;
        requestCount: number;
        errorRate: number;
      };
    };
  };
}

/**
 * Shape of the persisted metrics summary JSON file
 */
interface PersistedMetricsSummary {
  timestamp: number;
  snapshots: MetricsSummarySnapshot[];
}

/**
 * Analytics engine for querying and aggregating historical metrics
 */
export class AnalyticsEngine {
  private metrics: Map<string, ServerModelMetrics> = new Map();
  private requestHistory: RequestContext[] = [];
  private errorHistory: Array<{
    timestamp: number;
    serverId: string;
    model: string;
    errorType: string;
    message: string;
  }> = [];
  private maxHistorySize = 10000;
  private persistenceTimer?: NodeJS.Timeout;
  private fileHandler: JsonFileHandler;
  private readonly persistenceIntervalMs = 60000; // 60 seconds
  private readonly retentionMs = 24 * 60 * 60 * 1000; // 24 hours

  // REC-33: Hourly summary snapshots for long-term trends
  private summarySnapshots: MetricsSummarySnapshot[] = [];
  private summaryTimer?: NodeJS.Timeout;
  private summaryFileHandler: JsonFileHandler;
  private readonly summaryIntervalMs = 60 * 60 * 1000; // 1 hour
  private readonly summaryRetentionMs = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor() {
    const filePath = path.join(process.cwd(), 'data', 'analytics-engine.json');
    this.fileHandler = new JsonFileHandler(filePath, {
      createBackups: true,
      maxBackups: 3,
    });
    const summaryFilePath = path.join(process.cwd(), 'data', 'metrics-summary.json');
    this.summaryFileHandler = new JsonFileHandler(summaryFilePath, {
      createBackups: true,
      maxBackups: 3,
    });
    this.loadFromDisk();
    this.loadSummaryFromDisk();
    this.startPersistence();
    this.startSummaryTimer();
  }

  /**
   * Update with current metrics snapshot
   */
  updateMetrics(metrics: Map<string, ServerModelMetrics>): void {
    this.metrics = new Map(metrics);
  }

  /**
   * Record a request for analytics
   */
  recordRequest(context: RequestContext): void {
    this.requestHistory.push({ ...context });

    // Prune old history
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory = this.requestHistory.slice(-this.maxHistorySize);
    }

    // Record errors separately
    if (!context.success && context.error) {
      this.errorHistory.push({
        timestamp: context.startTime,
        serverId: context.serverId ?? 'unknown',
        model: context.model,
        errorType: this.classifyError(context.error),
        message: context.error.message,
      });

      if (this.errorHistory.length > this.maxHistorySize) {
        this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
      }
    }
  }

  /**
   * Classify error type from error message
   */
  private classifyError(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) {
      return 'timeout';
    }
    if (
      message.includes('oom') ||
      message.includes('out of memory') ||
      message.includes('not enough ram')
    ) {
      return 'oom';
    }
    if (
      message.includes('connection') ||
      message.includes('refused') ||
      message.includes('econnrefused')
    ) {
      return 'connection_refused';
    }
    if (message.includes('model') && message.includes('not found')) {
      return 'model_not_found';
    }
    if (message.includes('circuit breaker')) {
      return 'circuit_breaker';
    }
    if (message.includes('load') || message.includes('capacity')) {
      return 'capacity_exceeded';
    }

    return 'unknown';
  }

  /**
   * Parse time range
   */
  parseTimeRange(range: AnalyticsTimeRange, customRange?: TimeRange): TimeRange {
    const now = Date.now();

    switch (range) {
      case '1h':
        return { start: now - 3600000, end: now };
      case '6h':
        return { start: now - 21600000, end: now };
      case '24h':
        return { start: now - 86400000, end: now };
      case '7d':
        return { start: now - 604800000, end: now };
      case '30d':
        return { start: now - 2592000000, end: now };
      case 'custom':
        return customRange ?? { start: now - 3600000, end: now };
      default:
        return { start: now - 3600000, end: now };
    }
  }

  /**
   * Get top models by usage
   */
  getTopModels(
    limit = 10,
    timeRange: AnalyticsTimeRange = '24h',
    customRange?: TimeRange
  ): TopModelData[] {
    // For ranges > 24h, query SQLite rollups which have actual historical data
    if (this.isLongRange(timeRange)) {
      return this.getTopModelsFromRollups(limit, timeRange);
    }

    const range = this.parseTimeRange(timeRange, customRange);
    const modelStats: Map<string, { requests: number; latencySum: number; errors: number }> =
      new Map();

    // Aggregate from current metrics windows
    for (const [key, metrics] of this.metrics.entries()) {
      const [, ...modelParts] = key.split(':');
      const model = modelParts.join(':');
      const window = this.selectBestWindow(metrics.windows, timeRange);

      if (!modelStats.has(model)) {
        modelStats.set(model, { requests: 0, latencySum: 0, errors: 0 });
      }

      const stats = modelStats.get(model)!;
      stats.requests += window.count;
      stats.latencySum += window.latencySum;
      stats.errors += window.errors;
    }

    // Filter by time range from request history
    const filteredHistory = this.requestHistory.filter(
      req => req.startTime >= range.start && req.startTime <= range.end
    );

    // Supplement with request history
    for (const req of filteredHistory) {
      if (!modelStats.has(req.model)) {
        modelStats.set(req.model, { requests: 0, latencySum: 0, errors: 0 });
      }

      const stats = modelStats.get(req.model)!;
      // Only count if not already in metrics (approximation)
      if (stats.requests === 0) {
        stats.requests++;
        stats.latencySum += req.duration ?? 0;
        if (!req.success) {
          stats.errors++;
        }
      }
    }

    // Calculate totals
    let totalRequests = 0;
    for (const stats of modelStats.values()) {
      totalRequests += stats.requests;
    }

    // Convert to array and sort
    const results: TopModelData[] = [];
    for (const [model, stats] of modelStats.entries()) {
      results.push({
        model,
        requests: stats.requests,
        percentage: totalRequests > 0 ? (stats.requests / totalRequests) * 100 : 0,
        avgLatency: stats.requests > 0 ? stats.latencySum / stats.requests : 0,
        errorRate: stats.requests > 0 ? stats.errors / stats.requests : 0,
      });
    }

    return results.sort((a, b) => b.requests - a.requests).slice(0, limit);
  }

  /**
   * Select best window for time range
   */
  private selectBestWindow(
    windows: Record<TimeWindow, MetricsWindow>,
    range: AnalyticsTimeRange
  ): MetricsWindow {
    // Map time ranges to the most granular window that fits.
    // Available windows: 1m, 5m, 15m, 1h.
    // Shorter time ranges benefit from shorter windows for higher resolution;
    // longer time ranges use the 1h window since that's the longest we have.
    const windowMap: Record<AnalyticsTimeRange, TimeWindow> = {
      // For a 1-hour query we should use the 1h window (tests expect the 1h
      // bucket to be used when callers request '1h'). Longer ranges use the
      // 1h window as well since that's the largest in-memory window available.
      '1h': '1h',
      '6h': '1h',
      '24h': '1h',
      '7d': '1h',
      '30d': '1h',
      custom: '1h',
    };

    return windows[windowMap[range] || '1h'];
  }

  /**
   * Get server performance comparison
   */
  getServerPerformance(
    timeRange: AnalyticsTimeRange = '1h',
    _customRange?: TimeRange
  ): ServerPerformanceData[] {
    // For ranges > 24h, query SQLite rollups which have actual historical data
    if (this.isLongRange(timeRange)) {
      return this.getServerPerformanceFromRollups(timeRange);
    }

    const serverStats: Map<
      string,
      {
        requests: number;
        latencySum: number;
        latencies: number[];
        errors: number;
        throughputSum: number;
        modelCount: number;
      }
    > = new Map();

    // Aggregate metrics by server
    for (const [key, metrics] of this.metrics.entries()) {
      const [serverId] = key.split(':');
      const window = this.selectBestWindow(metrics.windows, timeRange);

      if (!serverStats.has(serverId)) {
        serverStats.set(serverId, {
          requests: 0,
          latencySum: 0,
          latencies: [],
          errors: 0,
          throughputSum: 0,
          modelCount: 0,
        });
      }

      const stats = serverStats.get(serverId)!;
      stats.requests += window.count;
      stats.latencySum += window.latencySum;
      stats.errors += window.errors;
      stats.throughputSum += metrics.throughput;
      stats.modelCount++;

      // Collect latencies for percentile calculation
      if (metrics.percentiles.p95 > 0) {
        stats.latencies.push(metrics.percentiles.p95);
      }
    }

    // Convert to results
    const results: ServerPerformanceData[] = [];
    for (const [serverId, stats] of serverStats.entries()) {
      const avgLatency = stats.requests > 0 ? stats.latencySum / stats.requests : 0;
      const sortedLatencies = [...stats.latencies].sort((a, b) => a - b);
      const p95Latency = this.calculatePercentile(sortedLatencies, 0.95);
      const p99Latency = this.calculatePercentile(sortedLatencies, 0.99);
      const errorRate = stats.requests > 0 ? stats.errors / stats.requests : 0;
      const throughput = stats.modelCount > 0 ? stats.throughputSum / stats.modelCount : 0;

      // Calculate utilization (approximate)
      const utilization = Math.min(1, stats.requests / (throughput * 60 + 1));

      // Calculate overall score (0-100)
      const latencyScore = Math.max(0, 100 - avgLatency / 50);
      const successScore = (1 - errorRate) * 100;
      const score = latencyScore * 0.5 + successScore * 0.5;

      results.push({
        id: serverId,
        requests: stats.requests,
        avgLatency: Math.round(avgLatency),
        p95Latency: Math.round(p95Latency),
        p99Latency: Math.round(p99Latency),
        errorRate: Math.round(errorRate * 1000) / 1000,
        throughput: Math.round(throughput * 100) / 100,
        utilization: Math.round(utilization * 100) / 100,
        score: Math.round(score),
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sorted: number[], percentile: number): number {
    return Statistics.calculatePercentile(sorted, percentile);
  }

  /**
   * Get error analysis
   */
  getErrorAnalysis(
    timeRange: AnalyticsTimeRange = '24h',
    customRange?: TimeRange
  ): ErrorAnalysisData {
    // For ranges > 24h, query SQLite which retains data beyond the 24h in-memory window
    if (this.isLongRange(timeRange)) {
      return this.getErrorAnalysisFromSQLite(timeRange);
    }

    const range = this.parseTimeRange(timeRange, customRange);

    // Filter errors by time range
    const filteredErrors = this.errorHistory.filter(
      err => err.timestamp >= range.start && err.timestamp <= range.end
    );

    // Aggregate by type
    const byType: Record<string, number> = {};
    const byServer: Record<string, number> = {};
    const byModel: Record<string, number> = {};

    for (const error of filteredErrors) {
      byType[error.errorType] = (byType[error.errorType] || 0) + 1;
      byServer[error.serverId] = (byServer[error.serverId] || 0) + 1;
      byModel[error.model] = (byModel[error.model] || 0) + 1;
    }

    // Calculate trend
    const trend = this.calculateErrorTrend(filteredErrors, range);

    // Get recent errors
    const recentErrors = filteredErrors.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);

    return {
      totalErrors: filteredErrors.length,
      byType,
      byServer,
      byModel,
      trend,
      recentErrors,
    };
  }

  /**
   * Calculate error trend
   */
  private calculateErrorTrend(
    errors: typeof this.errorHistory,
    range: TimeRange
  ): 'increasing' | 'decreasing' | 'stable' {
    if (errors.length < 10) {
      return 'stable';
    }

    // Split into two halves
    const mid = (range.start + range.end) / 2;
    const firstHalf = errors.filter(e => e.timestamp < mid).length;
    const secondHalf = errors.filter(e => e.timestamp >= mid).length;

    const ratio = secondHalf / (firstHalf || 1);

    if (ratio > 1.5) {
      return 'increasing';
    }
    if (ratio < 0.5) {
      return 'decreasing';
    }
    return 'stable';
  }

  /**
   * Get capacity planning data
   */
  getCapacityAnalysis(queueDepth = 0, _timeRange: AnalyticsTimeRange = '24h'): CapacityData {
    // Calculate current capacity
    let totalCapacity = 0;
    let usedCapacity = 0;
    const hourlyRequests: number[] = Array.from<number>({ length: 24 }).fill(0);
    const hourlyTimestamps: number[] = [];

    const now = Date.now();
    for (let i = 23; i >= 0; i--) {
      hourlyTimestamps.push(now - i * 3600000);
    }

    for (const [, metrics] of this.metrics.entries()) {
      const window = metrics.windows['1h'];

      // Estimate capacity from throughput and max concurrency
      const serverCapacity = Math.max(4, Math.round(metrics.throughput / 10));
      totalCapacity += serverCapacity;
      usedCapacity += metrics.inFlight;

      // Distribute requests across hours (simplified)
      const hourIndex = Math.floor((window.endTime % 86400000) / 3600000);
      if (hourIndex >= 0 && hourIndex < 24) {
        hourlyRequests[hourIndex] += window.count;
      }
    }

    const availableCapacity = Math.max(0, totalCapacity - usedCapacity);
    const saturation = totalCapacity > 0 ? usedCapacity / totalCapacity : 0;

    // Calculate saturation trend
    const saturationLevels = hourlyRequests.map(reqs => {
      return totalCapacity > 0 ? Math.min(1, reqs / (totalCapacity * 60)) : 0;
    });

    // Predict future saturation using simple linear regression
    const nextHourPrediction = this.predictSaturation(saturationLevels, 1);
    const next24HourPrediction = this.predictSaturation(saturationLevels, 24);

    // Generate recommendations
    const recommendations: string[] = [];

    if (nextHourPrediction.saturation > 0.8) {
      recommendations.push('Scale up within the next hour to handle predicted load increase');
    }
    if (next24HourPrediction.saturation > 0.9) {
      recommendations.push('Add capacity within 24 hours to prevent saturation');
    }
    if (saturation < 0.3 && totalCapacity > 8) {
      recommendations.push('Consider scaling down - current utilization is low');
    }
    if (queueDepth > totalCapacity * 0.5) {
      recommendations.push('Queue depth is high - add capacity or increase processing speed');
    }

    // Find worst performing server
    const serverPerformance = this.getServerPerformance('1h');
    const worstServer = serverPerformance[serverPerformance.length - 1];
    if (worstServer && worstServer.errorRate > 0.05) {
      recommendations.push(
        `Investigate server ${worstServer.id} - high error rate (${(worstServer.errorRate * 100).toFixed(1)}%)`
      );
    }

    return {
      current: {
        totalCapacity,
        usedCapacity,
        availableCapacity,
        queueDepth,
        saturation: Math.round(saturation * 100) / 100,
      },
      forecast: {
        nextHour: {
          predictedSaturation: Math.round(nextHourPrediction.saturation * 100) / 100,
          confidence: Math.round(nextHourPrediction.confidence * 100) / 100,
          recommendation:
            nextHourPrediction.saturation > 0.8
              ? 'scale-up'
              : nextHourPrediction.saturation < 0.3
                ? 'scale-down'
                : 'stable',
        },
        next24Hours: {
          predictedSaturation: Math.round(next24HourPrediction.saturation * 100) / 100,
          confidence: Math.round(next24HourPrediction.confidence * 100) / 100,
          recommendation:
            next24HourPrediction.saturation > 0.8
              ? 'scale-up'
              : next24HourPrediction.saturation < 0.3
                ? 'scale-down'
                : 'stable',
        },
      },
      trends: {
        requestsPerHour: hourlyRequests,
        saturationLevels,
        timestamps: hourlyTimestamps,
      },
      recommendations,
    };
  }

  /**
   * Predict future saturation using simple trend analysis
   */
  private predictSaturation(
    historical: number[],
    hoursAhead: number
  ): { saturation: number; confidence: number } {
    if (historical.length < 2) {
      return { saturation: historical[0] || 0.5, confidence: 0.3 };
    }

    // Simple linear regression
    const n = historical.length;
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += historical[i];
      sumXY += i * historical[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Predict
    const prediction = intercept + slope * (n + hoursAhead);
    const clampedPrediction = Math.max(0, Math.min(1, prediction));

    // Calculate confidence based on variance
    const mean = sumY / n;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      variance += Math.pow(historical[i] - mean, 2);
    }
    variance /= n;
    const confidence = Math.max(0.3, 1 - Math.sqrt(variance));

    return { saturation: clampedPrediction, confidence };
  }

  /**
   * Analyze trends for a specific metric
   */
  analyzeTrend(
    metric: 'latency' | 'errors' | 'throughput',
    serverId?: string,
    model?: string,
    timeRange: AnalyticsTimeRange = '24h'
  ): TrendAnalysis {
    const dataPoints: number[] = [];

    // Collect data points from metrics
    for (const [key, metrics] of this.metrics.entries()) {
      const [sId, ...mParts] = key.split(':');
      const mId = mParts.join(':');

      if (serverId && sId !== serverId) {
        continue;
      }
      if (model && mId !== model) {
        continue;
      }

      const window = this.selectBestWindow(metrics.windows, timeRange);

      let value: number;
      switch (metric) {
        case 'latency':
          value = window.count > 0 ? window.latencySum / window.count : 0;
          break;
        case 'errors':
          value = window.count > 0 ? window.errors / window.count : 0;
          break;
        case 'throughput':
          value = metrics.throughput;
          break;
        default:
          value = 0;
      }

      dataPoints.push(value);
    }

    if (dataPoints.length < 2) {
      return { metric, direction: 'stable', slope: 0, confidence: 0 };
    }

    // Calculate trend using simple regression
    const n = dataPoints.length;
    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += dataPoints[i];
      sumXY += i * dataPoints[i];
      sumX2 += i * i;
    }

    const denominator = n * sumX2 - sumX * sumX;
    const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;
    const avgValue = sumY / n;
    const relativeSlope = avgValue > 0 ? slope / avgValue : 0;

    let direction: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(relativeSlope) < 0.05) {
      direction = 'stable';
    } else if (relativeSlope > 0) {
      direction = 'increasing';
    } else {
      direction = 'decreasing';
    }

    // Calculate confidence based on data volume
    const confidence = Math.min(1, n / 10);

    return { metric, direction, slope, confidence };
  }

  /**
   * Get summary statistics
   * Aggregates across all time windows for a comprehensive 24h view
   */
  getSummary(): {
    totalRequests: number;
    totalErrors: number;
    avgLatency: number;
    uniqueModels: number;
    uniqueServers: number;
    timeRange: string;
  } {
    const serverIds = new Set<string>();
    const modelIds = new Set<string>();
    let totalRequests = 0;
    let totalErrors = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    for (const [key, metrics] of this.metrics.entries()) {
      const [serverId, ...modelParts] = key.split(':');
      const model = modelParts.join(':');
      serverIds.add(serverId);
      modelIds.add(model);

      // Use the 1h window as the single source of truth for summary stats.
      // Windows are nested (1m ⊂ 5m ⊂ 15m ⊂ 1h), so summing them would over-count.
      const window = metrics.windows['1h'];
      totalRequests += window.count;
      totalErrors += window.errors;

      // For latency, weight by request count
      if (window.count > 0) {
        totalLatency += window.latencySum;
        latencyCount += window.count;
      }
    }

    return {
      totalRequests,
      totalErrors,
      avgLatency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      uniqueModels: modelIds.size,
      uniqueServers: serverIds.size,
      timeRange: '1h',
    };
  }

  /**
   * Reset all data (for testing)
   */
  reset(): void {
    this.metrics.clear();
    this.requestHistory = [];
    this.errorHistory = [];
    logger.info('Analytics engine reset');
  }

  // ==========================================
  // Phase 2: SQLite-backed helpers for 7d/30d
  // ==========================================

  /**
   * Whether this time range should be served from SQLite rollups
   * (i.e. > 24h window).
   */
  private isLongRange(timeRange: AnalyticsTimeRange): boolean {
    return timeRange === '7d' || timeRange === '30d';
  }

  /**
   * Get server performance data from hourly/daily rollups.
   * Used for timeRange '7d' and '30d'.
   */
  private getServerPerformanceFromRollups(timeRange: AnalyticsTimeRange): ServerPerformanceData[] {
    const range = this.parseTimeRange(timeRange);
    let store: ReturnType<typeof getMetricsStore>;
    try {
      store = getMetricsStore();
    } catch {
      return [];
    }

    // For 7d use hourly rollups; for 30d use daily rollups (fewer rows)
    const useDaily = timeRange === '30d';

    const serverStats = new Map<
      string,
      {
        requests: number;
        latencySum: number;
        p95Latencies: number[];
        p99Latencies: number[];
        errors: number;
        tpsSum: number;
        tpsCount: number;
      }
    >();

    if (useDaily) {
      const rows = store.getDailyRollups({ startTime: range.start, endTime: range.end });
      for (const row of rows) {
        const sid = row.server_id;
        if (!serverStats.has(sid)) {
          serverStats.set(sid, {
            requests: 0,
            latencySum: 0,
            p95Latencies: [],
            p99Latencies: [],
            errors: 0,
            tpsSum: 0,
            tpsCount: 0,
          });
        }
        const s = serverStats.get(sid)!;
        s.requests += row.total_requests;
        s.latencySum += row.latency_sum;
        s.errors += row.failures;
        if (row.latency_p95 != null) {
          s.p95Latencies.push(row.latency_p95);
        }
        if (row.latency_p99 != null) {
          s.p99Latencies.push(row.latency_p99);
        }
        if (row.avg_tokens_per_second != null) {
          s.tpsSum += row.avg_tokens_per_second * row.total_requests;
          s.tpsCount += row.total_requests;
        }
      }
    } else {
      const rows = store.getHourlyRollups({ startTime: range.start, endTime: range.end });
      for (const row of rows) {
        const sid = row.server_id;
        if (!serverStats.has(sid)) {
          serverStats.set(sid, {
            requests: 0,
            latencySum: 0,
            p95Latencies: [],
            p99Latencies: [],
            errors: 0,
            tpsSum: 0,
            tpsCount: 0,
          });
        }
        const s = serverStats.get(sid)!;
        s.requests += row.total_requests;
        s.latencySum += row.latency_sum;
        s.errors += row.failures;
        if (row.latency_p95 != null) {
          s.p95Latencies.push(row.latency_p95);
        }
        if (row.latency_p99 != null) {
          s.p99Latencies.push(row.latency_p99);
        }
        if (row.avg_tokens_per_second != null) {
          s.tpsSum += row.avg_tokens_per_second * row.total_requests;
          s.tpsCount += row.total_requests;
        }
      }
    }

    const results: ServerPerformanceData[] = [];
    for (const [serverId, s] of serverStats.entries()) {
      const avgLatency = s.requests > 0 ? s.latencySum / s.requests : 0;
      const sortedP95 = [...s.p95Latencies].sort((a, b) => a - b);
      const sortedP99 = [...s.p99Latencies].sort((a, b) => a - b);
      const p95Latency = this.calculatePercentile(sortedP95, 0.95);
      const p99Latency = this.calculatePercentile(sortedP99, 0.99);
      const errorRate = s.requests > 0 ? s.errors / s.requests : 0;
      const throughput = s.tpsCount > 0 ? s.tpsSum / s.tpsCount : 0;
      const utilization = Math.min(1, s.requests / (throughput * 60 + 1));
      const latencyScore = Math.max(0, 100 - avgLatency / 50);
      const successScore = (1 - errorRate) * 100;
      const score = latencyScore * 0.5 + successScore * 0.5;

      results.push({
        id: serverId,
        requests: s.requests,
        avgLatency: Math.round(avgLatency),
        p95Latency: Math.round(p95Latency),
        p99Latency: Math.round(p99Latency),
        errorRate: Math.round(errorRate * 1000) / 1000,
        throughput: Math.round(throughput * 100) / 100,
        utilization: Math.round(utilization * 100) / 100,
        score: Math.round(score),
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Get top models data from hourly/daily rollups.
   * Used for timeRange '7d' and '30d'.
   */
  private getTopModelsFromRollups(limit: number, timeRange: AnalyticsTimeRange): TopModelData[] {
    const range = this.parseTimeRange(timeRange);
    let store: ReturnType<typeof getMetricsStore>;
    try {
      store = getMetricsStore();
    } catch {
      return [];
    }

    const useDaily = timeRange === '30d';
    const modelStats = new Map<string, { requests: number; latencySum: number; errors: number }>();

    if (useDaily) {
      const rows = store.getDailyRollups({ startTime: range.start, endTime: range.end });
      for (const row of rows) {
        if (!modelStats.has(row.model)) {
          modelStats.set(row.model, { requests: 0, latencySum: 0, errors: 0 });
        }
        const s = modelStats.get(row.model)!;
        s.requests += row.total_requests;
        s.latencySum += row.latency_sum;
        s.errors += row.failures;
      }
    } else {
      const rows = store.getHourlyRollups({ startTime: range.start, endTime: range.end });
      for (const row of rows) {
        if (!modelStats.has(row.model)) {
          modelStats.set(row.model, { requests: 0, latencySum: 0, errors: 0 });
        }
        const s = modelStats.get(row.model)!;
        s.requests += row.total_requests;
        s.latencySum += row.latency_sum;
        s.errors += row.failures;
      }
    }

    let totalRequests = 0;
    for (const s of modelStats.values()) {
      totalRequests += s.requests;
    }

    const results: TopModelData[] = [];
    for (const [model, s] of modelStats.entries()) {
      results.push({
        model,
        requests: s.requests,
        percentage: totalRequests > 0 ? (s.requests / totalRequests) * 100 : 0,
        avgLatency: s.requests > 0 ? s.latencySum / s.requests : 0,
        errorRate: s.requests > 0 ? s.errors / s.requests : 0,
      });
    }

    return results.sort((a, b) => b.requests - a.requests).slice(0, limit);
  }

  /**
   * Get error analysis data from the requests table in SQLite.
   * Used for timeRange '7d' and '30d'.
   */
  private getErrorAnalysisFromSQLite(timeRange: AnalyticsTimeRange): ErrorAnalysisData {
    const range = this.parseTimeRange(timeRange);
    let store: ReturnType<typeof getMetricsStore>;
    try {
      store = getMetricsStore();
    } catch {
      return {
        totalErrors: 0,
        byType: {},
        byServer: {},
        byModel: {},
        trend: 'stable',
        recentErrors: [],
      };
    }

    // Fetch failed requests within the time window (cap at 5000 to bound memory)
    const failedRows = store.getRequests({
      success: false,
      startTime: range.start,
      endTime: range.end,
      limit: 5000,
    });

    const byType: Record<string, number> = {};
    const byServer: Record<string, number> = {};
    const byModel: Record<string, number> = {};

    for (const row of failedRows) {
      const et = row.error_type ?? 'unknown';
      byType[et] = (byType[et] ?? 0) + 1;
      byServer[row.server_id] = (byServer[row.server_id] ?? 0) + 1;
      byModel[row.model] = (byModel[row.model] ?? 0) + 1;
    }

    // Trend: compare first-half vs second-half error counts
    const mid = (range.start + range.end) / 2;
    let firstHalf = 0;
    let secondHalf = 0;
    for (const row of failedRows) {
      if (row.timestamp < mid) {
        firstHalf++;
      } else {
        secondHalf++;
      }
    }

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (failedRows.length >= 10) {
      const ratio = secondHalf / (firstHalf || 1);
      if (ratio > 1.5) {
        trend = 'increasing';
      } else if (ratio < 0.5) {
        trend = 'decreasing';
      }
    }

    // Most recent 50 errors
    const recentErrors = [...failedRows]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50)
      .map(row => ({
        timestamp: row.timestamp,
        serverId: row.server_id,
        model: row.model,
        errorType: row.error_type ?? 'unknown',
        message: row.error_message ?? '',
      }));

    return {
      totalErrors: failedRows.length,
      byType,
      byServer,
      byModel,
      trend,
      recentErrors,
    };
  }

  // ==========================================
  // Persistence Methods
  // ==========================================

  /**
   * Start periodic persistence (every 60s)
   */
  private startPersistence(): void {
    this.persistenceTimer = setInterval(() => {
      void this.persist();
    }, this.persistenceIntervalMs);
  }

  /**
   * Persist analytics data to disk (public for explicit flush on shutdown)
   */
  persist(): Promise<void> {
    this.pruneOldData();
    try {
      const data: PersistedAnalyticsData = {
        timestamp: Date.now(),
        requestHistory: this.requestHistory,
        errorHistory: this.errorHistory,
      };
      const success = this.fileHandler.write(data);
      if (!success) {
        logger.error('Failed to persist analytics engine data');
      } else {
        logger.debug('Analytics engine data persisted', {
          requestCount: this.requestHistory.length,
          errorCount: this.errorHistory.length,
        });
      }
    } catch (error) {
      logger.error('Failed to persist analytics engine data:', { error });
    }
    return Promise.resolve();
  }

  /**
   * Load analytics data from disk (called in constructor)
   */
  private loadFromDisk(): void {
    try {
      const data = this.fileHandler.read<PersistedAnalyticsData>();
      if (data) {
        if (Array.isArray(data.requestHistory)) {
          this.requestHistory = data.requestHistory;
        }
        if (Array.isArray(data.errorHistory)) {
          this.errorHistory = data.errorHistory;
        }
        // Prune stale data on load (24h retention)
        this.pruneOldData();
        logger.info('Analytics engine data loaded from disk', {
          requestCount: this.requestHistory.length,
          errorCount: this.errorHistory.length,
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to load analytics engine data:', { error });
      }
    }
  }

  /**
   * Prune data older than retentionMs (24h)
   */
  private pruneOldData(): void {
    const cutoff = Date.now() - this.retentionMs;
    this.requestHistory = this.requestHistory.filter(r => r.startTime >= cutoff);
    this.errorHistory = this.errorHistory.filter(e => e.timestamp >= cutoff);
  }

  /**
   * Stop periodic persistence timer
   */
  stop(): void {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = undefined;
    }
    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = undefined;
    }
  }

  // ==========================================
  // Summary Persistence Methods (REC-33)
  // ==========================================

  /**
   * Start hourly summary snapshot timer
   */
  private startSummaryTimer(): void {
    this.summaryTimer = setInterval(() => {
      this.takeSummarySnapshot();
      void this.persistSummary();
    }, this.summaryIntervalMs);
  }

  /**
   * Take a snapshot of current metrics for long-term trend tracking
   */
  takeSummarySnapshot(): MetricsSummarySnapshot {
    const snapshot: MetricsSummarySnapshot = {
      timestamp: Date.now(),
      servers: {},
    };

    for (const [key, metrics] of this.metrics.entries()) {
      const colonIdx = key.indexOf(':');
      if (colonIdx === -1) {
        continue;
      }
      const serverId = key.slice(0, colonIdx);
      const model = key.slice(colonIdx + 1);

      if (!snapshot.servers[serverId]) {
        snapshot.servers[serverId] = {};
      }

      const window = metrics.windows['1h'];
      const requestCount = window?.count ?? 0;
      const avgLatency = requestCount > 0 ? (window?.latencySum ?? 0) / requestCount : 0;
      const errorRate = requestCount > 0 ? (window?.errors ?? 0) / requestCount : 0;

      snapshot.servers[serverId][model] = {
        avgLatency: Math.round(avgLatency),
        avgTokenThroughput: metrics.avgTokensPerSecond,
        requestCount,
        errorRate: Math.round(errorRate * 1000) / 1000,
      };
    }

    this.summarySnapshots.push(snapshot);
    // Prune old snapshots (30-day retention)
    const cutoff = Date.now() - this.summaryRetentionMs;
    this.summarySnapshots = this.summarySnapshots.filter(s => s.timestamp >= cutoff);

    return snapshot;
  }

  /**
   * Persist summary snapshots to disk
   */
  persistSummary(): Promise<void> {
    try {
      const data: PersistedMetricsSummary = {
        timestamp: Date.now(),
        snapshots: this.summarySnapshots,
      };
      const success = this.summaryFileHandler.write(data);
      if (!success) {
        logger.error('Failed to persist metrics summary');
      } else {
        logger.debug('Metrics summary persisted', { snapshotCount: this.summarySnapshots.length });
      }
    } catch (error) {
      logger.error('Failed to persist metrics summary:', { error });
    }
    return Promise.resolve();
  }

  /**
   * Load summary snapshots from disk
   */
  private loadSummaryFromDisk(): void {
    try {
      const data = this.summaryFileHandler.read<PersistedMetricsSummary>();
      if (data?.snapshots && Array.isArray(data.snapshots)) {
        // Prune stale snapshots on load (30-day retention)
        const cutoff = Date.now() - this.summaryRetentionMs;
        this.summarySnapshots = data.snapshots.filter(s => s.timestamp >= cutoff);
        logger.info('Metrics summary loaded from disk', {
          snapshotCount: this.summarySnapshots.length,
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to load metrics summary:', { error });
      }
    }
  }

  /**
   * Get all summary snapshots (for trend analysis)
   */
  getSummarySnapshots(): MetricsSummarySnapshot[] {
    return [...this.summarySnapshots];
  }

  // ==========================================
  // Decision History Methods
  // ==========================================

  /**
   * Get recent load balancer decision events
   */
  getDecisionEvents(limit = 100, model?: string, serverId?: string): DecisionEvent[] {
    return getDecisionHistory().getRecentEvents(limit, model, serverId);
  }

  /**
   * Get decision trends for a specific server:model
   */
  getServerModelDecisionTrend(serverId: string, model: string, hours = 24): ServerModelTrend {
    return getDecisionHistory().getServerModelTrend(serverId, model, hours);
  }

  /**
   * Get server selection statistics
   */
  getServerSelectionStats(hours = 24): Array<{
    serverId: string;
    totalSelections: number;
    byModel: Record<string, number>;
    avgScore: number;
  }> {
    return getDecisionHistory().getSelectionStats(hours);
  }

  /**
   * Get load balancer algorithm usage statistics
   */
  getAlgorithmStats(hours = 24): Record<string, { count: number; percentage: number }> {
    return getDecisionHistory().getAlgorithmStats(hours);
  }

  /**
   * Get score distribution timeline
   */
  getScoreTimeline(
    hours = 24,
    intervalMinutes = 15
  ): Array<{
    timestamp: number;
    avgScore: number;
    minScore: number;
    maxScore: number;
    serverCount: number;
  }> {
    return getDecisionHistory().getScoreTimeline(hours, intervalMinutes);
  }

  /**
   * Get metrics impact analysis
   */
  getMetricsImpact(hours = 24): {
    latency: { correlation: number; weight: number };
    successRate: { correlation: number; weight: number };
    load: { correlation: number; weight: number };
    capacity: { correlation: number; weight: number };
  } {
    return getDecisionHistory().getMetricsImpact(hours);
  }

  // ==========================================
  // Request History Methods
  // ==========================================

  /**
   * Get request history for a specific server
   */
  getServerRequestHistory(serverId: string, limit = 100, offset = 0): RequestRecord[] {
    return getRequestHistory().getServerHistory(serverId, limit, offset);
  }

  /**
   * Get all requests across all servers
   */
  getAllRequests(limit = 100, offset = 0): RequestRecord[] {
    return getRequestHistory().getAllRequests(limit, offset);
  }

  /**
   * Get request statistics for a server
   */
  getServerRequestStats(serverId: string, hours = 24): RequestStats {
    return getRequestHistory().getServerStats(serverId, hours);
  }

  /**
   * Get request timeline
   */
  getRequestTimeline(
    serverId?: string,
    hours = 24,
    intervalMinutes = 15
  ): Array<{
    timestamp: number;
    count: number;
    successCount: number;
    errorCount: number;
    avgDuration: number;
  }> {
    return getRequestHistory().getRequestTimeline(serverId, hours, intervalMinutes);
  }

  /**
   * Search requests by criteria
   */
  searchRequests(params: {
    serverId?: string;
    model?: string;
    endpoint?: string;
    success?: boolean;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): RequestRecord[] {
    return getRequestHistory().searchRequests(params);
  }

  /**
   * Get error summary for a server
   */
  getServerErrorSummary(
    serverId: string,
    hours = 24
  ): {
    totalErrors: number;
    byType: Record<string, number>;
    recentErrors: RequestRecord[];
  } {
    return getRequestHistory().getErrorSummary(serverId, hours);
  }

  /**
   * Get all server IDs with request history
   */
  getServersWithHistory(): string[] {
    return getRequestHistory().getServerIds();
  }

  /**
   * Get total request count across all servers
   */
  getTotalRequestCount(): number {
    return getRequestHistory().getTotalRequestCount();
  }
}
