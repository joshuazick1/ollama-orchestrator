/**
 * orchestrator.ts
 * Ollama Orchestrator with Historical Metrics - Server management and request routing
 */

import { ActiveTestScheduler } from '../active-test-scheduler.js';
import { getAnalyticsEngine } from '../analytics/analytics-engine.js';
import {
  getRecoveryFailureTracker,
  type RecoveryFailureRecord,
} from '../analytics/recovery-failure-tracker.js';
import {
  CircuitBreakerPersistence,
  type CircuitBreakerData,
} from '../circuit-breaker/circuit-breaker-persistence.js';
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  type CircuitBreakerConfig,
  type ErrorType,
} from '../circuit-breaker/circuit-breaker.js';
import type { HealthCheckConfig, OrchestratorConfig, RetryConfig } from '../config/config.js';
import { DEFAULT_CONFIG, getConfigManager } from '../config/config.js';
import { ERROR_MESSAGES } from '../constants/index.js';
import { getDecisionHistory } from '../decision-history.js';
import { HealthCheckScheduler, type HealthCheckResult } from '../health-check-scheduler.js';
import { InferenceProbeScheduler } from '../inference-probe-scheduler.js';
import {
  LoadBalancer,
  calculateServerScore,
  type LoadBalancerConfig,
} from '../load-balancer/load-balancer.js';
import { getTemporalScorer } from '../load-balancer/temporal-scorer.js';
import { MetricsAggregator } from '../metrics/index.js';
import { getModelManager } from '../model-manager.js';
import {
  getRecoveryTestCoordinator,
  RecoveryTestCoordinator,
  setRecoveryTestCoordinator,
} from '../recovery-test-coordinator.js';
import { getRequestHistory } from '../request-history.js';
import { getMetricsStore } from '../storage/metrics-store.js';
import { getOperationalStore } from '../storage/operational-store.js';
import { BanManager } from '../utils/ban-manager.js';
import { classifyError, ErrorCategory } from '../utils/error-classifier.js';
import { fetchWithTimeout, parseResponse } from '../utils/fetch-with-timeout.js';
import { InFlightManager, getInFlightManager } from '../utils/in-flight-manager.js';
import { safeJsonStringify } from '../utils/json-utils.js';
import { logger } from '../utils/logger.js';
import { ModelAggregator } from '../utils/model-aggregator.js';
import { canHandleContext, getDefaultContextSize } from '../utils/prompt-estimator.js';
import { TimeoutManager } from '../utils/timeout-manager.js';
import { normalizeServerUrl, areUrlsEquivalent } from '../utils/url-utils.js';

import {
  saveServersToDisk,
  loadTimeoutsFromDisk,
  saveTimeoutsToDisk,
} from './orchestrator-persistence.js';
import type {
  AIServer,
  RequestContext,
  ServerModelMetrics,
  GlobalMetrics,
  MetricsExport,
} from './orchestrator.types.js';

export type { AIServer } from './orchestrator.types.js';

/** Routing context for debug output - tracks which server was selected and routing reasoning */
export interface RoutingContext {
  selectedServerId?: string;
  serverCircuitState?: string;
  modelCircuitState?: string;
  availableServerCount?: number;
  routedToOpenCircuit?: boolean;
  retryCount?: number;
  serversTried?: string[];
  totalCandidates?: number;
  serverLoad?: number;
  maxConcurrency?: number;
  // REC-55: routing reasoning fields
  algorithm?: string;
  protocol?: string;
  excludedServers?: string[];
  serverScores?: Array<{ serverId: string; totalScore: number }>;
  timeoutMs?: number;
  /** Time spent in routing/failover before reaching a server (ms) */
  queueWaitTime?: number;

  // Failover diagnostics
  /** The deepest failover phase reached (1, 2, or 3) */
  failoverPhase?: number;
  /** Number of failover attempts that resulted in trying a different server */
  failoverCount?: number;
  /** Per-server error reasons encountered during failover */
  failoverErrors?: Array<{ serverId: string; error: string; errorType?: string }>;
  /** Whether the final result came after at least one failover */
  failoverOccurred?: boolean;
}

function extractParameterSizeFromName(modelName: string): string | undefined {
  const match = /:(\d+(?:\.\d+)?)[bB]/.exec(modelName);
  if (match?.[1]) {
    return `${match[1]}B`;
  }
  return undefined;
}

export class AIOrchestrator {
  private servers: AIServer[] = [];
  private inFlightManager: InFlightManager;
  private banManager: BanManager;
  private modelAggregator: ModelAggregator;
  private circuitBreakerRegistry: CircuitBreakerRegistry;
  private circuitBreakerPersistence: CircuitBreakerPersistence;
  private metricsAggregator: MetricsAggregator;
  private loadBalancer: LoadBalancer;
  private healthCheckScheduler: HealthCheckScheduler;
  private activeTestScheduler: ActiveTestScheduler;
  private probeScheduler: InferenceProbeScheduler;
  private draining = false;
  private config: OrchestratorConfig;
  private tagsCache?: {
    data: any[];
    timestamp: number;
    metadata: {
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      serverCount: number;
      modelCount: number;
      errors: Array<{
        serverId: string;
        error: string;
        type: 'network' | 'server' | 'timeout' | 'unknown';
      }>;
    };
  };

  // Track per server:model timeouts via TimeoutManager
  private timeoutManager: TimeoutManager;

  // Track healthy server count for logging changes
  private lastHealthyCount = 0;

  // Escalation check interval handle for cleanup
  private escalationIntervalId?: NodeJS.Timeout;

  // Suppress persistence during bulk operations (e.g., loading from disk)
  private _suppressPersistence = false;

  // Unsubscribe from config changes
  private unsubscribeFromConfig?: () => void;

  constructor(
    loadBalancerConfig?: LoadBalancerConfig,
    circuitBreakerConfig?: CircuitBreakerConfig,
    healthCheckConfig?: HealthCheckConfig,
    config?: OrchestratorConfig
  ) {
    this.config = config ?? { ...DEFAULT_CONFIG };

    getOperationalStore().runStartupMigrations();

    this.metricsAggregator = new MetricsAggregator();
    this.loadBalancer = new LoadBalancer(loadBalancerConfig ?? this.config.loadBalancer);

    const lbConfig = loadBalancerConfig ?? this.config.loadBalancer;
    if (lbConfig.crossModelInference) {
      this.metricsAggregator.setCrossModelInferenceConfig(lbConfig.crossModelInference);
    }

    this.circuitBreakerRegistry = new CircuitBreakerRegistry(
      circuitBreakerConfig ?? this.config.circuitBreaker
    );
    this.circuitBreakerPersistence = new CircuitBreakerPersistence({
      filePath: this.config.persistencePath
        ? `${this.config.persistencePath}/circuit-breakers.json`
        : undefined,
    });

    // Initialize BanManager
    this.banManager = new BanManager();

    // Initialize InFlightManager - use the shared singleton so all modules
    // (controllers, streaming handlers, etc.) operate on the same manager.
    this.inFlightManager = getInFlightManager();

    // Initialize ModelAggregator
    this.modelAggregator = new ModelAggregator();

    // Set up circuit breaker state change tracking by wrapping registry getOrCreate
    const registryGetOrCreate = this.circuitBreakerRegistry.getOrCreate.bind(
      this.circuitBreakerRegistry
    );
    const failureTracker = getRecoveryFailureTracker();
    (
      this.circuitBreakerRegistry as unknown as { getOrCreate: typeof registryGetOrCreate }
    ).getOrCreate = (
      name: string,
      config?: Partial<CircuitBreakerConfig>
    ): import('../circuit-breaker/circuit-breaker.js').CircuitBreaker => {
      return registryGetOrCreate(name, config, (oldState, newState) => {
        const [serverId, ...modelParts] = name.split(':');
        const model = modelParts.length > 0 ? modelParts.join(':') : undefined;
        failureTracker.recordCircuitBreakerTransition(
          serverId,
          model,
          oldState,
          newState,
          `State transition: ${oldState} -> ${newState}`
        );
      });
    };

    this.healthCheckScheduler = new HealthCheckScheduler(
      healthCheckConfig ?? this.config.healthCheck,
      () => [...this.servers],
      result => this.onHealthCheckResult(result),
      results => this.onAllHealthChecksComplete(results),
      server => this.runActiveTestsForServer(server)
    );

    this.activeTestScheduler = new ActiveTestScheduler(
      this.circuitBreakerRegistry,
      () => [...this.servers],
      server => this.runActiveTestsForServer(server)
    );

    this.probeScheduler = new InferenceProbeScheduler(
      this.config.probeScheduler,
      () => this.servers,
      () => this.metricsAggregator,
      () => getMetricsStore(),
      () => this.circuitBreakerRegistry
    );

    // Initialize TimeoutManager with config defaults
    const currentConfig = getConfigManager().getConfig();
    this.timeoutManager = new TimeoutManager({
      defaultTimeout: currentConfig.timeout.defaultTimeoutMs,
      minTimeout: currentConfig.timeout.minTimeoutMs,
      maxTimeout: currentConfig.timeout.maxTimeoutMs,
      recoveryTestMultiplier: currentConfig.timeout.recoveryTestMultiplier,
      normalRequestMultiplier: currentConfig.timeout.normalRequestMultiplier,
      decayRatePerMs: currentConfig.timeout.decayRatePerMs,
    });

    // Load timeouts from persistence
    if (this.config.enablePersistence) {
      try {
        const timeoutStates = loadTimeoutsFromDisk(currentConfig.circuitBreaker.activeTestTimeout);
        if (Object.keys(timeoutStates).length > 0) {
          this.timeoutManager.loadFromPersistedData({
            timeouts: timeoutStates,
            version: 1,
          });
        }
      } catch (err) {
        logger.error('Failed to load persisted timeouts, starting with empty state:', {
          error: err,
        });
      }
    }

    // Subscribe to config changes for timeout updates
    this.unsubscribeFromConfig = getConfigManager().registerComponentWatcher(
      'circuitBreaker',
      fullConfig => {
        this.timeoutManager.updateDefaultTimeout(fullConfig.circuitBreaker.activeTestTimeout);
        logger.info('TimeoutManager updated with config change', {
          newDefault: fullConfig.circuitBreaker.activeTestTimeout,
        });
      }
    );
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: OrchestratorConfig): void {
    this.config = config;

    this.loadBalancer.updateConfig(config.loadBalancer);
    this.circuitBreakerRegistry.updateAllConfig(config.circuitBreaker);
    this.healthCheckScheduler.updateConfig(config.healthCheck);
    this.metricsAggregator.setDecayConfig(config.metrics.decay);
    getTemporalScorer().updateConfig(config.storage.temporal);
    this.banManager.updateConfig({ failureCooldownMs: config.cooldown?.failureCooldownMs });

    logger.info('Orchestrator config updated at runtime');
  }

  /**
   * Handle individual health check result
   */
  private onHealthCheckResult(result: HealthCheckResult): void {
    const server = this.servers.find(s => s.id === result.serverId);
    if (!server) {
      logger.warn(`Health check result for unknown server: ${result.serverId}`);
      return;
    }

    const wasHealthy = server.healthy;
    const previousModelCount = server.models.length;

    if (result.success) {
      // Only mark server healthy if circuit breakers are not open
      // Active testing should be the ONLY way to recover from open circuit breakers
      const serverCb = this.getCircuitBreaker(server.id);
      if (serverCb.getState() !== 'open') {
        server.healthy = true;
        server.lastResponseTime = result.responseTime ?? Infinity;

        // Track if anything changed that needs persistence
        let needsPersistence = false;

        // Update models from health check result
        if (
          result.models &&
          safeJsonStringify(result.models) !== safeJsonStringify(server.models)
        ) {
          const previousModelSet = new Set(server.models);
          server.models = result.models;
          needsPersistence = true;
          for (const model of result.models) {
            if (!previousModelSet.has(model)) {
              this.probeScheduler.onModelDiscovered(server.id, model);
            }
          }
        }

        // Update endpoint capability flags
        if (
          result.supportsOllama !== undefined &&
          result.supportsOllama !== server.supportsOllama
        ) {
          server.supportsOllama = result.supportsOllama;
          logger.info(`Server ${server.id} Ollama support updated to: ${result.supportsOllama}`);
          needsPersistence = true;
        }
        if (result.supportsV1 !== undefined && result.supportsV1 !== server.supportsV1) {
          server.supportsV1 = result.supportsV1;
          logger.info(`Server ${server.id} /v1/* support updated to: ${result.supportsV1}`);
          needsPersistence = true;
        }

        // Update OpenAI models from health check result
        if (
          result.v1Models &&
          safeJsonStringify(result.v1Models) !== safeJsonStringify(server.v1Models)
        ) {
          server.v1Models = result.v1Models;
          needsPersistence = true;
        }

        // Save to disk when anything changes
        if (needsPersistence && this.config.enablePersistence) {
          saveServersToDisk(this.servers);
        }

        // Update loaded model information from /api/ps
        if (result.loadedModels !== undefined) {
          server.hardware = {
            loadedModels: result.loadedModels,
            usedVram: result.totalVramUsed ?? 0,
            lastUpdated: new Date(),
          };
        }

        this.recordSuccess(server.id);

        // Pre-create circuit breakers for all known models on this server
        // This ensures they appear in monitoring UI even before first use
        for (const model of server.models) {
          // This will create the circuit breaker if it doesn't exist
          this.getModelCircuitBreaker(server.id, model);
        }

        if (result.modelDetails) {
          for (const detail of result.modelDetails) {
            const parameterSize = detail.parameterSize || extractParameterSizeFromName(detail.name);
            const family = detail.family || undefined;
            const quantization = detail.quantization || undefined;
            if (parameterSize ?? family ?? quantization) {
              this.metricsAggregator.updateModelMetadata(server.id, detail.name, {
                parameterSize,
                family,
                quantization,
              });
            }
          }
        }

        // Update model metadata from /api/tags details
        if (result.modelDetails) {
          for (const detail of result.modelDetails) {
            const parameterSize = detail.parameterSize || extractParameterSizeFromName(detail.name);
            const family = detail.family || undefined;
            const quantization = detail.quantization || undefined;
            if (parameterSize ?? family ?? quantization) {
              this.metricsAggregator.updateModelMetadata(server.id, detail.name, {
                parameterSize,
                family,
                quantization,
              });
            }
          }
        }

        const modelCountChanged = server.models.length !== previousModelCount;
        if (modelCountChanged || !wasHealthy) {
          logger.debug(`Health check passed for ${server.id}`, {
            responseTime: result.responseTime,
            modelCount: server.models.length,
            modelCountChanged,
          });

          // Record successful recovery if server was previously unhealthy
          if (!wasHealthy) {
            getRecoveryFailureTracker().recordRecoverySuccess(server.id, result.responseTime);
            logger.info(`Server ${server.id} successfully recovered after being unhealthy`);
            // REC-20: clear any cooldown penalties so the server is immediately eligible
            this.banManager.clearCooldown(server.id, '');
            // REC-14: immediately queue model-level active tests so we don't wait for the next
            // health-check cycle to discover which model breakers can also be closed
            void this.runActiveTestsForServer(server);
          }
        }

        // Invalidate cache if server was previously unhealthy or models changed
        if (!wasHealthy || modelCountChanged) {
          this.invalidateServerTagsCache(server.id);
        }
      } else {
        logger.debug(
          `Health check passed for ${server.id} but circuit breaker is open - attempting recovery`,
          {
            responseTime: result.responseTime,
            breakerState: serverCb.getState(),
          }
        );

        // Force close circuit breaker on successful recovery health check
        // This allows the server to become healthy again after recovery
        serverCb.forceClose();
        logger.info(
          `Circuit breaker force-closed for ${server.id} after successful recovery health check`
        );

        // Now mark server as healthy since circuit breaker is closed
        server.healthy = true;
        server.lastResponseTime = result.responseTime ?? Infinity;

        // Update models from health check result
        if (result.models) {
          server.models = result.models;
        }

        // Update loaded model information from /api/ps
        if (result.loadedModels !== undefined) {
          server.hardware = {
            loadedModels: result.loadedModels,
            usedVram: result.totalVramUsed ?? 0,
            lastUpdated: new Date(),
          };
        }

        this.recordSuccess(server.id);

        // Pre-create circuit breakers for all known models on this server
        for (const model of server.models) {
          this.getModelCircuitBreaker(server.id, model);
        }

        // Record successful recovery
        getRecoveryFailureTracker().recordRecoverySuccess(server.id, result.responseTime);
        logger.info(`Server ${server.id} successfully recovered after being unhealthy`);
        // REC-20: clear any cooldown penalties so the server is immediately eligible
        this.banManager.clearCooldown(server.id, '');
        // REC-14: immediately queue model-level active tests
        void this.runActiveTestsForServer(server);

        // Invalidate cache since server is now healthy
        this.invalidateServerTagsCache(server.id);
      }
    } else {
      server.healthy = false;
      server.models = []; // Clear models on failure
      this.recordFailure(server.id, result.error || 'Health check failed');

      this.modelAggregator.removeServer(server.id);

      // Get circuit breaker state for tracking
      const serverCb = this.getCircuitBreaker(server.id);

      // Record recovery failure
      const errorType = this.classifyRecoveryError(result.error || 'Unknown error');
      getRecoveryFailureTracker().recordRecoveryFailure(
        server.id,
        result.error || 'Health check failed',
        errorType,
        result.responseTime,
        { source: 'health_check', circuitBreakerState: serverCb.getState() }
      );

      // REC-6: detect flapping and adjust circuit breaker thresholds
      const trackerStats = getRecoveryFailureTracker().getServerRecoveryStats(server.id);
      if (trackerStats?.pattern === 'flapping') {
        serverCb.handleFlappingDetected();
      }

      logger.warn(`Health check failed for ${server.id}:`, {
        error: result.error,
      });

      // Invalidate cache if server was previously healthy
      if (wasHealthy) {
        this.invalidateServerTagsCache(server.id);
      }
    }
  }

  /**
   * Handle completion of all health checks
   */
  private onAllHealthChecksComplete(results: HealthCheckResult[]): void {
    const healthyCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    // Only log if the healthy count has changed
    if (healthyCount !== this.lastHealthyCount) {
      const change =
        healthyCount > this.lastHealthyCount
          ? '+'
          : healthyCount < this.lastHealthyCount
            ? '-'
            : '';
      const changeAmount = Math.abs(healthyCount - this.lastHealthyCount);
      logger.info(
        `Health status changed: ${healthyCount}/${totalCount} servers healthy (${change}${changeAmount})`
      );
      this.lastHealthyCount = healthyCount;
    }

    // Auto-persist server states if persistence is enabled
    // This will be handled by the existing persistence patches
  }

  /**
   * Add a new Ollama server to the registry
   */
  addServer(server: Omit<AIServer, 'healthy' | 'lastResponseTime' | 'models'>): void {
    // Normalize URL to prevent duplicates with trailing slashes or encoding differences
    const normalizedUrl = normalizeServerUrl(server.url);

    // Prevent duplicates by id or url (using normalized comparison)
    if (this.servers.some(s => s.id === server.id || areUrlsEquivalent(s.url, normalizedUrl))) {
      logger.warn(`Server ${server.id} already exists, skipping`);
      return;
    }

    const newServer: AIServer = {
      ...server,
      url: normalizedUrl, // Store the normalized URL
      type: server.type ?? 'auto',
      healthy: true,
      lastResponseTime: Infinity,
      models: [],
      maxConcurrency: server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency,
    };

    this.servers.push(newServer);
    this.modelAggregator.addServer(newServer);
    getModelManager().registerServer(newServer);
    this.probeScheduler.onServerAdded(newServer.id);
    logger.info(`Added server ${server.id} at ${normalizedUrl}`);

    // Invalidate cache since we added a new server
    this.invalidateTagsCache();

    // Persist servers to disk if enabled and not suppressed
    if (this.config.enablePersistence && !this._suppressPersistence) {
      saveServersToDisk(this.servers);
    }

    // Run health check immediately if enabled
    if (this.config.healthCheck.enabled) {
      this.updateServerStatus(newServer).catch(err => {
        logger.error(`Initial health check failed for ${server.id}:`, { error: err as Error });
      });
    }
  }
  removeServer(serverId: string): void {
    const initialCount = this.servers.length;
    this.servers = this.servers.filter(s => s.id !== serverId);
    this.modelAggregator.removeServer(serverId);

    if (this.servers.length < initialCount) {
      logger.info(`Removed server ${serverId}. Remaining servers: ${this.servers.length}`);
      // Invalidate cache since we removed a server
      this.invalidateTagsCache();

      // Clean up circuit breakers for this server (server-level and all model-level)
      this.circuitBreakerRegistry.removeByPrefix(serverId);

      this.banManager.removeServerBans(serverId);
      this.banManager.clearCooldown(serverId, '');
      this.timeoutManager.reset(serverId);
      getModelManager().unregisterServer(serverId);

      // Persist servers to disk if enabled
      if (this.config.enablePersistence) {
        logger.info(`Saving ${this.servers.length} servers to disk after removal...`);
        saveServersToDisk(this.servers);
      } else {
        logger.warn(`Persistence disabled - server removal will not be saved to disk`);
      }
    } else {
      logger.warn(ERROR_MESSAGES.SERVER_NOT_FOUND_COLON(serverId));
    }
  }

  /**
   * Get all registered servers (deduplicated)
   */
  getServers(): AIServer[] {
    const seen = new Set<string>();
    return this.servers.filter(s => {
      if (seen.has(s.id)) {
        return false;
      }
      seen.add(s.id);
      return true;
    });
  }

  /**
   * Suppress persistence during bulk operations to prevent partial writes on interruption
   */
  setSuppressPersistence(value: boolean): void {
    this._suppressPersistence = value;
  }

  /**
   * Get a specific server by ID
   */
  getServer(serverId: string): AIServer | undefined {
    return this.servers.find(s => s.id === serverId);
  }

  /**
   * Update server configuration
   */
  updateServer(
    serverId: string,
    updates: Partial<Pick<AIServer, 'maxConcurrency' | 'modelContextLimits'>>
  ): boolean {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      return false;
    }

    if (typeof updates.maxConcurrency === 'number') {
      server.maxConcurrency = updates.maxConcurrency;
      logger.info(`Updated server ${serverId} maxConcurrency to ${updates.maxConcurrency}`);
    }

    if (updates.modelContextLimits !== undefined) {
      server.modelContextLimits = { ...updates.modelContextLimits };
      server.contextLimitsFetchedAt = Date.now();
      logger.info(`Updated server ${serverId} modelContextLimits`);
    }

    // Persist servers to disk if enabled
    if (this.config.enablePersistence) {
      saveServersToDisk(this.servers);
    }

    return true;
  }

  /**
   * Update health and models for all servers
   */
  async updateAllStatus(): Promise<void> {
    await Promise.all(
      this.servers.map(async server => {
        const banDetails = this.banManager.getBanDetails();
        const bannedModels = banDetails
          .filter(b => b.serverId === server.id && b.type === 'permanent')
          .map(b => b.model);

        if (bannedModels.length > 0 && bannedModels.length >= server.models.length) {
          logger.debug(`Skipping health check for banned server ${server.id}`);
          return;
        }

        await this.updateServerStatus(server);
      })
    );
  }

  /**
   * Update status for a single server
   */
  public async updateServerStatus(server: AIServer): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const startTime = Date.now();

      // Probe selection respects server.type: ollama=skip v1, openai=skip tags, auto=probe both
      const probeOllama = server.type !== 'openai';
      const probeV1 = server.type !== 'ollama';

      const [response, versionResponse, v1Response] = await Promise.all([
        probeOllama
          ? fetch(`${server.url}/api/tags`, {
              signal: controller.signal,
            }).catch((err: unknown) => {
              logger.debug('Probe fetch failed for /api/tags', {
                serverId: server.id,
                error: String(err),
              });
              return null;
            })
          : Promise.resolve(null),
        probeOllama
          ? fetch(`${server.url}/api/version`, {
              signal: controller.signal,
            }).catch((err: unknown) => {
              logger.debug('Probe fetch failed for /api/version', {
                serverId: server.id,
                error: String(err),
              });
              return null;
            })
          : Promise.resolve(null),
        probeV1
          ? fetch(`${server.url}/v1/models`, {
              signal: controller.signal,
            }).catch((err: unknown) => {
              logger.debug('Probe fetch failed for /v1/models', {
                serverId: server.id,
                error: String(err),
              });
              return null;
            })
          : Promise.resolve(null),
      ]);

      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;

      // Check which endpoints are supported
      const supportsOllama = response?.ok ?? false;
      const supportsV1 = v1Response?.ok ?? false;

      // Update capability flags
      if (supportsOllama !== server.supportsOllama) {
        logger.info(`Server ${server.id} Ollama support: ${supportsOllama}`);
        server.supportsOllama = supportsOllama;
      }
      if (supportsV1 !== server.supportsV1) {
        logger.info(`Server ${server.id} /v1/* support: ${supportsV1}`);
        server.supportsV1 = supportsV1;
      }

      // Server is healthy if at least one endpoint works
      if (!supportsOllama && !supportsV1) {
        throw new Error('Neither /api/tags nor /v1/models responded');
      }

      // Handle version
      if (versionResponse?.ok) {
        try {
          const versionData = (await versionResponse.json()) as { version: string };
          server.version = versionData.version;
        } catch (e) {
          logger.debug('Failed to parse version response', {
            serverId: server.id,
            error: String(e),
          });
        }
      }

      server.healthy = true;
      server.lastResponseTime = responseTime;

      // Extract Ollama models from /api/tags response
      if (response?.ok) {
        const data = (await response.json()) as { models?: unknown };
        if (data && typeof data === 'object' && 'models' in data) {
          const models = (data as { models: unknown }).models;
          if (Array.isArray(models)) {
            server.models = models
              .map((m: unknown) => {
                if (typeof m === 'string') {
                  return m;
                }
                if (typeof m === 'object' && m !== null) {
                  const record = m as Record<string, unknown>;
                  return (
                    (record.model as string | undefined) ??
                    (record.name as string | undefined) ??
                    null
                  );
                }
                return null;
              })
              .filter(Boolean) as string[];

            for (const m of models) {
              if (typeof m !== 'object' || m === null) {
                continue;
              }
              const rec = m as Record<string, unknown>;
              const modelName =
                (rec.model as string | undefined) ?? (rec.name as string | undefined);
              if (!modelName) {
                continue;
              }
              const det = rec.details as Record<string, unknown> | undefined;
              const parameterSize =
                (det?.parameter_size as string | undefined) ||
                extractParameterSizeFromName(modelName);
              const family = (det?.family as string | undefined) || undefined;
              const quantization = (det?.quantization_level as string | undefined) || undefined;
              if (parameterSize ?? family ?? quantization) {
                this.metricsAggregator.updateModelMetadata(server.id, modelName, {
                  parameterSize,
                  family,
                  quantization,
                });
              }
            }
          }
        }
      }

      // Extract OpenAI models from /v1/models response
      if (v1Response?.ok) {
        try {
          const data = (await v1Response.json()) as { data?: Array<{ id?: string }> };
          if (data && Array.isArray(data.data)) {
            server.v1Models = data.data
              .map((m: { id?: string }) => m.id)
              .filter((id): id is string => typeof id === 'string');
          }
        } catch (e) {
          logger.debug('Failed to parse v1 models response', {
            serverId: server.id,
            error: String(e),
          });
        }
      }

      // Reset circuit breaker on success
      this.recordSuccess(server.id);

      // If circuit breaker is open, mark server as unhealthy despite passing health check
      if (this.shouldSkipServer(server.id)) {
        server.healthy = false;
      }

      logger.debug(`Health check passed for ${server.id}`, {
        responseTime,
        models: server.models.length,
        supportsOllama,
        supportsV1,
        v1Models: server.v1Models?.length ?? 0,
      });
    } catch (error) {
      server.healthy = false;
      server.models = [];
      this.recordFailure(server.id, error instanceof Error ? error.message : String(error));

      logger.warn(`Health check failed for ${server.id}:`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get aggregated model map: model -> serverIds[]
   */
  getModelMap(): Record<string, string[]> {
    this.modelAggregator.setServers(this.servers);
    return this.modelAggregator.getModelMap(true);
  }

  /**
   * Get all unique models across healthy servers
   */
  getAllModels(): string[] {
    return this.modelAggregator.getAllModels(true);
  }

  /**
   * Get current model list from all servers (regardless of health)
   */
  getCurrentModelList(): string[] {
    this.modelAggregator.setServers(this.servers);
    return this.modelAggregator.getCurrentModelList();
  }

  /**
   * Get aggregated tags from all servers with caching and concurrency control
   */
  async getAggregatedTags(): Promise<{ models: any[] }> {
    const now = Date.now();

    // Check cache first
    if (this.tagsCache && now - this.tagsCache.timestamp < this.config.tags.cacheTtlMs) {
      return { models: this.tagsCache.data };
    }

    const healthyServers = this.servers.filter(s => s.healthy && s.supportsOllama !== false);

    if (healthyServers.length === 0) {
      // Return cached data if available, even if stale
      if (this.tagsCache) {
        return { models: this.tagsCache.data };
      }
      return { models: [] };
    }

    const allTags = new Map<string, Record<string, unknown>>();
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    const errors: Array<{
      serverId: string;
      error: string;
      type: 'network' | 'server' | 'timeout' | 'unknown';
    }> = [];

    // Process servers in batches with concurrency control
    const maxConcurrent = this.config.tags.maxConcurrentRequests ?? 10;
    const batchDelayMs = this.config.tags.batchDelayMs ?? 50;

    for (let i = 0; i < healthyServers.length; i += maxConcurrent) {
      const batch = healthyServers.slice(i, i + maxConcurrent);

      const batchPromises = batch.map(server => this.fetchServerTags(server));
      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        totalRequests++;
        if (result.status === 'fulfilled') {
          const fetchResult = result.value;
          if (fetchResult.success && fetchResult.data) {
            successfulRequests++;
            this.mergeTagsData(allTags, fetchResult.data, fetchResult.serverId);
          } else if (fetchResult.error) {
            failedRequests++;
            errors.push(fetchResult.error);
          }
        } else {
          failedRequests++;
          // This shouldn't happen since fetchServerTags doesn't reject, but handle it anyway
          errors.push({
            serverId: 'unknown',
            error: `Promise rejected: ${result.reason}`,
            type: 'unknown',
          });
        }
      }

      // Small delay between batches to avoid overwhelming servers
      if (i + maxConcurrent < healthyServers.length) {
        await new Promise(resolve => setTimeout(resolve, batchDelayMs));
      }
    }

    const models = Array.from(allTags.values());

    // Filter out models that have no closed circuit breaker
    const filteredModels = models.filter(model => {
      const servers = model.servers as string[];
      const modelName = (model.name as string) ?? (model.model as string);
      // Use full model name (including tag like :latest) to match circuit breaker keys
      return this.hasClosedCircuitBreaker(modelName, servers);
    });

    // Cache the results
    this.tagsCache = {
      data: filteredModels,
      timestamp: now,
      metadata: {
        totalRequests,
        successfulRequests,
        failedRequests,
        serverCount: healthyServers.length,
        modelCount: filteredModels.length,
        errors: errors.slice(0, 10), // Keep only first 10 errors
      },
    };

    // Log summary
    logger.debug(
      `Tags aggregation completed: ${successfulRequests}/${totalRequests} successful requests, ${filteredModels.length} unique models`
    );

    return { models: filteredModels };
  }

  /**
   * Fetch tags from a single server with error classification
   */
  private async fetchServerTags(server: AIServer): Promise<{
    success: boolean;
    data?: any[];
    serverId: string;
    error?: { serverId: string; error: string; type: 'network' | 'server' | 'timeout' | 'unknown' };
  }> {
    const timeoutMs = this.config.tags?.requestTimeoutMs ?? 5000;

    try {
      const response = await fetchWithTimeout(`${server.url}/api/tags`, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'ollama-orchestrator/1.0.0',
        },
      });

      if (!response.ok) {
        // Classify HTTP errors
        const errorType = response.status >= 500 ? 'server' : 'unknown';
        return {
          success: false,
          serverId: server.id,
          error: {
            serverId: server.id,
            error: `HTTP ${response.status}: ${response.statusText}`,
            type: errorType,
          },
        };
      }

      const data = (await response.json()) as { models?: unknown };

      // Validate response structure
      if (!data || typeof data !== 'object') {
        return {
          success: false,
          serverId: server.id,
          error: {
            serverId: server.id,
            error: 'Invalid response: not an object',
            type: 'server',
          },
        };
      }

      if (!('models' in data)) {
        return {
          success: false,
          serverId: server.id,
          error: {
            serverId: server.id,
            error: 'Invalid response: missing models property',
            type: 'server',
          },
        };
      }

      const models = data.models;
      if (!Array.isArray(models)) {
        return {
          success: false,
          serverId: server.id,
          error: {
            serverId: server.id,
            error: 'Invalid response: models is not an array',
            type: 'server',
          },
        };
      }

      // Update circuit breaker on success
      this.recordSuccess(server.id);

      return {
        success: true,
        data: models,
        serverId: server.id,
      };
    } catch (error) {
      let errorType: 'network' | 'server' | 'timeout' | 'unknown' = 'unknown';
      let errorMessage = 'Unknown error';

      if (error instanceof Error) {
        errorMessage = error.message;

        if (error.name === 'AbortError') {
          errorType = 'timeout';
        } else if (
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('ECONNRESET')
        ) {
          errorType = 'network';
        } else if (error.message.includes('fetch failed') || error.message.includes('network')) {
          errorType = 'network';
        }
      }

      // Update circuit breaker on failure (but not for network issues)
      if (errorType !== 'network') {
        this.recordFailure(server.id, error instanceof Error ? error.message : String(error));
      }

      return {
        success: false,
        serverId: server.id,
        error: {
          serverId: server.id,
          error: errorMessage,
          type: errorType,
        },
      };
    }
  }

  /**
   * Merge tags data from a server into the global collection
   */
  private mergeTagsData(
    allTags: Map<string, Record<string, unknown>>,
    models: unknown[],
    serverId: string
  ): void {
    for (const tag of models) {
      if (!tag || typeof tag !== 'object') {
        continue;
      }

      const tagRecord = tag as Record<string, unknown>;

      // Generate safe model key
      const modelName =
        (tagRecord.name as string | undefined) ?? (tagRecord.model as string | undefined);
      if (!modelName || typeof modelName !== 'string') {
        // Skip models without valid names
        continue;
      }

      // Use model name as primary key, with fallback to digest for uniqueness
      const digest = tagRecord.digest as string | undefined;
      const modelKey = digest ? `${modelName}:${digest}` : modelName;

      if (!allTags.has(modelKey)) {
        // First time seeing this model
        allTags.set(modelKey, {
          ...tagRecord,
          servers: [serverId],
        });
      } else {
        const existing = allTags.get(modelKey);
        if (existing) {
          const servers = existing.servers as string[];
          if (!servers.includes(serverId)) {
            servers.push(serverId);
          }
        }
      }
    }
  }

  /**
   * Get aggregated OpenAI models from servers supporting /v1/* endpoints
   */
  getAggregatedOpenAIModels(): {
    object: string;
    data: Array<{ id: string; object: string; created: number; owned_by: string }>;
  } {
    // First pass: collect all servers that have each model
    const modelToServers = new Map<string, string[]>();

    for (const server of this.servers) {
      if (server.healthy && server.supportsV1 && server.v1Models) {
        for (const modelId of server.v1Models) {
          if (!modelToServers.has(modelId)) {
            modelToServers.set(modelId, []);
          }
          const servers = modelToServers.get(modelId);
          if (servers && !servers.includes(server.id)) {
            servers.push(server.id);
          }
        }
      }
    }

    // Second pass: filter to only include models with closed circuit breaker
    const models: Array<{ id: string; object: string; created: number; owned_by: string }> = [];

    for (const [modelId, servers] of modelToServers) {
      if (this.hasClosedCircuitBreaker(modelId, servers)) {
        models.push({
          id: modelId,
          object: 'model',
          created: Math.floor(Date.now() / 1000), // Unix seconds (REC-39)
          owned_by: servers[0], // Use first server as owner
        });
      }
    }

    return {
      object: 'list',
      data: models,
    };
  }

  /**
   * Check if a model has at least one closed circuit breaker across servers
   * Treats missing circuit breakers as closed
   */
  private hasClosedCircuitBreaker(modelName: string, serverIds: string[]): boolean {
    for (const serverId of serverIds) {
      const key = `${serverId}:${modelName}`;
      const breaker = this.circuitBreakerRegistry.get(key);
      if (!breaker || breaker.getState() === 'closed') {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolve model name by appending :latest tag if needed
   */
  private resolveModelName(model: string, availableModels: string[]): string | null {
    // Direct match
    if (availableModels.includes(model)) {
      return model;
    }

    // If no tag specified, try :latest
    if (!model.includes(':')) {
      const withLatest = `${model}:latest`;
      if (availableModels.includes(withLatest)) {
        return withLatest;
      }
    }

    return null;
  }

  /**
   * Check if a server can handle a prompt of the given size for a model.
   * Returns true if the server's context limit for the model is sufficient,
   * or if no context limit is known (assumes it might work).
   * If enforceFresh is true and the limit is stale (TTL expired), returns false.
   */
  canServerHandleContext(
    server: AIServer,
    model: string,
    estimatedTokens: number,
    enforceFresh: boolean = false
  ): boolean {
    const contextLimit = server.modelContextLimits?.[model];

    if (contextLimit === undefined) {
      return true; // No limit known, assume it might work
    }

    if (enforceFresh && this.isContextLimitStale(server, model)) {
      return false; // Stale limit, don't trust it
    }

    return canHandleContext(contextLimit, estimatedTokens, model);
  }

  /**
   * Check if a context limit is stale (TTL expired).
   */
  isContextLimitStale(server: AIServer, model: string): boolean {
    const contextLimit = server.modelContextLimits?.[model];
    if (contextLimit === undefined) {
      return true; // No limit known is considered stale
    }

    const fetchedAt = server.contextLimitsFetchedAt;
    if (fetchedAt === undefined) {
      return true;
    }

    const ttlMs = this.config.modelManager?.contextLimitTtlMs ?? 86400000; // Default 24h
    return Date.now() - fetchedAt > ttlMs;
  }

  /**
   * Get the context limit for a model on a server.
   * Returns the configured limit, or the default for that model family if not set.
   */
  getModelContextLimit(server: AIServer, model: string): number {
    return server.modelContextLimits?.[model] ?? getDefaultContextSize(model);
  }

  /**
   * Update the context limit for a model on a server.
   * Called when we learn the context limit from /api/show or configure it manually.
   */
  setModelContextLimit(serverId: string, model: string, contextLimit: number): void {
    const server = this.servers.find(s => s.id === serverId);
    if (server) {
      if (!server.modelContextLimits) {
        server.modelContextLimits = {};
      }
      server.modelContextLimits[model] = contextLimit;
      server.contextLimitsFetchedAt = Date.now();
      logger.debug(`Set context limit for ${serverId}:${model} to ${contextLimit}`);
    }
  }

  /**
   * Decrease the context limit for a model on a server when we see context errors.
   * This learns from failures to refine our understanding of actual context limits.
   */
  decreaseModelContextLimit(serverId: string, model: string, suggestedLimit?: number): void {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      return;
    }

    const currentLimit = server.modelContextLimits?.[model];
    if (currentLimit === undefined) {
      return;
    }

    let newLimit: number;
    if (suggestedLimit !== undefined && suggestedLimit < currentLimit) {
      newLimit = suggestedLimit;
    } else {
      newLimit = Math.floor(currentLimit * 0.8);
    }

    if (newLimit < currentLimit) {
      server.modelContextLimits![model] = newLimit;
      server.contextLimitsFetchedAt = Date.now();
      logger.info(
        `Decreased context limit for ${serverId}:${model} from ${currentLimit} to ${newLimit}`
      );
    }
  }

  /**
   * Detect if an error message is about context length.
   */
  isContextError(errorMessage: string): boolean {
    const contextPatterns = [
      'context length',
      'context_window',
      'too many tokens',
      'token limit',
      'maximum context',
      'context overflow',
      '超出上下文',
      'context exceeded',
    ];
    const lowerMsg = errorMessage.toLowerCase();
    return contextPatterns.some(pattern => lowerMsg.includes(pattern.toLowerCase()));
  }

  /**
   * Extract a suggested context limit from an error message if present.
   * Ollama sometimes includes the limit in the error, e.g., "context length 8192 exceeded"
   */
  extractContextLimitFromError(errorMessage: string): number | undefined {
    const patterns = [
      /context length (\d+)/i,
      /context_window (\d+)/i,
      /(\d+) tokens?/i,
      /token limit (\d+)/i,
      /maximum context (\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = errorMessage.match(pattern);
      if (match && match[1]) {
        const limit = parseInt(match[1], 10);
        if (!isNaN(limit) && limit > 0) {
          return limit;
        }
      }
    }

    return undefined;
  }

  /**
   * Find the best server for a given model using historical metrics
   */
  getBestServerForModel(
    model: string,
    isStreaming: boolean = false,
    estimatedPromptTokens?: number
  ): AIServer | undefined {
    // Filter candidates based on hard requirements
    const candidates = this.servers.filter(server => {
      // Must be healthy
      if (!server.healthy) {
        return false;
      }

      // Must not be draining or in maintenance
      if (server.draining === true || server.maintenance === true) {
        return false;
      }

      // Must have the model (with :latest resolution)
      const resolvedModel = this.resolveModelName(model, server.models);
      if (!resolvedModel) {
        return false;
      }

      // Must not be in cooldown
      if (this.isInCooldown(server.id, model)) {
        return false;
      }

      // Must not be permanently banned for this model.
      // BanManager and CircuitBreaker are intentionally independent: BanManager enforces
      // cooldown-based exclusions for specific server:model pairs (e.g. after repeated failures
      // or explicit operator bans), while CircuitBreaker tracks failure-rate thresholds per
      // server. Both checks are evaluated here to exclude a server from routing — neither is
      // authoritative for all exclusion scenarios, providing defense-in-depth.
      if (this.banManager.isBanned(server.id, model)) {
        return false;
      }

      // Must not be circuit breaker open
      if (this.shouldSkipServer(server.id)) {
        return false;
      }

      // Must have capacity
      const maxConcurrency = server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
      const totalLoad = this.getTotalInFlight(server.id);
      if (totalLoad >= maxConcurrency) {
        return false;
      }

      // Context limit filtering: skip servers that can't handle the prompt size
      // Only applies when we have an estimated prompt size and it's non-trivial (>100 tokens)
      if (estimatedPromptTokens !== undefined && estimatedPromptTokens > 100) {
        if (!this.canServerHandleContext(server, model, estimatedPromptTokens)) {
          const contextLimit = this.getModelContextLimit(server, model);
          logger.debug(
            `getBestServerForModel: skipping ${server.id} for ${model}: context limit ${contextLimit} < ${estimatedPromptTokens} tokens`
          );
          return false;
        }
      }

      return true;
    });

    if (candidates.length === 0) {
      return undefined;
    }

    if (candidates.length === 1) {
      const selected = candidates[0];
      // Record the decision even for single candidate
      const scores = candidates.map(server => {
        const totalLoad = this.getTotalInFlight(server.id);
        const metrics = this.metricsAggregator.getMetrics(server.id, model);
        const cbHealth = this.getCircuitBreakerHealth(server.id, model);
        return calculateServerScore(
          server,
          model,
          totalLoad,
          totalLoad,
          metrics,
          undefined,
          cbHealth,
          this.getTimeout(server.id, model),
          estimatedPromptTokens,
          (serverId, model) =>
            this.getModelContextLimit(this.servers.find(s => s.id === serverId)!, model)
        );
      });

      getDecisionHistory().recordDecision(
        model,
        selected,
        this.loadBalancer.getAlgorithm(),
        scores,
        'single_candidate'
      );
      return selected;
    }

    // Use load balancer with historical metrics for intelligent selection
    const selected = this.loadBalancer.select(
      candidates,
      model,
      (serverId, model) => this.getModelInFlight(serverId, model),
      serverId => this.getTotalInFlight(serverId),
      (serverId, model) => this.metricsAggregator.getMetricsWithFallback(serverId, model),
      isStreaming,
      undefined,
      (serverId, model) => this.getTimeout(serverId, model),
      serverId => this.getCircuitBreakerHealth(serverId),
      estimatedPromptTokens,
      (serverId, model) =>
        this.getModelContextLimit(this.servers.find(s => s.id === serverId)!, model)
    );

    // Record the decision for historical analysis
    if (selected) {
      const scores = candidates.map(server => {
        const totalLoad = this.getTotalInFlight(server.id);
        const metrics = this.metricsAggregator.getMetricsWithFallback(server.id, model);
        const cbHealth = this.getCircuitBreakerHealth(server.id, model);
        return calculateServerScore(
          server,
          model,
          totalLoad,
          totalLoad,
          metrics,
          undefined,
          cbHealth,
          this.getTimeout(server.id, model),
          estimatedPromptTokens,
          (serverId, model) =>
            this.getModelContextLimit(this.servers.find(s => s.id === serverId)!, model)
        );
      });

      getDecisionHistory().recordDecision(
        model,
        selected,
        this.loadBalancer.getAlgorithm(),
        scores,
        'load_balancer'
      );
    }

    return selected;
  }

  /**
   * Get server scores for debugging/routing decisions
   */
  getServerScores(model: string): Array<ReturnType<typeof calculateServerScore>> {
    const candidates = this.servers.filter(server => {
      if (!server.healthy) {
        return false;
      }
      if (!server.models.includes(model)) {
        return false;
      }
      if (this.isInCooldown(server.id, model)) {
        return false;
      }
      if (this.banManager.isBanned(server.id, model)) {
        return false;
      }
      if (this.shouldSkipServer(server.id)) {
        return false;
      }
      const maxConcurrency = server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
      const totalLoad = this.getTotalInFlight(server.id);
      if (totalLoad >= maxConcurrency) {
        return false;
      }
      return true;
    });

    return candidates
      .map(server => {
        const totalLoad = this.getTotalInFlight(server.id);
        const metrics = this.metricsAggregator.getMetrics(server.id, model);
        const cbHealth = this.getCircuitBreakerHealth(server.id, model);
        return calculateServerScore(
          server,
          model,
          totalLoad,
          totalLoad,
          metrics,
          undefined,
          cbHealth,
          this.getTimeout(server.id, model)
        );
      })
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * Get load balancer score for any server:model (including those with open circuits)
   * This is useful for showing "what-if" scores in the frontend
   */
  getLBScoreForServerModel(serverId: string, model: string) {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      return undefined;
    }

    const totalLoad = this.getTotalInFlight(server.id);
    const metrics = this.metricsAggregator.getMetrics(server.id, model);

    // Calculate score as if circuit breaker was healthy (for "what-if" scenario)
    const cbHealth = {
      state: 'closed' as const,
      failureCount: 0,
      errorRate: 0,
      lastFailure: undefined,
    };

    // Use totalLoad as the current load for server-level capacity scoring
    return calculateServerScore(
      server,
      model,
      totalLoad,
      totalLoad,
      metrics,
      undefined,
      cbHealth,
      this.getTimeout(server.id, model)
    );
  }

  /**
   * Execute a request with automatic failover
   * Strategy: Try all servers first (no same-server retries), then retry the full cycle once more.
   * Only after exhausting all servers twice, attempt same-server retries on the original server.
   */
  async tryRequestWithFailover<T>(
    model: string,
    fn: (server: AIServer, context?: { requestId?: string }) => Promise<T>,
    isStreaming: boolean = false,
    endpoint: 'generate' | 'embeddings' = 'generate',
    requiredCapability?: 'ollama' | 'openai' | 'anthropic',
    routingContext?: RoutingContext,
    signal?: AbortSignal,
    estimatedPromptTokens?: number
  ): Promise<T> {
    const errors: Array<{ server: string; error: string; type?: ErrorType }> = [];
    const routingStartTime = Date.now();

    // Check for abort before starting
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    // Track context-filtered servers for better error messages
    let contextFilteredCount = 0;
    let smallestContextLimit = Infinity;
    const eligibleServers = this.servers.filter(s => {
      // Check capability requirement
      if (requiredCapability === 'ollama' && s.supportsOllama === false) {
        return false;
      }
      if (requiredCapability === 'openai' && s.supportsV1 === false) {
        return false;
      }
      if (requiredCapability === 'anthropic' && s.supportsAnthropic === false) {
        return false;
      }

      // Get the appropriate model list for this capability
      const availableModels =
        requiredCapability === 'openai' || requiredCapability === 'anthropic'
          ? (s.v1Models ?? s.models)
          : s.models;

      // Resolve model name (try direct match, then :latest)
      const resolvedModel = this.resolveModelName(model, availableModels);
      if (!resolvedModel) {
        return false;
      }

      // Context limit filtering: skip servers that can't handle the prompt size
      // Only applies when we have an estimated prompt size and it's non-trivial
      if (estimatedPromptTokens !== undefined && estimatedPromptTokens > 100) {
        if (!this.canServerHandleContext(s, model, estimatedPromptTokens)) {
          const contextLimit = this.getModelContextLimit(s, model);
          contextFilteredCount++;
          if (contextLimit < smallestContextLimit) {
            smallestContextLimit = contextLimit;
          }
          logger.debug(
            `Skipping server ${s.id} for ${model}: context limit ${contextLimit} < ${estimatedPromptTokens} tokens`
          );
          return false;
        }
      }

      return (
        s.healthy &&
        !this.isInCooldown(s.id, model) &&
        !this.banManager.isBanned(s.id, model) &&
        !this.shouldSkipServerModel(s.id, model, endpoint)
      );
    });

    // Sort candidates using load balancer (historical metrics)
    let candidates: AIServer[] = [];
    const remainingServers = [...eligibleServers];

    // Record initial decision with full scoring (first selection = primary routing decision)
    let firstDecisionRecorded = false;

    while (remainingServers.length > 0) {
      const selected = this.loadBalancer.select(
        remainingServers,
        model,
        (serverId, model) => this.getModelInFlight(serverId, model),
        serverId => this.getTotalInFlight(serverId),
        (serverId, model) => this.metricsAggregator.getMetricsWithFallback(serverId, model),
        isStreaming,
        undefined,
        (serverId, model) => this.getTimeout(serverId, model),
        serverId => this.getCircuitBreakerHealth(serverId)
      );

      if (!selected) {
        break;
      }

      // Record decision for the first selection (actual routing decision with full scores)
      if (!firstDecisionRecorded) {
        const scores = remainingServers.map(server => {
          const totalLoad = this.getTotalInFlight(server.id);
          const metrics = this.metricsAggregator.getMetricsWithFallback(server.id, model);
          const cbHealth = this.getCircuitBreakerHealth(server.id, model);
          return calculateServerScore(
            server,
            model,
            totalLoad,
            totalLoad,
            metrics,
            undefined,
            cbHealth,
            this.getTimeout(server.id, model),
            estimatedPromptTokens,
            (serverId, model) =>
              this.getModelContextLimit(this.servers.find(s => s.id === serverId)!, model)
          );
        });

        getDecisionHistory().recordDecision(
          model,
          selected,
          this.loadBalancer.getAlgorithm(),
          scores,
          'failover_routing'
        );
        firstDecisionRecorded = true;
      }

      candidates.push(selected);
      const index = remainingServers.findIndex(s => s.id === selected.id);
      if (index >= 0) {
        remainingServers.splice(index, 1);
      }
    }

    if (candidates.length === 0) {
      // REC-71: Differentiate "No servers" error conditions
      let errorReason = 'No servers available';

      // Check if context filtering eliminated all servers (must be checked first)
      if (
        estimatedPromptTokens !== undefined &&
        estimatedPromptTokens > 100 &&
        contextFilteredCount > 0
      ) {
        throw new Error(
          `Prompt size (${estimatedPromptTokens} tokens) exceeds context limit on all ${contextFilteredCount} server(s) ` +
            `(smallest limit: ${smallestContextLimit === Infinity ? 'unknown' : smallestContextLimit} tokens) for model '${model}'. ` +
            'Consider splitting the prompt or using a server with a larger context window.'
        );
      }

      // Check if no servers support the required capability
      const capabilityServers = this.servers.filter(s => {
        if (requiredCapability === 'ollama' && s.supportsOllama === false) {
          return false;
        }
        if (requiredCapability === 'openai' && s.supportsV1 === false) {
          return false;
        }
        if (requiredCapability === 'anthropic' && s.supportsAnthropic === false) {
          return false;
        }
        return true;
      });

      if (capabilityServers.length === 0) {
        errorReason = `No servers support required capability '${requiredCapability}'`;
      } else {
        // Check if no servers have the model
        const modelServers = capabilityServers.filter(s => {
          const availableModels =
            requiredCapability === 'openai' || requiredCapability === 'anthropic'
              ? (s.v1Models ?? s.models)
              : s.models;
          const resolvedModel = this.resolveModelName(model, availableModels);
          return resolvedModel !== null;
        });

        if (modelServers.length === 0) {
          errorReason = `Model '${model}' not found on any ${requiredCapability || 'configured'} server`;
        } else {
          // Check remaining conditions: healthy, not banned, not in cooldown, not circuit breaker blocked
          const healthyServers = modelServers.filter(s => s.healthy);
          if (healthyServers.length === 0) {
            errorReason = 'All servers are unhealthy';
          } else {
            const availableServers = healthyServers.filter(
              s =>
                !this.banManager.isBanned(s.id, model) &&
                !this.isInCooldown(s.id, model) &&
                !this.shouldSkipServerModel(s.id, model, endpoint)
            );
            if (availableServers.length === 0) {
              const bannedCount = healthyServers.filter(s =>
                this.banManager.isBanned(s.id, model)
              ).length;
              const cooldownCount = healthyServers.filter(s =>
                this.isInCooldown(s.id, model)
              ).length;
              const circuitCount = healthyServers.filter(s =>
                this.shouldSkipServerModel(s.id, model, endpoint)
              ).length;

              if (bannedCount === healthyServers.length) {
                errorReason = 'All servers are permanently banned for this model';
              } else if (cooldownCount === healthyServers.length) {
                errorReason = 'All servers are in cooldown for this model';
              } else if (circuitCount === healthyServers.length) {
                errorReason = 'All servers have open circuit breakers for this model';
              } else {
                errorReason =
                  'All servers are unavailable (banned, in cooldown, or circuit breaker open)';
              }
            }
          }
        }
      }

      throw new Error(`${errorReason} for model '${model}'`);
    }

    const initialServer = candidates[0];

    // Populate routing context with available server count
    if (routingContext) {
      routingContext.availableServerCount = candidates.length;
      routingContext.totalCandidates = candidates.length;
    }

    logger.info(`Selected server ${initialServer.id} for model ${model}`, {
      totalCandidates: candidates.length,
      initialServer: initialServer.id,
      serverHealth: initialServer.healthy,
      serverLoad: this.getTotalInFlight(initialServer.id),
    });

    const retryConfig = this.config.retry;
    let retryCount = 0;
    let failoverPhase = 1;
    const failoverErrors: Array<{ serverId: string; error: string; errorType?: string }> = [];
    const allServersTried: string[] = [];
    let concurrencySkipCount = 0; // Track how many candidates were skipped due to max concurrency
    // Generate a stable user request ID that links all retry/failover attempts
    const userRequestId = `ureq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Phase 1: Try each candidate once (failover-first strategy)
    logger.info(`Phase 1: Trying ${candidates.length} candidate(s) once each`, { model });
    for (const server of candidates) {
      // Check for abort before each attempt
      if (signal?.aborted) {
        throw new Error('Request aborted');
      }
      const maxConcurrency = server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
      const canIncrement = this.inFlightManager.tryIncrementInFlight(
        server.id,
        model,
        maxConcurrency
      );

      if (!canIncrement) {
        concurrencySkipCount++;
        logger.info(`Skipping server ${server.id} for model ${model}: at max concurrency`, {
          maxConcurrency,
        });
        // REC-74: Record skipped attempt
        getDecisionHistory().recordFailoverAttempt({
          model,
          phase: 1,
          serverId: server.id,
          result: 'skipped',
        });
        getMetricsStore().recordFailover({
          requestId: userRequestId,
          timestamp: Date.now(),
          model,
          phase: 1,
          serverId: server.id,
          result: 'skipped',
        });
        continue;
      }

      // Try request WITHOUT same-server retries (failover immediately)
      const attemptStart1 = Date.now();
      const result = await this.tryRequestOnServerNoRetry(
        server,
        model,
        fn,
        isStreaming,
        errors,
        undefined,
        true,
        userRequestId,
        retryCount > 0,
        routingContext
      );
      const attemptLatency1 = Date.now() - attemptStart1;

      if (result.success) {
        // REC-74: Record successful attempt
        getDecisionHistory().recordFailoverAttempt({
          model,
          phase: 1,
          serverId: server.id,
          result: 'success',
          latencyMs: attemptLatency1,
        });
        getMetricsStore().recordFailover({
          requestId: userRequestId,
          timestamp: Date.now(),
          model,
          phase: 1,
          serverId: server.id,
          result: 'success',
          latencyMs: attemptLatency1,
        });
        if (routingContext) {
          routingContext.retryCount = retryCount;
          routingContext.serversTried = [...allServersTried, server.id];
          routingContext.queueWaitTime = Date.now() - routingStartTime;
          routingContext.failoverPhase = 1;
          routingContext.failoverCount = retryCount;
          routingContext.failoverOccurred = retryCount > 0;
          if (failoverErrors.length > 0) {
            routingContext.failoverErrors = failoverErrors;
          }
        }
        const serverMaxConcurrency =
          server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
        const serverLoad = this.getTotalInFlight(server.id);
        this.populateRoutingContext(
          routingContext,
          server.id,
          model,
          serverLoad,
          serverMaxConcurrency
        );
        return result.value;
      }

      // REC-74: Record failed attempt
      const lastError = errors[errors.length - 1];
      getDecisionHistory().recordFailoverAttempt({
        model,
        phase: 1,
        serverId: server.id,
        result: 'failure',
        errorType: lastError?.type,
        latencyMs: attemptLatency1,
      });
      getMetricsStore().recordFailover({
        requestId: userRequestId,
        timestamp: Date.now(),
        model,
        phase: 1,
        serverId: server.id,
        result: 'failure',
        errorType: lastError?.type,
        latencyMs: attemptLatency1,
      });

      allServersTried.push(server.id);
      if (lastError) {
        failoverErrors.push({
          serverId: server.id,
          error: lastError.error,
          errorType: lastError.type,
        });
      }

      retryCount++;
      logger.info(`Server ${server.id} failed, failing over to next candidate`, { model });
    }

    // Phase 2: Retry full cycle once more (all servers one more time)
    failoverPhase = 2;
    // Check for abort before Phase 2
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }
    // Re-filter candidates to account for servers that entered cooldown during Phase 1
    candidates = candidates.filter(
      s =>
        s.healthy &&
        !this.isInCooldown(s.id, model) &&
        !this.banManager.isBanned(s.id, model) &&
        !this.shouldSkipServerModel(s.id, model, endpoint)
    );

    logger.info(`Phase 2: Retrying full cycle of ${candidates.length} candidate(s)`, { model });
    for (const server of candidates) {
      // Check for abort before each attempt
      if (signal?.aborted) {
        throw new Error('Request aborted');
      }
      const maxConcurrency = server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
      const canIncrement = this.inFlightManager.tryIncrementInFlight(
        server.id,
        model,
        maxConcurrency
      );

      if (!canIncrement) {
        concurrencySkipCount++;
        // REC-74: Record skipped attempt
        getDecisionHistory().recordFailoverAttempt({
          model,
          phase: 2,
          serverId: server.id,
          result: 'skipped',
        });
        getMetricsStore().recordFailover({
          requestId: userRequestId,
          timestamp: Date.now(),
          model,
          phase: 2,
          serverId: server.id,
          result: 'skipped',
        });
        continue;
      }

      const attemptStart2 = Date.now();
      const result = await this.tryRequestOnServerNoRetry(
        server,
        model,
        fn,
        isStreaming,
        errors,
        undefined,
        true,
        userRequestId,
        true, // Phase 2 is always a retry
        routingContext
      );
      const attemptLatency2 = Date.now() - attemptStart2;

      if (result.success) {
        // REC-74: Record successful attempt
        getDecisionHistory().recordFailoverAttempt({
          model,
          phase: 2,
          serverId: server.id,
          result: 'success',
          latencyMs: attemptLatency2,
        });
        getMetricsStore().recordFailover({
          requestId: userRequestId,
          timestamp: Date.now(),
          model,
          phase: 2,
          serverId: server.id,
          result: 'success',
          latencyMs: attemptLatency2,
        });
        if (routingContext) {
          routingContext.retryCount = retryCount;
          routingContext.serversTried = [...allServersTried, server.id];
          routingContext.queueWaitTime = Date.now() - routingStartTime;
          routingContext.failoverPhase = 2;
          routingContext.failoverCount = retryCount;
          routingContext.failoverOccurred = true;
          if (failoverErrors.length > 0) {
            routingContext.failoverErrors = failoverErrors;
          }
        }
        const serverMaxConcurrency =
          server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
        const serverLoad = this.getTotalInFlight(server.id);
        this.populateRoutingContext(
          routingContext,
          server.id,
          model,
          serverLoad,
          serverMaxConcurrency
        );
        return result.value;
      }
      // REC-74: Record failed attempt
      const lastError2 = errors[errors.length - 1];
      getDecisionHistory().recordFailoverAttempt({
        model,
        phase: 2,
        serverId: server.id,
        result: 'failure',
        errorType: lastError2?.type,
        latencyMs: attemptLatency2,
      });
      getMetricsStore().recordFailover({
        requestId: userRequestId,
        timestamp: Date.now(),
        model,
        phase: 2,
        serverId: server.id,
        result: 'failure',
        errorType: lastError2?.type,
        latencyMs: attemptLatency2,
      });
      allServersTried.push(server.id);
      if (lastError2) {
        failoverErrors.push({
          serverId: server.id,
          error: lastError2.error,
          errorType: lastError2.type,
        });
      }
      retryCount++;
    }

    // Phase 3: All servers exhausted twice, now try same-server retries on initial server only
    failoverPhase = 3;
    // Check for abort before Phase 3
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }
    logger.info(
      `Phase 3: All servers exhausted twice. Attempting same-server retries on initial server ${initialServer.id}`,
      { model }
    );
    const maxConcurrency =
      initialServer.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
    const totalLoad = this.getTotalInFlight(initialServer.id);

    if (totalLoad < maxConcurrency) {
      const attemptStart3 = Date.now();
      const result = await this.tryRequestOnServerWithRetries(
        initialServer,
        model,
        fn,
        isStreaming,
        retryConfig,
        errors,
        undefined,
        userRequestId,
        routingContext
      );
      const attemptLatency3 = Date.now() - attemptStart3;

      if (result.success) {
        // REC-74: Record successful Phase 3 attempt
        getDecisionHistory().recordFailoverAttempt({
          model,
          phase: 3,
          serverId: initialServer.id,
          result: 'success',
          latencyMs: attemptLatency3,
        });
        getMetricsStore().recordFailover({
          requestId: userRequestId,
          timestamp: Date.now(),
          model,
          phase: 3,
          serverId: initialServer.id,
          result: 'success',
          latencyMs: attemptLatency3,
        });
        if (routingContext) {
          routingContext.retryCount = retryCount;
          routingContext.serversTried = [...allServersTried, initialServer.id];
          routingContext.queueWaitTime = Date.now() - routingStartTime;
          routingContext.failoverPhase = 3;
          routingContext.failoverCount = retryCount;
          routingContext.failoverOccurred = true;
          if (failoverErrors.length > 0) {
            routingContext.failoverErrors = failoverErrors;
          }
        }
        this.populateRoutingContext(
          routingContext,
          initialServer.id,
          model,
          totalLoad,
          maxConcurrency
        );
        return result.value;
      }

      // REC-74: Record failed Phase 3 attempt
      const lastError3 = errors[errors.length - 1];
      getDecisionHistory().recordFailoverAttempt({
        model,
        phase: 3,
        serverId: initialServer.id,
        result: 'failure',
        errorType: lastError3?.type,
        latencyMs: attemptLatency3,
      });
      getMetricsStore().recordFailover({
        requestId: userRequestId,
        timestamp: Date.now(),
        model,
        phase: 3,
        serverId: initialServer.id,
        result: 'failure',
        errorType: lastError3?.type,
        latencyMs: attemptLatency3,
      });
      allServersTried.push(initialServer.id);
      if (lastError3) {
        failoverErrors.push({
          serverId: initialServer.id,
          error: lastError3.error,
          errorType: lastError3.type,
        });
      }
    }

    // All candidates exhausted
    if (routingContext) {
      routingContext.retryCount = retryCount;
      routingContext.serversTried = allServersTried;
      routingContext.failoverPhase = failoverPhase;
      routingContext.failoverCount = retryCount;
      routingContext.failoverOccurred = retryCount > 0;
      if (failoverErrors.length > 0) {
        routingContext.failoverErrors = failoverErrors;
      }
    }

    // Distinguish concurrency saturation from other failures
    let errorMessage: string;
    if (errors.length > 0) {
      errorMessage =
        `All ${candidates.length} candidate(s) failed after 2 full cycles and same-server retries. ` +
        `Errors: ${errors.map(e => `${e.server}: ${e.error.substring(0, 100)}`).join('; ')}`;
    } else if (concurrencySkipCount > 0) {
      errorMessage =
        `All ${candidates.length} server(s) for model '${model}' are at max concurrency` +
        ` (${concurrencySkipCount} concurrency-blocked across all phases)`;
    } else {
      errorMessage = `No servers available for model '${model}'`;
    }

    throw new Error(errorMessage);
  }

  /**
   * Execute a request to a specific server (bypassing load balancer)
   * Useful for testing, debugging, or explicit server routing
   * @param serverId - The server ID to route to
   * @param model - The model to use
   * @param fn - Function to execute on the server
   * @param options - Optional parameters
   */
  async requestToServer<T>(
    serverId: string,
    model: string,
    fn: (server: AIServer, context?: { requestId?: string }) => Promise<T>,
    options: {
      isStreaming?: boolean;
      bypassCircuitBreaker?: boolean;
      signal?: AbortSignal;
      routingContext?: RoutingContext;
    } = {}
  ): Promise<T> {
    const {
      isStreaming: _isStreaming = false,
      bypassCircuitBreaker = false,
      signal,
      routingContext,
    } = options;

    // Check for abort before starting
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    // Find the server by ID
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      throw new Error(ERROR_MESSAGES.SERVER_NOT_FOUND_COLON(serverId));
    }

    if (!server.healthy && !bypassCircuitBreaker) {
      throw new Error(`Server is not healthy: ${serverId}`);
    }

    if (!server.models.includes(model)) {
      throw new Error(`Model '${model}' not available on server ${serverId}`);
    }

    // Check cooldown (skip if bypassing circuit breaker)
    if (!bypassCircuitBreaker && this.isInCooldown(server.id, model)) {
      throw new Error(`Server ${serverId} is in cooldown for model ${model}`);
    }

    // Check permanent ban (skip if bypassing circuit breaker)
    if (!bypassCircuitBreaker && this.banManager.isBanned(server.id, model)) {
      throw new Error(`Server ${serverId} is permanently banned for model ${model}`);
    }

    // Check circuit breaker (skip if bypassing)
    const modelCb = this.getModelCircuitBreaker(server.id, model);
    if (!bypassCircuitBreaker && !modelCb.canExecute()) {
      throw new Error(`Circuit breaker is open for ${serverId}:${model}`);
    }

    // Execute with in-flight tracking (this is the key difference - uses normal request tracking)
    this.incrementInFlight(server.id, model, bypassCircuitBreaker);

    // Generate request context if streaming
    const requestId = _isStreaming
      ? `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      : undefined;

    try {
      const result = await fn(server, requestId ? { requestId } : undefined);

      // Record success
      this.decrementInFlight(server.id, model, bypassCircuitBreaker);

      // Only record circuit breaker success if not bypassing
      if (!bypassCircuitBreaker) {
        this.recordSuccess(server.id, model);
      }

      // Populate routing context if provided (REC-54)
      if (routingContext) {
        const serverLoad = this.getTotalInFlight(server.id);
        const maxConcurrency = server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
        routingContext.queueWaitTime = 0; // Direct-to-server, no routing delay
        this.populateRoutingContext(routingContext, server.id, model, serverLoad, maxConcurrency);
      }

      return result;
    } catch (error) {
      this.decrementInFlight(server.id, model, bypassCircuitBreaker);

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record failure in circuit breaker (skip if bypassing)
      if (!bypassCircuitBreaker) {
        this.recordFailure(server.id, errorMessage, model);
      }

      throw error;
    }
  }

  private async tryRequestOnServerNoRetry<T>(
    server: AIServer,
    model: string,
    fn: (server: AIServer, context?: { requestId?: string }) => Promise<T>,
    isStreaming: boolean,
    errors: Array<{ server: string; error: string; type?: ErrorType }>,
    _timeoutMs?: number,
    alreadyIncremented: boolean = false,
    parentRequestId?: string,
    isRetry: boolean = false,
    routingContext?: RoutingContext
  ): Promise<{ success: true; value: T } | { success: false }> {
    // Check circuit breaker state BEFORE attempting request
    const serverCb = this.getCircuitBreaker(server.id);
    const modelCb = this.getModelCircuitBreaker(server.id, model);

    // Check if either circuit breaker is half-open - if so, perform recovery test
    const serverState = serverCb.getState();
    const modelState = modelCb.getState();
    const isServerHalfOpen = serverState === 'half-open';
    const isModelHalfOpen = modelState === 'half-open';

    if (isServerHalfOpen || isModelHalfOpen) {
      logger.debug(
        `Circuit breaker half-open for ${server.id}:${model}, performing coordinated recovery test`
      );

      // REC-19: if a half-open breaker has been stuck in that state longer than
      // its configured halfOpenTimeout, push it back to open immediately rather
      // than spawning another recovery test that will never land.
      const now = Date.now();
      const checkHalfOpenExpiry = (
        cb: import('../circuit-breaker/circuit-breaker.js').CircuitBreaker
      ): boolean => {
        if (cb.getState() !== 'half-open') {
          return false;
        }
        const stats = cb.getStats();
        const cfg = cb.getConfig();
        if (stats.halfOpenStartedAt && stats.halfOpenStartedAt > 0) {
          const timeInHalfOpen = now - stats.halfOpenStartedAt;
          if (timeInHalfOpen > cfg.halfOpenTimeout) {
            logger.warn(
              `Half-open breaker ${cb.getName()} timed out in request path after ${timeInHalfOpen}ms (limit: ${cfg.halfOpenTimeout}ms), reverting to open`
            );
            cb.recordFailure(new Error('Half-open timeout in request path'), 'transient');
            return true;
          }
        }
        return false;
      };

      const serverExpired = isServerHalfOpen && checkHalfOpenExpiry(serverCb);
      const modelExpired = isModelHalfOpen && checkHalfOpenExpiry(modelCb);

      if (serverExpired || modelExpired) {
        const errorMsg = `Circuit breaker half-open timeout for ${server.id}:${model}`;
        logger.debug(errorMsg);
        errors.push({ server: server.id, error: errorMsg, type: 'transient' });
        if (alreadyIncremented) {
          this.decrementInFlight(server.id, model);
        }
        return { success: false };
      }

      // Use RecoveryTestCoordinator for coordinated testing
      // - Server-level breakers: lightweight /api/tags test
      // - Model-level breakers: full inference test with server coordination (one at a time per server)
      const coordinator = getRecoveryTestCoordinator();

      try {
        const recoveryPromises: Promise<boolean>[] = [];
        const breakersToTest: CircuitBreaker[] = [];

        if (isServerHalfOpen) {
          recoveryPromises.push(coordinator.performCoordinatedRecoveryTest(serverCb));
          breakersToTest.push(serverCb);
        }
        if (isModelHalfOpen) {
          recoveryPromises.push(coordinator.performCoordinatedRecoveryTest(modelCb));
          breakersToTest.push(modelCb);
        }

        const recoveryResults = await Promise.all(recoveryPromises);
        const allRecovered = recoveryResults.every(result => result);

        if (allRecovered) {
          logger.info(`Recovery test passed for ${server.id}:${model}, proceeding with request`);
          // Recovery successful, proceed with request
        } else {
          // Recovery failed - record failure for each failed breaker to transition back to open
          for (let i = 0; i < recoveryResults.length; i++) {
            if (!recoveryResults[i]) {
              const failedBreaker = breakersToTest[i];
              const errorMsg = `Circuit breaker recovery failed for ${server.id}:${model}`;
              // Use stored lastErrorType to preserve original error classification
              // This ensures proper backoff (e.g., 48h for auth errors, 2min for transient)
              const errorType = failedBreaker.getLastErrorType() || 'transient';
              failedBreaker.recordFailure(new Error(errorMsg), errorType);
              logger.warn(`Recovery test failed for breaker, transitioning back to open`);
            }
          }

          const errorMsg = `Circuit breaker recovery failed or deferred for ${server.id}:${model}`;
          logger.debug(errorMsg);
          errors.push({ server: server.id, error: errorMsg, type: 'transient' });
          if (alreadyIncremented) {
            this.decrementInFlight(server.id, model);
          }
          return { success: false };
        }
      } catch (error) {
        logger.warn(`Recovery test error for ${server.id}:${model}`, { error });
        const errorMsg = `Circuit breaker recovery error for ${server.id}:${model}`;
        errors.push({ server: server.id, error: errorMsg, type: 'transient' });
        if (alreadyIncremented) {
          this.decrementInFlight(server.id, model);
        }
        return { success: false };
      }
    }

    if (!serverCb.canExecute() || !modelCb.canExecute()) {
      const circuitState = !serverCb.canExecute() ? serverCb.getState() : modelCb.getState();
      const errorMsg = `Circuit breaker ${circuitState} for ${server.id}:${model}`;
      logger.debug(errorMsg);
      errors.push({ server: server.id, error: errorMsg, type: 'transient' });
      if (alreadyIncremented) {
        this.decrementInFlight(server.id, model);
      }
      return { success: false };
    }

    // Capture circuit breaker state BEFORE request starts
    // This is critical for determining if this was an active test (half-open state)
    const circuitStateAtStart = {
      serverState: serverCb.getState(),
      modelState: modelCb.getState(),
    };
    const wasActiveTestAtStart =
      circuitStateAtStart.serverState === 'half-open' ||
      circuitStateAtStart.modelState === 'half-open';

    const requestContext: RequestContext = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      startTime: Date.now(),
      serverId: server.id,
      model,
      endpoint: 'generate',
      streaming: isStreaming,
      success: false,
      parentRequestId,
      isRetry,
    };

    try {
      if (!alreadyIncremented) {
        this.incrementInFlight(server.id, model);
      }

      // Track streaming requests for real-time progress monitoring
      if (isStreaming) {
        this.inFlightManager.addStreamingRequest(requestContext.id, server.id, model);
        // Pass requestId in context instead of mutating server
      }

      const result = await fn(server, { requestId: requestContext.id });
      this.decrementInFlight(server.id, model);

      // Record successful request metrics
      requestContext.endTime = Date.now();
      requestContext.duration = requestContext.endTime - requestContext.startTime;
      requestContext.success = true;

      // Extract token metrics from Ollama response for non-streaming requests
      if (!isStreaming && result && typeof result === 'object') {
        const ollamaResponse = result as Record<string, unknown>;
        if (typeof ollamaResponse.eval_count === 'number') {
          requestContext.tokensGenerated = ollamaResponse.eval_count;
        }
        if (typeof ollamaResponse.prompt_eval_count === 'number') {
          requestContext.tokensPrompt = ollamaResponse.prompt_eval_count;
        }
      }

      // Extract token metrics from streaming responses
      if (isStreaming && result && typeof result === 'object' && '_tokenMetrics' in result) {
        const tokenMetrics = (
          result as { _tokenMetrics?: { tokensGenerated?: number; tokensPrompt?: number } }
        )._tokenMetrics;
        if (tokenMetrics) {
          if (typeof tokenMetrics.tokensGenerated === 'number') {
            requestContext.tokensGenerated = tokenMetrics.tokensGenerated;
          }
          if (typeof tokenMetrics.tokensPrompt === 'number') {
            requestContext.tokensPrompt = tokenMetrics.tokensPrompt;
          }
        }
      }

      // Extract chunk data if present
      if (isStreaming && result && typeof result === 'object' && '_chunkData' in result) {
        const chunkData = (
          result as {
            _chunkData?: {
              chunkCount?: number;
              totalBytes?: number;
              maxChunkGapMs?: number;
              avgChunkSizeBytes?: number;
            };
          }
        )._chunkData;
        if (chunkData) {
          requestContext.chunkCount = chunkData.chunkCount;
          requestContext.totalBytes = chunkData.totalBytes;
          requestContext.maxChunkGapMs = chunkData.maxChunkGapMs;
          requestContext.avgChunkSizeBytes = chunkData.avgChunkSizeBytes;
        }
      }

      // Extract Ollama duration fields from streaming responses (REC-25)
      if (isStreaming && result && typeof result === 'object' && '_ollamaDurations' in result) {
        const od = (
          result as {
            _ollamaDurations?: {
              evalDuration?: number;
              promptEvalDuration?: number;
              totalDuration?: number;
              loadDuration?: number;
            };
          }
        )._ollamaDurations;
        if (od) {
          requestContext.evalDuration = od.evalDuration;
          requestContext.promptEvalDuration = od.promptEvalDuration;
          requestContext.totalDuration = od.totalDuration;
          requestContext.loadDuration = od.loadDuration;
        }
      }

      requestContext.queueWaitTime = routingContext?.queueWaitTime;
      this.metricsAggregator.recordRequest(requestContext);
      getRequestHistory().recordRequest(requestContext);
      getMetricsStore().recordRequest(requestContext);
      if (!requestContext.isProbe) {
        this.probeScheduler.recordUserRequest(server.id);
      }

      // Remove streaming request tracking
      if (isStreaming) {
        this.inFlightManager.removeStreamingRequest(requestContext.id);
      }

      // Reset failure count on success - server is working
      this.resetServerFailureCount(server.id);
      this.recordSuccess(server.id, model);

      // Use captured circuit state from request start, not current state
      // This fixes the race condition where breaker transitions before we check
      if (wasActiveTestAtStart && requestContext.duration > 0) {
        // Update timeout based on actual response time from active test
        // Set timeout to 3x the actual response time, with bounds
        this.timeoutManager.updateFromResponseTime(server.id, model, requestContext.duration, true);
        logger.info(
          `Active test success: updated timeout for ${server.id}:${model} to ${this.timeoutManager.getTimeout(server.id, model)}ms (3x ${requestContext.duration}ms response time)`
        );
      } else if (requestContext.duration > 5000) {
        this.timeoutManager.updateFromResponseTime(
          server.id,
          model,
          requestContext.duration,
          false
        );
        logger.debug(
          `Updated timeout for ${server.id}:${model} to ${this.timeoutManager.getTimeout(server.id, model)}ms based on response time of ${requestContext.duration}ms`
        );
      }

      logger.info(`Request succeeded on ${server.id} for model ${model}`, {
        duration: requestContext.duration,
        wasActiveTest: wasActiveTestAtStart,
      });

      return { success: true, value: result };
    } catch (error) {
      this.decrementInFlight(server.id, model);

      // Remove streaming request tracking on failure
      if (isStreaming) {
        this.inFlightManager.removeStreamingRequest(requestContext.id);
      }

      const lastError = error instanceof Error ? error : new Error(String(error));

      // Record failed request metrics
      requestContext.endTime = Date.now();
      requestContext.duration = requestContext.endTime - requestContext.startTime;
      requestContext.success = false;
      requestContext.error = lastError;
      requestContext.queueWaitTime = routingContext?.queueWaitTime;
      this.metricsAggregator.recordRequest(requestContext);
      getRequestHistory().recordRequest(requestContext);
      getMetricsStore().recordRequest(requestContext);

      const errorMessage = lastError.message;
      const errorType = classifyError(errorMessage).type;

      logger.warn(`Request failed on ${server.id} for model ${model}`, {
        error: errorMessage,
        errorType,
        duration: requestContext.duration,
      });

      this.handleServerError(server, model, errorMessage, errorType, errors);
      return { success: false };
    }
  }

  private async tryRequestOnServerWithRetries<T>(
    server: AIServer,
    model: string,
    fn: (server: AIServer, context?: { requestId?: string }) => Promise<T>,
    isStreaming: boolean,
    retryConfig: RetryConfig,
    errors: Array<{ server: string; error: string; type?: ErrorType }>,
    _timeoutMs?: number,
    parentRequestId?: string,
    routingContext?: RoutingContext
  ): Promise<{ success: true; value: T } | { success: false }> {
    let lastError: Error | undefined;
    let retryCount = 0;

    // Generate base request ID once, append retry count for each attempt
    const baseRequestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.info(`Attempting request on server ${server.id} for model ${model} with retries`, {
      isStreaming,
      maxRetries: retryConfig.maxRetriesPerServer,
      serverHealth: server.healthy,
      serverLoad: this.getTotalInFlight(server.id),
    });

    while (retryCount <= retryConfig.maxRetriesPerServer) {
      // Use base request ID with retry suffix, or just base on first attempt
      const requestId = retryCount === 0 ? baseRequestId : `${baseRequestId}-retry-${retryCount}`;

      const requestContext: RequestContext = {
        id: requestId,
        startTime: Date.now(),
        serverId: server.id,
        model,
        endpoint: 'generate',
        streaming: isStreaming,
        success: false,
        parentRequestId,
        isRetry: retryCount > 0,
      };

      try {
        this.incrementInFlight(server.id, model);

        // Track streaming requests for real-time progress monitoring
        if (isStreaming) {
          this.inFlightManager.addStreamingRequest(requestContext.id, server.id, model);
          // Pass requestId in context instead of mutating server
        }

        if (retryCount > 0) {
          logger.info(
            `Retry ${retryCount}/${retryConfig.maxRetriesPerServer} on ${server.id} for model ${model}`
          );
        }

        const result = await fn(server, { requestId: requestContext.id });
        this.decrementInFlight(server.id, model);

        // Record successful request metrics
        requestContext.endTime = Date.now();
        requestContext.duration = requestContext.endTime - requestContext.startTime;
        requestContext.success = true;

        // Extract streaming metrics if present
        if (isStreaming && result && typeof result === 'object' && '_streamingMetrics' in result) {
          const streamingMetrics = (
            result as { _streamingMetrics?: { ttft?: number; streamingDuration?: number } }
          )._streamingMetrics;
          if (streamingMetrics) {
            requestContext.ttft = streamingMetrics.ttft;
            requestContext.streamingDuration = streamingMetrics.streamingDuration;
          }
        }

        // Extract chunk data if present
        if (isStreaming && result && typeof result === 'object' && '_chunkData' in result) {
          const chunkData = (
            result as {
              _chunkData?: {
                chunkCount?: number;
                totalBytes?: number;
                maxChunkGapMs?: number;
                avgChunkSizeBytes?: number;
              };
            }
          )._chunkData;
          if (chunkData) {
            requestContext.chunkCount = chunkData.chunkCount;
            requestContext.totalBytes = chunkData.totalBytes;
            requestContext.maxChunkGapMs = chunkData.maxChunkGapMs;
            requestContext.avgChunkSizeBytes = chunkData.avgChunkSizeBytes;
          }
        }

        // Extract token metrics from Ollama response for non-streaming requests
        if (!isStreaming && result && typeof result === 'object') {
          const ollamaResponse = result as Record<string, unknown>;
          if (typeof ollamaResponse.eval_count === 'number') {
            requestContext.tokensGenerated = ollamaResponse.eval_count;
          }
          if (typeof ollamaResponse.prompt_eval_count === 'number') {
            requestContext.tokensPrompt = ollamaResponse.prompt_eval_count;
          }
        }

        // Extract token metrics from streaming responses
        if (isStreaming && result && typeof result === 'object' && '_tokenMetrics' in result) {
          const tokenMetrics = (
            result as { _tokenMetrics?: { tokensGenerated?: number; tokensPrompt?: number } }
          )._tokenMetrics;
          if (tokenMetrics) {
            if (typeof tokenMetrics.tokensGenerated === 'number') {
              requestContext.tokensGenerated = tokenMetrics.tokensGenerated;
            }
            if (typeof tokenMetrics.tokensPrompt === 'number') {
              requestContext.tokensPrompt = tokenMetrics.tokensPrompt;
            }
          }
        }

        // Extract Ollama duration fields from streaming responses (REC-25)
        if (isStreaming && result && typeof result === 'object' && '_ollamaDurations' in result) {
          const od = (
            result as {
              _ollamaDurations?: {
                evalDuration?: number;
                promptEvalDuration?: number;
                totalDuration?: number;
                loadDuration?: number;
              };
            }
          )._ollamaDurations;
          if (od) {
            requestContext.evalDuration = od.evalDuration;
            requestContext.promptEvalDuration = od.promptEvalDuration;
            requestContext.totalDuration = od.totalDuration;
            requestContext.loadDuration = od.loadDuration;
          }
        }

        requestContext.queueWaitTime = routingContext?.queueWaitTime;
        this.metricsAggregator.recordRequest(requestContext);
        getRequestHistory().recordRequest(requestContext);
        getMetricsStore().recordRequest(requestContext);
        if (!requestContext.isProbe) {
          this.probeScheduler.recordUserRequest(server.id);
        }

        // Remove streaming request tracking
        if (isStreaming) {
          this.inFlightManager.removeStreamingRequest(requestContext.id);
        }

        // Reset failure count on success - server is working
        this.resetServerFailureCount(server.id);
        this.recordSuccess(server.id, model);

        if (retryCount > 0) {
          logger.info(
            `Request succeeded on ${server.id} for model ${model} after ${retryCount} retries`,
            {
              duration: requestContext.duration,
            }
          );
        } else {
          logger.info(`Request succeeded on ${server.id} for model ${model}`, {
            duration: requestContext.duration,
          });
        }

        return { success: true, value: result };
      } catch (error) {
        this.decrementInFlight(server.id, model);

        // Remove streaming request tracking on failure
        if (isStreaming) {
          this.inFlightManager.removeStreamingRequest(requestContext.id);
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        // Record failed request metrics
        requestContext.endTime = Date.now();
        requestContext.duration = requestContext.endTime - requestContext.startTime;
        requestContext.success = false;
        requestContext.error = lastError;
        requestContext.queueWaitTime = routingContext?.queueWaitTime;
        this.metricsAggregator.recordRequest(requestContext);
        getRequestHistory().recordRequest(requestContext);
        getMetricsStore().recordRequest(requestContext);

        const errorMessage = lastError.message;
        const errorType = classifyError(errorMessage).type;

        logger.warn(`Request failed on ${server.id} for model ${model}`, {
          error: errorMessage,
          errorType,
          attempt: retryCount + 1,
          maxRetries: retryConfig.maxRetriesPerServer,
          duration: requestContext.duration,
        });

        // Check if this is a retryable transient error for same-server retry
        const isRetryableOnSameServer = this.isRetryableOnSameServer(errorMessage, retryConfig);

        logger.debug(`Error classification for ${server.id}:${model}`, {
          errorType,
          isRetryableOnSameServer,
          retryCount,
          maxRetries: retryConfig.maxRetriesPerServer,
          willRetry: isRetryableOnSameServer && retryCount < retryConfig.maxRetriesPerServer,
        });

        if (isRetryableOnSameServer && retryCount < retryConfig.maxRetriesPerServer) {
          // Calculate delay with exponential backoff + jitter to prevent thundering herd
          const baseDelay = Math.min(
            retryConfig.retryDelayMs * Math.pow(retryConfig.backoffMultiplier, retryCount),
            retryConfig.maxRetryDelayMs
          );
          const delay = Math.round(baseDelay * (0.5 + Math.random() * 0.5));

          logger.info(
            `Will retry on same server ${server.id} for model ${model} in ${delay}ms (attempt ${retryCount + 1}/${retryConfig.maxRetriesPerServer})`,
            { errorType, error: errorMessage }
          );

          await this.sleep(delay);
          retryCount++;
          continue; // Retry on same server
        }

        // Not retryable on same server or max retries reached - handle the error
        if (retryCount >= retryConfig.maxRetriesPerServer) {
          logger.warn(
            `Max retries (${retryConfig.maxRetriesPerServer}) exhausted on ${server.id} for model ${model}, failing over to next server`
          );
        } else {
          logger.info(
            `Error not retryable on same server (${errorType}), failing over to next server for model ${model}`
          );
        }

        this.handleServerError(server, model, errorMessage, errorType, errors);
        return { success: false };
      }
    }

    return { success: false };
  }

  /**
   * Check if an error should trigger a retry on the same server
   */
  private isRetryableOnSameServer(errorMessage: string, retryConfig: RetryConfig): boolean {
    // Check for retryable HTTP status codes
    for (const code of retryConfig.retryableStatusCodes) {
      if (errorMessage.includes(`HTTP ${code}`) || errorMessage.includes(`${code}`)) {
        return true;
      }
    }

    // Check for transient network errors
    const transientPatterns = [
      /timeout/i,
      /temporarily unavailable/i,
      /rate limit/i,
      /too many requests/i,
      /econnreset/i,
      /etimedout/i,
    ];

    return transientPatterns.some(pattern => pattern.test(errorMessage));
  }

  /**
   * Handle a server error and update state appropriately
   */
  private handleServerError(
    server: AIServer,
    model: string,
    errorMessage: string,
    errorType: ErrorType,
    errors: Array<{ server: string; error: string; type?: ErrorType }>
  ): void {
    logger.info(`Handling server error for ${server.id}:${model}`, {
      errorType,
      errorMessage: errorMessage.substring(0, 200), // Truncate for logging
      currentHealthy: server.healthy,
      consecutiveFailures: this.banManager.getFailureCount(server.id),
    });

    switch (errorType) {
      case 'permanent': {
        // Permanent errors: ban server:model combo forever
        this.banManager.addBan(server.id, model);
        const isServerWide = this.isServerWideError(errorMessage);
        // Only mark server unhealthy if it's a server-wide issue
        if (isServerWide) {
          server.healthy = false;
        }
        this.recordFailure(server.id, errorType, model);
        logger.error(`PERMANENT BAN: Server ${server.id} banned for model ${model}`, {
          error: errorMessage,
          serverMarkedUnhealthy: isServerWide,
          totalBans: this.banManager.getBanDetails().filter(b => b.type === 'permanent').length,
        });
        break;
      }

      case 'non-retryable':
        // Non-retryable: model-specific issue, don't mark server unhealthy
        // Just put in cooldown for this model
        this.banManager.markFailure(server.id, model);
        this.recordFailure(server.id, errorType, model);
        logger.warn(`NON-RETRYABLE ERROR: ${server.id} for model ${model} (server stays healthy)`, {
          error: errorMessage,
          cooldownUntil: new Date(
            Date.now() + this.config.cooldown.failureCooldownMs
          ).toISOString(),
        });
        break;

      case 'transient': {
        // Transient: temporary issue, don't mark unhealthy immediately
        // Only mark unhealthy after multiple consecutive failures
        this.markFailure(server.id, model);
        const failureCount = this.incrementServerFailureCount(server.id);
        const threshold = this.config.healthCheck.failureThreshold ?? 3;

        if (failureCount >= threshold) {
          server.healthy = false;
          logger.warn(
            `TRANSIENT ERROR: Server ${server.id} marked UNHEALTHY after ${failureCount} consecutive failures`,
            {
              error: errorMessage,
              threshold,
              model,
            }
          );
        } else {
          logger.warn(
            `TRANSIENT ERROR: ${server.id} for model ${model} (${failureCount}/${threshold} failures)`,
            {
              error: errorMessage,
              remainingBeforeUnhealthy: threshold - failureCount,
            }
          );
        }
        this.recordFailure(server.id, errorType, model);
        break;
      }

      default: {
        // Retryable/unknown: put in cooldown, track failures
        this.markFailure(server.id, model);
        const unknownFailureCount = this.incrementServerFailureCount(server.id);
        const unknownThreshold = this.config.healthCheck.failureThreshold ?? 3;

        if (unknownFailureCount >= unknownThreshold) {
          server.healthy = false;
          logger.warn(
            `RETRYABLE ERROR: Server ${server.id} marked UNHEALTHY after ${unknownFailureCount} failures`,
            {
              error: errorMessage,
              threshold: unknownThreshold,
              model,
            }
          );
        } else {
          logger.warn(
            `RETRYABLE ERROR: ${server.id} for model ${model} (${unknownFailureCount}/${unknownThreshold} failures)`,
            {
              error: errorMessage,
              remainingBeforeUnhealthy: unknownThreshold - unknownFailureCount,
            }
          );
        }
        this.recordFailure(server.id, errorType, model);
      }
    }

    errors.push({ server: server.id, error: errorMessage, type: errorType });
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get in-flight requests grouped by server
   */
  getInFlightByServer(): Record<
    string,
    {
      total: number;
      byModel: Record<string, { regular: number; bypass: number }>;
    }
  > {
    return this.inFlightManager.getInFlightDetailed();
  }

  /**
   * Get total in-flight requests for a server
   */
  getTotalInFlight(serverId: string): number {
    return this.inFlightManager.getTotalInFlight(serverId);
  }

  /**
   * Get in-flight requests for a specific server+model combination (REC-23)
   */
  getModelInFlight(serverId: string, model: string): number {
    return this.inFlightManager.getInFlight(serverId, model);
  }

  /**
   * Get streaming requests grouped by server for real-time progress monitoring
   */
  getStreamingRequestsByServer(): Record<
    string,
    Array<{
      id: string;
      model: string;
      startTime: number;
      chunkCount: number;
      lastChunkTime: number;
      isStalled: boolean;
    }>
  > {
    return this.inFlightManager.getStreamingRequestsByServer();
  }

  /**
   * Increment in-flight request count
   */
  incrementInFlight(serverId: string, model: string, bypass: boolean = false): void {
    this.inFlightManager.incrementInFlight(serverId, model, bypass);
    this.metricsAggregator.incrementInFlight(serverId, model);

    // If this is a real request (not bypass) and server is undergoing active tests,
    // invalidate the test results - we need to re-test when server is idle
    if (!bypass && this.serversUndergoingActiveTests.has(serverId)) {
      const coordinator = getRecoveryTestCoordinator();
      coordinator.invalidateServerTests(serverId);
    }
  }

  /**
   * Decrement in-flight request count
   */
  decrementInFlight(serverId: string, model: string, bypass: boolean = false): void {
    this.inFlightManager.decrementInFlight(serverId, model, bypass);
    this.metricsAggregator.decrementInFlight(serverId, model);
  }

  /**
   * Get in-flight request count for a server:model
   */
  getInFlight(serverId: string, model: string): number {
    return this.inFlightManager.getInFlight(serverId, model);
  }

  /**
   * Record success for circuit breaker (both server and model level).
   */
  private recordSuccess(serverId: string, model?: string): void {
    const serverCb = this.getCircuitBreaker(serverId);

    serverCb.recordSuccess();

    // Also record at model level if provided
    if (model) {
      const modelCb = this.getModelCircuitBreaker(serverId, model);
      modelCb.recordSuccess();

      // Clear failure tracker on success
      this.banManager.recordSuccess(serverId, model);

      // Record model-level success for aggregator tracking
      this.modelAggregator.recordSuccess(model);
    }

    // Schedule persistence save
    this.scheduleCircuitBreakerSave();
  }

  /**
   * Record failure for circuit breaker (both server and model level)
   * Uses enhanced error classification for category-specific handling
   */
  private recordFailure(serverId: string, error: string | Error, model?: string): void {
    // Classify the error for enhanced handling
    const classification = classifyError(typeof error === 'string' ? error : error.message);

    // Escalate timeout for repeated timeout failures
    if (model) {
      const errorMsg = typeof error === 'string' ? error : error.message;
      const isTimeout =
        errorMsg.toLowerCase().includes('timeout') ||
        errorMsg.toLowerCase().includes('timed out') ||
        (error instanceof Error && error.name === 'AbortError');
      this.timeoutManager.recordFailure(serverId, model, isTimeout ? 'timeout' : undefined);

      // Learn from context errors: decrease context limit if we see a context-related failure
      if (this.isContextError(errorMsg)) {
        const suggestedLimit = this.extractContextLimitFromError(errorMsg);
        this.decreaseModelContextLimit(serverId, model, suggestedLimit);
        logger.warn(`Context error detected for ${serverId}:${model}, updating context limit`, {
          error: errorMsg,
          suggestedLimit,
        });
      }
    }

    // Map enhanced classification to legacy error types for backward compatibility
    // Preserve rateLimited type to ensure proper 5-minute exponential backoff
    let legacyErrorType: ErrorType;
    if (classification.type === 'rateLimited') {
      legacyErrorType = 'rateLimited';
    } else {
      switch (classification.category) {
        case ErrorCategory.RESOURCE:
          legacyErrorType = 'permanent';
          break;
        case ErrorCategory.COMPATIBILITY:
          legacyErrorType = 'non-retryable';
          break;
        case ErrorCategory.NETWORK:
          legacyErrorType = 'transient';
          break;
        case ErrorCategory.AUTHENTICATION:
          legacyErrorType = 'non-retryable';
          break;
        case ErrorCategory.CONFIGURATION:
          legacyErrorType = 'permanent';
          break;
        case ErrorCategory.UNKNOWN:
        default:
          legacyErrorType = 'retryable';
          break;
      }
    }

    const cb = this.getCircuitBreaker(serverId);
    cb.recordFailure(typeof error === 'string' ? new Error(error) : error, legacyErrorType);

    // Also record at model level if provided
    if (model) {
      const modelCb = this.getModelCircuitBreaker(serverId, model);
      modelCb.recordFailure(typeof error === 'string' ? new Error(error) : error, legacyErrorType);

      // Use BanManager for failure tracking
      this.banManager.recordFailure(serverId, model);

      // Record model-level failure for aggregator tracking
      this.modelAggregator.recordFailure(model);

      // Category-specific ban thresholds
      const banThreshold = this.getBanThresholdForCategory(classification.category);
      const modelStats = modelCb.getStats();
      const currentFailures = this.banManager.getModelFailureCount(serverId, model);

      if (
        currentFailures >= banThreshold &&
        modelStats.errorRate >= this.getErrorRateThresholdForCategory(classification.category) &&
        modelStats.successCount === 0
      ) {
        if (!this.banManager.isBanned(serverId, model)) {
          this.banManager.addBan(serverId, model);
          logger.warn(
            `Banning ${serverId}:${model} after ${currentFailures} consecutive ${classification.category} failures (${Math.round(modelStats.errorRate * 100)}% error rate)`,
            {
              serverId,
              model,
              failureCount: currentFailures,
              errorCategory: classification.category,
              errorSeverity: classification.severity,
              errorRate: modelStats.errorRate,
            }
          );
        }
      }
    }

    // Schedule persistence save
    this.scheduleCircuitBreakerSave();
  }

  /**
   * Get reset window for error category (how long before resetting failure counter)
   */
  private getResetWindowForCategory(category: ErrorCategory): number {
    switch (category) {
      case ErrorCategory.RESOURCE:
        return 300000; // 5 minutes - resource issues persist longer
      case ErrorCategory.NETWORK:
        return 60000; // 1 minute - network issues resolve faster
      case ErrorCategory.AUTHENTICATION:
        return 3600000; // 1 hour - auth issues are persistent
      case ErrorCategory.COMPATIBILITY:
        return 86400000; // 24 hours - compatibility issues are permanent
      case ErrorCategory.CONFIGURATION:
        return 86400000; // 24 hours - config issues are permanent
      default:
        return 300000; // 5 minutes default
    }
  }

  /**
   * Get ban threshold for error category
   */
  private getBanThresholdForCategory(category: ErrorCategory): number {
    switch (category) {
      case ErrorCategory.RESOURCE:
        return 5; // Lower threshold for resource issues
      case ErrorCategory.NETWORK:
        return 15; // Higher threshold for transient network issues
      case ErrorCategory.AUTHENTICATION:
        return 3; // Quick ban for auth failures
      case ErrorCategory.COMPATIBILITY:
        return 2; // Very quick ban for compatibility issues
      case ErrorCategory.CONFIGURATION:
        return 3; // Quick ban for config issues
      default:
        return 10; // Default threshold
    }
  }

  /**
   * Get error rate threshold for category-specific banning
   */
  private getErrorRateThresholdForCategory(category: ErrorCategory): number {
    switch (category) {
      case ErrorCategory.RESOURCE:
        return 0.8; // 80% error rate for resource issues
      case ErrorCategory.NETWORK:
        return 0.95; // 95% error rate for network issues
      case ErrorCategory.AUTHENTICATION:
        return 0.5; // 50% error rate for auth issues
      case ErrorCategory.COMPATIBILITY:
        return 0.5; // 50% error rate for compatibility
      case ErrorCategory.CONFIGURATION:
        return 0.5; // 50% error rate for config
      default:
        return 0.99; // 99% default (near 100%)
    }
  }

  /**
   * Schedule a save of circuit breaker states (debounced)
   */
  private scheduleCircuitBreakerSave(): void {
    const data: CircuitBreakerData = {
      timestamp: Date.now(),
      breakers: this.circuitBreakerRegistry.getAllStats(),
    };

    // Debug logging for persistence triggers
    const modelTypeUpdates = Object.entries(data.breakers)
      .filter(([_, stats]) => stats.modelType)
      .map(([key, stats]) => `${key}: ${stats.modelType}`)
      .join(', ');

    if (modelTypeUpdates) {
      logger.debug(`Scheduling circuit breaker save with model type updates: ${modelTypeUpdates}`);
    } else {
      logger.debug('Scheduling circuit breaker save (no model type updates)');
    }

    this.circuitBreakerPersistence.scheduleSave(data);
  }

  /**
   * Get circuit breaker health for a server:model combination
   */
  private getCircuitBreakerHealth(
    serverId: string,
    _model?: string
  ):
    | { state: 'closed' | 'open' | 'half-open'; failureCount: number; errorRate: number }
    | undefined {
    const cb = this.circuitBreakerRegistry.get(serverId);
    if (!cb) {
      return undefined;
    }

    const stats = cb.getStats();
    return {
      state: stats.state,
      failureCount: stats.failureCount,
      errorRate: stats.errorRate,
    };
  }

  /**
   * Check if server/model is in cooldown
   */
  isInCooldown(serverId: string, model: string): boolean {
    return this.banManager.isInCooldown(serverId, model);
  }

  /**
   * Check if server's circuit breaker allows requests (not open)
   * Returns true if circuit is closed or half-open (allowing test requests)
   */
  isCircuitAllowed(serverId: string): boolean {
    const cb = this.circuitBreakerRegistry.get(serverId);
    if (!cb) {
      return true; // No circuit breaker = allowed
    }
    const stats = cb.getStats();
    return stats.state !== 'open';
  }

  /**
   * Mark a server:model combination as failed and put it in cooldown
   */
  private markFailure(serverId: string, model: string): void {
    this.banManager.markFailure(serverId, model);
  }

  /**
   * Load bans from persisted data
   */
  loadBans(bans: Set<string>): void {
    for (const ban of bans) {
      const [serverId, model] = ban.split(':');
      if (serverId && model) {
        this.banManager.addBan(serverId, model);
      }
    }
    logger.info(`Loaded ${bans.size} permanent bans`);
  }

  /**
   * Initialize the orchestrator with persistence and start health check scheduler
   */
  async initialize(): Promise<void> {
    try {
      // Initialize metrics aggregator persistence
      await this.metricsAggregator.initialize();

      // Initialize SQLite metrics store with config and in-flight callback
      const storageCfg = this.config.storage;
      getMetricsStore({
        dbPath: storageCfg.dbPath,
        retention: storageCfg.retention,
        performance: storageCfg.performance,
        temporal: storageCfg.temporal,
        getInFlightCount: () => this.inFlightManager.getGlobalInFlightCount(),
      });
      logger.info('[MetricsStore] Initialized via orchestrator startup');

      // Initialize circuit breaker persistence
      await this.circuitBreakerPersistence.initialize();

      // Load persisted circuit breaker states
      const persistedBreakerData = await this.circuitBreakerPersistence.load();
      if (persistedBreakerData) {
        this.circuitBreakerRegistry.loadPersistedState(persistedBreakerData.breakers);
      }

      // Load permanent bans from SQLite so bans survive process restarts
      this.banManager.loadBansFromStore();

      // Initialize recovery test coordinator with configurable timeouts
      const rtCfg = this.config.recoveryTest;
      setRecoveryTestCoordinator(
        new RecoveryTestCoordinator({
          serverCooldownMs: rtCfg.serverCooldownMs,
          maxWaitForInFlightMs: rtCfg.maxWaitForInFlightMs,
          modelTestTimeoutMs: rtCfg.modelTestTimeoutMs,
          tagsTestTimeoutMs: rtCfg.tagsTestTimeoutMs,
          testPromptTokens: rtCfg.testPromptTokens,
        })
      );
      const coordinator = getRecoveryTestCoordinator();
      coordinator.setServerUrlProvider((serverId: string) => {
        const server = this.servers.find(s => s.id === serverId);
        return server?.url || null;
      });
      coordinator.setInFlightProvider((serverId: string) => {
        return this.getTotalInFlight(serverId);
      });
      coordinator.setIncrementInFlight((serverId: string, model: string) => {
        this.incrementInFlight(serverId, model, true); // Active tests bypass circuit breaker
      });
      coordinator.setDecrementInFlight((serverId: string, model: string) => {
        this.decrementInFlight(serverId, model, true); // Active tests bypass circuit breaker
      });
      coordinator.setGetTimeout((serverId: string, model: string) => {
        return this.timeoutManager.getTimeout(serverId, model);
      });
      coordinator.setRecordTimeoutFailure((serverId: string, model: string) => {
        this.timeoutManager.recordFailure(serverId, model, 'timeout');
        logger.info(
          `Active test timeout: escalated timeout for ${serverId}:${model} to ${this.timeoutManager.getTimeout(serverId, model)}ms`
        );
      });
      coordinator.setRecordActiveTestTimeout((serverId: string, model: string, testTimeoutMs: number) => {
        this.timeoutManager.recordActiveTestTimeout(serverId, model, testTimeoutMs);
        logger.debug(
          `Active test timeout recorded for ${serverId}:${model} (${testTimeoutMs}ms) - no escalation`
        );
      });
      coordinator.setOnTestsInvalidated((serverId: string) => {
        logger.info(
          `Active tests invalidated for server ${serverId} due to concurrent real request`
        );
        // Reset halfOpenStartedAt to give more time for recovery when server becomes idle
        // This prevents the breaker from timing out while server is still processing requests
        const breaker = this.circuitBreakerRegistry.get(serverId);
        if (breaker && breaker.getState() === 'half-open') {
          const stats = breaker.getStats();
          if (stats.halfOpenStartedAt > 0) {
            breaker.resetHalfOpenTimer();
            logger.info(`Reset half-open timer for ${serverId} after test invalidation`);
          }
        }
      });

      logger.info('Orchestrator: Recovery test coordinator callbacks have been set up');

      // Start health check scheduler
      this.healthCheckScheduler.start();
      this.activeTestScheduler.start();
      this.probeScheduler.start();

      const DECAY_INTERVAL_MS = 5 * 60 * 1000;
      this.escalationIntervalId = setInterval(() => {
        this.timeoutManager.applyDecay();
        // Reset timeouts for server:models that have been idle for 10+ minutes
        this.timeoutManager.resetAllAfterIdle(600000);
      }, DECAY_INTERVAL_MS);

      logger.info(
        'Orchestrator initialized with persistence, circuit breakers, and recovery test coordinator'
      );
    } catch (error) {
      logger.error('Failed to initialize orchestrator:', { error });
      throw error;
    }
  }

  /**
   * Get timeout for a server:model pair, with fallback to default
   * Uses adaptive timeouts for active tests based on model size, historical performance, and server health
   */
  getTimeout(serverId: string, model: string): number {
    return this.timeoutManager.getTimeout(serverId, model);
  }

  /**
   * Set timeout for a server:model pair
   */
  setTimeout(serverId: string, model: string, timeoutMs: number): void {
    this.timeoutManager.setTimeout(serverId, model, timeoutMs);

    // Persist if enabled
    if (this.config.enablePersistence) {
      const persistedData = this.timeoutManager.toPersistedData();
      saveTimeoutsToDisk(persistedData.timeouts);
    }
  }

  /**
   * Remove a specific ban for a server:model combination
   * @returns true if the ban was removed, false if it didn't exist
   */
  unban(serverId: string, model: string): boolean {
    return this.banManager.removeBan(serverId, model);
  }

  /**
   * Remove all bans for a specific server
   * @returns number of bans removed
   */
  unbanServer(serverId: string): number {
    const removed = this.banManager.removeServerBans(serverId);

    if (removed > 0) {
      // Reset circuit breakers for this server
      this.circuitBreakerRegistry.remove(serverId);

      // Clear cooldowns for this server
      this.banManager.clearCooldown(serverId, '');

      logger.info(`Removed ${removed} bans for server ${serverId}`);
    }

    return removed;
  }

  /**
   * Remove all bans for a specific model (across all servers)
   * @returns number of bans removed
   */
  unbanModel(model: string): number {
    return this.banManager.removeModelBans(model);
  }

  /**
   * Clear all permanent bans
   * @returns number of bans cleared
   */
  clearAllBans(): number {
    const banDetails = this.banManager.getBanDetails();
    const count = banDetails.filter(b => b.type === 'permanent').length;
    this.banManager.clearAllBans();

    if (count > 0) {
      logger.info(`Cleared all ${count} permanent bans`);
    }

    return count;
  }

  /**
   * Get detailed ban information
   */
  getBanDetails(): Array<{ serverId: string; model: string; key: string }> {
    return this.banManager.getBanDetails().map(b => ({
      serverId: b.serverId,
      model: b.model,
      key: `${b.serverId}:${b.model}`,
    }));
  }

  // Track which servers are currently being tested to prevent hammering
  private serversUndergoingActiveTests = new Set<string>();
  private readonly MAX_MODELS_PER_SERVER_PER_CYCLE = 2;
  private async runActiveTestsForServer(
    server: AIServer
  ): Promise<Array<{ model: string; success: boolean; duration: number; error?: string }>> {
    // Fast-path guard: avoids entering RecoveryTestCoordinator when a test cycle is already
    // running for this server. RecoveryTestCoordinator has its own independent `activeServers`
    // Set (authoritative inner guard); this outer check is a performance optimization only.
    // Both guards are intentional defense-in-depth and are not redundant.
    if (this.serversUndergoingActiveTests.has(server.id)) {
      logger.debug(`Skipping active tests for ${server.id} - already in progress`);
      return [];
    }

    const now = Date.now();
    const allStats = this.circuitBreakerRegistry.getAllStats();

    // First, check for any OPEN breakers whose nextRetryAt has passed and transition them to half-open
    for (const [breakerName, stats] of Object.entries(allStats)) {
      if (stats.state === 'open' && stats.nextRetryAt && stats.nextRetryAt <= now) {
        const breaker = this.circuitBreakerRegistry.get(breakerName);
        if (breaker) {
          const canExec = breaker.canExecute();
          if (canExec) {
            logger.info(
              `Transitioned breaker ${breakerName} from open to half-open (nextRetryAt passed)`,
              {
                nextRetryAt: stats.nextRetryAt,
                timeSinceRetryAt: now - stats.nextRetryAt,
              }
            );
          }
        }
      }
    }

    // Check for any HALF-OPEN breakers whose halfOpenTimeout has passed and transition them back to open
    // Use the circuit breaker's self-contained timeout check which doesn't rely on activeTestsInProgress
    for (const [breakerName, stats] of Object.entries(allStats)) {
      if (stats.state === 'half-open') {
        const breaker = this.circuitBreakerRegistry.get(breakerName);
        if (breaker) {
          breaker.checkHalfOpenTimeout();
        }
      }
    }

    // Check if server circuit is half-open (server-level recovery)
    const serverCb = this.getCircuitBreaker(server.id);
    if (serverCb.getState() === 'half-open') {
      logger.info(`Server ${server.id} circuit is half-open, performing recovery health check`);

      this.serversUndergoingActiveTests.add(server.id);

      try {
        const healthCheckResult = await this.performRecoveryHealthCheck(server);

        if (healthCheckResult.success) {
          serverCb.forceClose();
          logger.info(`Server ${server.id} recovery confirmed, circuit closed`);
        } else {
          logger.warn(
            `Server ${server.id} recovery health check failed: ${healthCheckResult.error}`
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Server ${server.id} recovery health check error: ${errorMessage}`);
      } finally {
        this.serversUndergoingActiveTests.delete(server.id);
      }

      return [];
    }

    const halfOpenBreakers: Array<{ breaker: CircuitBreaker; model?: string }> = [];

    // Check model-level breakers
    for (const [breakerName, stats] of Object.entries(allStats)) {
      if (!breakerName.startsWith(`${server.id}:`)) {
        continue;
      }

      if (stats.state === 'half-open') {
        const breaker = this.circuitBreakerRegistry.get(breakerName);
        if (breaker) {
          const model = breakerName.slice(server.id.length + 1);
          halfOpenBreakers.push({ breaker, model });
        }
      }
    }

    if (halfOpenBreakers.length === 0) {
      return [];
    }

    // Delegate to RecoveryTestCoordinator
    this.serversUndergoingActiveTests.add(server.id);

    const coordinator = getRecoveryTestCoordinator();

    try {
      const testResults = await coordinator.runActiveTests(server.id, halfOpenBreakers, {
        onTestStart: breakerName => {
          const breaker = this.circuitBreakerRegistry.get(breakerName);
          breaker?.startActiveTest();
        },
        onTestEnd: (breakerName, success, duration) => {
          const breaker = this.circuitBreakerRegistry.get(breakerName);
          breaker?.endActiveTest();

          logger.info(`Active test ${success ? 'succeeded' : 'failed'} for ${breakerName}`, {
            duration,
          });
        },
      });

      return testResults.map(r => ({
        model: r.model || '',
        success: r.success,
        duration: r.duration,
        error: r.error,
      }));
    } finally {
      this.serversUndergoingActiveTests.delete(server.id);
    }
  }

  /**
   * Get circuit breaker for a server (with server-level half-open limits)
   */
  private getCircuitBreaker(
    serverId: string
  ): import('../circuit-breaker/circuit-breaker.js').CircuitBreaker {
    return this.circuitBreakerRegistry.getOrCreate(serverId, undefined, (oldState, newState) => {
      // Enforce server-level half-open circuit limits
      if (newState === 'half-open') {
        const halfOpenCount = this.countHalfOpenCircuits(serverId);
        const maxHalfOpenPerServer = this.config.circuitBreaker.maxHalfOpenPerServer;

        if (halfOpenCount >= maxHalfOpenPerServer) {
          logger.warn(
            `Server ${serverId} already has ${halfOpenCount} half-open circuits (max ${maxHalfOpenPerServer}). Preventing transition to half-open.`
          );
          // Force back to open state and extend the timeout
          const breaker = this.circuitBreakerRegistry.get(serverId);
          if (breaker) {
            breaker.forceOpen();
            // Preserve original error type for backoff calculation
            const stats = breaker.getStats();
            const errorType: ErrorType = stats.lastErrorType || 'transient';
            breaker.recordFailure(new Error('Server-level half-open limit exceeded'), errorType);
          }
          return;
        }
      }

      // When server circuit closes, close all model circuits to give them clean slate
      if (oldState === 'half-open' && newState === 'closed') {
        this.closeAllModelCircuits(serverId);
      }

      logger.info(`Circuit breaker state changed: ${oldState} -> ${newState}`);
    });
  }

  /**
   * Get circuit breaker for a server:model combination (with server-level half-open limits)
   */
  private getModelCircuitBreaker(
    serverId: string,
    model: string
  ): import('../circuit-breaker/circuit-breaker.js').CircuitBreaker {
    const key = `${serverId}:${model}`;
    return this.circuitBreakerRegistry.getOrCreate(key, undefined, (oldState, newState) => {
      // Enforce server-level half-open circuit limits
      if (newState === 'half-open') {
        const halfOpenCount = this.countHalfOpenCircuits(serverId);
        const maxHalfOpenPerServer = this.config.circuitBreaker.maxHalfOpenPerServer;

        if (halfOpenCount >= maxHalfOpenPerServer) {
          logger.warn(
            `Server ${serverId} already has ${halfOpenCount} half-open circuits (max ${maxHalfOpenPerServer}). Preventing transition to half-open for model ${model}.`
          );
          // Force back to open state and extend the timeout
          const breaker = this.circuitBreakerRegistry.get(key);
          if (breaker) {
            breaker.forceOpen();
            // Preserve original error type for backoff calculation
            const stats = breaker.getStats();
            const errorType: ErrorType = stats.lastErrorType || 'transient';
            breaker.recordFailure(new Error('Server-level half-open limit exceeded'), errorType);
          }
          return;
        }
      }

      logger.info(`Circuit breaker state changed: ${oldState} -> ${newState}`);
    });
  }

  /**
   * Populate routing context with circuit breaker and server info after successful request
   */
  private populateRoutingContext(
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

    // Get server-level circuit breaker state
    const serverCb = this.circuitBreakerRegistry.get(serverId);
    if (serverCb) {
      context.serverCircuitState = serverCb.getState();
    }

    // Get model-level circuit breaker state
    const modelCb = this.circuitBreakerRegistry.get(`${serverId}:${model}`);
    if (modelCb) {
      context.modelCircuitState = modelCb.getState();
    }

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

  /**
   * Count half-open circuits for a server
   */
  private countHalfOpenCircuits(serverId: string): number {
    let count = 0;
    const allStats = this.circuitBreakerRegistry.getAllStats();

    // Count server-level breaker
    const serverStats = allStats[serverId];
    if (serverStats && serverStats.state === 'half-open') {
      count++;
    }

    // Count model-level breakers for this server
    for (const [key, stats] of Object.entries(allStats)) {
      if (key.startsWith(`${serverId}:`) && stats.state === 'half-open') {
        count++;
      }
    }

    return count;
  }

  /**
   * Close all model-level circuit breakers for a server
   * Called when server circuit recovers to give models clean slate
   */
  private closeAllModelCircuits(serverId: string): void {
    const allStats = this.circuitBreakerRegistry.getAllStats();
    let closedCount = 0;

    // Close all model-level breakers for this server
    for (const [key, stats] of Object.entries(allStats)) {
      if (key.startsWith(`${serverId}:`) && stats.state !== 'closed') {
        const breaker = this.circuitBreakerRegistry.get(key);
        if (breaker) {
          breaker.forceClose();
          closedCount++;
        }
      }
    }

    if (closedCount > 0) {
      logger.info(
        `Closed ${closedCount} model circuit breakers for server ${serverId} after server recovery`
      );
    }
  }

  /**
   * Perform a recovery health check for a server
   * Simple health check to confirm server is working during recovery
   */
  private async performRecoveryHealthCheck(
    server: AIServer
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${server.url}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5 second timeout for recovery check
      });

      if (response.ok) {
        return { success: true };
      } else {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get server-level circuit breaker (public API for admin endpoints)
   */
  getServerCircuitBreaker(
    serverId: string
  ): import('../circuit-breaker/circuit-breaker.js').CircuitBreaker | undefined {
    return this.circuitBreakerRegistry.get(serverId);
  }

  /**
   * Manually trigger active recovery test for a server:model breaker
   */
  async manualTriggerRecoveryTest(
    serverId: string,
    model: string
  ): Promise<{
    success: boolean;
    error?: string;
    breakerState?: string;
  }> {
    try {
      const breaker = this.getModelCircuitBreaker(serverId, model);
      if (!breaker) {
        return { success: false, error: `Circuit breaker not found for ${serverId}:${model}` };
      }

      const state = breaker.getState();
      logger.info(`Manual recovery test requested for ${serverId}:${model}`, {
        currentState: state,
        lastFailureReason: breaker.getLastFailureReason(),
      });

      if (state !== 'half-open') {
        return {
          success: false,
          error: `Circuit breaker is in ${state} state, not half-open. Manual tests only work in half-open state.`,
          breakerState: state,
        };
      }

      const testResult = await breaker.manualRecoveryTest();
      const newState = breaker.getState();

      logger.info(`Manual recovery test completed for ${serverId}:${model}`, {
        testResult,
        oldState: state,
        newState,
        consecutiveFailedRecoveries: breaker.getStats().consecutiveFailedRecoveries,
      });

      return {
        success: testResult,
        breakerState: newState,
      };
    } catch (error) {
      logger.error(`Manual recovery test failed for ${serverId}:${model}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get circuit breaker for a server:model combination (public API for admin endpoints)
   */
  getModelCircuitBreakerPublic(
    serverId: string,
    model: string
  ): import('../circuit-breaker/circuit-breaker.js').CircuitBreaker | undefined {
    return this.getModelCircuitBreaker(serverId, model);
  }

  /**
   * Force close a server-level circuit breaker (public API for admin endpoints)
   */
  resetServerCircuitBreaker(serverId: string): boolean {
    const breaker = this.circuitBreakerRegistry.get(serverId);
    if (breaker) {
      breaker.forceClose();
      return true;
    }
    return false;
  }

  /**
   * Extract models from health check response data
   */
  private extractModelsFromResponse(responseData?: any): string[] {
    if (!responseData || typeof responseData !== 'object') {
      return [];
    }

    const data = responseData as { models?: unknown };
    if (!data.models || !Array.isArray(data.models)) {
      return [];
    }

    return data.models
      .map((m: unknown) => {
        if (typeof m === 'string') {
          return m;
        }
        if (typeof m === 'object' && m !== null) {
          const record = m as Record<string, unknown>;
          return (
            (record.model as string | undefined) ?? (record.name as string | undefined) ?? null
          );
        }
        return null;
      })
      .filter(Boolean) as string[];
  }

  /**
   * Check if two string arrays are equal (order matters for model lists)
   */
  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((val, index) => val === b[index]);
  }

  /**
   * Check if server:model combo should be skipped due to circuit breaker
   * Uses canAttempt() for read-only check without triggering state transitions
   */
  private shouldSkipServerModel(
    serverId: string,
    model: string,
    endpoint?: 'generate' | 'embeddings'
  ): boolean {
    // Check both server-level and model-level circuit breakers
    const serverCb = this.getCircuitBreaker(serverId);
    const modelCb = this.getModelCircuitBreaker(serverId, model);

    // Skip if circuit is open (can't attempt) - use canAttempt() for read-only check
    if (!serverCb.canAttempt() || !modelCb.canAttempt()) {
      return true;
    }

    // Also skip half-open circuits that have never succeeded
    // These are likely permanently broken and waste requests during recovery testing
    const serverStats = serverCb.getStats();
    const modelStats = modelCb.getStats();

    if (serverStats.state === 'half-open' && serverStats.successCount === 0) {
      return true;
    }
    if (modelStats.state === 'half-open' && modelStats.successCount === 0) {
      return true;
    }

    // Check model type compatibility with endpoint
    const modelType = modelCb.getModelType();
    if (endpoint === 'generate' && modelType === 'embedding') {
      // Skip embedding models for generate requests
      return true;
    }
    if (endpoint === 'embeddings' && modelType === 'generation') {
      // Skip generation models for embedding requests
      return true;
    }

    return false;
  }

  /**
   * Remove circuit breaker for a server:model combination
   * Call this when a model is deleted from a server
   */
  removeModelCircuitBreaker(serverId: string, model: string): boolean {
    return this.circuitBreakerRegistry.remove(`${serverId}:${model}`);
  }

  /**
   * Classify an error for recovery tracking purposes
   */
  private classifyRecoveryError(errorMessage: string): RecoveryFailureRecord['errorType'] {
    const message = errorMessage.toLowerCase();

    if (
      message.includes('timeout') ||
      message.includes('etimedout') ||
      message.includes('gateway timeout')
    ) {
      return 'timeout';
    }
    if (
      message.includes('connection refused') ||
      message.includes('econnrefused') ||
      message.includes('connect') ||
      message.includes('network') ||
      message.includes('fetch failed')
    ) {
      return 'connection_refused';
    }
    if (message.includes('http 5')) {
      return 'http_error';
    }
    if (
      message.includes('model') &&
      (message.includes('not found') || message.includes('not exist'))
    ) {
      return 'model_not_found';
    }
    return 'unknown';
  }

  /**
   * Check if error indicates a server-wide issue (affects all models)
   */
  private isServerWideError(errorMessage: string): boolean {
    const serverWidePatterns = [
      /disk.*full/i,
      /no space left/i,
      /server.*crash/i,
      /system.*error/i,
      /internal server error/i,
      /service unavailable/i,
    ];
    return serverWidePatterns.some(pattern => pattern.test(errorMessage));
  }

  /**
   * Increment consecutive failure count for a server
   * Returns the new count
   */
  private incrementServerFailureCount(serverId: string): number {
    const currentCount = this.banManager.getFailureCount(serverId);
    this.banManager.recordFailure(serverId);
    return currentCount + 1;
  }

  /**
   * Reset consecutive failure count for a server (on successful request)
   */
  private resetServerFailureCount(serverId: string): void {
    this.banManager.resetFailureCount(serverId);
  }

  /**
   * Check if model-level breakers should escalate to server-level breaker
   */
  private checkModelBreakerEscalation(serverId: string): void {
    const server = this.getServer(serverId);
    if (!server || !this.config.circuitBreaker.modelEscalation.enabled) {
      return;
    }

    const modelBreakers = server.models.map(model => this.getModelCircuitBreaker(serverId, model));

    if (modelBreakers.length === 0) {
      return;
    }

    // Use getState() instead of canExecute() to avoid mutating totalRequestCount
    // or triggering open→half-open transitions as a side-effect of this check.
    const openModelBreakers = modelBreakers.filter(cb => cb.getState() === 'open');
    const openRatio = openModelBreakers.length / modelBreakers.length;

    // Check ratio threshold
    if (openRatio > this.config.circuitBreaker.modelEscalation.ratioThreshold) {
      logger.warn(
        `Server ${serverId}: ${openModelBreakers.length}/${modelBreakers.length} models have open breakers (${Math.round(openRatio * 100)}%). Opening server breaker.`
      );
      this.forceOpenServerBreaker(serverId, 'Model breaker ratio escalation');
      return;
    }

    // Check duration threshold
    const now = Date.now();
    const durationThreshold = this.config.circuitBreaker.modelEscalation.durationThresholdMs;
    const longOpenBreakers = openModelBreakers.filter(cb => {
      const stats = cb.getStats();
      return stats.state === 'open' && now - stats.lastFailure > durationThreshold;
    });

    if (longOpenBreakers.length > 0) {
      logger.warn(
        `Server ${serverId}: Model breaker(s) have been open for >${durationThreshold / 60000} minutes. Opening server breaker.`
      );
      this.forceOpenServerBreaker(serverId, 'Model breaker duration escalation');
    }
  }

  /**
   * Force open a server-level circuit breaker
   */
  private forceOpenServerBreaker(serverId: string, reason: string): void {
    const serverCb = this.getCircuitBreaker(serverId);
    if (serverCb.getState() === 'open') {
      return;
    } // Already open

    // Force the server breaker open by recording enough failures
    const threshold = serverCb.getConfig().baseFailureThreshold;
    for (let i = 0; i < threshold; i++) {
      serverCb.recordFailure(new Error(reason), 'transient');
    }

    // Also mark server as unhealthy to align with our health check changes
    const server = this.getServer(serverId);
    if (server) {
      server.healthy = false;
      this.invalidateServerTagsCache(serverId);
    }
  }

  /**
   * Check if server should be skipped due to circuit breaker
   */
  private shouldSkipServer(serverId: string): boolean {
    const cb = this.getCircuitBreaker(serverId);
    return !cb.canExecute();
  }

  /**
   * Initialize the orchestrator (load persisted metrics)
   */
  getStats(): {
    uptime: number;
    totalServers: number;
    healthyServers: number;
    totalModels: number;
    inFlightRequests: number;
    circuitBreakers: Record<string, { state: string; failureCount: number }>;
  } {
    const healthyServers = this.servers.filter(s => s.healthy).length;

    const inFlightData = this.inFlightManager.getAllInFlight();
    let inFlightTotal = 0;
    for (const serverData of Object.values(inFlightData)) {
      for (const count of Object.values(serverData)) {
        inFlightTotal += count;
      }
    }

    const allStats = this.circuitBreakerRegistry.getAllStats();
    const circuitBreakers: Record<string, { state: string; failureCount: number }> = {};
    for (const [id, stats] of Object.entries(allStats)) {
      circuitBreakers[id] = {
        state: stats.state,
        failureCount: stats.failureCount,
      };
    }

    return {
      uptime: process.uptime(),
      totalServers: this.servers.length,
      healthyServers,
      totalModels: this.getAllModels().length,
      inFlightRequests: inFlightTotal,
      circuitBreakers,
    };
  }

  /**
   * Get detailed metrics for a specific server:model
   */
  getDetailedMetrics(serverId: string, model: string): ServerModelMetrics | undefined {
    return this.metricsAggregator.getMetrics(serverId, model);
  }

  /**
   * Get all detailed metrics
   */
  getAllDetailedMetrics(): Map<string, ServerModelMetrics> {
    return this.metricsAggregator.getAllMetrics();
  }

  /**
   * Get global aggregated metrics
   */
  getGlobalMetrics(): GlobalMetrics {
    return this.metricsAggregator.getGlobalMetrics();
  }

  /**
   * Export all metrics in structured format
   */
  exportMetrics(): MetricsExport {
    return this.metricsAggregator.exportMetrics();
  }

  /**
   * Get circuit breaker statistics for all servers
   */
  getCircuitBreakerStats() {
    return this.circuitBreakerRegistry.getAllStats();
  }

  /**
   * Put server into draining mode
   * No new requests accepted, waits for in-flight to complete
   */
  async drain(timeoutMs = 30000): Promise<boolean> {
    logger.info(`Starting drain with timeout ${timeoutMs}ms...`);
    this.draining = true;

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const stats = this.getStats();

      if (stats.inFlightRequests === 0) {
        const skippedServers = this.servers.filter(s => this.shouldSkipServer(s.id));
        if (skippedServers.length > 0) {
          logger.warn(
            `Drain complete but ${skippedServers.length} server(s) still ineligible for traffic — keeping drain active: ${skippedServers.map(s => s.id).join(', ')}`
          );
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        logger.info('Drain complete - all requests finished');
        this.draining = false;
        return true;
      }

      logger.debug(`Draining: ${stats.inFlightRequests} in-flight`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.warn(
      `Drain timeout reached with ${this.getStats().inFlightRequests} in-flight requests`
    );
    this.draining = false;
    return false;
  }

  /**
   * Clear the tags cache completely
   */
  clearTagsCache(): void {
    this.tagsCache = undefined;
    logger.debug('Tags cache cleared');
  }

  /**
   * Invalidate tags cache when server state changes significantly
   */
  invalidateTagsCache(): void {
    // Only clear cache if we have one
    if (this.tagsCache) {
      this.tagsCache = undefined;
      logger.debug('Tags cache invalidated due to server state change');
    }
  }

  /**
   * Invalidate cache when a specific server's models change
   * This is called when server health changes or models are updated
   */
  invalidateServerTagsCache(serverId: string): void {
    // For now, we clear the entire cache since cached results contain aggregated data
    // In the future, we could implement more granular invalidation
    this.invalidateTagsCache();
    logger.debug(`Tags cache invalidated due to changes in server ${serverId}`);
  }

  /**
   * Shutdown the orchestrator
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down orchestrator...');

    // Stop health check scheduler
    this.healthCheckScheduler.stop();
    this.activeTestScheduler.stop();
    this.probeScheduler.stop();

    // Clear escalation check interval
    if (this.escalationIntervalId) {
      clearInterval(this.escalationIntervalId);
      this.escalationIntervalId = undefined;
    }

    // Shutdown metrics aggregator (flushes persistence)
    await this.metricsAggregator.shutdown();

    // Save circuit breaker states
    const breakerData: CircuitBreakerData = {
      timestamp: Date.now(),
      breakers: this.circuitBreakerRegistry.getAllStats(),
    };
    await this.circuitBreakerPersistence.shutdown(breakerData);

    // Persist timeouts on shutdown to ensure they're saved
    if (this.config.enablePersistence) {
      const persistedData = this.timeoutManager.toPersistedData();
      saveTimeoutsToDisk(persistedData.timeouts);
      logger.info(`Persisted ${Object.keys(persistedData.timeouts).length} timeouts on shutdown`);
    }

    // Persist decision and request history
    await getDecisionHistory().persist();
    await getRequestHistory().persist();

    // Persist analytics engine data
    // Note: AnalyticsEngine now uses MetricsStore for persistence (SQLite)
    // Only need to persist summary snapshots to JSON
    await getAnalyticsEngine().persistSummary();

    // Stop persistence timers
    getDecisionHistory().stop();
    getRequestHistory().stop();
    getAnalyticsEngine().stop();

    this.inFlightManager.clear();
    this.banManager.clearAllCooldowns();
    this.circuitBreakerRegistry.clear();

    getOperationalStore().close();

    logger.info('Orchestrator shutdown complete');
  }
}
