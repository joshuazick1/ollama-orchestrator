/**
 * metrics-persistence.ts
 * Persistent storage for metrics data
 */

import path from 'path';

import { JsonFileHandler } from '../config/jsonFileHandler.js';
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
  private fileHandler: JsonFileHandler;
  private retentionHours: number;
  private saveIntervalMs: number;
  private saveTimeout?: NodeJS.Timeout;
  private isDirty = false;

  constructor(options: MetricsPersistenceOptions = {}) {
    const filePath = options.filePath ?? path.join(process.cwd(), 'data', 'metrics.json');
    this.fileHandler = new JsonFileHandler(filePath, {
      createBackups: true,
      maxBackups: 3,
    });
    this.retentionHours = options.retentionHours ?? 24;
    this.saveIntervalMs = options.saveIntervalMs ?? 30000; // 30 seconds
  }

  /**
   * Initialize persistence - ensure directory exists
   */
  initialize(): Promise<void> {
    try {
      // JsonFileHandler constructor already ensures directory exists
      logger.info('Metrics persistence initialized');
      return Promise.resolve();
    } catch (error) {
      logger.error('Failed to initialize metrics persistence:', { error });
      throw error;
    }
  }

  /**
   * Save metrics data to disk
   */
  save(data: MetricsData): Promise<void> {
    try {
      // Clean old data based on retention policy
      const cleanedData = this.cleanOldData(data);

      const success = this.fileHandler.write(cleanedData);

      if (!success) {
        throw new Error('Failed to write metrics data');
      }

      this.isDirty = false;
      logger.debug('Metrics saved to disk');
      return Promise.resolve();
    } catch (error) {
      logger.error('Failed to save metrics:', { error });
      throw error;
    }
  }

  /**
   * Load metrics data from disk
   */
  load(): Promise<MetricsData | null> {
    try {
      const data = this.fileHandler.read<MetricsData>();

      if (!data) {
        logger.info('No existing metrics file found, starting fresh');
        return Promise.resolve(null);
      }

      logger.info('Metrics loaded from disk');
      return Promise.resolve(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No existing metrics file found, starting fresh');
        return Promise.resolve(null);
      }
      logger.error('Failed to load metrics:', { error });
      return Promise.resolve(null);
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
