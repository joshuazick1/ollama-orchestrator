/**
 * active-test-scheduler.ts
 * Dedicated scheduler for active circuit-breaker recovery tests.
 *
 * Watches open circuit breakers and triggers recovery tests as soon as their
 * nextRetryAt timestamp expires — instead of waiting for the next health-check
 * cycle boundary (up to 30 s later).
 *
 * Also detects **full model outages** — when every server hosting a given model
 * has its model-level circuit breaker open — and expedites recovery testing so
 * the model becomes available again as quickly as possible.
 */

import type {
  CircuitBreakerRegistry,
  CircuitBreakerStats,
} from './circuit-breaker/circuit-breaker.js';
import type { AIServer } from './orchestrator/orchestrator.types.js';
import { logger } from './utils/logger.js';

/** Milliseconds between polls of the circuit-breaker registry. */
const POLL_INTERVAL_MS = 1000;

/**
 * Minimum interval (ms) between prioritised recovery triggers for the same
 * model to avoid hammering servers during a full outage.
 */
const PRIORITY_COOLDOWN_MS = 10_000;

export class ActiveTestScheduler {
  private readonly registry: CircuitBreakerRegistry;
  private readonly getServers: () => AIServer[];
  private readonly runActiveTests: (
    server: AIServer
  ) => Promise<Array<{ model: string; success: boolean; duration: number; error?: string }>>;

  /** Names of breakers that already have a scheduled timer, preventing duplicates. */
  private readonly scheduledTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Tracks when a prioritised (full-outage) recovery was last triggered per
   * model, preventing redundant expedited tests on every poll cycle.
   */
  private readonly priorityCooldowns = new Map<string, number>();

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
    this.priorityCooldowns.clear();

    logger.info('ActiveTestScheduler stopped');
  }

  /**
   * Poll the registry for open breakers whose nextRetryAt has expired or is
   * approaching, and schedule a one-shot recovery test for each.
   *
   * After scheduling individual breaker tests, performs full-model-outage
   * detection and expedites recovery for any model whose every hosting server
   * has an open circuit breaker.
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

    // --- Full model outage detection & prioritised recovery ---
    this.detectAndExpediteFullOutages(now, allStats, servers, serverById);
  }

  /**
   * Detect models where **every** hosting server has an open model-level
   * circuit breaker and expedite recovery tests for those models.
   *
   * For each fully-outaged model we pick the server whose CB has the earliest
   * `nextRetryAt` (closest to recovery) and either:
   *   - Reschedule its pending timer to fire immediately, or
   *   - Trigger an immediate recovery test if no timer exists.
   *
   * A per-model cooldown prevents triggering more than once per
   * `PRIORITY_COOLDOWN_MS` to avoid hammering failing servers.
   */
  detectAndExpediteFullOutages(
    now: number,
    allStats: Record<string, CircuitBreakerStats>,
    servers: AIServer[],
    serverById: Map<string, AIServer>
  ): void {
    // Build a map: model → list of { serverId, breakerName, nextRetryAt }
    const modelServerMap = new Map<
      string,
      Array<{ serverId: string; breakerName: string; nextRetryAt: number }>
    >();

    for (const [breakerName, stats] of Object.entries(allStats)) {
      const colonIdx = breakerName.indexOf(':');
      if (colonIdx === -1) {
        // Server-level breaker — not relevant for per-model outage detection
        continue;
      }
      if (stats.state !== 'open') {
        continue;
      }

      const serverId = breakerName.slice(0, colonIdx);
      const model = breakerName.slice(colonIdx + 1);

      if (!serverById.has(serverId)) {
        continue;
      }

      let entries = modelServerMap.get(model);
      if (!entries) {
        entries = [];
        modelServerMap.set(model, entries);
      }
      entries.push({
        serverId,
        breakerName,
        nextRetryAt: stats.nextRetryAt,
      });
    }

    // For each model, check if ALL servers that host it have an open CB
    for (const [model, openEntries] of modelServerMap) {
      const hostingServers = servers.filter(s => s.models.includes(model));

      // Skip if model has no known hosting servers or if some servers are healthy
      if (hostingServers.length === 0) {
        continue;
      }
      if (openEntries.length < hostingServers.length) {
        // Not all servers are down for this model — normal scheduling is fine
        // Also clean up cooldown if model recovered
        this.priorityCooldowns.delete(model);
        continue;
      }

      // Full outage detected — every server hosting this model has an open CB
      // Check cooldown to avoid spamming
      const lastPriority = this.priorityCooldowns.get(model) ?? 0;
      if (now - lastPriority < PRIORITY_COOLDOWN_MS) {
        continue;
      }

      // Pick the entry closest to recovery (earliest nextRetryAt)
      const bestEntry = openEntries.reduce((a, b) => (a.nextRetryAt <= b.nextRetryAt ? a : b));
      const server = serverById.get(bestEntry.serverId);
      if (!server) {
        continue;
      }

      logger.warn(
        `ActiveTestScheduler: full outage detected for model "${model}" ` +
          `(${openEntries.length}/${hostingServers.length} servers open). ` +
          `Expediting recovery test on server ${bestEntry.serverId}.`
      );

      this.priorityCooldowns.set(model, now);

      // Cancel existing timer for this breaker and trigger immediately
      const existingTimer = this.scheduledTimers.get(bestEntry.breakerName);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.scheduledTimers.delete(bestEntry.breakerName);
      }
      this.triggerTest(server, bestEntry.breakerName);
    }

    // Clean up cooldowns for models no longer tracked
    for (const model of this.priorityCooldowns.keys()) {
      if (!modelServerMap.has(model)) {
        this.priorityCooldowns.delete(model);
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
