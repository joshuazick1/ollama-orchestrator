/**
 * metrics-persistence.ts
 * Persistent storage for metrics data
 */

import { promises as fs } from 'fs';
import path from 'path';

import type { ServerModelMetrics } from '../orchestrator.types.js';
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
  private filePath: string;
  private retentionHours: number;
  private saveIntervalMs: number;
  private saveTimeout?: NodeJS.Timeout;
  private isDirty = false;

  constructor(options: MetricsPersistenceOptions = {}) {
    this.filePath = options.filePath ?? path.join(process.cwd(), 'data', 'metrics.json');
    this.retentionHours = options.retentionHours ?? 24;
    this.saveIntervalMs = options.saveIntervalMs ?? 30000; // 30 seconds
  }

  /**
   * Initialize persistence - ensure directory exists
   */
  async initialize(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      logger.info('Metrics persistence initialized', { filePath: this.filePath });
    } catch (error) {
      logger.error('Failed to initialize metrics persistence:', { error });
      throw error;
    }
  }

  /**
   * Save metrics data to disk
   */
  async save(data: MetricsData): Promise<void> {
    try {
      // Clean old data based on retention policy
      const cleanedData = this.cleanOldData(data);

      const json = JSON.stringify(cleanedData, null, 2);
      await fs.writeFile(this.filePath, json, 'utf-8');

      this.isDirty = false;
      logger.debug('Metrics saved to disk', { filePath: this.filePath, size: json.length });
    } catch (error) {
      logger.error('Failed to save metrics:', { error });
      throw error;
    }
  }

  /**
   * Load metrics data from disk
   */
  async load(): Promise<MetricsData | null> {
    try {
      const json = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(json) as MetricsData;

      logger.info('Metrics loaded from disk', { filePath: this.filePath });
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No existing metrics file found, starting fresh');
        return null;
      }
      logger.error('Failed to load metrics:', { error });
      return null;
    }
  }

  /**
   * Schedule a save operation (debounced)
   */
  scheduleSave(data: MetricsData): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      void this.save(data);
    }, this.saveIntervalMs);

    this.isDirty = true;
  }

  /**
   * Force immediate save if data is dirty
   */
  async flush(data: MetricsData): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    if (this.isDirty) {
      await this.save(data);
    }
  }

  /**
   * Clean old metrics data based on retention policy
   */
  private cleanOldData(data: MetricsData): MetricsData {
    const cleanedServers: Record<string, ServerModelMetrics> = {};

    for (const [serverModelKey, serverData] of Object.entries(data.servers)) {
      // For now, keep all data. In future, could filter recentLatencies by timestamp
      cleanedServers[serverModelKey] = serverData;
    }

    return {
      ...data,
      servers: cleanedServers,
      timestamp: Date.now(),
    };
  }

  /**
   * Shutdown - ensure final save
   */
  async shutdown(data: MetricsData): Promise<void> {
    await this.flush(data);
  }
}
