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

export interface Tier2ProbeResult {
  serverId: string;
  serverUrl: string;
  headerScore: number;
  entropyScore: number;
  tlsScore: number;
  tier2Score: number;
  headerEvidence: HoneypotProbeResult['headerEvidence'];
  entropyEvidence: HoneypotProbeResult['entropyEvidence'];
  tlsEvidence: HoneypotProbeResult['tlsEvidence'];
  timestamp: number;
}

export class HoneypotProbeScheduler {
  private results = new Map<string, HoneypotProbeResult>();
  private tier2Results = new Map<string, Tier2ProbeResult>();
  private intervalHandle: NodeJS.Timeout | null = null;
  private tier2IntervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isTier2Running = false;
  private config = {
    enabled: true,
    intervalMs: 21600000,
    batchSize: 50,
    timeoutMs: 10000,
    scoreThreshold: { suspicious: 30, flagged: 70 },
  };
  private tier2Config = {
    enabled: true,
    entropySampleCount: 5,
    tlsTimeoutMs: 5000,
    intervalMs: 86400000,
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
      this.tier2Config = {
        enabled: cfg.tier2?.enabled ?? true,
        entropySampleCount: cfg.tier2?.entropySampleCount ?? 5,
        tlsTimeoutMs: cfg.tier2?.tlsTimeoutMs ?? 5000,
        intervalMs: cfg.tier2?.intervalMs ?? 86400000,
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

    if (this.tier2Config.enabled) {
      this.startTier2();
    }
  }

  private startTier2(): void {
    if (this.tier2IntervalHandle) {
      logger.warn('[HoneypotProbe] Tier 2 scheduler already running');
      return;
    }

    logger.info('[HoneypotProbe] Tier 2 scheduler starting', {
      intervalMs: this.tier2Config.intervalMs,
      entropySampleCount: this.tier2Config.entropySampleCount,
      tlsTimeoutMs: this.tier2Config.tlsTimeoutMs,
    });

    this.runTier2Cycle().catch(err =>
      logger.error('[HoneypotProbe] Tier 2 initial cycle failed', { error: String(err) })
    );

    this.tier2IntervalHandle = setInterval(() => {
      this.runTier2Cycle().catch(err =>
        logger.error('[HoneypotProbe] Tier 2 scheduled cycle failed', { error: String(err) })
      );
    }, this.tier2Config.intervalMs);

    if (this.tier2IntervalHandle.unref) {
      this.tier2IntervalHandle.unref();
    }
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.tier2IntervalHandle) {
      clearInterval(this.tier2IntervalHandle);
      this.tier2IntervalHandle = null;
    }
    logger.info('[HoneypotProbe] scheduler stopped');
  }

  getResults(): Map<string, HoneypotProbeResult> {
    return new Map(this.results);
  }

  getTier2Results(): Map<string, Tier2ProbeResult> {
    return new Map(this.tier2Results);
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

  async runTier2Cycle(): Promise<void> {
    if (this.isTier2Running) {
      logger.debug('[HoneypotProbe] Tier 2 cycle already in progress, skipping');
      return;
    }
    this.isTier2Running = true;

    try {
      const orchestrator = getOrchestratorInstance();
      const psCoordinator = getPsPollCoordinator();
      const servers = orchestrator.getServers().filter(s => s.healthy);

      logger.info('[HoneypotProbe][TlsFingerprint] starting Tier 2 cycle', {
        serverCount: servers.length,
      });

      const batchSize = Math.max(1, Math.floor(this.config.batchSize / 5));
      const runner = new HoneypotProbeRunner({
        entropy: {
          sampleCount: this.tier2Config.entropySampleCount,
          timeoutMs: this.config.timeoutMs,
        },
        tls: { timeoutMs: this.tier2Config.tlsTimeoutMs },
      });

      for (let i = 0; i < servers.length; i += batchSize) {
        const batch = servers.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async server => {
            try {
              const models = psCoordinator.getModelsOnServer(server.id);
              const model = models.size > 0 ? [...models][0] : 'llama3.2:3b';

              const result = await runner.runTier2(server.url, server.id, model);

              const tier2Result: Tier2ProbeResult = {
                serverId: server.id,
                serverUrl: server.url,
                headerScore: result.headerScore,
                entropyScore: result.entropyScore,
                tlsScore: result.tlsScore,
                tier2Score: result.tier2Score,
                headerEvidence: result.headerEvidence,
                entropyEvidence: result.entropyEvidence,
                tlsEvidence: result.tlsEvidence,
                timestamp: Date.now(),
              };

              this.tier2Results.set(server.id, tier2Result);
            } catch (err) {
              logger.warn('[HoneypotProbe][TlsFingerprint] server Tier 2 probe failed', {
                serverId: server.id,
                error: String(err),
              });
            }
          })
        );

        if (i + batchSize < servers.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      logger.info('[HoneypotProbe][TlsFingerprint] Tier 2 cycle complete', {
        serverCount: servers.length,
        resultCount: this.tier2Results.size,
      });
    } finally {
      this.isTier2Running = false;
    }
  }
}
