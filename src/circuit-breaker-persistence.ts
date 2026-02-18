/**
 * circuit-breaker-persistence.ts
 * Persistent storage for circuit breaker states
 */

import path from 'path';

import type { CircuitState } from './circuit-breaker.js';
import { JsonFileHandler } from './config/jsonFileHandler.js';
import { logger } from './utils/logger.js';

export interface CircuitBreakerData {
  timestamp: number;
  breakers: Record<
    string,
    {
      state: CircuitState;
      failureCount: number;
      successCount: number;
      totalRequestCount?: number; // Total requests attempted (including blocked)
      blockedRequestCount?: number; // Requests blocked by open circuit breaker
      lastFailure: number;
      lastSuccess: number;
      nextRetryAt: number;
      consecutiveSuccesses: number;
      errorRate: number;
      errorCounts: Record<string, number>;
      halfOpenStartedAt: number; // Timestamp when entered half-open state
      lastFailureReason?: string; // Last failure reason when circuit opened
      modelType?: 'embedding' | 'generation'; // Detected model capability
      lastErrorType?: 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited'; // Last error type
    }
  >;
}

export interface CircuitBreakerPersistenceOptions {
  filePath?: string;
  saveIntervalMs?: number;
}

export class CircuitBreakerPersistence {
  private fileHandler: JsonFileHandler;
  private saveIntervalMs: number;
  private saveTimeout?: NodeJS.Timeout;
  private isDirty = false;

  constructor(options: CircuitBreakerPersistenceOptions = {}) {
    const filePath = options.filePath ?? path.join(process.cwd(), 'data', 'circuit-breakers.json');
    this.fileHandler = new JsonFileHandler(filePath, {
      createBackups: true,
      maxBackups: 3,
    });
    this.saveIntervalMs = options.saveIntervalMs ?? 30000; // 30 seconds
  }

  /**
   * Initialize persistence - ensure directory exists
   */
  async initialize(): Promise<void> {
    try {
      // JsonFileHandler constructor already ensures directory exists
      logger.info('Circuit breaker persistence initialized', {
        filePath: this.fileHandler['filePath'],
      });
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
      const success = this.fileHandler.write(data);

      if (!success) {
        throw new Error('Failed to write circuit breaker data');
      }

      this.isDirty = false;
      logger.debug('Circuit breakers saved to disk', {
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
      const data = this.fileHandler.read<CircuitBreakerData>();

      if (!data) {
        logger.info('No existing circuit breaker file found, starting fresh');
        return null;
      }

      logger.info('Circuit breakers loaded from disk', {
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
