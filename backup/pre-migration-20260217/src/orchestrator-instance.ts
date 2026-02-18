/**
 * orchestrator-instance.ts
 * Singleton orchestrator instance management with auto-persistence
 */

import { getConfigManager } from './config/config.js';
import { getDecisionHistory } from './decision-history.js';
import {
  loadServersFromDisk,
  loadBansFromDisk,
  saveServersToDisk,
} from './orchestrator-persistence.js';
import { AIOrchestrator } from './orchestrator.js';
import type { AIServer } from './orchestrator.types.js';
import { getRequestHistory } from './request-history.js';
import { logger } from './utils/logger.js';
import { normalizeServerUrl } from './utils/urlUtils.js';

// Singleton instance
let orchestrator: AIOrchestrator | null = null;

/**
 * Deduplicate servers by normalized URL
 * Keeps the first occurrence of each unique URL (after normalization)
 * Also normalizes the URL in the returned servers
 */
function deduplicateServersByUrl(servers: AIServer[]): {
  deduplicatedServers: AIServer[];
  duplicatesRemoved: number;
} {
  const seenUrls = new Map<string, string>(); // normalized URL -> original server id
  const deduplicatedServers: AIServer[] = [];
  let duplicatesRemoved = 0;

  for (const server of servers) {
    const normalizedUrl = normalizeServerUrl(server.url);

    if (seenUrls.has(normalizedUrl)) {
      const existingServerId = seenUrls.get(normalizedUrl);
      logger.warn(
        `Duplicate URL detected: Server '${server.id}' has same URL as '${existingServerId}' ` +
          `(${server.url} -> ${normalizedUrl}). Removing duplicate.`
      );
      duplicatesRemoved++;
    } else {
      seenUrls.set(normalizedUrl, server.id);
      // Store server with normalized URL
      deduplicatedServers.push({
        ...server,
        url: normalizedUrl,
      });
    }
  }

  return { deduplicatedServers, duplicatesRemoved };
}

/**
 * Get the singleton orchestrator instance
 * Creates instance if needed and loads persisted data
 */
export function getOrchestratorInstance(): AIOrchestrator {
  if (!orchestrator) {
    const configManager = getConfigManager();
    const config = configManager.getConfig();
    orchestrator = new AIOrchestrator(
      config.loadBalancer,
      config.queue,
      config.circuitBreaker,
      config.healthCheck
    );

    // Load persisted servers and bans synchronously
    if (config.enablePersistence) {
      try {
        // Force reload from disk to ensure fresh data (bypass any caching)
        const persistedServers = loadServersFromDisk();
        const persistedBans = loadBansFromDisk();

        logger.info(
          `Persistence loading: Found ${persistedServers.length} servers in ${config.persistencePath}/servers.json`
        );

        // Migrate: deduplicate servers by normalized URL
        const { deduplicatedServers, duplicatesRemoved } =
          deduplicateServersByUrl(persistedServers);
        if (duplicatesRemoved > 0) {
          logger.warn(
            `Migration: Removed ${duplicatesRemoved} duplicate servers with equivalent URLs`
          );
          // Save the deduplicated list back to disk
          saveServersToDisk(deduplicatedServers);
        }

        // Load servers (using deduplicated list)
        for (const server of deduplicatedServers) {
          // Only add if not already present
          if (!orchestrator.getServer(server.id)) {
            orchestrator.addServer({
              id: server.id,
              url: server.url,
              type: server.type,
              maxConcurrency: server.maxConcurrency,
            });
            // Update server state from persisted data
            const addedServer = orchestrator.getServer(server.id);
            if (addedServer) {
              addedServer.healthy = server.healthy;
              addedServer.models = server.models;
              addedServer.lastResponseTime = server.lastResponseTime;
              if (server.supportsOllama !== undefined) {
                addedServer.supportsOllama = server.supportsOllama;
              }
              if (server.supportsV1 !== undefined) {
                addedServer.supportsV1 = server.supportsV1;
              }
              if (server.v1Models !== undefined) {
                addedServer.v1Models = server.v1Models;
              }
              if (server.apiKey !== undefined) {
                addedServer.apiKey = server.apiKey;
              }
            }
          }
        }

        // Load bans
        orchestrator.loadBans(persistedBans);

        // Load decision and request history from disk (async but don't block startup)
        void getDecisionHistory()
          .load()
          .then(() => getRequestHistory().load())
          .then(() => {
            logger.info('Loaded decision and request history from persistence');
          })
          .catch((error: unknown) => {
            logger.warn('Failed to load decision/request history from persistence:', { error });
          });

        logger.info(
          `Loaded ${deduplicatedServers.length} servers and ${persistedBans.size} bans from persistence`
        );
      } catch (error) {
        logger.error('Failed to load persisted data:', { error });
      }
    }

    // Initialize metrics aggregator persistence (async in background)
    orchestrator.initialize().catch((error: unknown) => {
      logger.error('Failed to initialize metrics persistence:', { error });
    });

    // Start health check scheduler
    // Note: scheduler is started in initialize() method
  }

  return orchestrator;
}

/**
 * Reset the orchestrator singleton (for testing)
 */
export function resetOrchestratorInstance(): void {
  orchestrator = null;
  logger.info('Orchestrator instance reset');
}

/**
 * Check if instance exists
 */
export function hasOrchestratorInstance(): boolean {
  return orchestrator !== null;
}

export default getOrchestratorInstance;
