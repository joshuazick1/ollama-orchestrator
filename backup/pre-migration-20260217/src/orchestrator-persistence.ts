/**
 * orchestrator-persistence.ts
 * Server registration persistence utilities
 */

import { serversConfig, bansConfig, timeoutsConfig } from './config/configManager.js';
import type { AIServer } from './orchestrator.types.js';
import { logger } from './utils/logger.js';

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
 */
export function loadServersFromDisk(): AIServer[] {
  try {
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
  } catch (err) {
    logger.error('Exception while loading servers:', { error: err });
    return [];
  }
}

/**
 * Load bans from disk
 */
export function loadBansFromDisk(): Set<string> {
  try {
    const bans = bansConfig.get();
    if (bans && Array.isArray(bans)) {
      logger.info(`Loaded ${bans.length} bans from disk`);
      return new Set(bans);
    } else {
      logger.warn('No valid bans found on disk, returning empty set');
      return new Set();
    }
  } catch (err) {
    logger.error('Exception while loading bans:', { error: err });
    return new Set();
  }
}

/**
 * Save timeouts to disk
 */
export function saveTimeoutsToDisk(timeouts: Record<string, number>): void {
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

/**
 * Load timeouts from disk
 */
export function loadTimeoutsFromDisk(): Record<string, number> {
  try {
    const filePath = timeoutsConfig.getPath();
    logger.debug(`Loading timeouts from disk at ${filePath}...`);
    const timeouts = timeoutsConfig.get();
    if (timeouts && typeof timeouts === 'object') {
      logger.debug(`Successfully loaded ${Object.keys(timeouts).length} timeouts from disk`);
      return timeouts;
    } else {
      logger.debug(`No valid timeouts found on disk at ${filePath}, returning empty object`);
      return {};
    }
  } catch (err) {
    logger.error('Exception while loading timeouts:', { error: err });
    return {};
  }
}
