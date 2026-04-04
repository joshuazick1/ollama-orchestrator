/**
 * orchestrator-persistence.ts
 * Server registration persistence utilities
 */

import { serversConfig, bansConfig, timeoutsConfig } from '../config/config-manager.js';
import { logger } from '../utils/logger.js';
import type { TimeoutState } from '../utils/timeout-manager.js';

import type { AIServer } from './orchestrator.types.js';

/**
 * Save servers to disk
 */
export function saveServersToDisk(servers: AIServer[]): void {
  try {
    logger.info(`Saving ${servers.length} servers to disk at ${serversConfig.getPath()}...`);
    const success = serversConfig.set(servers);
    if (!success) {
      logger.error('Failed to save servers to disk - configManager.set() returned false');
    } else {
      logger.info(`Successfully saved ${servers.length} servers to disk`);
    }
  } catch (err) {
    logger.error('Exception while saving servers:', { error: err });
  }
}

/**
 * Save bans to disk
 */
export function saveBansToDisk(bans: Set<string>): void {
  try {
    const bansArray = Array.from(bans);
    const success = bansConfig.set(bansArray);
    if (!success) {
      logger.error('Failed to save bans to disk');
    } else {
      logger.debug(`Saved ${bansArray.length} bans to disk`);
    }
  } catch (err) {
    logger.error('Exception while saving bans:', { error: err });
  }
}

/**
 * Load servers from disk
 * @throws {Error} if the data file exists but cannot be read or parsed
 */
export function loadServersFromDisk(): AIServer[] {
  const filePath = serversConfig.getPath();
  logger.info(`Loading servers from disk at ${filePath}...`);
  const servers = serversConfig.get();
  if (servers && Array.isArray(servers)) {
    logger.info(`Successfully loaded ${servers.length} servers from disk`);
    return servers;
  } else {
    logger.warn(`No valid servers found on disk at ${filePath}, returning empty array`);
    return [];
  }
}

/**
 * Load bans from disk
 * @throws {Error} if the data file exists but cannot be read or parsed
 */
export function loadBansFromDisk(): Set<string> {
  const bans = bansConfig.get();
  if (bans && Array.isArray(bans)) {
    logger.info(`Loaded ${bans.length} bans from disk`);
    return new Set(bans);
  } else {
    logger.warn('No valid bans found on disk, returning empty set');
    return new Set();
  }
}

/**
 * Save timeouts to disk
 */
export function saveTimeoutsToDisk(timeouts: Record<string, TimeoutState>): void {
  try {
    logger.debug(
      `Saving ${Object.keys(timeouts).length} timeouts to disk at ${timeoutsConfig.getPath()}...`
    );
    const success = timeoutsConfig.set(timeouts);
    if (!success) {
      logger.error('Failed to save timeouts to disk - configManager.set() returned false');
    } else {
      logger.debug(`Successfully saved ${Object.keys(timeouts).length} timeouts to disk`);
    }
  } catch (err) {
    logger.error('Exception while saving timeouts:', { error: err });
  }
}

export function loadTimeoutsFromDisk(defaultTimeout: number): Record<string, TimeoutState> {
  const filePath = timeoutsConfig.getPath();
  logger.debug(`Loading timeouts from disk at ${filePath}...`);
  const raw = timeoutsConfig.get();
  if (!raw || typeof raw !== 'object') {
    logger.debug(`No valid timeouts found on disk at ${filePath}, returning empty object`);
    return {};
  }

  const result: Record<string, TimeoutState> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number') {
      result[key] = {
        baseTimeout: defaultTimeout,
        currentTimeout: value,
        lastUpdated: Date.now(),
      };
    } else if (
      value !== null &&
      typeof value === 'object' &&
      'currentTimeout' in value &&
      typeof (value as Record<string, unknown>).currentTimeout === 'number'
    ) {
      const v = value as Partial<TimeoutState>;
      result[key] = {
        baseTimeout: typeof v.baseTimeout === 'number' ? v.baseTimeout : defaultTimeout,
        currentTimeout: v.currentTimeout as number,
        lastUpdated: typeof v.lastUpdated === 'number' ? v.lastUpdated : Date.now(),
      };
    }
  }

  logger.debug(`Successfully loaded ${Object.keys(result).length} timeouts from disk`);
  return result;
}
