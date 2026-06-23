/**
 * perf-probe-scheduler.ts
 * Daily randomized performance probe scheduler.
 *
 * Runs a minimal-overlap probe set across the fleet once every 24h (configurable).
 * Each (server, model) pair is scheduled at a random time within the 24h window
 * to spread load and avoid thundering-herd effects.
 *
 * Uses the same greedy set-cover model selection as the seed probe
 * (via selectProbeModels) to pick probe models that collectively cover all servers.
 *
 * On failure, falls back to alternative non-cloud models on the same server.
 */

import type { AIOrchestrator } from '../orchestrator/orchestrator.js';
import type { MetricsStore } from '../storage/metrics-store.js';
import type { ProbeRunResult } from '../types/perf-probe.types.js';
import { filterNonCloudModels, isCloudModel } from '../utils/cloud-model-filter.js';
import { type InFlightManager } from '../utils/in-flight-manager.js';
import { logger as loggerInstance } from '../utils/logger.js';
import type { RunProbeOptions } from '../utils/perf-probe-runner.js';
import { selectProbeModels } from '../utils/probe-model-selector.js';

import { feedThreeSinks } from './three-sink-feeder.js';

// ============================================================
// Config
// ============================================================

export interface PerformanceProbeSchedulerConfig {
  /** Whether the scheduler runs (default: true) */
  enabled: boolean;
  /** Cycle interval in milliseconds (default: 24h) */
  intervalMs: number;
  /** Max jitter added/subtracted to each probe delay in ms (default: 5min) */
  jitterMs: number;
  /** Max concurrent probes globally (default: max(2, min(16, floor(serverCount/100)))) */
  maxConcurrent: number;
  /** Cooldown window in ms — skip if a probe of same (server,model) ran recently (default: 5min) */
  cooldownMs: number;
  /** Max models to select via greedy set cover (default: 50) */
  probeModelCount: number;
  /** Per-probe timeout in ms (default: 30000) */
  probeTimeoutMs: number;
  /** Delay before probing newly-added servers in ms (default: 7200000 = 2h) */
  newServerProbeDelayMs: number;
}

const DEFAULT_CONFIG: PerformanceProbeSchedulerConfig = {
  enabled: true,
  intervalMs: 24 * 60 * 60 * 1000,
  jitterMs: 5 * 60 * 1000,
  maxConcurrent: 4,
  cooldownMs: 5 * 60 * 1000,
  probeModelCount: 50,
  probeTimeoutMs: 30_000,
  newServerProbeDelayMs: 7200000,
};

// ============================================================
// Public types
// ============================================================

export interface ScheduleEntry {
  serverId: string;
  model: string;
  firesAt: number;
  scheduledAt: number;
  isRunning: boolean;
}

export interface NewServerProbeEntry {
  serverId: string;
  scheduledAt: number;
  firesAt: number;
}

export interface SchedulerStatus {
  running: boolean;
  enabled: boolean;
  cycleStartedAt: number | null;
  cycleEndsAt: number | null;
  config: PerformanceProbeSchedulerConfig;
  currentProbes: ScheduleEntry[];
  newServerProbes: NewServerProbeEntry[];
  stats: {
    totalScheduledToday: number;
    totalCompletedToday: number;
    totalFailedToday: number;
    totalSkippedCooldown: number;
    totalSkippedConcurrency: number;
  };
  lastError: string | null;
}

// ============================================================
// Constructor options
// ============================================================

export interface PerformanceProbeSchedulerOptions {
  /** Logger instance */
  logger: typeof loggerInstance;
  /** Orchestrator for getModelMap() and getServer() */
  orchestrator: AIOrchestrator;
  /** Probe execution function */
  runProbe: (
    serverId: string,
    model: string,
    serverUrl: string,
    options?: RunProbeOptions
  ) => Promise<ProbeRunResult>;
  /** Metrics store for cooldown queries */
  metricsStore: MetricsStore;
  /** In-flight manager for concurrency control */
  inFlightManager: InFlightManager;
  /** Stable scheduler ID used as taskId when feeding three sinks */
  schedulerId: string;
  /** Scheduler configuration (merged with defaults) */
  config?: Partial<PerformanceProbeSchedulerConfig>;
}

// ============================================================
// Implementation
// ============================================================

export class PerformanceProbeScheduler {
  /** Merged config with defaults */
  private readonly config: PerformanceProbeSchedulerConfig;

  /** All pending setTimeout handles */
  readonly activeTimeouts: Set<NodeJS.Timeout> = new Set();

  /** Currently running probe count (for global concurrency cap) */
  private activeProbes = 0;

  /** Whether the scheduler loop is active */
  private running = false;

  /** Handle for the 24h cycle timeout (setTimeout, not setInterval) */
  private cycleEndTimeout: NodeJS.Timeout | null = null;

  /** Timestamp when the current cycle started */
  private cycleStartedAt: number | null = null;

  /** Timestamp when the current cycle ends */
  private cycleEndsAt: number | null = null;

  /** Stable scheduler ID passed to feedThreeSinks as taskId */
  readonly schedulerId: string;

  /** Stats accumulated within the current 24h cycle */
  readonly stats = {
    totalScheduledToday: 0,
    totalCompletedToday: 0,
    totalFailedToday: 0,
    totalSkippedCooldown: 0,
    totalSkippedConcurrency: 0,
  };

  /** Last error message for status reporting */
  private lastError: string | null = null;

  /** Tracks scheduled (serverId, model) entries for getSchedule() and isRunning state */
  private scheduleEntries: Map<string, ScheduleEntry> = new Map();

  /** Pending new-server probe timeouts keyed by serverId */
  private newServerProbes: Map<string, NodeJS.Timeout> = new Map();

  /** Timestamp when each new-server probe was scheduled */
  private newServerProbeScheduledAt: Map<string, number> = new Map();

  /** Actual delay used for each new-server probe (ms) */
  private newServerProbeDelay: Map<string, number> = new Map();

  constructor(private readonly opts: PerformanceProbeSchedulerOptions) {
    this.schedulerId = opts.schedulerId;
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
  }

  // ---- Public API ----

  /**
   * Start the scheduler. Computes the initial 24h schedule and sets all timeouts.
   */
  start(): Promise<void> {
    if (this.running) {
      return Promise.resolve();
    }
    this.running = true;
    this.scheduleNext24hCycle();
    this.cycleEndTimeout = setTimeout(() => {
      void this.scheduleNext24hCycle();
    }, this.config.intervalMs);
    this.opts.logger.info('perf-probe scheduler started', {
      schedulerId: this.schedulerId,
      intervalMs: this.config.intervalMs,
      jitterMs: this.config.jitterMs,
      maxConcurrent: this.config.maxConcurrent,
      cooldownMs: this.config.cooldownMs,
      probeModelCount: this.config.probeModelCount,
      probeTimeoutMs: this.config.probeTimeoutMs,
    });
    return Promise.resolve();
  }

  /**
   * Stop the scheduler. Clears all pending timeouts. Idempotent.
   * Sets running=false FIRST (before clearing) to race-safety any in-flight callbacks.
   */
  stop(): void {
    // RACE-SAFETY: set running=false FIRST so any in-flight timeouts bail out
    this.running = false;

    // Clear all pending probe timeouts
    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts.clear();

    // Clear the 24h cycle timer
    if (this.cycleEndTimeout !== null) {
      clearTimeout(this.cycleEndTimeout);
      this.cycleEndTimeout = null;
    }

    // Clear all new-server probe timeouts
    for (const timeout of this.newServerProbes.values()) {
      clearTimeout(timeout);
    }
    this.newServerProbes.clear();
    this.newServerProbeScheduledAt.clear();
    this.newServerProbeDelay.clear();

    // Reset cycle timestamps so getStatus() reflects stopped state
    this.cycleStartedAt = null;
    this.cycleEndsAt = null;

    this.opts.logger.info('perf-probe scheduler stopped', {
      schedulerId: this.schedulerId,
    });
  }

  /**
   * Returns whether the scheduler is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Returns a snapshot of the current schedule for testing / debugging.
   */
  getSchedule(): ScheduleEntry[] {
    return Array.from(this.scheduleEntries.values());
  }

  /**
   * Full status snapshot (used by T9 status API).
   */
  getStatus(): SchedulerStatus {
    const now = Date.now();
    return {
      running: this.running,
      enabled: this.config.enabled,
      cycleStartedAt: this.cycleStartedAt,
      cycleEndsAt: this.cycleEndsAt,
      config: { ...this.config },
      currentProbes: this.getSchedule(),
      newServerProbes: Array.from(this.newServerProbes.keys()).map(serverId => {
        const scheduledAt = this.newServerProbeScheduledAt.get(serverId) ?? now;
        const delay = this.newServerProbeDelay.get(serverId) ?? this.config.newServerProbeDelayMs;
        const firesAt = scheduledAt + delay;
        return { serverId, scheduledAt, firesAt };
      }),
      stats: { ...this.stats },
      lastError: this.lastError,
    };
  }

  // ---- New-server probe API ----

  /**
   * Schedule a one-off probe of all models on a newly-added server.
   * Fires after delayMs (default: config.newServerProbeDelayMs = 2h).
   * When fires: runs probe for each model on the server, feeds three sinks.
   * On failure: logs and skips (no retry; daily cycle will pick it up).
   */
  scheduleNewServerProbe(serverId: string, delayMs?: number): void {
    // Ensure the scheduler is running so the probe actually fires when timeout fires.
    // This allows new-server probes to run independently of the daily cycle start/stop.
    if (!this.running) {
      this.running = true;
    }

    // Cancel any existing probe for this server first (idempotent)
    this.cancelNewServerProbe(serverId);

    const delay = delayMs ?? this.config.newServerProbeDelayMs;
    const scheduledAt = Date.now();

    const timeout = setTimeout(() => {
      void this.runNewServerProbe(serverId).catch((err: unknown) => {
        this.opts.logger.error('new-server probe failed', {
          serverId,
          error: String(err),
        });
      });
    }, delay);

    this.newServerProbes.set(serverId, timeout);
    this.newServerProbeScheduledAt.set(serverId, scheduledAt);
    this.newServerProbeDelay.set(serverId, delay);

    this.opts.logger.debug('scheduled new-server probe', {
      schedulerId: this.schedulerId,
      serverId,
      delayMs: delay,
      firesAt: scheduledAt + delay,
    });
  }

  /**
   * Cancel a pending new-server probe for the given server.
   * Idempotent — no-op if no probe is scheduled.
   */
  cancelNewServerProbe(serverId: string): void {
    const existing = this.newServerProbes.get(serverId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.newServerProbes.delete(serverId);
      this.newServerProbeScheduledAt.delete(serverId);
      this.newServerProbeDelay.delete(serverId);
      this.opts.logger.debug('cancelled new-server probe', {
        schedulerId: this.schedulerId,
        serverId,
      });
    }
  }

  // ---- Internal methods ----

  /**
   * Compute a new 24h cycle: select probe models via greedy set cover,
   * build (server, model) pairs, and schedule each at a random time within the window.
   */
  private scheduleNext24hCycle(): void {
    if (!this.running) {
      return;
    }

    // Reset daily stats at the start of each new cycle
    this.stats.totalScheduledToday = 0;
    this.stats.totalCompletedToday = 0;
    this.stats.totalFailedToday = 0;
    this.stats.totalSkippedCooldown = 0;
    this.stats.totalSkippedConcurrency = 0;
    this.lastError = null;

    // Clear any stale timeouts from the previous cycle
    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts.clear();
    this.scheduleEntries.clear();

    try {
      // Step 1: compute the full venn diagram from the orchestrator
      const fullVenn = this.opts.orchestrator.getModelMap();

      // Step 1b: filter to non-cloud models only (cloud models require external auth)
      const nonCloudVenn: Record<string, string[]> = {};
      for (const [model, serverIds] of Object.entries(fullVenn)) {
        if (!isCloudModel(model)) {
          nonCloudVenn[model] = serverIds;
        }
      }

      // Step 2: select probe models via the same greedy set cover used by the seed probe
      const probeModels = selectProbeModels(nonCloudVenn, this.config.probeModelCount);

      // Step 3: build (server, model) pairs from selected models × venn
      const pairs: Array<{ serverId: string; model: string }> = [];
      for (const model of probeModels) {
        const serverIds = nonCloudVenn[model] ?? [];
        for (const serverId of serverIds) {
          pairs.push({ serverId, model });
        }
      }

      // Step 4: schedule each pair at a random time within [now, now + intervalMs)
      const now = Date.now();
      for (const { serverId, model } of pairs) {
        if (!this.running) {
          return;
        }

        const baseDelay = Math.floor(Math.random() * this.config.intervalMs);
        const jitter = Math.floor((Math.random() * 2 - 1) * this.config.jitterMs);
        const delay = Math.max(0, baseDelay + jitter);

        const timeout = setTimeout(() => {
          void this.runScheduledProbe(serverId, model);
        }, delay);
        this.activeTimeouts.add(timeout);

        const entry: ScheduleEntry = {
          serverId,
          model,
          firesAt: now + delay,
          scheduledAt: now,
          isRunning: false,
        };
        this.scheduleEntries.set(`${serverId}:${model}`, entry);

        this.stats.totalScheduledToday++;
      }

      this.cycleStartedAt = now;
      this.cycleEndsAt = now + this.config.intervalMs;

      this.opts.logger.info('perf-probe cycle scheduled', {
        schedulerId: this.schedulerId,
        probeModelsSelected: probeModels.length,
        totalPairsScheduled: pairs.length,
        cycleEndsAt: this.cycleEndsAt,
      });

      // Schedule the next cycle
      this.cycleEndTimeout = setTimeout(() => {
        void this.scheduleNext24hCycle();
      }, this.config.intervalMs);
    } catch (err) {
      this.lastError = String(err);
      this.opts.logger.error('perf-probe scheduleNext24hCycle failed', {
        schedulerId: this.schedulerId,
        error: this.lastError,
      });
    }
  }

  /**
   * Execute a scheduled probe for a (serverId, primaryModel) pair.
   * Handles cooldown check, concurrency cap, per-server concurrency, and fallback models.
   */
  private async runScheduledProbe(
    serverId: string,
    primaryModel: string,
    _attempt = 0
  ): Promise<void> {
    // RACE-SAFETY: if stop() was called, bail out immediately
    if (!this.running) {
      return;
    }

    // COOLDOWN: skip if metricsStore recorded a probe for this (server, model) recently
    const cooldownStart = Date.now() - this.config.cooldownMs;
    const recent = this.opts.metricsStore.getRequests({
      serverId,
      model: primaryModel,
      startTime: cooldownStart,
      isProbe: true,
      limit: 1,
    });
    if (recent.length > 0) {
      this.stats.totalSkippedCooldown++;
      this.opts.logger.debug('perf-probe skipped (cooldown)', { serverId, model: primaryModel });
      return;
    }

    // Global concurrency cap — skip if we're at the limit
    if (this.activeProbes >= this.config.maxConcurrent) {
      this.stats.totalSkippedConcurrency++;
      this.opts.logger.debug('perf-probe skipped (global concurrency cap)', {
        serverId,
        model: primaryModel,
        activeProbes: this.activeProbes,
        maxConcurrent: this.config.maxConcurrent,
      });
      return;
    }

    // Resolve server for URL and maxConcurrency
    const server = this.opts.orchestrator.getServer(serverId);
    if (!server) {
      this.opts.logger.warn('perf-probe server not found', { serverId });
      return;
    }

    // Build the list of models to try: primary first, then up to 2 non-cloud fallbacks
    const modelsToTry = [primaryModel, ...this.getFallbackModels(serverId, primaryModel)];
    const entryKey = `${serverId}:${primaryModel}`;

    for (const model of modelsToTry) {
      // Re-check running flag inside the loop
      if (!this.running) {
        return;
      }

      // Per-server concurrency check via tryIncrementInFlight
      const acquired = this.opts.inFlightManager.tryIncrementInFlight(
        serverId,
        model,
        server.maxConcurrency ?? 4
      );
      if (!acquired) {
        this.stats.totalSkippedConcurrency++;
        this.opts.logger.debug('perf-probe skipped (per-server concurrency)', {
          serverId,
          model,
        });
        continue; // try next fallback model
      }

      this.activeProbes++;

      // Mark entry as running (uses primaryModel key since that's how the entry was stored)
      const entry = this.scheduleEntries.get(entryKey);
      if (entry) {
        entry.isRunning = true;
      }

      try {
        const result = await this.opts.runProbe(serverId, model, server.url, {
          timeoutMs: this.config.probeTimeoutMs,
        });

        // feedThreeSinks is SYNCHRONOUS — preserves existing controller semantics
        feedThreeSinks(result, this.schedulerId, false);

        if (result.success) {
          this.stats.totalCompletedToday++;
          this.opts.logger.info('scheduled probe succeeded', {
            serverId,
            model,
            primaryModel,
          });
          // Probe finished — remove from schedule
          this.scheduleEntries.delete(entryKey);
          return;
        } else {
          this.stats.totalFailedToday++;
          this.opts.logger.warn('scheduled probe failed, trying fallback', {
            serverId,
            model,
            primaryModel,
            error: result.error,
          });
          continue; // try next fallback model
        }
      } catch (err) {
        this.stats.totalFailedToday++;
        this.opts.logger.error('scheduled probe threw exception', {
          serverId,
          model,
          primaryModel,
          error: String(err),
        });
        continue; // try next fallback model
      } finally {
        this.opts.inFlightManager.decrementInFlight(serverId, model);
        this.activeProbes--;
      }
    }

    // All models exhausted without success — remove from schedule
    this.scheduleEntries.delete(entryKey);
  }

  /**
   * Return up to 2 non-cloud fallback models on the same server (excluding primaryModel).
   * Used when the primary model probe fails.
   */
  private getFallbackModels(serverId: string, primaryModel: string): string[] {
    const fullVenn = this.opts.orchestrator.getModelMap();

    // Find all models that this server has
    const allModelsOnServer: string[] = [];
    for (const [model, serverIds] of Object.entries(fullVenn)) {
      if (serverIds.includes(serverId)) {
        allModelsOnServer.push(model);
      }
    }

    // Filter out cloud models and the primary
    const nonCloud = filterNonCloudModels(allModelsOnServer);
    return nonCloud.filter(m => m !== primaryModel).slice(0, 2);
  }

  /**
   * Execute probes for all models on a newly-added server.
   * Called when a new-server probe timer fires.
   * On failure: logs and skips (no retry; daily cycle will pick it up).
   */
  private async runNewServerProbe(serverId: string): Promise<void> {
    if (!this.running) {
      return;
    }

    // Clean up tracking state
    this.newServerProbes.delete(serverId);
    this.newServerProbeScheduledAt.delete(serverId);

    const server = this.opts.orchestrator.getServer(serverId);
    if (!server) {
      this.opts.logger.debug('new-server probe skipped: server not found', { serverId });
      return;
    }

    const fullVenn = this.opts.orchestrator.getModelMap();
    const allModelsOnServer: string[] = [];
    for (const [model, serverIds] of Object.entries(fullVenn)) {
      if (serverIds.includes(serverId)) {
        allModelsOnServer.push(model);
      }
    }

    const modelsOnServer = filterNonCloudModels(allModelsOnServer);

    if (modelsOnServer.length === 0) {
      this.opts.logger.debug('new-server probe skipped: no models on server', { serverId });
      return;
    }

    this.opts.logger.debug('running new-server probe', {
      schedulerId: this.schedulerId,
      serverId,
      modelCount: modelsOnServer.length,
    });

    for (const model of modelsOnServer) {
      if (!this.running) {
        return;
      }

      // Use a short cooldown check — if recently probed, skip
      const cooldownStart = Date.now() - this.config.cooldownMs;
      const recent = this.opts.metricsStore.getRequests({
        serverId,
        model,
        startTime: cooldownStart,
        isProbe: true,
        limit: 1,
      });
      if (recent.length > 0) {
        continue;
      }

      // Try to acquire in-flight slot
      const acquired = this.opts.inFlightManager.tryIncrementInFlight(
        serverId,
        model,
        server.maxConcurrency ?? 4
      );
      if (!acquired) {
        continue;
      }

      this.activeProbes++;

      try {
        const result = await this.opts.runProbe(serverId, model, server.url, {
          timeoutMs: this.config.probeTimeoutMs,
        });

        feedThreeSinks(result, this.schedulerId, false);

        if (result.success) {
          this.stats.totalCompletedToday++;
        } else {
          this.stats.totalFailedToday++;
          this.opts.logger.warn('new-server probe model failed', {
            serverId,
            model,
            error: result.error,
          });
        }
      } catch (err) {
        this.stats.totalFailedToday++;
        this.opts.logger.error('new-server probe threw exception', {
          serverId,
          model,
          error: String(err),
        });
      } finally {
        this.opts.inFlightManager.decrementInFlight(serverId, model);
        this.activeProbes--;
      }
    }
  }
}
