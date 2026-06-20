/**
 * ps-poll-coordinator.ts
 * Periodically polls each server's /api/ps endpoint to track which models
 * are currently loaded on each server. Maintains a live picture of model
 * availability across the fleet.
 *
 * This replaces snapshot-only model tracking with continuously refreshed data.
 */

import { logger } from '../utils/logger.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';

export interface PsPollConfig {
  enabled: boolean;
  intervalMs: number;
  staggerOffsetMs: number;
  requestTimeoutMs: number;
  maxErrorsBeforeBackoff: number;
}

interface ServerPsState {
  models: Set<string>;
  lastPollAt: number;
  errorCount: number;
  lastErrorAt: number;
}

export class PsPollCoordinator {
  private state = new Map<string, ServerPsState>();
  private intervalHandle: NodeJS.Timeout | null = null;
  private staggerTimeouts = new Map<string, NodeJS.Timeout>();
  private config: PsPollConfig;
  private isPolling = false;

  constructor(config?: Partial<PsPollConfig>) {
    this.config = {
      enabled: true,
      intervalMs: 60_000,
      staggerOffsetMs: 1000,
      requestTimeoutMs: 5000,
      maxErrorsBeforeBackoff: 3,
      ...config,
    };
  }

  /**
   * Start the PS poll coordinator.
   * Does NOT throw if polling fails — errors are logged but do not block startup.
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('[ps-poll] coordinator disabled');
      return;
    }
    if (this.intervalHandle) {
      logger.warn('[ps-poll] coordinator already running');
      return;
    }

    logger.info('[ps-poll] coordinator starting', {
      intervalMs: this.config.intervalMs,
      staggerOffsetMs: this.config.staggerOffsetMs,
      requestTimeoutMs: this.config.requestTimeoutMs,
    });

    // First poll immediately (best-effort, non-blocking)
    this.pollAllServers().catch(err =>
      logger.error('[ps-poll] initial poll failed', { error: String(err) })
    );

    // Schedule recurring polls
    this.intervalHandle = setInterval(() => {
      this.pollAllServers().catch(err =>
        logger.error('[ps-poll] scheduled poll failed', { error: String(err) })
      );
    }, this.config.intervalMs);

    // Allow clean exit without keeping process alive
    if (this.intervalHandle.unref) {
      this.intervalHandle.unref();
    }
  }

  /**
   * Stop the PS poll coordinator.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    for (const t of this.staggerTimeouts.values()) {
      clearTimeout(t);
    }
    this.staggerTimeouts.clear();
    logger.info('[ps-poll] coordinator stopped');
  }

  /**
   * Poll all healthy servers with stagger offset to avoid thundering herd.
   */
  async pollAllServers(): Promise<void> {
    if (this.isPolling) {
      logger.debug('[ps-poll] poll already in progress, skipping');
      return;
    }
    this.isPolling = true;
    try {
      const orchestrator = getOrchestratorInstance();
      const servers = orchestrator.getServers().filter(s => s.healthy);

      for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        const delay = i * this.config.staggerOffsetMs;
        const timeout = setTimeout(() => {
          this.refreshServer(server.id).catch(err =>
            logger.warn('[ps-poll] refresh failed', { serverId: server.id, error: String(err) })
          );
        }, delay);
        this.staggerTimeouts.set(server.id, timeout);
      }
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Refresh PS state for a single server.
   */
  async refreshServer(serverId: string): Promise<void> {
    const orchestrator = getOrchestratorInstance();
    const servers = orchestrator.getServers();
    const server = servers.find(s => s.id === serverId);
    if (!server || !server.healthy) {
      // Server is dead or removed — purge state
      this.state.delete(serverId);
      return;
    }

    const state = this.state.get(serverId) ?? {
      models: new Set<string>(),
      lastPollAt: 0,
      errorCount: 0,
      lastErrorAt: 0,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      const response = await fetch(`${server.url}/api/ps`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
      const modelNames = (data.models || [])
        .map(m => m.name ?? m.model)
        .filter((n): n is string => typeof n === 'string');
      state.models = new Set(modelNames);
      state.lastPollAt = Date.now();
      state.errorCount = 0;
      this.state.set(serverId, state);
      logger.debug('[ps-poll] poll success', {
        serverId,
        modelCount: state.models.size,
      });
    } catch (error) {
      state.errorCount++;
      state.lastErrorAt = Date.now();
      this.state.set(serverId, state);
      if (state.errorCount >= this.config.maxErrorsBeforeBackoff) {
        logger.warn('[ps-poll] server in error state', {
          serverId,
          errorCount: state.errorCount,
          error: String(error),
        });
      }
    }
  }

  /**
   * Get the set of models currently loaded on a given server.
   */
  getModelsOnServer(serverId: string): Set<string> {
    return this.state.get(serverId)?.models ?? new Set();
  }

  /**
   * Get all server IDs that have a given model loaded.
   */
  getServersWithModel(model: string): Set<string> {
    const result = new Set<string>();
    for (const [serverId, serverState] of this.state.entries()) {
      if (serverState.models.has(model)) {
        result.add(serverId);
      }
    }
    return result;
  }

  /**
   * Get aggregated stats across all polled servers.
   */
  getStats(): { serverCount: number; totalModels: number; oldestPoll: number } {
    let oldest = Date.now();
    let totalModels = 0;
    for (const serverState of this.state.values()) {
      totalModels += serverState.models.size;
      if (serverState.lastPollAt > 0 && serverState.lastPollAt < oldest) {
        oldest = serverState.lastPollAt;
      }
    }
    return {
      serverCount: this.state.size,
      totalModels,
      oldestPoll: oldest === Date.now() ? 0 : oldest,
    };
  }
}
