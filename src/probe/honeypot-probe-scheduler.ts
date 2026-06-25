import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { getPsPollCoordinator } from './ps-poll-coordinator-instance.js';
import { getConfigManager } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { HoneypotProbeRunner, type HoneypotProbeResult } from '../utils/honeypot-probes.js';

let schedulerInstance: HoneypotProbeScheduler | null = null;

export function getHoneypotProbeScheduler(): HoneypotProbeScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new HoneypotProbeScheduler();
  }
  return schedulerInstance;
}

export function resetHoneypotProbeScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
  }
  schedulerInstance = null;
}

export class HoneypotProbeScheduler {
  private results = new Map<string, HoneypotProbeResult>();
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;
  private config = {
    enabled: true,
    intervalMs: 21600000,
    batchSize: 50,
    timeoutMs: 10000,
    scoreThreshold: { suspicious: 30, flagged: 70 },
  };

  constructor() {
    this.reloadConfig();
  }

  reloadConfig(): void {
    const cfg = getConfigManager().getConfig().honeypotProbes;
    if (cfg) {
      this.config = {
        enabled: cfg.enabled ?? true,
        intervalMs: cfg.intervalMs ?? 21600000,
        batchSize: cfg.batchSize ?? 50,
        timeoutMs: cfg.timeoutMs ?? 10000,
        scoreThreshold: cfg.scoreThreshold ?? { suspicious: 30, flagged: 70 },
      };
    }
  }

  start(): void {
    if (this.intervalHandle) {
      logger.warn('[HoneypotProbe] scheduler already running');
      return;
    }

    logger.info('[HoneypotProbe] scheduler starting', {
      intervalMs: this.config.intervalMs,
      batchSize: this.config.batchSize,
    });

    this.runCycle().catch(err =>
      logger.error('[HoneypotProbe] initial cycle failed', { error: String(err) })
    );

    this.intervalHandle = setInterval(() => {
      this.runCycle().catch(err =>
        logger.error('[HoneypotProbe] scheduled cycle failed', { error: String(err) })
      );
    }, this.config.intervalMs);

    if (this.intervalHandle.unref) {
      this.intervalHandle.unref();
    }
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    logger.info('[HoneypotProbe] scheduler stopped');
  }

  getResults(): Map<string, HoneypotProbeResult> {
    return new Map(this.results);
  }

  async runCycle(): Promise<void> {
    if (this.isRunning) {
      logger.debug('[HoneypotProbe] cycle already in progress, skipping');
      return;
    }
    this.isRunning = true;

    try {
      const orchestrator = getOrchestratorInstance();
      const psCoordinator = getPsPollCoordinator();
      const servers = orchestrator.getServers().filter(s => s.healthy);

      logger.info('[HoneypotProbe] starting cycle', { serverCount: servers.length });

      const batchSize = this.config.batchSize;
      const runner = new HoneypotProbeRunner({
        schema: { timeoutMs: this.config.timeoutMs },
        coldStart: { timeoutMs: this.config.timeoutMs },
      });

      for (let i = 0; i < servers.length; i += batchSize) {
        const batch = servers.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async server => {
            try {
              const models = psCoordinator.getModelsOnServer(server.id);
              const model = models.size > 0 ? [...models][0] : 'llama3.2:3b';

              const result = await runner.runAll(
                server.url,
                server.id,
                model,
                this.config.scoreThreshold.suspicious,
                this.config.scoreThreshold.flagged
              );

              this.results.set(server.id, result);
            } catch (err) {
              logger.warn('[HoneypotProbe] server probe failed', {
                serverId: server.id,
                error: String(err),
              });
            }
          })
        );

        if (i + batchSize < servers.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info('[HoneypotProbe] cycle complete', {
        serverCount: servers.length,
        resultCount: this.results.size,
      });
    } finally {
      this.isRunning = false;
    }
  }
}
