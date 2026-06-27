/**
 * orchestrator-persistence.ts
 * Server registration persistence utilities
 */

import { serversConfig } from '../config/config-manager.js';
import { getOperationalStore } from '../storage/operational-store.js';
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
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
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
export function saveBansToDisk(_bans: Set<string>): void {
  logger.debug('Bans are now persisted in SQLite via OperationalStore — saveBansToDisk is a no-op');
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
  const activeBans = getOperationalStore().getActiveBans();
  const banSet = new Set(activeBans.map(b => `${b.serverId}:${b.model}`));
  logger.info(`Loaded ${banSet.size} active bans from SQLite`);
  return banSet;
}

/**
 * Save timeouts to disk
 */
export function saveTimeoutsToDisk(timeouts: Record<string, TimeoutState>): void {
  try {
    const store = getOperationalStore();
    for (const [key, state] of Object.entries(timeouts)) {
      store.saveTimeout(key, state);
    }
    logger.debug(`Saved ${Object.keys(timeouts).length} timeouts to SQLite`);
  } catch (err) {
    logger.error('Exception while saving timeouts:', { error: err });
  }
}

export function loadTimeoutsFromDisk(defaultTimeout: number): Record<string, TimeoutState> {
  logger.debug('Loading timeouts from SQLite...');
  const raw = getOperationalStore().getAllTimeouts();

  const result: Record<string, TimeoutState> = {};
  for (const [key, state] of Object.entries(raw)) {
    result[key] = {
      baseTimeout: typeof state.baseTimeout === 'number' ? state.baseTimeout : defaultTimeout,
      currentTimeout: state.currentTimeout,
      lastUpdated: typeof state.lastUpdated === 'number' ? state.lastUpdated : Date.now(),
    };
  }

  logger.debug(`Successfully loaded ${Object.keys(result).length} timeouts from SQLite`);
  return result;
}
