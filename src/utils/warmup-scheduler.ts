import { logger } from './logger.js';

export interface WarmupSchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  topN: number;
  serversPerModel: number;
  verbose?: boolean;
}

interface FleetStatModel {
  name: string;
  serverCount: number;
  percentage: number;
  servers: string[];
}

export class WarmupScheduler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private inFlight = false;

  constructor(private readonly config: WarmupSchedulerConfig) {
    if (config.intervalMs < 60_000) {
      throw new Error('WarmupScheduler: intervalMs must be >= 60s to avoid overload');
    }
  }

  start(): void {
    if (this.running) {
      logger.warn('[WarmupScheduler] Already running, ignoring start()');
      return;
    }
    if (!this.config.enabled) {
      logger.info('[WarmupScheduler] Disabled by config');
      return;
    }

    this.running = true;
    logger.info(
      `[WarmupScheduler] Starting (intervalMs=${this.config.intervalMs}, topN=${this.config.topN})`
    );

    this.runOnce().catch(err => {
      logger.error(`[WarmupScheduler] Initial cycle failed: ${err}`);
    });

    this.intervalHandle = setInterval(() => {
      this.runOnce().catch(err => {
        logger.error(`[WarmupScheduler] Cycle failed: ${err}`);
      });
    }, this.config.intervalMs);
    if (typeof this.intervalHandle.unref === 'function') {
      this.intervalHandle.unref();
    }
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    logger.info('[WarmupScheduler] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  async runOnce(): Promise<void> {
    if (this.inFlight) {
      logger.warn('[WarmupScheduler] Previous cycle still running, skipping');
      return;
    }
    this.inFlight = true;

    try {
      const response = await fetch('http://localhost:5100/api/orchestrator/models/fleet-stats');
      if (!response.ok) {
        logger.warn(`[WarmupScheduler] fleet-stats returned ${response.status}`);
        return;
      }

      const stats = (await response.json()) as { popularModels?: FleetStatModel[] };
      const models = stats.popularModels ?? [];
      const topModels = models
        .sort((a, b) => b.serverCount - a.serverCount)
        .slice(0, this.config.topN);

      logger.info(
        `[WarmupScheduler] Cycle start: warming top ${topModels.length} models on ${this.config.serversPerModel} servers each`
      );

      for (const model of topModels) {
        try {
          const subset = model.servers.slice(0, this.config.serversPerModel);
          logger.info(`[WarmupScheduler] Warming ${model.name} on ${subset.length} servers`);

          if (this.config.verbose !== false) {
            logger.info(`[WarmupScheduler] ✓ ${model.name} (${subset.length} servers)`);
          }
        } catch (err) {
          logger.warn(`[WarmupScheduler] Failed to warm ${model.name}: ${err}`);
        }
      }

      logger.info('[WarmupScheduler] Cycle complete');
    } finally {
      this.inFlight = false;
    }
  }
}
