/**
 * metrics-persistence.ts
 * Persistent storage for metrics data using SQLite via OperationalStore
 */

import type { ServerModelMetrics } from '../orchestrator/orchestrator.types.js';
import { getOperationalStore } from '../storage/operational-store.js';
import { logger } from '../utils/logger.js';

export interface MetricsData {
  timestamp: number;
  servers: Record<string, ServerModelMetrics>;
}

export interface MetricsPersistenceOptions {
  filePath?: string;
  retentionHours?: number;
  saveIntervalMs?: number;
}

export class MetricsPersistence {
  private retentionHours: number;
  private saveIntervalMs: number;
  private saveTimeout?: NodeJS.Timeout;
  private isDirty = false;

  constructor(options: MetricsPersistenceOptions = {}) {
    this.retentionHours = options.retentionHours ?? 24;
    this.saveIntervalMs = options.saveIntervalMs ?? 30000;
  }

  initialize(): Promise<void> {
    logger.info('Metrics persistence initialized (SQLite backend)');
    return Promise.resolve();
  }

  save(data: MetricsData): Promise<void> {
    try {
      const store = getOperationalStore();
      const cutoff = Date.now() - this.retentionHours * 60 * 60 * 1000;
      for (const [key, metrics] of Object.entries(data.servers)) {
        if (metrics.lastUpdated < cutoff && metrics.inFlight === 0) {
          continue;
        }
        const colonIdx = key.indexOf(':');
        const serverId = colonIdx !== -1 ? key.slice(0, colonIdx) : key;
        const model = colonIdx !== -1 ? key.slice(colonIdx + 1) : key;

        const window1h = metrics.windows?.['1h'];
        const totalRequests = window1h?.count ?? 0;

        store.saveMetricsSnapshot(serverId, model, {
          latencyAvg: metrics.percentiles?.p50 ?? undefined,
          latencyP95: metrics.percentiles?.p95 ?? undefined,
          latencyP99: metrics.percentiles?.p99 ?? undefined,
          successRate: metrics.successRate,
          throughput: metrics.throughput,
          tokensPerSecond: metrics.avgTokensPerSecond,
          inFlight: metrics.inFlight,
          totalRequests,
          parameterSize: metrics.parameterSize,
          family: metrics.family,
          quantization: metrics.quantization,
          lastRequestAt: metrics.lastUpdated,
        });
      }
      this.isDirty = false;
      logger.debug('Metrics saved to SQLite');
      return Promise.resolve();
    } catch (error) {
      logger.error('Failed to save metrics:', { error });
      throw error;
    }
  }

  load(): Promise<MetricsData | null> {
    try {
      const store = getOperationalStore();
      const rows = store.getAllMetricsSnapshots();
      if (rows.length === 0) {
        logger.info('No existing metrics found in SQLite, starting fresh');
        return Promise.resolve(null);
      }

      const servers: Record<string, ServerModelMetrics> = {};
      const now = Date.now();
      for (const row of rows) {
        const key = `${row.serverId}:${row.model}`;
        const baseMetrics: ServerModelMetrics = {
          serverId: row.serverId,
          model: row.model,
          inFlight: row.inFlight ?? 0,
          queued: 0,
          windows: {
            '1m': {
              startTime: now,
              endTime: now,
              count: 0,
              userRequests: 0,
              latencySum: 0,
              latencySquaredSum: 0,
              minLatency: 0,
              maxLatency: 0,
              errors: 0,
              tokensGenerated: 0,
              tokensPrompt: 0,
            },
            '5m': {
              startTime: now,
              endTime: now,
              count: 0,
              userRequests: 0,
              latencySum: 0,
              latencySquaredSum: 0,
              minLatency: 0,
              maxLatency: 0,
              errors: 0,
              tokensGenerated: 0,
              tokensPrompt: 0,
            },
            '15m': {
              startTime: now,
              endTime: now,
              count: 0,
              userRequests: 0,
              latencySum: 0,
              latencySquaredSum: 0,
              minLatency: 0,
              maxLatency: 0,
              errors: 0,
              tokensGenerated: 0,
              tokensPrompt: 0,
            },
            '1h': {
              startTime: now,
              endTime: now,
              count: row.totalRequests ?? 0,
              userRequests: 0,
              latencySum: 0,
              latencySquaredSum: 0,
              minLatency: 0,
              maxLatency: 0,
              errors: row.recentErrors ?? 0,
              tokensGenerated: 0,
              tokensPrompt: 0,
            },
            '24h': {
              startTime: now,
              endTime: now,
              count: 0,
              userRequests: 0,
              latencySum: 0,
              latencySquaredSum: 0,
              minLatency: 0,
              maxLatency: 0,
              errors: 0,
              tokensGenerated: 0,
              tokensPrompt: 0,
            },
          },
          percentiles: {
            p50: row.latencyAvg ?? 0,
            p95: row.latencyP95 ?? 0,
            p99: row.latencyP99 ?? 0,
          },
          successRate: row.successRate ?? 1,
          throughput: row.throughput ?? 0,
          avgTokensPerRequest: 0,
          avgPromptTokens: 0,
          avgTokensPerSecond: row.tokensPerSecond ?? 0,
          coldStartCount: 0,
          parameterSize: row.parameterSize ?? undefined,
          family: row.family ?? undefined,
          quantization: row.quantization ?? undefined,
          lastUpdated: row.lastRequestAt ?? row.updatedAt,
          recentLatencies: [],
        };
        servers[key] = baseMetrics;
      }

      logger.info('Metrics loaded from SQLite', { count: rows.length });
      return Promise.resolve({ timestamp: Date.now(), servers });
    } catch (error) {
      logger.error('Failed to load metrics:', { error });
      return Promise.resolve(null);
    }
  }

  scheduleSave(data: MetricsData): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      void this.save(data);
    }, this.saveIntervalMs);

    this.isDirty = true;
  }

  async flush(data: MetricsData): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    if (this.isDirty) {
      await this.save(data);
    }
  }

  async shutdown(data: MetricsData): Promise<void> {
    await this.flush(data);
  }
}
