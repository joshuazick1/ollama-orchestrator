/**
 * persistence.ts
 * Orchestrator Persistence - Centralized persistence management
 */

import { logger } from '../utils/logger.js';
import type { TimeoutState } from '../utils/timeout-manager.js';

import { AIOrchestrator, type RoutingContext } from './orchestrator.js';
import type { AIServer } from './orchestrator.types.js';
import { getOperationalStore } from '../storage/operational-store.js';
import type { ProbeState } from '../probe/types.js';

/**
 * Re-export helpers from orchestrator-persistence.ts for backwards compatibility
 * These are pure functions that don't need orchestrator state
 */
export {
  saveServersToDisk,
  saveTimeoutsToDisk,
  loadTimeoutsFromDisk,
} from './orchestrator-persistence.js';

/**
 * Load servers from disk
 * @throws {Error} if the data file exists but cannot be read or parsed
 */
export { loadServersFromDisk } from './orchestrator-persistence.js';

/**
 * OrchestratorPersistence - Handles all persistence-related operations for the orchestrator
 * Consolidates server persistence, timeout persistence, and routing context population.
 * Note: Circuit breaker state is now persisted via the probe subsystem's WAL (Write-Ahead Log).
 */
export class OrchestratorPersistence {
  constructor(private readonly orchestrator: AIOrchestrator) {}

  /**
   * Save servers to disk
   */
  saveServersToDisk(servers: AIServer[]): void {
    try {
      const _config = (this.orchestrator as unknown as { config: { persistencePath?: string } })
        .config;
      // Use serversConfig directly like the original helper
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { serversConfig } = require('../config/config-manager.js');
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
   * Load timeouts from disk
   */
  loadTimeoutsFromDisk(defaultTimeout: number): Record<string, TimeoutState> {
    logger.debug('Loading timeouts from SQLite...');
    const raw = getOperationalStore().getAllTimeouts();

    const result: Record<string, TimeoutState> = {};
    for (const [key, state] of Object.entries(raw)) {
      const s = state as TimeoutState;
      result[key] = {
        baseTimeout: typeof s.baseTimeout === 'number' ? s.baseTimeout : defaultTimeout,
        currentTimeout: s.currentTimeout,
        lastUpdated: typeof s.lastUpdated === 'number' ? s.lastUpdated : Date.now(),
      };
    }

    logger.debug(`Successfully loaded ${Object.keys(result).length} timeouts from SQLite`);
    return result;
  }

  /**
   * Save timeouts to disk
   */
  saveTimeoutsToDisk(timeouts: Record<string, TimeoutState>): void {
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

  /**
   * Populate routing context with circuit breaker and server info after successful request
   */
  populateRoutingContext(
    context: RoutingContext | undefined,
    serverId: string,
    model: string,
    serverLoad?: number,
    maxConcurrency?: number
  ): void {
    if (!context) {
      return;
    }

    context.selectedServerId = serverId;

    // Get probe orchestrator from the new subsystem
    const probeOrchestrator = this.orchestrator.getProbeOrchestrator();

    // Map internal 4-state probe system to UI 3-state circuit breaker model
    const mapState = (s: ProbeState): 'open' | 'closed' | 'half-open' => {
      if (s === 'UNHEALTHY') return 'open';
      if (s === 'RECOVERING') return 'half-open';
      return 'closed'; // HEALTHY or SUSPECT
    };

    // Server-level circuit state (use 'ollama_chat' as representative endpoint)
    const serverState = probeOrchestrator.getState({
      serverId,
      model: '*',
      endpoint: 'ollama_chat',
    });
    context.serverCircuitState = mapState(serverState);

    // Model-level circuit state
    const modelState = probeOrchestrator.getState({
      serverId,
      model,
      endpoint: 'ollama_chat',
    });
    context.modelCircuitState = mapState(modelState);

    // Check if we routed to an open circuit
    if (context.serverCircuitState === 'open' || context.modelCircuitState === 'open') {
      context.routedToOpenCircuit = true;
    }

    // Add server load info
    if (serverLoad !== undefined) {
      context.serverLoad = serverLoad;
    }
    if (maxConcurrency !== undefined) {
      context.maxConcurrency = maxConcurrency;
    }
  }
}
