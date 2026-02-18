/**
 * circuit-breaker-persistence.ts
 * Persistent storage for circuit breaker states
 */

import { promises as fs } from 'fs';
import path from 'path';

import type { CircuitState } from './circuit-breaker.js';
import { logger } from './utils/logger.js';

export interface CircuitBreakerData {
  timestamp: number;
  breakers: Record<
    string,
    {
      state: CircuitState;
      failureCount: number;
      successCount: number;
      lastFailure: number;
      lastSuccess: number;
      nextRetryAt: number;
      consecutiveSuccesses: number;
      errorRate: number;
      errorCounts: Record<string, number>;
      halfOpenStartedAt: number; // Timestamp when entered half-open state
      lastFailureReason?: string; // Last failure reason when circuit opened
      modelType?: 'embedding' | 'generation'; // Detected model capability
      lastErrorType?: 'retryable' | 'non-retryable' | 'transient' | 'permanent'; // Last error type
    }
  >;
}

export interface CircuitBreakerPersistenceOptions {
  filePath?: string;
  saveIntervalMs?: number;
}

export class CircuitBreakerPersistence {
  private filePath: string;
  private saveIntervalMs: number;
  private saveTimeout?: NodeJS.Timeout;
  private isDirty = false;

  constructor(options: CircuitBreakerPersistenceOptions = {}) {
    this.filePath = options.filePath ?? path.join(process.cwd(), 'data', 'circuit-breakers.json');
    this.saveIntervalMs = options.saveIntervalMs ?? 30000; // 30 seconds
  }

  /**
   * Initialize persistence - ensure directory exists
   */
  async initialize(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      logger.info('Circuit breaker persistence initialized', { filePath: this.filePath });
    } catch (error) {
      logger.error('Failed to initialize circuit breaker persistence:', { error });
      throw error;
    }
  }

  /**
   * Save circuit breaker data to disk
   */
  async save(data: CircuitBreakerData): Promise<void> {
    try {
      const json = JSON.stringify(data, null, 2);
      await fs.writeFile(this.filePath, json, 'utf-8');

      this.isDirty = false;
      logger.debug('Circuit breakers saved to disk', {
        filePath: this.filePath,
        count: Object.keys(data.breakers).length,
      });
    } catch (error) {
      logger.error('Failed to save circuit breakers:', { error });
      throw error;
    }
  }

  /**
   * Load circuit breaker data from disk
   */
  async load(): Promise<CircuitBreakerData | null> {
    try {
      const json = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(json) as CircuitBreakerData;

      logger.info('Circuit breakers loaded from disk', {
        filePath: this.filePath,
        count: Object.keys(data.breakers).length,
      });
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No existing circuit breaker file found, starting fresh');
        return null;
      }
      logger.error('Failed to load circuit breakers:', { error });
      return null;
    }
  }

  /**
   * Schedule a save operation (debounced)
   */
  scheduleSave(data: CircuitBreakerData): void {
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
  async flush(data: CircuitBreakerData): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    if (this.isDirty) {
      await this.save(data);
    }
  }

  /**
   * Shutdown - ensure final save
   */
  async shutdown(data: CircuitBreakerData): Promise<void> {
    await this.flush(data);
  }
}
