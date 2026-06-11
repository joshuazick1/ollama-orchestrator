/**
 * error-event-store.ts
 * File-based error event persistence with daily rotation.
 *
 * Stores error events as NDJSON (one JSON object per line) in daily files.
 * Directory: ./data/error-events/
 * File naming: error-events-YYYY-MM-DD.json
 */

import fs from 'fs';
import path from 'path';

import type { ErrorEvent, ErrorQueryFilters } from '../types/error-event.js';
import { isObject, safeJsonParse } from '../utils/json-utils.js';
import { logger } from '../utils/logger.js';

import { NdjsonFileStore } from './json-file-store.js';

const DEFAULT_ERROR_EVENTS_DIR = './data/error-events';

/**
 * ErrorEventStore - File-based persistence for error events.
 *
 * Provides daily rotation with NDJSON format for error event storage.
 */
export class ErrorEventStore extends NdjsonFileStore<ErrorEvent> {
  private baseDir: string;

  constructor(baseDir: string = DEFAULT_ERROR_EVENTS_DIR) {
    super();
    this.baseDir = baseDir;
  }

  protected getFilePath(): string {
    return path.join(this.baseDir, 'error-events.json');
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Record a single error event by appending it to the daily file.
   */
  async recordError(event: ErrorEvent): Promise<void> {
    await this.ensureDirectory();
    const filePath = this.getDailyFilePath(new Date(event.timestamp));
    const line = JSON.stringify(event) + '\n';

    return new Promise((resolve, reject) => {
      fs.appendFile(filePath, line, 'utf8', err => {
        if (err) {
          logger.error('[ErrorEventStore] Failed to record error event', { error: err, event });
          reject(err);
        } else {
          logger.debug('[ErrorEventStore] Recorded error event', { id: event.id, filePath });
          resolve();
        }
      });
    });
  }

  /**
   * Query error events from files based on filters.
   * Basic implementation - reads relevant daily files and filters in memory.
   */
  async queryErrors(filters: ErrorQueryFilters = {}): Promise<ErrorEvent[]> {
    const results: ErrorEvent[] = [];
    const limit = filters.limit ?? 100;

    // Determine date range to search
    const datesToSearch = this.getDatesToSearch(filters.startTime, filters.endTime);

    for (const dateStr of datesToSearch) {
      const filePath = this.getDailyFilePath(new Date(dateStr));

      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        const events = await this.readEventsFromFile(filePath);

        for (const event of events) {
          if (this.matchesFilters(event, filters)) {
            results.push(event);
            if (results.length >= limit) {
              return results;
            }
          }
        }
      } catch (err) {
        logger.warn('[ErrorEventStore] Failed to read error file', { filePath, error: err });
        // Continue with other files
      }
    }

    return results;
  }

  /**
   * Get the file path for a given date.
   */
  getDailyFilePath(date: Date): string {
    const dateStr = date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    return path.join(this.baseDir, `error-events-${dateStr}.json`);
  }

  /**
   * Ensure the error events directory exists.
   */
  async ensureDirectory(): Promise<void> {
    const resolvedPath = path.resolve(this.baseDir);

    if (!fs.existsSync(resolvedPath)) {
      return new Promise((resolve, reject) => {
        fs.mkdir(resolvedPath, { recursive: true }, err => {
          if (err) {
            logger.error('[ErrorEventStore] Failed to create directory', {
              error: err,
              path: resolvedPath,
            });
            reject(err);
          } else {
            logger.debug('[ErrorEventStore] Created directory', { path: resolvedPath });
            resolve();
          }
        });
      });
    }
  }

  // ============================================================
  // Internal Helpers
  // ============================================================

  /**
   * Read all events from a single NDJSON file.
   */
  private readEventsFromFile(filePath: string): Promise<ErrorEvent[]> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf8', (err, content) => {
        if (err) {
          reject(err);
          return;
        }

        const events: ErrorEvent[] = [];
        const lines = content.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          const parsed = safeJsonParse(
            line,
            (v): v is ErrorEvent => isObject(v) && 'id' in v && 'timestamp' in v,
            null,
            'error-event'
          );
          if (parsed !== null) {
            events.push(parsed);
          }
        }

        resolve(events);
      });
    });
  }

  /**
   * Determine which dates to search based on time filters.
   */
  private getDatesToSearch(startTime?: string, endTime?: string): string[] {
    const dates: Set<string> = new Set();

    const start = startTime ? new Date(startTime) : new Date(Date.now() - 86400000);
    const end = endTime ? new Date(endTime) : startTime ? new Date('2100-01-01') : new Date();

    const current = new Date(start);
    current.setUTCHours(0, 0, 0, 0);

    while (current <= end) {
      dates.add(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }

    return Array.from(dates);
  }

  /**
   * Check if an event matches the given filters.
   */
  private matchesFilters(event: ErrorEvent, filters: ErrorQueryFilters): boolean {
    if (filters.serverId !== undefined && event.serverId !== filters.serverId) {
      return false;
    }
    if (filters.circuitId !== undefined && event.circuitId !== filters.circuitId) {
      return false;
    }
    if (filters.errorType !== undefined && event.errorType !== filters.errorType) {
      return false;
    }
    if (filters.startTime !== undefined && event.timestamp < filters.startTime) {
      return false;
    }
    if (filters.endTime !== undefined && event.timestamp > filters.endTime) {
      return false;
    }
    return true;
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance: ErrorEventStore | undefined;

export function getErrorEventStore(baseDir?: string): ErrorEventStore {
  if (!_instance) {
    _instance = new ErrorEventStore(baseDir);
  }
  return _instance;
}

/** Reset the singleton (used in tests) */
export function resetErrorEventStore(): void {
  _instance = undefined;
}
