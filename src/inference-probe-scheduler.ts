import type { CircuitBreakerRegistry } from './circuit-breaker/circuit-breaker.js';
import type { ProbeSchedulerConfig } from './config/config.js';
import { API_ENDPOINTS } from './constants/api-endpoints.js';
import { MetricsAggregator } from './metrics/index.js';
import type { AIServer, RequestContext } from './orchestrator/orchestrator.types.js';
import type { MetricsStore } from './storage/metrics-store.js';
import { calculateBackoff } from './utils/backoff/index.js';
import type { ErrorAggregator } from './utils/error-aggregator.js';
import { fetchWithTimeout } from './utils/fetch-with-timeout.js';
import { getInFlightManager } from './utils/in-flight-manager.js';
import { logger } from './utils/logger.js';
import { probeCoordinator } from './utils/probe-coordinator.js';

export type { ProbeSchedulerConfig };

export interface ProbeTarget {
  serverId: string;
  model: string;
  parameterSize: string;
  priority: 'critical' | 'normal' | 'low';
  reason: string;
}

const PRIORITY_ORDER: Record<ProbeTarget['priority'], number> = {
  critical: 0,
  normal: 1,
  low: 2,
};

const BACKOFF_INITIAL_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

export class InferenceProbeScheduler {
  private config: ProbeSchedulerConfig;
  private getServers: () => AIServer[];
  private getMetricsAggregator: () => MetricsAggregator;
  private getMetricsStore: () => MetricsStore;
  private getCircuitBreakerRegistry: () => CircuitBreakerRegistry;
  private getErrorAggregator: () => ErrorAggregator;

  private intervalTimer?: NodeJS.Timeout;
  private drainTimer?: NodeJS.Timeout;
  private probeQueue: ProbeTarget[] = [];
  private activeProbes: Map<string, Promise<void>> = new Map();
  private activeProbesPerServer: Map<string, number> = new Map();
  private probeAbortControllers: Map<string, AbortController> = new Map();
  private lastUserRequestTime: Map<string, number> = new Map();
  private failureBackoff: Map<string, number> = new Map();
  private failureCount: Map<string, number> = new Map();
  private isRunning = false;

  constructor(
    config: ProbeSchedulerConfig,
    getServers: () => AIServer[],
    getMetricsAggregator: () => MetricsAggregator,
    getMetricsStore: () => MetricsStore,
    getCircuitBreakerRegistry: () => CircuitBreakerRegistry,
    getErrorAggregator: () => ErrorAggregator
  ) {
    this.config = config;
    this.getServers = getServers;
    this.getMetricsAggregator = getMetricsAggregator;
    this.getMetricsStore = getMetricsStore;
    this.getCircuitBreakerRegistry = getCircuitBreakerRegistry;
    this.getErrorAggregator = getErrorAggregator;
  }

  start(): void {
    if (this.isRunning) {
      return;
    }
    if (!this.config.enabled) {
      logger.info('InferenceProbeScheduler: disabled via config');
      return;
    }
    this.isRunning = true;

    void this.runCoverageCheck();

    this.drainTimer = setTimeout(() => {
      void this.drainQueue();
    }, 10_000);

    this.intervalTimer = setInterval(() => {
      void this.runCoverageCheck().then(() => this.drainQueue());
    }, this.config.intervalMs);

    logger.info('InferenceProbeScheduler started', {
      intervalMs: this.config.intervalMs,
      maxConcurrentProbes: this.config.maxConcurrentProbes,
    });
  }

  stop(): void {
    this.isRunning = false;

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = undefined;
    }

    logger.info('InferenceProbeScheduler stopped');
  }

  onServerAdded(serverId: string): void {
    if (!this.config.enabled) {
      return;
    }
    logger.debug(`InferenceProbeScheduler: server added ${serverId}, triggering coverage check`);
    void this.runCoverageCheckForServer(serverId).then(() => this.drainQueue());
  }

  onModelDiscovered(serverId: string, model: string): void {
    if (!this.config.enabled) {
      return;
    }
    const aggregator = this.getMetricsAggregator();
    const rawMetrics = aggregator.getRawMetrics(serverId, model);
    const parameterSize =
      rawMetrics?.parameterSize ?? this.extractParameterSizeFromName(model) ?? 'unknown';

    const covered = this.isSizeClassCovered(serverId, parameterSize);
    if (!covered) {
      const key = `${serverId}:${model}`;
      if (!this.probeQueue.some(t => t.serverId === serverId && t.model === model)) {
        const target: ProbeTarget = {
          serverId,
          model,
          parameterSize,
          priority: 'normal',
          reason: `new model discovered with uncovered size class ${parameterSize}`,
        };
        this.probeQueue.push(target);
        this.sortQueue();
        logger.debug(`InferenceProbeScheduler: queued probe for new model ${key}`);
      }
    }
  }

  recordUserRequest(serverId: string): void {
    this.lastUserRequestTime.set(serverId, Date.now());
  }

  cancelProbe(probeId: string): void {
    const controller = this.probeAbortControllers.get(probeId);
    if (controller) {
      controller.abort();
      this.probeAbortControllers.delete(probeId);
      logger.info(`InferenceProbeScheduler: cancelled probe ${probeId}`);
    }
  }

  getActiveProbeId(serverId: string, model: string): string | undefined {
    const prefix = `${serverId}:${model}:`;
    for (const [probeId] of this.probeAbortControllers) {
      if (probeId.startsWith(prefix)) {
        return probeId;
      }
    }
    return undefined;
  }

  computeMinimumProbeSet(): ProbeTarget[] {
    const aggregator = this.getMetricsAggregator();
    const servers = this.getServers();
    const targets: ProbeTarget[] = [];

    for (const server of servers) {
      if (server.supportsOllama === false) {
        continue;
      }
      if (server.models.length === 0) {
        continue;
      }

      const modelsBySize = this.groupModelsBySize(server, aggregator);

      for (const [parameterSize, models] of modelsBySize.entries()) {
        const covered = models.some(model => {
          const raw = aggregator.getRawMetrics(server.id, model);
          return (raw?.windows['24h']?.count ?? 0) >= this.config.minSamplesForCoverage;
        });

        if (covered) {
          continue;
        }

        const bestModel = this.selectBestProbeModel(server, models, aggregator);
        if (!bestModel) {
          continue;
        }

        const modelCount = models.length;
        let priority: ProbeTarget['priority'];
        if (modelCount >= 10) {
          priority = 'critical';
        } else if (modelCount >= 3) {
          priority = 'normal';
        } else {
          priority = 'low';
        }

        targets.push({
          serverId: server.id,
          model: bestModel,
          parameterSize,
          priority,
          reason: `size class ${parameterSize} has no samples in 24h window (${modelCount} models in class)`,
        });
      }
    }

    targets.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return targets;
  }

  private runCoverageCheck(): Promise<void> {
    try {
      const newTargets = this.computeMinimumProbeSet();

      for (const target of newTargets) {
        const alreadyQueued = this.probeQueue.some(
          t => t.serverId === target.serverId && t.model === target.model
        );
        const alreadyActive = this.activeProbes.has(`${target.serverId}:${target.model}`);

        if (!alreadyQueued && !alreadyActive) {
          this.probeQueue.push(target);
        }
      }

      this.sortQueue();
      logger.debug('InferenceProbeScheduler: coverage check complete', {
        newTargets: newTargets.length,
        queueLength: this.probeQueue.length,
      });
    } catch (err) {
      logger.warn('InferenceProbeScheduler: coverage check failed', { error: err });
    }
    return Promise.resolve();
  }

  private runCoverageCheckForServer(serverId: string): Promise<void> {
    try {
      const aggregator = this.getMetricsAggregator();
      const server = this.getServers().find(s => s.id === serverId);
      if (!server || server.supportsOllama === false) {
        return Promise.resolve();
      }

      const modelsBySize = this.groupModelsBySize(server, aggregator);

      for (const [parameterSize, models] of modelsBySize.entries()) {
        const covered = models.some(model => {
          const raw = aggregator.getRawMetrics(server.id, model);
          return (raw?.windows['24h']?.count ?? 0) >= this.config.minSamplesForCoverage;
        });

        if (covered) {
          continue;
        }

        const bestModel = this.selectBestProbeModel(server, models, aggregator);
        if (!bestModel) {
          continue;
        }

        const key = `${serverId}:${bestModel}`;
        const alreadyQueued = this.probeQueue.some(
          t => t.serverId === serverId && t.model === bestModel
        );
        const alreadyActive = this.activeProbes.has(key);

        if (!alreadyQueued && !alreadyActive) {
          const modelCount = models.length;
          let priority: ProbeTarget['priority'];
          if (modelCount >= 10) {
            priority = 'critical';
          } else if (modelCount >= 3) {
            priority = 'normal';
          } else {
            priority = 'low';
          }

          this.probeQueue.push({
            serverId,
            model: bestModel,
            parameterSize,
            priority,
            reason: `server added, size class ${parameterSize} uncovered`,
          });
        }
      }

      this.sortQueue();
    } catch (err) {
      logger.warn('InferenceProbeScheduler: per-server coverage check failed', {
        serverId,
        error: err,
      });
    }
    return Promise.resolve();
  }

  private drainQueue(): Promise<void> {
    if (!this.isRunning) {
      return Promise.resolve();
    }

    const servers = this.getServers();
    const serverMap = new Map(servers.map(s => [s.id, s]));

    let i = 0;
    while (i < this.probeQueue.length) {
      if (this.activeProbes.size >= this.config.maxConcurrentProbes) {
        break;
      }

      const target = this.probeQueue[i];
      const server = serverMap.get(target.serverId);

      if (!server) {
        this.probeQueue.splice(i, 1);
        continue;
      }

      if (server.supportsOllama === false) {
        this.probeQueue.splice(i, 1);
        continue;
      }

      const key = `${target.serverId}:${target.model}`;

      const backoffUntil = this.failureBackoff.get(key) ?? 0;
      if (Date.now() < backoffUntil) {
        i++;
        continue;
      }

      const maxConcurrency = server.maxConcurrency ?? 4;
      if (this.shouldSkipServer(target.serverId, maxConcurrency)) {
        i++;
        continue;
      }

      this.probeQueue.splice(i, 1);

      const probePromise = this.executeProbe(target, server.url).finally(() => {
        this.activeProbes.delete(key);
        const serverCount = (this.activeProbesPerServer.get(target.serverId) ?? 1) - 1;
        if (serverCount <= 0) {
          this.activeProbesPerServer.delete(target.serverId);
        } else {
          this.activeProbesPerServer.set(target.serverId, serverCount);
        }
      });

      this.activeProbes.set(key, probePromise);
      this.activeProbesPerServer.set(
        target.serverId,
        (this.activeProbesPerServer.get(target.serverId) ?? 0) + 1
      );

      void probePromise;
    }

    return Promise.resolve();
  }

  private async executeProbe(target: ProbeTarget, serverUrl: string): Promise<void> {
    const { serverId, model } = target;
    const key = `${serverId}:${model}`;
    const startTime = Date.now();

    // Skip inference probes when cluster-wide rate limit is active
    if (this.getErrorAggregator().isClusterRateLimited()) {
      logger.info(`InferenceProbeScheduler: skipping probe ${key} - cluster rate limit active`);
      return;
    }
    if (!probeCoordinator.tryAcquire(serverId, model)) {
      logger.info(`InferenceProbeScheduler: skipping probe ${key} - another probe in progress`);
      return;
    }

    logger.info(`InferenceProbeScheduler: starting probe ${key}`, {
      parameterSize: target.parameterSize,
      reason: target.reason,
    });

    const requestContext: RequestContext = {
      id: `probe-${key}-${startTime}`,
      serverId,
      model,
      endpoint: 'generate',
      streaming: false,
      isProbe: true,
      startTime,
      success: false,
    };

    try {
      const url = `${serverUrl.replace(/\/$/, '')}${API_ENDPOINTS.OLLAMA.GENERATE}`;
      const body = JSON.stringify({
        model,
        prompt: 'Count from 1 to 10:',
        stream: false,
        options: { num_predict: 10, temperature: 0 },
      });

      const abortController = new AbortController();
      const probeId = `probe-${key}-${startTime}`;
      this.probeAbortControllers.set(probeId, abortController);

      let response: Response;
      try {
        response = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          timeout: this.config.probeTimeoutMs,
          signal: abortController.signal,
        });
      } finally {
        this.probeAbortControllers.delete(probeId);
      }

      requestContext.endTime = Date.now();
      requestContext.duration = requestContext.endTime - startTime;
      requestContext.success = response.ok;

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        requestContext.error = new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        this.recordProbeFailure(key);
        this.getCircuitBreakerRegistry()
          .getOrCreate(key)
          .recordFailure(new Error(`Probe failed: HTTP ${response.status}`), 'transient');
        logger.warn(`InferenceProbeScheduler: probe failed for ${key}`, {
          status: response.status,
          duration: requestContext.duration,
        });
      } else {
        this.failureCount.delete(key);
        this.failureBackoff.delete(key);
        this.getCircuitBreakerRegistry().getOrCreate(key).recordSuccess();
        logger.info(`InferenceProbeScheduler: probe succeeded for ${key}`, {
          duration: requestContext.duration,
        });
      }
    } catch (err) {
      requestContext.endTime = Date.now();
      requestContext.duration = requestContext.endTime - startTime;

      if (err instanceof Error && err.name === 'AbortError') {
        logger.info(`InferenceProbeScheduler: probe ${key} was cancelled`);
      } else {
        requestContext.success = false;
        requestContext.error = err instanceof Error ? err : new Error(String(err));
        this.recordProbeFailure(key);
        this.getCircuitBreakerRegistry()
          .getOrCreate(key)
          .recordFailure(err instanceof Error ? err : new Error(String(err)), 'transient');
        logger.warn(`InferenceProbeScheduler: probe error for ${key}`, { error: err });
      }
    }

    try {
      this.getMetricsAggregator().recordRequest(requestContext);
    } catch (err) {
      logger.warn('InferenceProbeScheduler: failed to record probe in metricsAggregator', {
        error: err,
      });
    }

    try {
      this.getMetricsStore().recordRequest(requestContext, { isProbe: true });
    } catch (err) {
      logger.warn('InferenceProbeScheduler: failed to record probe in metricsStore', {
        error: err,
      });
    }
    probeCoordinator.release(serverId, model);
  }

  private shouldSkipServer(serverId: string, maxConcurrency: number): boolean {
    const lastUserReq = this.lastUserRequestTime.get(serverId) ?? 0;
    if (Date.now() - lastUserReq < this.config.cooldownAfterUserRequestMs) {
      return true;
    }

    const activeOnServer = this.activeProbesPerServer.get(serverId) ?? 0;
    if (activeOnServer >= this.config.maxProbesPerServer) {
      return true;
    }

    if (this.config.onlyDuringLowTraffic) {
      const inFlight = getInFlightManager().getTotalInFlight(serverId);
      if (maxConcurrency > 0 && inFlight / maxConcurrency > this.config.lowTrafficThreshold) {
        return true;
      }
    }

    return false;
  }

  private recordProbeFailure(key: string): void {
    const count = (this.failureCount.get(key) ?? 0) + 1;
    this.failureCount.set(key, count);
    const result = calculateBackoff('exponential', {
      attempt: count - 1,
      baseDelayMs: BACKOFF_INITIAL_MS,
      maxDelayMs: BACKOFF_MAX_MS,
      multiplier: 2,
      jitterFactor: 0,
    });
    const delay = result.delayMs;
    this.failureBackoff.set(key, Date.now() + delay);
    logger.debug(`InferenceProbeScheduler: backoff set for ${key}`, {
      failureCount: count,
      backoffMs: delay,
    });
  }

  private isSizeClassCovered(serverId: string, parameterSize: string): boolean {
    const aggregator = this.getMetricsAggregator();
    const allMetrics = aggregator.getAllMetricsForServer(serverId);
    return allMetrics.some(
      m =>
        m.parameterSize === parameterSize &&
        (m.windows['24h']?.count ?? 0) >= this.config.minSamplesForCoverage
    );
  }

  private groupModelsBySize(
    server: AIServer,
    aggregator: MetricsAggregator
  ): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const model of server.models) {
      const raw = aggregator.getRawMetrics(server.id, model);
      const parameterSize =
        raw?.parameterSize ?? this.extractParameterSizeFromName(model) ?? 'unknown';

      const group = result.get(parameterSize) ?? [];
      group.push(model);
      result.set(parameterSize, group);
    }

    return result;
  }

  private selectBestProbeModel(
    server: AIServer,
    models: string[],
    aggregator: MetricsAggregator
  ): string | undefined {
    if (models.length === 0) {
      return undefined;
    }

    const loadedModelNames = new Set((server.hardware?.loadedModels ?? []).map(lm => lm.name));

    const loadedInList = models.filter(m => loadedModelNames.has(m));
    if (loadedInList.length > 0) {
      return loadedInList[0];
    }

    let bestModel = models[0];
    let bestCount = -1;

    for (const model of models) {
      const raw = aggregator.getRawMetrics(server.id, model);
      const count = raw?.windows['24h']?.count ?? 0;
      if (count > bestCount) {
        bestCount = count;
        bestModel = model;
      }
    }

    return bestModel;
  }

  private extractParameterSizeFromName(modelName: string): string | undefined {
    const match = /:(\d+(?:\.\d+)?)[bB]/.exec(modelName);
    if (match?.[1]) {
      return `${match[1]}B`;
    }
    const match2 = /(\d+(?:\.\d+)?)b/i.exec(modelName);
    if (match2?.[1]) {
      return `${match2[1]}B`;
    }
    return undefined;
  }

  private sortQueue(): void {
    this.probeQueue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }
}
