/**
 * active-test-scheduler.ts
 * Dedicated scheduler for active circuit-breaker recovery tests.
 *
 * Watches open circuit breakers and triggers recovery tests as soon as their
 * nextRetryAt timestamp expires — instead of waiting for the next health-check
 * cycle boundary (up to 30 s later).
 */

import type { CircuitBreakerRegistry } from './circuit-breaker.js';
import type { AIServer } from './orchestrator.types.js';
import { logger } from './utils/logger.js';

/** Milliseconds between polls of the circuit-breaker registry. */
const POLL_INTERVAL_MS = 1000;

export class ActiveTestScheduler {
  private readonly registry: CircuitBreakerRegistry;
  private readonly getServers: () => AIServer[];
  private readonly runActiveTests: (
    server: AIServer
  ) => Promise<Array<{ model: string; success: boolean; duration: number; error?: string }>>;

  /** Names of breakers that already have a scheduled timer, preventing duplicates. */
  private readonly scheduledTimers = new Map<string, NodeJS.Timeout>();

  private pollTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    registry: CircuitBreakerRegistry,
    getServers: () => AIServer[],
    runActiveTests: (
      server: AIServer
    ) => Promise<Array<{ model: string; success: boolean; duration: number; error?: string }>>
  ) {
    this.registry = registry;
    this.getServers = getServers;
    this.runActiveTests = runActiveTests;
  }

  /** Start the polling loop. */
  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    logger.info('ActiveTestScheduler started');
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /** Stop the polling loop and cancel all pending timers. */
  stop(): void {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    for (const timer of this.scheduledTimers.values()) {
      clearTimeout(timer);
    }
    this.scheduledTimers.clear();

    logger.info('ActiveTestScheduler stopped');
  }

  /**
   * Poll the registry for open breakers whose nextRetryAt has expired or is
   * approaching, and schedule a one-shot recovery test for each.
   */
  private poll(): void {
    if (!this.isRunning) {
      return;
    }

    const now = Date.now();
    const allStats = this.registry.getAllStats();
    const servers = this.getServers();
    const serverById = new Map(servers.map(s => [s.id, s]));

    for (const [breakerName, stats] of Object.entries(allStats)) {
      if (stats.state !== 'open') {
        continue;
      }
      if (!stats.nextRetryAt || stats.nextRetryAt <= 0) {
        continue;
      }
      // Already scheduled — skip.
      if (this.scheduledTimers.has(breakerName)) {
        continue;
      }

      const delay = Math.max(0, stats.nextRetryAt - now);

      // Determine the server for this breaker.
      // Breaker names are either "<serverId>" (server-level) or "<serverId>:<model>".
      const colonIdx = breakerName.indexOf(':');
      const serverId = colonIdx === -1 ? breakerName : breakerName.slice(0, colonIdx);
      const server = serverById.get(serverId);

      if (!server) {
        continue;
      }

      logger.debug(`ActiveTestScheduler: scheduling test for ${breakerName} in ${delay}ms`);

      const timer = setTimeout(() => {
        this.scheduledTimers.delete(breakerName);
        this.triggerTest(server, breakerName);
      }, delay);

      this.scheduledTimers.set(breakerName, timer);
    }

    // Prune scheduled timers for breakers that are no longer open
    // (e.g. they transitioned to closed or half-open via a real request).
    for (const [breakerName] of this.scheduledTimers) {
      const stats = allStats[breakerName];
      if (!stats || stats.state !== 'open') {
        const timer = this.scheduledTimers.get(breakerName);
        if (timer) {
          clearTimeout(timer);
        }
        this.scheduledTimers.delete(breakerName);
        logger.debug(`ActiveTestScheduler: cancelled timer for ${breakerName} (no longer open)`);
      }
    }
  }

  /** Trigger active tests for the server associated with the given breaker. */
  private triggerTest(server: AIServer, breakerName: string): void {
    if (!this.isRunning) {
      return;
    }
    logger.info(`ActiveTestScheduler: triggering recovery test for ${breakerName}`, {
      serverId: server.id,
    });
    void this.runActiveTests(server);
  }
}
