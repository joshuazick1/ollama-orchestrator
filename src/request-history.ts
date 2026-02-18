/**
 * request-history.ts
 * Per-server request history tracking
 */

import path from 'path';

import { JsonFileHandler } from './config/jsonFileHandler.js';
import type { RequestContext } from './orchestrator.types.js';
import { logger } from './utils/logger.js';

/**
 * Extended request record with additional metadata
 */
export interface RequestRecord {
  id: string;
  timestamp: number;
  serverId: string;
  model: string;
  endpoint: string;
  streaming: boolean;
  duration: number;
  success: boolean;
  tokensGenerated?: number;
  tokensPrompt?: number;
  errorType?: string;
  errorMessage?: string;
  ttft?: number;
  streamingDuration?: number;
  latencyPercentile?: number; // How this request compared to historical (p50, p95, etc.)
  queueWaitTime?: number;
}

/**
 * Request statistics for a time period
 */
export interface RequestStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgDuration: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  avgTokensGenerated: number;
  avgTokensPrompt: number;
  requestsPerMinute: number;
  errorRate: number;
  byModel: Record<
    string,
    {
      count: number;
      avgDuration: number;
      errorRate: number;
    }
  >;
  byEndpoint: Record<
    string,
    {
      count: number;
      avgDuration: number;
      errorRate: number;
    }
  >;
}

/**
 * Configuration for request history tracking
 */
export interface RequestHistoryConfig {
  maxRequestsPerServer: number;
  retentionHours: number;
  enablePersistence: boolean;
  persistenceIntervalMs: number;
}

export const DEFAULT_REQUEST_HISTORY_CONFIG: RequestHistoryConfig = {
  maxRequestsPerServer: 5000,
  retentionHours: 24,
  enablePersistence: true,
  persistenceIntervalMs: 60000,
};

/**
 * Shape of the persisted request history JSON file
 */
interface PersistedRequestHistory {
  timestamp: number;
  requests: Record<string, RequestRecord[]>;
}

/**
 * Tracks per-server request history with detailed metadata
 */
export class RequestHistory {
  private requests: Map<string, RequestRecord[]> = new Map(); // serverId -> requests
  private config: RequestHistoryConfig;
  private persistenceTimer?: NodeJS.Timeout;
  private fileHandler?: JsonFileHandler;

  constructor(config: Partial<RequestHistoryConfig> = {}) {
    this.config = { ...DEFAULT_REQUEST_HISTORY_CONFIG, ...config };

    if (this.config.enablePersistence) {
      const filePath = path.join(process.cwd(), 'data', 'request-history.json');
      this.fileHandler = new JsonFileHandler(filePath, {
        createBackups: true,
        maxBackups: 3,
      });
      this.startPersistence();
    }
  }

  /**
   * Record a request completion
   */
  recordRequest(context: RequestContext, queueWaitTime?: number): RequestRecord {
    const record: RequestRecord = {
      id: context.id,
      timestamp: context.startTime,
      serverId: context.serverId ?? 'unknown',
      model: context.model,
      endpoint: context.endpoint,
      streaming: context.streaming,
      duration: context.duration ?? 0,
      success: context.success,
      tokensGenerated: context.tokensGenerated,
      tokensPrompt: context.tokensPrompt,
      errorType: context.error ? this.classifyError(context.error) : undefined,
      errorMessage: context.error?.message,
      ttft: context.ttft,
      streamingDuration: context.streamingDuration,
      queueWaitTime,
    };

    const serverId = record.serverId;
    if (!this.requests.has(serverId)) {
      this.requests.set(serverId, []);
    }

    const serverRequests = this.requests.get(serverId)!;
    serverRequests.push(record);

    // Prune if exceeded max
    if (serverRequests.length > this.config.maxRequestsPerServer) {
      this.requests.set(serverId, serverRequests.slice(-this.config.maxRequestsPerServer));
    }

    return record;
  }

  /**
   * Get request history for a specific server
   */
  getServerHistory(serverId: string, limit = 100, offset = 0): RequestRecord[] {
    const serverRequests = this.requests.get(serverId) ?? [];
    return serverRequests.slice(-(offset + limit), -offset || undefined).reverse();
  }

  /**
   * Get all requests across all servers
   */
  getAllRequests(limit = 100, offset = 0): RequestRecord[] {
    const allRequests: RequestRecord[] = [];
    for (const requests of this.requests.values()) {
      allRequests.push(...requests);
    }

    // Sort by timestamp descending
    allRequests.sort((a, b) => b.timestamp - a.timestamp);

    return allRequests.slice(offset, offset + limit);
  }

  /**
   * Get request statistics for a server
   */
  getServerStats(serverId: string, hours = 24): RequestStats {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const serverRequests = this.requests.get(serverId) ?? [];
    const recentRequests = serverRequests.filter(r => r.timestamp >= cutoff);

    if (recentRequests.length === 0) {
      return this.createEmptyStats();
    }

    const totalRequests = recentRequests.length;
    const successfulRequests = recentRequests.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;

    const durations = recentRequests.map(r => r.duration);
    const sortedDurations = [...durations].sort((a, b) => a - b);

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const totalTokensGenerated = recentRequests
      .filter(r => r.tokensGenerated)
      .reduce((sum, r) => sum + (r.tokensGenerated ?? 0), 0);
    const totalTokensPrompt = recentRequests
      .filter(r => r.tokensPrompt)
      .reduce((sum, r) => sum + (r.tokensPrompt ?? 0), 0);

    // Group by model
    const byModel: Record<string, { count: number; totalDuration: number; errors: number }> = {};
    const byEndpoint: Record<string, { count: number; totalDuration: number; errors: number }> = {};

    for (const req of recentRequests) {
      if (!byModel[req.model]) {
        byModel[req.model] = { count: 0, totalDuration: 0, errors: 0 };
      }
      byModel[req.model].count++;
      byModel[req.model].totalDuration += req.duration;
      if (!req.success) {
        byModel[req.model].errors++;
      }

      if (!byEndpoint[req.endpoint]) {
        byEndpoint[req.endpoint] = { count: 0, totalDuration: 0, errors: 0 };
      }
      byEndpoint[req.endpoint].count++;
      byEndpoint[req.endpoint].totalDuration += req.duration;
      if (!req.success) {
        byEndpoint[req.endpoint].errors++;
      }
    }

    // Calculate requests per minute
    const timeRange =
      recentRequests[recentRequests.length - 1].timestamp - recentRequests[0].timestamp;
    const requestsPerMinute = timeRange > 0 ? (totalRequests / timeRange) * 60 * 1000 : 0;

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      avgDuration: Math.round((totalDuration / totalRequests) * 100) / 100,
      p50Latency: this.calculatePercentile(sortedDurations, 0.5),
      p95Latency: this.calculatePercentile(sortedDurations, 0.95),
      p99Latency: this.calculatePercentile(sortedDurations, 0.99),
      avgTokensGenerated: Math.round((totalTokensGenerated / totalRequests) * 100) / 100,
      avgTokensPrompt: Math.round((totalTokensPrompt / totalRequests) * 100) / 100,
      requestsPerMinute: Math.round(requestsPerMinute * 100) / 100,
      errorRate: Math.round((failedRequests / totalRequests) * 1000) / 1000,
      byModel: Object.fromEntries(
        Object.entries(byModel).map(([model, data]) => [
          model,
          {
            count: data.count,
            avgDuration: Math.round((data.totalDuration / data.count) * 100) / 100,
            errorRate: Math.round((data.errors / data.count) * 1000) / 1000,
          },
        ])
      ),
      byEndpoint: Object.fromEntries(
        Object.entries(byEndpoint).map(([endpoint, data]) => [
          endpoint,
          {
            count: data.count,
            avgDuration: Math.round((data.totalDuration / data.count) * 100) / 100,
            errorRate: Math.round((data.errors / data.count) * 1000) / 1000,
          },
        ])
      ),
    };
  }

  /**
   * Get timeline of requests over time
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
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const intervalMs = intervalMinutes * 60 * 1000;

    let requests: RequestRecord[];
    if (serverId) {
      requests = (this.requests.get(serverId) ?? []).filter(r => r.timestamp >= cutoff);
    } else {
      requests = [];
      for (const serverRequests of this.requests.values()) {
        requests.push(...serverRequests.filter(r => r.timestamp >= cutoff));
      }
    }

    // Group into buckets
    const buckets = new Map<
      number,
      {
        count: number;
        successCount: number;
        errorCount: number;
        totalDuration: number;
      }
    >();

    for (const req of requests) {
      const bucketTime = Math.floor(req.timestamp / intervalMs) * intervalMs;
      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, {
          count: 0,
          successCount: 0,
          errorCount: 0,
          totalDuration: 0,
        });
      }

      const bucket = buckets.get(bucketTime)!;
      bucket.count++;
      if (req.success) {
        bucket.successCount++;
      } else {
        bucket.errorCount++;
      }
      bucket.totalDuration += req.duration;
    }

    // Convert to result array
    const result: Array<{
      timestamp: number;
      count: number;
      successCount: number;
      errorCount: number;
      avgDuration: number;
    }> = [];

    for (const [timestamp, data] of buckets) {
      result.push({
        timestamp,
        count: data.count,
        successCount: data.successCount,
        errorCount: data.errorCount,
        avgDuration: data.count > 0 ? Math.round((data.totalDuration / data.count) * 100) / 100 : 0,
      });
    }

    return result.sort((a, b) => a.timestamp - b.timestamp);
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
    let results: RequestRecord[] = [];

    if (params.serverId) {
      results = this.requests.get(params.serverId) ?? [];
    } else {
      for (const serverRequests of this.requests.values()) {
        results.push(...serverRequests);
      }
    }

    // Apply filters
    if (params.model) {
      results = results.filter(r => r.model === params.model);
    }
    if (params.endpoint) {
      results = results.filter(r => r.endpoint === params.endpoint);
    }
    if (params.success !== undefined) {
      results = results.filter(r => r.success === params.success);
    }
    if (params.startTime !== undefined) {
      results = results.filter(r => r.timestamp >= params.startTime!);
    }
    if (params.endTime !== undefined) {
      results = results.filter(r => r.timestamp <= params.endTime!);
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);

    const limit = params.limit ?? 100;
    return results.slice(0, limit);
  }

  /**
   * Get error summary for a server
   */
  getErrorSummary(
    serverId: string,
    hours = 24
  ): {
    totalErrors: number;
    byType: Record<string, number>;
    recentErrors: RequestRecord[];
  } {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const serverRequests = this.requests.get(serverId) ?? [];
    const errorRequests = serverRequests.filter(r => !r.success && r.timestamp >= cutoff);

    const byType: Record<string, number> = {};
    for (const req of errorRequests) {
      const type = req.errorType ?? 'unknown';
      byType[type] = (byType[type] ?? 0) + 1;
    }

    return {
      totalErrors: errorRequests.length,
      byType,
      recentErrors: errorRequests.slice(-10).reverse(),
    };
  }

  /**
   * Get all server IDs with history
   */
  getServerIds(): string[] {
    return Array.from(this.requests.keys());
  }

  /**
   * Get total request count across all servers
   */
  getTotalRequestCount(): number {
    let count = 0;
    for (const requests of this.requests.values()) {
      count += requests.length;
    }
    return count;
  }

  /**
   * Clear history for a specific server
   */
  clearServerHistory(serverId: string): void {
    this.requests.delete(serverId);
  }

  /**
   * Clear all history
   */
  clearAllHistory(): void {
    this.requests.clear();
  }

  /**
   * Classify error type
   */
  private classifyError(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) {
      return 'timeout';
    }
    if (message.includes('oom') || message.includes('out of memory')) {
      return 'oom';
    }
    if (message.includes('connection') || message.includes('refused')) {
      return 'connection';
    }
    if (message.includes('model') && message.includes('not found')) {
      return 'model_not_found';
    }
    if (message.includes('circuit breaker')) {
      return 'circuit_breaker';
    }
    if (message.includes('capacity') || message.includes('queue')) {
      return 'capacity';
    }

    return 'unknown';
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) {
      return 0;
    }
    if (sorted.length === 1) {
      return sorted[0];
    }

    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Create empty stats object
   */
  private createEmptyStats(): RequestStats {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgDuration: 0,
      p50Latency: 0,
      p95Latency: 0,
      p99Latency: 0,
      avgTokensGenerated: 0,
      avgTokensPrompt: 0,
      requestsPerMinute: 0,
      errorRate: 0,
      byModel: {},
      byEndpoint: {},
    };
  }

  /**
   * Start periodic persistence
   */
  private startPersistence(): void {
    this.persistenceTimer = setInterval(() => {
      void this.persist();
    }, this.config.persistenceIntervalMs);
  }

  /**
   * Persist requests to storage
   */
  persist(): Promise<void> {
    this.pruneOldRequests();

    if (this.config.enablePersistence) {
      try {
        // Convert Map to object for serialization
        const data = {
          timestamp: Date.now(),
          requests: Object.fromEntries(this.requests),
        };

        const success = this.fileHandler?.write(data);

        if (!success) {
          logger.error('Failed to persist request history');
        } else {
          logger.debug('Request history persisted', { serverCount: this.requests.size });
        }
        return Promise.resolve();
      } catch (error) {
        logger.error('Failed to persist request history:', { error });
        return Promise.resolve();
      }
    }
    return Promise.resolve();
  }

  /**
   * Load persisted request history
   */
  load(): Promise<void> {
    if (!this.config.enablePersistence || !this.fileHandler) {
      return Promise.resolve();
    }

    try {
      const data = this.fileHandler.read<PersistedRequestHistory>();

      if (data?.requests && typeof data.requests === 'object') {
        this.requests = new Map(Object.entries(data.requests));
        logger.info('Request history loaded', { serverCount: this.requests.size });
      }
      return Promise.resolve();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to load request history:', { error });
      }
      return Promise.resolve();
    }
  }

  /**
   * Prune old requests
   */
  private pruneOldRequests(): void {
    const cutoff = Date.now() - this.config.retentionHours * 60 * 60 * 1000;

    for (const [serverId, requests] of this.requests.entries()) {
      const pruned = requests.filter(r => r.timestamp >= cutoff);
      if (pruned.length !== requests.length) {
        this.requests.set(serverId, pruned);
      }
    }
  }

  /**
   * Stop persistence timer
   */
  stop(): void {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
    }
  }
}

// Singleton instance
let requestHistoryInstance: RequestHistory | null = null;

export function getRequestHistory(): RequestHistory {
  if (!requestHistoryInstance) {
    requestHistoryInstance = new RequestHistory();
  }
  return requestHistoryInstance;
}

export function resetRequestHistory(): void {
  requestHistoryInstance = null;
}
