/**
 * circuit-breaker-persistence.ts
 * Persistent storage for circuit breaker states using SQLite via OperationalStore
 */

import { getOperationalStore } from '../storage/operational-store.js';
import { logger } from '../utils/logger.js';

import type { CircuitState } from './circuit-breaker.js';

export interface CircuitBreakerData {
  timestamp: number;
  breakers: Record<
    string,
    {
      state: CircuitState;
      failureCount: number;
      successCount: number;
      totalRequestCount?: number;
      blockedRequestCount?: number;
      lastFailure: number;
      lastSuccess: number;
      nextRetryAt: number;
      consecutiveSuccesses: number;
      errorRate: number;
      errorCounts: Record<string, number>;
      halfOpenStartedAt: number;
      lastFailureReason?: string;
      modelType?: 'embedding' | 'generation';
      lastErrorType?: 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited';
      consecutiveFailedRecoveries?: number;
      halfOpenAttempts?: number;
    }
  >;
}

export interface CircuitBreakerPersistenceOptions {
  filePath?: string;
  saveIntervalMs?: number;
}

export class CircuitBreakerPersistence {
  private saveIntervalMs: number;
  private saveTimeout?: NodeJS.Timeout;
  private isDirty = false;

  constructor(options: CircuitBreakerPersistenceOptions = {}) {
    this.saveIntervalMs = options.saveIntervalMs ?? 30000;
  }

  initialize(): Promise<void> {
    logger.info('Circuit breaker persistence initialized (SQLite backend)');
    return Promise.resolve();
  }

  save(data: CircuitBreakerData): Promise<void> {
    try {
      const store = getOperationalStore();
      for (const [key, breaker] of Object.entries(data.breakers)) {
        const colonIdx = key.indexOf(':');
        const serverId = colonIdx !== -1 ? key.slice(0, colonIdx) : key;
        const model = colonIdx !== -1 ? key.slice(colonIdx + 1) : key;
        store.saveCircuitBreakerState(serverId, model, {
          state: breaker.state,
          failureCount: breaker.failureCount,
          successCount: breaker.successCount,
          lastFailureAt: breaker.lastFailure || undefined,
          lastSuccessAt: breaker.lastSuccess || undefined,
          nextRetryAt: breaker.nextRetryAt || undefined,
          consecutiveFailedRecoveries: breaker.consecutiveFailedRecoveries,
          halfOpenAttempts: breaker.halfOpenAttempts,
        });
      }
      this.isDirty = false;
      logger.debug('Circuit breakers saved to SQLite', {
        count: Object.keys(data.breakers).length,
      });
      return Promise.resolve();
    } catch (error) {
      logger.error('Failed to save circuit breakers:', { error });
      throw error;
    }
  }

  load(): Promise<CircuitBreakerData | null> {
    try {
      const store = getOperationalStore();
      const rows = store.getAllCircuitBreakerStates();
      if (rows.length === 0) {
        logger.info('No existing circuit breaker state found in SQLite, starting fresh');
        return Promise.resolve(null);
      }

      const breakers: CircuitBreakerData['breakers'] = {};
      for (const row of rows) {
        const key = `${row.serverId}:${row.model}`;
        breakers[key] = {
          state: row.state as CircuitState,
          failureCount: row.failureCount,
          successCount: row.successCount,
          lastFailure: row.lastFailureAt ?? 0,
          lastSuccess: row.lastSuccessAt ?? 0,
          nextRetryAt: row.nextRetryAt ?? 0,
          consecutiveSuccesses: 0,
          errorRate: 0,
          errorCounts: {},
          halfOpenStartedAt: 0,
          consecutiveFailedRecoveries: row.consecutiveFailedRecoveries ?? 0,
          halfOpenAttempts: row.halfOpenAttempts ?? 0,
        };
      }

      logger.info('Circuit breakers loaded from SQLite', { count: rows.length });
      return Promise.resolve({ timestamp: Date.now(), breakers });
    } catch (error) {
      logger.error('Failed to load circuit breakers:', { error });
      return Promise.resolve(null);
    }
  }

  scheduleSave(data: CircuitBreakerData): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      void this.save(data);
    }, this.saveIntervalMs);

    this.isDirty = true;
  }

  async flush(data: CircuitBreakerData): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    if (this.isDirty) {
      await this.save(data);
    }
  }

  async shutdown(data: CircuitBreakerData): Promise<void> {
    await this.flush(data);
  }
}
