/**
 * health-check-scheduler.ts
 * Periodic health-check scheduler that refreshes the orchestrator's per-server
 * model lists (server.models, server.v1Models, server.discoveredV1Models) by
 * invoking orchestrator.updateServerStatus() on every registered server.
 *
 * The orchestrator was missing a periodic loop after the probe-orchestrator
 * refactor (May 2026 audit, Finding #1). Without it, /api/tags and /v1/models
 * proxy endpoints reflect stale data once the initial probe sweep completes.
 */

import { getConfigManager } from '../config/config.js';
import type { HealthCheckConfig } from '../config/schema.js';
import { logger } from '../utils/logger.js';

export interface HealthCheckSchedulerServerDescriptor {
  id: string;
}

export interface HealthCheckSchedulerOptions {
  serverListProvider: () => HealthCheckSchedulerServerDescriptor[];
  updateServerStatus: (server: HealthCheckSchedulerServerDescriptor) => Promise<void>;
}

export interface HealthCheckCycleResult {
  serversProbed: number;
  succeeded: number;
  failed: number;
  skipped: boolean;
}

export class HealthCheckScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;
  private tickInFlight = false;
  private running = false;

  constructor(private opts: HealthCheckSchedulerOptions) {}

  private getConfig(): HealthCheckConfig {
    const config = getConfigManager().getConfig();
    return (
      config.healthCheck ?? {
        enabled: true,
        intervalMs: 30000,
        timeoutMs: 5000,
        maxConcurrentChecks: 10,
        retryAttempts: 2,
        retryDelayMs: 1000,
        recoveryIntervalMs: 60000,
        backoffMultiplier: 1.5,
      }
    );
  }

  start(): void {
    if (this.running) {
      return;
    }

    const config = this.getConfig();
    if (!config.enabled) {
      logger.info('health-check scheduler disabled in config');
      return;
    }

    this.running = true;
    this.intervalHandle = setInterval(() => {
      this.tick().catch(err => {
        logger.error('health-check tick error', { error: String(err) });
      });
    }, config.intervalMs);

    if (this.intervalHandle.unref) {
      this.intervalHandle.unref();
    }

    logger.info('health-check scheduler started', {
      intervalMs: config.intervalMs,
      maxConcurrentChecks: config.maxConcurrentChecks,
    });
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    logger.info('health-check scheduler stopped');
  }

  async runOnce(): Promise<HealthCheckCycleResult> {
    if (this.tickInFlight) {
      return { serversProbed: 0, succeeded: 0, failed: 0, skipped: true };
    }
    this.tickInFlight = true;

    const config = this.getConfig();
    const servers = this.opts.serverListProvider();
    let succeeded = 0;
    let failed = 0;

    const limit = Math.max(1, config.maxConcurrentChecks);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < servers.length) {
        const idx = cursor++;
        const server = servers[idx];
        try {
          await this.opts.updateServerStatus(server);
          succeeded++;
        } catch (err) {
          failed++;
          logger.debug('health-check update failed', {
            serverId: server.id,
            error: String(err),
          });
        }
      }
    };

    try {
      const workers = Array.from({ length: Math.min(limit, servers.length) }, () => worker());
      await Promise.all(workers);
    } finally {
      this.tickInFlight = false;
    }

    return { serversProbed: servers.length, succeeded, failed, skipped: false };
  }

  private async tick(): Promise<void> {
    const result = await this.runOnce();
    if (!result.skipped) {
      logger.debug('health-check cycle complete', result);
    }
  }
}
