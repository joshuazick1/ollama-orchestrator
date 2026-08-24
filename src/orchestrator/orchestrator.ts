/**
 * orchestrator.ts
 * Ollama Orchestrator with Historical Metrics - Server management and request routing
 */

import { getAnalyticsEngine } from '../analytics/analytics-engine.js';
import {
  getRecoveryFailureTracker,
  type RecoveryFailureRecord,
} from '../analytics/recovery-failure-tracker.js';
import type { OrchestratorConfig, RetryConfig } from '../config/config.js';
import { DEFAULT_CONFIG, getConfigManager } from '../config/config.js';
import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants/index.js';
import { getDecisionHistory } from '../decision-history.js';
import {
  LoadBalancer,
  calculateServerScore,
  type LoadBalancerConfig,
  type ServerScore,
} from '../load-balancer/load-balancer.js';
import { getTemporalScorer } from '../load-balancer/temporal-scorer.js';
import { MetricsAggregator } from '../metrics/index.js';
import { RequestTelemetry } from '../metrics/request-telemetry.js';
import { getModelManager } from '../model-manager.js';
import { EndpointRegistry } from '../probe/endpoint-registry.js';
import { classify } from '../probe/failure-classifier.js';
import { detectGarbageResponse } from '../probe/garbage-response-detector.js';
import type { ModelAvailabilityProvider } from '../probe/model-availability-provider.js';
import { getPerfProbeSchedulerInstance } from '../probe/perf-probe-scheduler-instance.js';
import { ProbeOrchestrator } from '../probe/probe-orchestrator.js';
import {
  getCapabilityProbeScheduler,
  getHealthCheckScheduler,
} from '../probe/probe-scheduler-instance.js';
import { getPsPollCoordinator } from '../probe/ps-poll-coordinator-instance.js';
import { BackoffSchedule } from '../probe/recovery-driver.js';
import { RecoveryDriver } from '../probe/recovery-driver.js';
import {
  parseTupleKey,
  type Tuple,
  type ProbeState,
  type ProbeEndpoint,
  GENERATION_ENDPOINTS,
  EMBEDDING_ENDPOINTS,
  DEFAULT_PROBE_CONFIG,
} from '../probe/types.js';
import { WALStore } from '../probe/wal-store.js';
import { getRequestHistory } from '../request-history.js';
import { getErrorEventStore } from '../storage/error-event-store.js';
import { getMetricsStore } from '../storage/metrics-store.js';
import { getOperationalStore } from '../storage/operational-store.js';
import type { ErrorType } from '../types/error-event.js';
import { sleep } from '../utils/async-helpers.js';
import { calculateBackoff, fromRetryConfig } from '../utils/backoff/index.js';
import { BanManager } from '../utils/ban-manager.js';
import { ErrorAggregator } from '../utils/error-aggregator.js';
import type { ClusterStatus } from '../utils/error-aggregator.js';
import {
  classifyError,
  ErrorCategory,
  isRetryableOnSameServer,
  type ErrorType as ClassifyErrorType,
} from '../utils/error-classifier.js';
import { NdjsonResponseError, detectNdjsonResponse } from '../utils/fetch-with-timeout.js';
import { InFlightManager, getInFlightManager } from '../utils/in-flight-manager.js';
import { logger } from '../utils/logger.js';
import { ModelAggregator } from '../utils/model-aggregator.js';
import {
  attemptModelRepair,
  CORRUPTED_MODEL_PATTERNS,
  matchesAny,
  RUNNER_CRASH_PATTERNS,
} from '../utils/model-repair.js';
import { filterValidModels } from '../utils/model-validator.js';
import { getNegativeModelCache } from '../utils/negative-model-cache.js';
import { canHandleContext, getDefaultContextSize } from '../utils/prompt-estimator.js';
import { getQuarantinePool } from '../utils/quarantine-pool.js';
import { RetryBudget } from '../utils/retry-budget.js';
import { TimeoutManager } from '../utils/timeout-manager.js';
import { normalizeServerUrl, areUrlsEquivalent } from '../utils/url-utils.js';

import { AnthropicModels, type AnthropicModel } from './anthropic-models.js';
import { OrchestratorModels } from './models.js';
import type {
  AIServer,
  RequestContext,
  ServerModelMetrics,
  GlobalMetrics,
  MetricsExport,
} from './orchestrator.types.js';
import { OrchestratorPersistence } from './persistence.js';
import { TagsCacheStore } from './tags-cache.js';
import { isVLLMResponse, VLLMModelsResponseSchema, type VLLMModelMeta } from './vllm-models.js';

export type { AIServer } from './orchestrator.types.js';

export type ServerLifecycleCallback = (event: 'added' | 'removed', server: AIServer) => void;

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
  /** Retry budget attempts used */
  retryBudgetUsed?: number;
  /** Retry budget maximum attempts */
  retryBudgetMax?: number;
}

function extractParameterSizeFromName(modelName: string): string | undefined {
  const match = /:(\d+(?:\.\d+)?)[bB]/.exec(modelName);
  if (match?.[1]) {
    return `${match[1]}B`;
  }
  return undefined;
}

function extractV1ModelIds(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const obj = raw as Record<string, unknown>;

  // OpenAI standard: { data: [{ id: "..." }, ...] }
  const data = obj['data'];
  if (Array.isArray(data)) {
    return data
      .map((m): string | undefined => {
        if (typeof m === 'string') {
          return m;
        }
        if (m && typeof m === 'object') {
          const r = m as Record<string, unknown>;
          const id = r['id'];
          if (typeof id === 'string') {
            return id;
          }
        }
        return undefined;
      })
      .filter((id): id is string => typeof id === 'string');
  }

  // Ollama-compatible / vLLM fallback: { models: [{ name|id: "..." }, ...] }
  const models = obj['models'];
  if (Array.isArray(models)) {
    return models
      .map((m): string | undefined => {
        if (typeof m === 'string') {
          return m;
        }
        if (m && typeof m === 'object') {
          const r = m as Record<string, unknown>;
          const id = r['id'] ?? r['name'] ?? r['model'];
          if (typeof id === 'string') {
            return id;
          }
        }
        return undefined;
      })
      .filter((id): id is string => typeof id === 'string');
  }

  return [];
}

export class AIOrchestrator {
  private servers: AIServer[] = [];
  private lazyRefreshLastAt: Map<string, number> = new Map();
  private lazyRefreshInFlight: Map<string, Promise<number>> = new Map();
  private static readonly LAZY_REFRESH_WAIT_TIMEOUT_MS = 200;
  private static readonly LAZY_REFRESH_MIN_INTERVAL_MS = 30_000;
  private inFlightManager: InFlightManager;
  private banManager: BanManager;
  private modelAggregator: ModelAggregator;

  /**
   * Returns true for model names that should be routed through the cloud LLM
   * gateway (suffix `:cloud`, prefix `cloud-`, or substring `cloud`).
   */
  static isCloudModel(model: string): boolean {
    if (!model) {
      return false;
    }
    const lower = model.toLowerCase();
    return lower.endsWith(':cloud') || lower.startsWith('cloud-') || lower.includes('cloud');
  }

  /**
   * Trims a candidate pool of servers according to the configured caps.
   * - For cloud models with cloudModelNoCap=true: cap to cloudModelMaxCandidates (default 100).
   * - Otherwise (non-cloud, or cloud without the no-cap override): cap to 20.
   */
  static computeCandidatePoolTrim<T extends { id: string }>(
    servers: T[],
    model: string,
    options: { cloudModelNoCap?: boolean; cloudModelMaxCandidates?: number } | undefined
  ): T[] {
    const isCloud = AIOrchestrator.isCloudModel(model);
    const noCap = options?.cloudModelNoCap === true;
    const maxCandidates = options?.cloudModelMaxCandidates ?? 100;
    if (isCloud && noCap) {
      return servers.length > maxCandidates ? servers.slice(0, maxCandidates) : servers;
    }
    return servers.length > 20 ? servers.slice(0, 20) : servers;
  }

  /**
   * Returns the retry budget for a model. Cloud models use the larger
   * cloudModelRetryBudget / cloudModelMaxCandidates ceiling so a single
   * cloud provider outage does not consume the per-request budget.
   */
  computeRetryBudgetForModel(model: string): number {
    const isCloud = AIOrchestrator.isCloudModel(model);
    const routing =
      (
        this.config as unknown as {
          routing?: { cloudModelRetryBudget?: number; cloudModelMaxCandidates?: number };
        }
      ).routing ?? {};
    if (isCloud) {
      if (typeof routing.cloudModelRetryBudget === 'number') {
        return routing.cloudModelRetryBudget;
      }
      if (typeof routing.cloudModelMaxCandidates === 'number') {
        return routing.cloudModelMaxCandidates;
      }
      return 100;
    }
    const retry = (this.config as unknown as { retry?: { maxBudget?: number } }).retry ?? {};
    return typeof retry.maxBudget === 'number' ? retry.maxBudget : 10;
  }
  private persistence: OrchestratorPersistence;
  private metricsAggregator: MetricsAggregator;
  private telemetry: RequestTelemetry;
  private loadBalancer: LoadBalancer;
  private probeOrchestrator: ProbeOrchestrator;
  private modelAvailabilityProvider?: ModelAvailabilityProvider;
  private recoveryDriver: RecoveryDriver;
  private backoffSchedule: BackoffSchedule;
  private endpointRegistry: EndpointRegistry;
  private walStore: WALStore;
  private draining = false;
  private config: OrchestratorConfig;
  private readonly tagsCacheStore: TagsCacheStore;
  private anthropicModels: AnthropicModels;

  // Track per server:model timeouts via TimeoutManager
  private timeoutManager: TimeoutManager;

  // Track healthy server count for logging changes
  private lastHealthyCount = 0;

  // Escalation check interval handle for cleanup
  private escalationIntervalId?: NodeJS.Timeout;

  // Suppress persistence during bulk operations (e.g., loading from disk)
  private _suppressPersistence = false;

  private errorAggregator: ErrorAggregator;

  private unsubscribeFromConfig?: () => void;

  private serverAddedCallbacks: ServerLifecycleCallback[] = [];
  private serverRemovedCallbacks: ServerLifecycleCallback[] = [];

  public getConfig(): OrchestratorConfig {
    return this.config;
  }
  public getInFlightManager(): InFlightManager {
    return this.inFlightManager;
  }
  public getBanManager(): BanManager {
    return this.banManager;
  }
  public getLoadBalancer(): LoadBalancer {
    return this.loadBalancer;
  }
  public getMetricsAggregator(): MetricsAggregator {
    return this.metricsAggregator;
  }
  public getErrorAggregator(): ErrorAggregator {
    return this.errorAggregator;
  }
  public getTimeoutManager(): TimeoutManager {
    return this.timeoutManager;
  }
  public getModelAggregator(): ModelAggregator {
    return this.modelAggregator;
  }
  public getProbeOrchestrator(): ProbeOrchestrator {
    return this.probeOrchestrator;
  }
  public setModelAvailabilityProvider(provider: ModelAvailabilityProvider): void {
    this.modelAvailabilityProvider = provider;
    this.loadBalancer.setModelAvailabilityProvider(provider);
  }
  public getEndpointRegistry(): EndpointRegistry {
    return this.endpointRegistry;
  }
  public getRecoveryDriver(): RecoveryDriver {
    return this.recoveryDriver;
  }
  public getMetricsStore() {
    return getMetricsStore();
  }
  public getPersistence(): OrchestratorPersistence {
    return this.persistence;
  }
  public getModels(): OrchestratorModels {
    return this.models;
  }

  public async getAggregatedAnthropicModels(): Promise<{ object: string; data: AnthropicModel[] }> {
    return this.anthropicModels.getAggregatedAnthropicModels();
  }
  public getDecisionHistory() {
    return getDecisionHistory();
  }
  public getRequestHistory() {
    return getRequestHistory();
  }
  public getRetryBudget(): typeof RetryBudget {
    return RetryBudget;
  }

  public getTagsCache() {
    return this.tagsCacheStore.get();
  }

  public getAnthropicModels(): AnthropicModels {
    return this.anthropicModels;
  }

  public getInferenceTimeoutMs(): number {
    return this.config.inferenceTimeoutMs;
  }

  public setTagsCache(
    data: any[],
    metadata: {
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      serverCount: number;
      modelCount: number;
      errors: Array<{
        serverId: string;
        error: string;
        type: ErrorType;
      }>;
    }
  ): void {
    this.tagsCacheStore.set(data, metadata);
  }

  public populateRoutingContext(
    context: RoutingContext | undefined,
    serverId: string,
    model: string,
    serverLoad?: number,
    maxConcurrency?: number
  ): void {
    this.persistence.populateRoutingContext(context, serverId, model, serverLoad, maxConcurrency);
  }

  public calculateServerScore(
    server: AIServer,
    model: string,
    currentLoad: number,
    totalLoad: number,
    metrics: ServerModelMetrics | undefined,
    config: LoadBalancerConfig | undefined,
    timeoutMs: number | undefined,
    estimatedPromptTokens: number | undefined,
    getContextLimit?: (serverId: string, model: string) => number
  ): ServerScore {
    return calculateServerScore(
      server,
      model,
      currentLoad,
      totalLoad,
      metrics,
      config,
      timeoutMs,
      estimatedPromptTokens,
      getContextLimit
    );
  }

  public readonly models: OrchestratorModels;

  constructor(loadBalancerConfig?: LoadBalancerConfig, config?: OrchestratorConfig) {
    this.config = config ?? { ...DEFAULT_CONFIG };

    getOperationalStore().runStartupMigrations();

    // Initialize tags cache store with max-entries cap from config
    const maxCachedModels = config?.tags?.maxCachedModels ?? 1000;
    this.tagsCacheStore = new TagsCacheStore(maxCachedModels);

    this.metricsAggregator = new MetricsAggregator();
    // Start automatic prune scheduler for metrics (T6).
    // Uses config.metrics.pruneIntervalMs (default 300000 = 5 min). 0 disables.
    this.metricsAggregator.startPruneScheduler(
      this.config.metrics.pruneIntervalMs,
      24 * 60 * 60 * 1000 // 24h default maxAge
    );

    this.telemetry = new RequestTelemetry(
      {
        metricsAggregators: this.metricsAggregator as unknown as {
          recordRequest: (ctx: RequestContext) => unknown;
        },
        getRequestHistory: () =>
          getRequestHistory() as unknown as {
            recordRequest: (ctx: RequestContext, queueWaitTime?: number) => unknown;
          },
        getMetricsStore: () =>
          getMetricsStore() as unknown as {
            recordRequest: (ctx: RequestContext, opts?: unknown) => unknown;
          },
        getAnalyticsEngine: () =>
          getAnalyticsEngine() as unknown as {
            recordRequest: (ctx: RequestContext) => unknown;
          },
      },
      {
        getErrorEventStore: () =>
          getErrorEventStore() as unknown as {
            recordError: (event: unknown) => Promise<unknown>;
          },
      }
    );
    // maxStickySessions is constructor-only — the BoundedMap cap is fixed
    // at construction; runtime changes to this knob require LoadBalancer
    // re-instantiation (orchestrator restart). See LoadBalancer docs.
    this.loadBalancer = new LoadBalancer(loadBalancerConfig ?? this.config.loadBalancer);

    const lbConfig = loadBalancerConfig ?? this.config.loadBalancer;
    if (lbConfig.crossModelInference) {
      this.metricsAggregator.setCrossModelInferenceConfig(lbConfig.crossModelInference);
    }

    this.persistence = new OrchestratorPersistence(this);

    // Initialize BanManager
    this.banManager = new BanManager();

    const eaConfig = this.config.errorAggregator;
    this.errorAggregator = new ErrorAggregator(
      eaConfig
        ? {
            enabled: eaConfig.enabled,
            rateLimitThreshold: eaConfig.rateLimitThreshold,
            timeWindowMs: eaConfig.timeWindowMs,
            clusterBackoffMs: eaConfig.clusterBackoffMs,
            clusterSize: this.servers.length,
          }
        : {}
    );
    this.errorAggregator.startPeriodicCleanup();

    // Initialize InFlightManager - use the shared singleton so all modules
    // (controllers, streaming handlers, etc.) operate on the same manager.
    this.inFlightManager = getInFlightManager();

    // Initialize ModelAggregator
    this.modelAggregator = new ModelAggregator();

    // Initialize probe subsystem (ProbeOrchestrator + EndpointRegistry + WALStore)
    this.walStore = new WALStore(getOperationalStore());
    this.probeOrchestrator = new ProbeOrchestrator(DEFAULT_PROBE_CONFIG, this.walStore);
    this.endpointRegistry = new EndpointRegistry();

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
        const timeoutStates = this.persistence.loadTimeoutsFromDisk(
          currentConfig.circuitBreaker.activeTestTimeout
        );
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

    this.models = new OrchestratorModels(this);

    this.walStore = new WALStore(getOperationalStore());
    this.endpointRegistry = new EndpointRegistry();
    this.anthropicModels = new AnthropicModels(
      this,
      this.config.anthropic?.modelsCacheTtlMs ?? 30000
    );
    const probeConfig =
      (this.config as { probe?: typeof DEFAULT_PROBE_CONFIG }).probe ?? DEFAULT_PROBE_CONFIG;
    this.probeOrchestrator = new ProbeOrchestrator(probeConfig, this.walStore);
    this.backoffSchedule = new BackoffSchedule(probeConfig);
    this.recoveryDriver = new RecoveryDriver(
      this.probeOrchestrator,
      this.endpointRegistry,
      this.backoffSchedule,
      probeConfig,
      async tuple => {
        const server = this.servers.find(s => s.id === tuple.serverId);
        if (!server) {
          return { success: false, classification: { kind: 'transient', retryable: true } };
        }
        const { probeExecutor } = await import('./probe-executor.js');
        return probeExecutor(tuple, { serverUrl: server.url, apiKey: server.apiKey });
      }
    );
    this.probeOrchestrator.onStateChange((tuple, from, to, reason) => {
      const failureTracker = getRecoveryFailureTracker();
      failureTracker.recordCircuitBreakerTransition(
        tuple.serverId,
        tuple.model,
        from === 'HEALTHY' ? 'closed' : from === 'UNHEALTHY' ? 'open' : 'half-open',
        to === 'HEALTHY' ? 'closed' : to === 'UNHEALTHY' ? 'open' : 'half-open',
        reason
      );
    });
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: OrchestratorConfig): void {
    this.config = config;

    this.loadBalancer.updateConfig(config.loadBalancer);
    this.metricsAggregator.setDecayConfig(config.metrics.decay);
    getTemporalScorer().updateConfig(config.storage.temporal);
    this.banManager.updateConfig({ failureCooldownMs: config.cooldown?.failureCooldownMs });

    logger.info('Orchestrator config updated at runtime');
  }

  /**
   * Handle individual health check result
   * @deprecated RecoveryDriver now handles probe results; this is a no-op stub
   */
  private onunknown(_result: unknown): void {
    // No-op: probe subsystem (RecoveryDriver) now handles probe result processing
    // The old HealthCheckScheduler still calls this but the result is handled by the new probe system
  }

  /**
   * Handle completion of all health checks
   * @deprecated RecoveryDriver now handles probe results; this is a no-op stub
   */
  private onAllHealthChecksComplete(_results: unknown[]): void {
    // No-op: probe subsystem (RecoveryDriver) now handles probe result processing
  }

  /**
   * Add a new Ollama server to the registry.
   *
   * Atomic duplicate handling: The check-and-add operation is synchronous and
   * atomic from the caller's perspective (single-threaded JavaScript event loop).
   * However, concurrent HTTP requests could theoretically pass the duplicate
   * check before either adds - this would require a mutex for true atomicity.
   * The controller trusts this method to handle duplicates after removing
   * its own pre-check (task 2.1).
   */
  addServer(
    server: Omit<AIServer, 'healthy' | 'lastResponseTime' | 'models' | 'serverAddedAt'>
  ): void {
    // Normalize URL first - BEFORE checking for duplicates and BEFORE storing
    const normalizedUrl = normalizeServerUrl(server.url);

    // Check for duplicates by ID or equivalent URL (uses normalized comparison)
    // Note: This is synchronous atomic within the single-threaded JS event loop,
    // but concurrent requests may still create a race condition (see JSDoc above)
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
      serverAddedAt: Date.now(),
    };

    this.servers.push(newServer);
    this.modelAggregator.addServer(newServer);
    getModelManager().registerServer(newServer);

    this.errorAggregator.setClusterSize(this.servers.length);
    logger.info(`Added server ${server.id} at ${normalizedUrl}`);

    // Declare endpoints based on server type to avoid polluting the registry
    // with irrelevant capabilities:
    // - 'ollama': only Ollama endpoints
    // - 'openai': only OpenAI endpoints + anthropic_messages
    // - 'auto': all (preserves current behavior for auto-detected servers)
    const endpointsToDeclare: ProbeEndpoint[] = [];
    const isAuto = !server.type || server.type === 'auto';

    if (server.type === 'ollama' || isAuto) {
      for (const ep of GENERATION_ENDPOINTS) {
        if (ep.startsWith('ollama_')) {
          endpointsToDeclare.push(ep);
        }
      }
      for (const ep of EMBEDDING_ENDPOINTS) {
        if (ep.startsWith('ollama_')) {
          endpointsToDeclare.push(ep);
        }
      }
    }
    if (server.type === 'openai' || isAuto) {
      for (const ep of GENERATION_ENDPOINTS) {
        if (ep.startsWith('openai_')) {
          endpointsToDeclare.push(ep);
        }
      }
      for (const ep of EMBEDDING_ENDPOINTS) {
        if (ep.startsWith('openai_')) {
          endpointsToDeclare.push(ep);
        }
      }
      endpointsToDeclare.push('anthropic_messages');
    }

    for (const endpoint of endpointsToDeclare) {
      this.endpointRegistry.declare(newServer.id, endpoint);
    }

    // Invalidate cache since we added a new server
    this.invalidateTagsCache();

    // Persist servers to disk if enabled and not suppressed
    if (this.config.enablePersistence && !this._suppressPersistence) {
      this.persistence.saveServersToDisk(this.servers);
    }

    for (const cb of this.serverAddedCallbacks) {
      cb('added', newServer);
    }
  }
  // Clear one (serverId, model) negative-model-cache claim. Used by the ModelVerifier
  // (src/probe/model-verifier.ts) after a successful re-verification probe.
  forgetBrokenClaim(serverId: string, model: string): boolean {
    return getNegativeModelCache().clear(serverId, model);
  }

  cleanupOrphanedBreakers(): number {
    const fleetIds = new Set(this.servers.map(s => s.id));
    const advertisedModelsByServer = new Map<string, Set<string>>();
    for (const server of this.servers) {
      advertisedModelsByServer.set(server.id, new Set(server.models ?? []));
    }
    let evicted = 0;
    for (const [key] of this.probeOrchestrator.getAllStates()) {
      const parsed = parseTupleKey(key);
      if (!fleetIds.has(parsed.serverId)) {
        this.probeOrchestrator.evictTuple(parsed);
        evicted += 1;
        continue;
      }
      const advertised = advertisedModelsByServer.get(parsed.serverId);
      if (advertised && !advertised.has(parsed.model)) {
        this.probeOrchestrator.evictTuple(parsed);
        evicted += 1;
      }
    }
    return evicted;
  }

  removeServer(serverId: string): void {
    const initialCount = this.servers.length;
    const removedServer = this.servers.find(s => s.id === serverId);
    this.servers = this.servers.filter(s => s.id !== serverId);

    if (this.servers.length < initialCount) {
      if (removedServer) {
        for (const cb of this.serverRemovedCallbacks) {
          cb('removed', removedServer);
        }
      }

      this.modelAggregator.removeServer(serverId);
      this.errorAggregator.setClusterSize(this.servers.length);
      logger.info(`Removed server ${serverId}. Remaining servers: ${this.servers.length}`);
      this.invalidateTagsCache();

      this.banManager.removeServerBans(serverId);
      this.banManager.clearCooldown(serverId, '');
      this.timeoutManager.reset(serverId);
      getModelManager().unregisterServer(serverId);

      // Evict probe tuples for this server
      this.endpointRegistry.revokeAll(serverId);
      if (removedServer) {
        for (const model of removedServer.models) {
          for (const endpoint of [...GENERATION_ENDPOINTS, ...EMBEDDING_ENDPOINTS]) {
            void this.probeOrchestrator.evictTuple({ serverId, model, endpoint });
          }
        }
      }
      // Bulk-evict any remaining tuples for models the server no longer advertises.
      this.probeOrchestrator.evictAllForServer(serverId);

      // Persist servers to disk if enabled
      if (this.config.enablePersistence) {
        logger.info(`Saving ${this.servers.length} servers to disk after removal...`);
        this.persistence.saveServersToDisk(this.servers);
      } else {
        logger.warn(`Persistence disabled - server removal will not be saved to disk`);
      }
    } else {
      logger.warn(ERROR_MESSAGES.SERVER_NOT_FOUND_COLON(serverId));
    }
  }

  /**
   * Get all registered servers (deduplicated)
   * @param options - Filter options
   * @param options.healthyOnly - Return only healthy servers
   * @param options.excludeGhosts - Return only servers with at least 1 model loaded (per PS poll coordinator)
   */
  getServers(options: { healthyOnly?: boolean; excludeGhosts?: boolean } = {}): AIServer[] {
    let servers = Array.from(this.servers);

    if (options.healthyOnly) {
      servers = servers.filter(s => s.healthy);
    }

    if (options.excludeGhosts) {
      const psCoordinator = getPsPollCoordinator();
      servers = servers.filter(s => psCoordinator.getModelsOnServer(s.id).size > 0);
    }

    // Deduplicate by server id
    const seen = new Set<string>();
    return servers.filter(s => {
      if (seen.has(s.id)) {
        return false;
      }
      seen.add(s.id);
      return true;
    });
  }

  getClusterStatus(): ClusterStatus {
    return this.errorAggregator.getClusterStatus();
  }

  /**
   * Lazily refreshes the per-server model lists for any server whose model
   * catalog does not already include `model`. Coalesces concurrent refreshes
   * per-model via singleflight and enforces a 200ms wait timeout: callers that
   * time out receive `0` so request hot paths never block on slow probes.
   */
  async refreshServerModelsForModel(model: string): Promise<number> {
    // Coalesce concurrent refreshes for the same model.
    const existing = this.lazyRefreshInFlight.get(model);
    if (existing) {
      return existing;
    }

    // Skip if refreshed within the min interval.
    const lastAt = this.lazyRefreshLastAt.get(model);
    if (lastAt !== undefined && Date.now() - lastAt < AIOrchestrator.LAZY_REFRESH_MIN_INTERVAL_MS) {
      return 0;
    }

    const serversNeedingRefresh = this.servers.filter(s => s.healthy && !s.models.includes(model));
    if (serversNeedingRefresh.length === 0) {
      this.lazyRefreshLastAt.set(model, Date.now());
      return 0;
    }

    const promise = this.runLazyRefresh(model, serversNeedingRefresh);
    this.lazyRefreshInFlight.set(model, promise);
    try {
      return await promise;
    } finally {
      this.lazyRefreshInFlight.delete(model);
    }
  }

  private async runLazyRefresh(model: string, servers: AIServer[]): Promise<number> {
    let totalAdded = 0;
    try {
      const result = await Promise.race([
        this.performLazyRefresh(model, servers),
        new Promise<number>(resolve =>
          setTimeout(() => resolve(0), AIOrchestrator.LAZY_REFRESH_WAIT_TIMEOUT_MS)
        ),
      ]);
      totalAdded = result;
    } catch {
      totalAdded = 0;
    } finally {
      this.lazyRefreshLastAt.set(model, Date.now());
    }
    return totalAdded;
  }

  private async performLazyRefresh(model: string, servers: AIServer[]): Promise<number> {
    const { discoverModels } = await import('./discover-models.js');
    let totalAdded = 0;
    for (const server of servers) {
      try {
        const discovered = await discoverModels(server.url, { timeoutMs: 5000 });
        const want = discovered.merged.find(m => m === model || m.startsWith(model + ':'));
        if (want && !server.models.includes(want)) {
          server.models = [...server.models, want];
          totalAdded++;
        }
      } catch {
        // continue with remaining servers
      }
    }
    return totalAdded;
  }

  /**
   * Run garbage-detection on a response and quarantine the server if any
   * signals trigger. Returns the detection result for caller observability.
   */
  recordGarbageResponse(
    serverId: string,
    responseText: string,
    promptText: string | null,
    model: string
  ): { isGarbage: boolean; signals: string[] } {
    const signals: string[] = [];
    let confidence = 0;
    let evidence = responseText.length > 200 ? responseText.slice(0, 200) : responseText;

    // NDJSON response from a non-streaming endpoint is a strong signal in its
    // own right — surface it before running the generic detector so the operator
    // sees the format error specifically.
    if (detectNdjsonResponse(responseText) !== null) {
      signals.push('ndjson-streaming-format');
      confidence = 1.0;
    }

    const detection = detectGarbageResponse(responseText, promptText);
    if (detection.isGarbage) {
      for (const s of detection.signals) {
        if (!signals.includes(s)) {
          signals.push(s);
        }
      }
      if (detection.confidence > confidence) {
        confidence = detection.confidence;
      }
      if (detection.evidence && detection.evidence.length > 0) {
        evidence = detection.evidence;
      }
    }

    if (signals.length === 0) {
      return { isGarbage: false, signals: [] };
    }

    getQuarantinePool().quarantine(
      serverId,
      'garbage-response',
      {
        signals,
        confidence,
        evidence,
        model,
      },
      false
    );
    return { isGarbage: true, signals: [...signals] };
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
    updates: Partial<
      Pick<
        AIServer,
        | 'maxConcurrency'
        | 'modelContextLimits'
        | 'type'
        | 'v1Models'
        | 'forcedCapabilities'
        | 'endpointOverrides'
      >
    >
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

    if (updates.type !== undefined) {
      server.type = updates.type;
      logger.info(`Updated server ${serverId} type to ${updates.type}`);
    }

    if (updates.v1Models !== undefined) {
      server.v1Models = updates.v1Models;
      logger.info(`Updated server ${serverId} v1Models`);
    }

    if (updates.forcedCapabilities !== undefined) {
      server.forcedCapabilities = { ...updates.forcedCapabilities };
      logger.info(`Updated server ${serverId} forcedCapabilities`);
    }

    if (updates.endpointOverrides !== undefined) {
      server.endpointOverrides = { ...updates.endpointOverrides };
      logger.info(`Updated server ${serverId} endpointOverrides`);
    }

    // Persist servers to disk if enabled
    if (this.config.enablePersistence) {
      this.persistence.saveServersToDisk(this.servers);
    }

    return true;
  }

  /**
   * Persist current server list to disk. Called by external subsystems
   * (e.g., the capability probe scheduler) after they mutate server fields.
   */
  persistServers(): void {
    if (this.config.enablePersistence && !this._suppressPersistence) {
      this.persistence.saveServersToDisk(this.servers);
    }
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

      const [response, versionResponse, v1Response, anthropicResponse] = await Promise.all([
        probeOllama
          ? fetch(`${server.url}${API_ENDPOINTS.OLLAMA.TAGS}`, {
              signal: controller.signal,
            })
              .then(res => {
                if (res?.ok) {
                  this.endpointRegistry.confirm(server.id, 'ollama_tags' as ProbeEndpoint);
                }
                return res;
              })
              .catch((err: unknown) => {
                logger.debug('Probe fetch failed for /api/tags', {
                  serverId: server.id,
                  error: String(err),
                });
                this.endpointRegistry.recordFailure(server.id, 'ollama_tags' as ProbeEndpoint);
                return null;
              })
          : Promise.resolve(null),
        probeOllama
          ? fetch(`${server.url}${API_ENDPOINTS.OLLAMA.VERSION}`, {
              signal: controller.signal,
            })
              .then(res => {
                if (res?.ok) {
                  this.endpointRegistry.confirm(server.id, 'ollama_version' as ProbeEndpoint);
                }
                return res;
              })
              .catch((err: unknown) => {
                logger.debug('Probe fetch failed for /api/version', {
                  serverId: server.id,
                  error: String(err),
                });
                this.endpointRegistry.recordFailure(server.id, 'ollama_version' as ProbeEndpoint);
                return null;
              })
          : Promise.resolve(null),
        probeV1
          ? fetch(`${server.url}${API_ENDPOINTS.OPENAI.MODELS}`, {
              signal: controller.signal,
              headers: server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : undefined,
            })
              .then(res => {
                if (res?.ok) {
                  this.endpointRegistry.confirm(server.id, 'openai_models' as ProbeEndpoint);
                }
                return res;
              })
              .catch((err: unknown) => {
                logger.debug('Probe fetch failed for /v1/models', {
                  serverId: server.id,
                  error: String(err),
                });
                this.endpointRegistry.recordFailure(server.id, 'openai_models' as ProbeEndpoint);
                return null;
              })
          : Promise.resolve(null),
        probeV1
          ? fetch(`${server.url}/v1/messages`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': server.apiKey || '',
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: '__probe__',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'hi' }],
              }),
              signal: AbortSignal.timeout(2000),
            })
              .then(res => {
                if (res !== null && res.status !== 401) {
                  this.endpointRegistry.confirm(server.id, 'anthropic_messages' as ProbeEndpoint);
                }
                return res;
              })
              .catch((err: unknown) => {
                logger.debug('Probe fetch failed for /v1/messages', {
                  serverId: server.id,
                  error: String(err),
                });
                this.endpointRegistry.recordFailure(
                  server.id,
                  'anthropic_messages' as ProbeEndpoint
                );
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

      const newSupportsAnthropic = anthropicResponse !== null && anthropicResponse.status !== 401;
      if (newSupportsAnthropic !== server.supportsAnthropic) {
        logger.info(`Server ${server.id} Anthropic support: ${newSupportsAnthropic}`);
        server.supportsAnthropic = newSupportsAnthropic;
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

      // Extract OpenAI models from /v1/models response.
      // Always overwrite discoveredV1Models when the endpoint returns 2xx — even with
      // an empty list — to avoid the silent staleness caused by a first-probe empty
      // result. Accepts {data:[{id}]} (OpenAI standard) and {models:[{name|id}]}
      // (Ollama-compatible / vLLM) response shapes.
      if (v1Response?.ok) {
        try {
          const raw = (await v1Response.json()) as unknown;
          const ids = extractV1ModelIds(raw);

          server.discoveredV1Models = ids;
          if (ids.length > 0) {
            logger.debug('Discovered v1 models', {
              serverId: server.id,
              count: ids.length,
            });
          }

          if (ids.length > 0 && (!server.v1Models || server.v1Models.length === 0)) {
            server.v1Models = [...ids];
            logger.info('Auto-populated v1Models from discovery', {
              serverId: server.id,
              models: server.v1Models.length,
            });
          }

          if (isVLLMResponse(raw)) {
            const vllmParsed = VLLMModelsResponseSchema.safeParse(raw);
            if (vllmParsed.success && vllmParsed.data) {
              const vllmMeta: Record<string, VLLMModelMeta> = {};
              for (const model of vllmParsed.data.data) {
                if (model.id && model.metadata) {
                  vllmMeta[model.id] = model.metadata;
                }
              }
              if (Object.keys(vllmMeta).length > 0) {
                server.vllmMetadata = vllmMeta;
                logger.debug('Extracted vLLM metadata from discovery', {
                  serverId: server.id,
                  modelCount: Object.keys(vllmMeta).length,
                });
              }
            }
          }

          if (this.config.enablePersistence && !this._suppressPersistence) {
            this.persistence.saveServersToDisk(this.servers);
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
    return this.models.getAggregatedTags();
  }

  private async fetchServerTags(server: AIServer): Promise<{
    success: boolean;
    data?: any[];
    serverId: string;
    error?: { serverId: string; error: string; type: ErrorType };
  }> {
    return this.models.fetchServerTags(server);
  }

  private mergeTagsData(
    allTags: Map<string, Record<string, unknown>>,
    models: unknown[],
    serverId: string
  ): void {
    this.models.mergeTagsData(allTags, models, serverId);
  }

  /**
   * Get aggregated OpenAI models from servers supporting /v1/* endpoints
   */
  getAggregatedOpenAIModels(options: { includeAll?: boolean } = {}): {
    object: string;
    data: Array<{
      id: string;
      object: string;
      created: number;
      owned_by: string;
      metadata?: VLLMModelMeta;
    }>;
  } {
    const includeAll = options.includeAll === true;
    const seenModels = new Set<string>();

    const modelToServers = new Map<string, string[]>();
    const modelToVLLMMeta = new Map<string, VLLMModelMeta>();

    for (const server of this.servers) {
      if (!server.healthy || !server.supportsV1) {
        continue;
      }

      if (server.v1Models) {
        for (const modelId of filterValidModels(server.v1Models)) {
          if (!seenModels.has(modelId)) {
            seenModels.add(modelId);
            modelToServers.set(modelId, []);
          }
          const servers = modelToServers.get(modelId);
          if (servers && !servers.includes(server.id)) {
            servers.push(server.id);
          }
          if (!modelToVLLMMeta.has(modelId) && server.vllmMetadata?.[modelId]) {
            modelToVLLMMeta.set(modelId, server.vllmMetadata[modelId]);
          }
        }
      }

      if (server.discoveredV1Models) {
        for (const modelId of filterValidModels(server.discoveredV1Models)) {
          if (!seenModels.has(modelId)) {
            seenModels.add(modelId);
            modelToServers.set(modelId, []);
          }
          const servers = modelToServers.get(modelId);
          if (servers && !servers.includes(server.id)) {
            servers.push(server.id);
          }
          if (!modelToVLLMMeta.has(modelId) && server.vllmMetadata?.[modelId]) {
            modelToVLLMMeta.set(modelId, server.vllmMetadata[modelId]);
          }
        }
      }
    }

    // Second pass: filter to only include models with closed circuit breaker
    const models: Array<{
      id: string;
      object: string;
      created: number;
      owned_by: string;
      metadata?: VLLMModelMeta;
    }> = [];

    for (const [modelId, servers] of modelToServers) {
      if (includeAll || this.hasAvailableServer(modelId, servers)) {
        const model: {
          id: string;
          object: string;
          created: number;
          owned_by: string;
          metadata?: VLLMModelMeta;
        } = {
          id: modelId,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: servers[0],
        };
        const vllmMeta = modelToVLLMMeta.get(modelId);
        if (vllmMeta) {
          model.metadata = vllmMeta;
        }
        models.push(model);
      }
    }

    return {
      object: 'list',
      data: models,
    };
  }

  /**
   * Check if a model has at least one server that can serve traffic
   * Uses probe system to determine if routing is allowed
   */
  private hasAvailableServer(modelName: string, serverIds: string[]): boolean {
    for (const serverId of serverIds) {
      const tuple: Tuple = { serverId, model: modelName, endpoint: 'ollama_chat' };
      if (this.probeOrchestrator.canServe(tuple, 'routing')) {
        return true;
      }
    }
    return false;
  }

  public resolveModelName(model: string, availableModels: string[]): string | null {
    if (availableModels.includes(model)) {
      return model;
    }

    const tagResult = this.resolveTagVariants(model, availableModels);
    if (tagResult) {
      return tagResult;
    }

    const fuzzyResult = this.resolveByFamilyAndSize(model, availableModels);
    if (fuzzyResult) {
      return fuzzyResult;
    }

    return null;
  }

  private resolveTagVariants(model: string, availableModels: string[]): string | null {
    if (!model.includes(':')) {
      const withLatest = `${model}:latest`;
      if (availableModels.includes(withLatest)) {
        return withLatest;
      }
    }

    if (model.endsWith(':latest')) {
      const withoutLatest = model.slice(0, -7);
      if (availableModels.includes(withoutLatest)) {
        return withoutLatest;
      }
      const withLatestSuffix = `${withoutLatest}:latest`;
      if (availableModels.includes(withLatestSuffix)) {
        return withLatestSuffix;
      }
    }

    return null;
  }

  private parseModelParts(model: string): { family: string; tag: string } {
    const colonIdx = model.lastIndexOf(':');
    if (colonIdx === -1) {
      return { family: model, tag: 'latest' };
    }
    return {
      family: model.slice(0, colonIdx),
      tag: model.slice(colonIdx + 1),
    };
  }

  private extractModelSize(tag: string): number | null {
    const match = tag.match(/^(\d+(?:\.\d+)?)b$/i);
    if (!match) {
      return null;
    }
    return parseFloat(match[1]);
  }

  private resolveByFamilyAndSize(model: string, availableModels: string[]): string | null {
    const { family, tag } = this.parseModelParts(model);
    const requestedSize = this.extractModelSize(tag);

    if (!requestedSize) {
      return null;
    }

    const candidates: Array<{ modelName: string; size: number }> = [];

    for (const avail of availableModels) {
      const parts = this.parseModelParts(avail);
      if (parts.family !== family) {
        continue;
      }
      const availSize = this.extractModelSize(parts.tag);
      if (availSize !== null) {
        candidates.push({ modelName: avail, size: availSize });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => Math.abs(a.size - requestedSize) - Math.abs(b.size - requestedSize));

    return candidates[0].modelName;
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
    estimatedPromptTokens?: number,
    userId?: string,
    isAdmin?: boolean,
    requestId?: string
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
        return calculateServerScore(
          server,
          model,
          totalLoad,
          totalLoad,
          metrics,
          undefined,
          this.getTimeout(server.id, model),
          estimatedPromptTokens,
          (serverId: string, model: string) =>
            this.getModelContextLimit(this.servers.find(s => s.id === serverId)!, model)
        );
      });

      getDecisionHistory().recordDecision(
        model,
        selected,
        this.loadBalancer.getAlgorithm(),
        scores,
        'single_candidate',
        requestId
      );
      return selected;
    }

    // Use load balancer with historical metrics for intelligent selection
    const selected = this.loadBalancer.select(
      candidates,
      model,
      (serverId: string, model: string) => this.getModelInFlight(serverId, model),
      (serverId: string) => this.getTotalInFlight(serverId),
      (serverId: string, model: string) =>
        this.metricsAggregator.getMetricsWithFallback(serverId, model),
      isStreaming,
      undefined,
      (serverId: string, model: string) => this.getTimeout(serverId, model),
      estimatedPromptTokens,
      (serverId: string, model: string) =>
        this.getModelContextLimit(this.servers.find(s => s.id === serverId)!, model),
      userId,
      isAdmin
    );

    // Record the decision for historical analysis
    if (selected) {
      const scores = candidates.map(server => {
        const totalLoad = this.getTotalInFlight(server.id);
        const metrics = this.metricsAggregator.getMetricsWithFallback(server.id, model);
        return calculateServerScore(
          server,
          model,
          totalLoad,
          totalLoad,
          metrics,
          undefined,
          this.getTimeout(server.id, model),
          estimatedPromptTokens,
          (serverId: string, model: string) =>
            this.getModelContextLimit(this.servers.find(s => s.id === serverId)!, model)
        );
      });

      getDecisionHistory().recordDecision(
        model,
        selected,
        this.loadBalancer.getAlgorithm(),
        scores,
        'load_balancer',
        requestId
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
        return calculateServerScore(
          server,
          model,
          totalLoad,
          totalLoad,
          metrics,
          undefined,
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

    // Use totalLoad as the current load for server-level capacity scoring
    return calculateServerScore(
      server,
      model,
      totalLoad,
      totalLoad,
      metrics,
      undefined,
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
    endpoint: ProbeEndpoint = 'ollama_generate',
    requiredCapability?: 'ollama' | 'openai' | 'anthropic',
    routingContext?: RoutingContext,
    signal?: AbortSignal,
    estimatedPromptTokens?: number,
    userId?: string,
    isAdmin?: boolean,
    requestId?: string
  ): Promise<T> {
    const errors: Array<{ server: string; error: string; type?: ClassifyErrorType }> = [];
    const routingStartTime = Date.now();

    const retryBudget = new RetryBudget(
      (this.config.retry as { maxBudget?: number })?.maxBudget ?? 10
    );

    // Check for abort before starting
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    const clusterBackoffMs = this.errorAggregator.getBackoffForCluster();
    const rateLimitedServerIds = Object.keys(
      this.errorAggregator.getErrorSummary().rateLimitServers
    );

    const eligibleForBackoff = this.servers.filter(s => {
      if (requiredCapability === 'ollama' && s.supportsOllama === false) {
        return false;
      }
      if (requiredCapability === 'openai') {
        const hasV1Evidence =
          s.supportsV1 === true ||
          (s.v1Models && s.v1Models.length > 0) ||
          (s.discoveredV1Models && s.discoveredV1Models.length > 0);
        if (!hasV1Evidence) {
          return false;
        }
      }
      if (requiredCapability === 'anthropic' && s.supportsAnthropic === false) {
        return false;
      }
      return s.healthy && !this.isInCooldown(s.id, model) && !this.banManager.isBanned(s.id, model);
    });

    const shouldDelay =
      clusterBackoffMs > 0 && eligibleForBackoff.some(s => rateLimitedServerIds.includes(s.id));
    if (shouldDelay) {
      await sleep(clusterBackoffMs);
    }

    // Track context-filtered servers for better error messages
    let contextFilteredCount = 0;
    let smallestContextLimit = Infinity;
    const eligibleServers = this.servers.filter(s => {
      // Check capability requirement
      if (requiredCapability === 'ollama' && s.supportsOllama === false) {
        return false;
      }
      // Check if server has any v1 support evidence
      const hasV1Evidence =
        s.supportsV1 === true ||
        (s.v1Models && s.v1Models.length > 0) ||
        (s.discoveredV1Models && s.discoveredV1Models.length > 0);

      if (requiredCapability === 'openai' && !hasV1Evidence) {
        return false;
      }
      if (requiredCapability === 'anthropic' && s.supportsAnthropic === false) {
        return false;
      }

      // Get the appropriate model list for this capability
      const availableModels =
        requiredCapability === 'openai' || requiredCapability === 'anthropic'
          ? Array.from(
              new Set([...(s.v1Models ?? []), ...(s.discoveredV1Models ?? []), ...(s.models ?? [])])
            )
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
        (serverId: string, model: string) => this.getTimeout(serverId, model),
        estimatedPromptTokens,
        (serverId: string, model: string) =>
          this.getModelContextLimit(this.servers.find(s => s.id === serverId)!, model),
        userId,
        isAdmin
      );

      if (!selected) {
        break;
      }

      // Record decision for the first selection (actual routing decision with full scores)
      if (!firstDecisionRecorded) {
        const scores = remainingServers.map(server => {
          const totalLoad = this.getTotalInFlight(server.id);
          const metrics = this.metricsAggregator.getMetricsWithFallback(server.id, model);
          return calculateServerScore(
            server,
            model,
            totalLoad,
            totalLoad,
            metrics,
            undefined,
            this.getTimeout(server.id, model),
            estimatedPromptTokens,
            (serverId: string, model: string) =>
              this.getModelContextLimit(this.servers.find(s => s.id === serverId)!, model)
          );
        });

        getDecisionHistory().recordDecision(
          model,
          selected,
          this.loadBalancer.getAlgorithm(),
          scores,
          'load_balancer',
          requestId
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
              ? Array.from(
                  new Set([
                    ...(s.v1Models ?? []),
                    ...(s.discoveredV1Models ?? []),
                    ...(s.models ?? []),
                  ])
                )
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

    if (!retryBudget.canRetry()) {
      throw new Error('Retry budget exhausted before any attempts');
    }

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
        routingContext,
        endpoint
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
        this.persistence.populateRoutingContext(
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
      retryBudget.recordAttempt(server.id);
      if (retryBudget.isExhausted()) {
        const uniqueServerCount = new Set(allServersTried).size;
        throw new Error(
          `Retry budget exhausted after ${retryBudget.getAttemptsUsed()} attempts across ${uniqueServerCount} servers`
        );
      }
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
        routingContext,
        endpoint
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
        this.persistence.populateRoutingContext(
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
      retryBudget.recordAttempt(server.id);
      if (retryBudget.isExhausted()) {
        const uniqueServerCount = new Set(allServersTried).size;
        throw new Error(
          `Retry budget exhausted after ${retryBudget.getAttemptsUsed()} attempts across ${uniqueServerCount} servers`
        );
      }
    }

    // Phase 3: All servers exhausted twice, now try same-server retries on initial server only
    failoverPhase = 3;
    // Check for abort before Phase 3
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }
    if (!retryBudget.canRetry()) {
      const uniqueServerCount = new Set(allServersTried).size;
      throw new Error(
        `Retry budget exhausted before Phase 3 after ${retryBudget.getAttemptsUsed()} attempts across ${uniqueServerCount} servers`
      );
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
        routingContext,
        endpoint
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
        this.persistence.populateRoutingContext(
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
      retryBudget.recordAttempt(initialServer.id);
      if (retryBudget.isExhausted()) {
        const uniqueServerCount = new Set(allServersTried).size;
        throw new Error(
          `Retry budget exhausted after ${retryBudget.getAttemptsUsed()} attempts across ${uniqueServerCount} servers`
        );
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
      routingContext.retryBudgetUsed = retryBudget.getAttemptsUsed();
      routingContext.retryBudgetMax =
        retryBudget.getAttemptsRemaining() + retryBudget.getAttemptsUsed();
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

    // Check circuit breaker (skip if bypassing) - now uses probe system
    if (!bypassCircuitBreaker && this.shouldSkipServerModel(server.id, model)) {
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
        this.persistence.populateRoutingContext(
          routingContext,
          server.id,
          model,
          serverLoad,
          maxConcurrency
        );
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
    errors: Array<{ server: string; error: string; type?: ClassifyErrorType }>,
    _timeoutMs?: number,
    alreadyIncremented: boolean = false,
    parentRequestId?: string,
    isRetry: boolean = false,
    routingContext?: RoutingContext,
    endpoint: ProbeEndpoint = 'ollama_generate'
  ): Promise<{ success: true; value: T } | { success: false }> {
    const wasActiveTestAtStart = false;

    const requestContext: RequestContext = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      startTime: Date.now(),
      serverId: server.id,
      model,
      endpoint,
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

      // Extract token metrics BEFORE decrementing in-flight (needed for token-weighted tracking)
      let tokensGenerated = 0;
      let tokensPrompt = 0;

      // Extract token metrics from Ollama response for non-streaming requests
      if (!isStreaming && result && typeof result === 'object') {
        const ollamaResponse = result as Record<string, unknown>;
        if (typeof ollamaResponse.eval_count === 'number') {
          tokensGenerated = ollamaResponse.eval_count;
        }
        if (typeof ollamaResponse.prompt_eval_count === 'number') {
          tokensPrompt = ollamaResponse.prompt_eval_count;
        }
      }

      // Extract token metrics from streaming responses
      if (isStreaming && result && typeof result === 'object' && '_tokenMetrics' in result) {
        const tokenMetrics = (
          result as { _tokenMetrics?: { tokensGenerated?: number; tokensPrompt?: number } }
        )._tokenMetrics;
        if (tokenMetrics) {
          if (typeof tokenMetrics.tokensGenerated === 'number') {
            tokensGenerated = tokenMetrics.tokensGenerated;
          }
          if (typeof tokenMetrics.tokensPrompt === 'number') {
            tokensPrompt = tokenMetrics.tokensPrompt;
          }
        }
      }

      // Use token-weighted decrement when we have token information
      if (tokensPrompt > 0 || tokensGenerated > 0) {
        this.decrementInFlightWithTokens(server.id, model, tokensPrompt, tokensGenerated);
      } else {
        this.decrementInFlight(server.id, model);
      }

      // Record successful request metrics
      requestContext.endTime = Date.now();
      requestContext.duration = requestContext.endTime - requestContext.startTime;
      requestContext.success = true;
      requestContext.tokensGenerated = tokensGenerated || undefined;
      requestContext.tokensPrompt = tokensPrompt || undefined;

      // Extract chunk data if present
      if (isStreaming && result && typeof result === 'object' && '_chunkData' in result) {
        const chunkData = (
          result as {
            _chunkData?: {
              chunkCount?: number;
              totalBytes?: number;
              maxChunkGapMs?: number;
              avgChunkSizeBytes?: number;
              chunkGaps?: number[];
            };
          }
        )._chunkData;
        if (chunkData) {
          requestContext.chunkCount = chunkData.chunkCount;
          requestContext.totalBytes = chunkData.totalBytes;
          requestContext.maxChunkGapMs = chunkData.maxChunkGapMs;
          requestContext.avgChunkSizeBytes = chunkData.avgChunkSizeBytes;
          requestContext.chunkGaps = chunkData.chunkGaps;
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
      this.telemetry.recordRequest(requestContext);
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

      void this.probeOrchestrator.recordProbeResult({ serverId: server.id, model, endpoint }, true);

      return { success: true, value: result };
    } catch (error) {
      this.decrementInFlight(server.id, model);

      // Remove streaming request tracking on failure
      if (isStreaming) {
        this.inFlightManager.removeStreamingRequest(requestContext.id);
      }

      // Non-streaming endpoints that return NDJSON instead of a single JSON
      // object are a strong signal of upstream misconfiguration or compromise.
      // Quarantine the server so the operator can investigate, but do NOT
      // mark it unhealthy on its own — the underlying capability may still
      // work for streaming callers.
      if (error instanceof NdjsonResponseError) {
        this.recordGarbageResponse(server.id, error.body, null, model);
      }

      const lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message;

      // Detect and react to model-repair and runner-crash conditions before
      // the generic failure handler runs. These need to fire BEFORE the
      // generic handler so the quarantine decision is observable.
      if (matchesAny(errorMessage, RUNNER_CRASH_PATTERNS)) {
        getQuarantinePool().quarantine(
          server.id,
          'runner-crash',
          { model, error: errorMessage },
          false
        );
      } else if (matchesAny(errorMessage, CORRUPTED_MODEL_PATTERNS)) {
        getQuarantinePool().quarantine(
          server.id,
          'corrupted-model',
          { model, status: 'repair-attempting' },
          false
        );
        const repairResult = await attemptModelRepair(server.url, model, 5000, 10000);
        if (repairResult.success) {
          getQuarantinePool().unquarantine(server.id);
        }
      }

      // Record failed request metrics
      requestContext.endTime = Date.now();
      requestContext.duration = requestContext.endTime - requestContext.startTime;
      requestContext.success = false;
      requestContext.error = lastError;
      requestContext.queueWaitTime = routingContext?.queueWaitTime;
      this.telemetry.recordRequest(requestContext);

      const errorType = classifyError(errorMessage).type;

      if (errorType === 'rateLimited') {
        this.errorAggregator.recordError(server.id, 'rateLimited');
      }

      logger.warn(`Request failed on ${server.id} for model ${model}`, {
        error: errorMessage,
        errorType,
        duration: requestContext.duration,
      });

      this.handleServerError(server, model, errorMessage, errorType, errors, endpoint);
      return { success: false };
    }
  }

  private async tryRequestOnServerWithRetries<T>(
    server: AIServer,
    model: string,
    fn: (server: AIServer, context?: { requestId?: string }) => Promise<T>,
    isStreaming: boolean,
    retryConfig: RetryConfig,
    errors: Array<{ server: string; error: string; type?: ClassifyErrorType }>,
    _timeoutMs?: number,
    parentRequestId?: string,
    routingContext?: RoutingContext,
    endpoint: ProbeEndpoint = 'ollama_generate'
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
        endpoint,
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

        // Extract token metrics BEFORE decrementing in-flight (needed for token-weighted tracking)
        let tokensGenerated = 0;
        let tokensPrompt = 0;

        // Extract token metrics from Ollama response for non-streaming requests
        if (!isStreaming && result && typeof result === 'object') {
          const ollamaResponse = result as Record<string, unknown>;
          if (typeof ollamaResponse.eval_count === 'number') {
            tokensGenerated = ollamaResponse.eval_count;
          }
          if (typeof ollamaResponse.prompt_eval_count === 'number') {
            tokensPrompt = ollamaResponse.prompt_eval_count;
          }
        }

        // Extract token metrics from streaming responses
        if (isStreaming && result && typeof result === 'object' && '_tokenMetrics' in result) {
          const tokenMetrics = (
            result as { _tokenMetrics?: { tokensGenerated?: number; tokensPrompt?: number } }
          )._tokenMetrics;
          if (tokenMetrics) {
            if (typeof tokenMetrics.tokensGenerated === 'number') {
              tokensGenerated = tokenMetrics.tokensGenerated;
            }
            if (typeof tokenMetrics.tokensPrompt === 'number') {
              tokensPrompt = tokenMetrics.tokensPrompt;
            }
          }
        }

        // Use token-weighted decrement when we have token information
        if (tokensPrompt > 0 || tokensGenerated > 0) {
          this.decrementInFlightWithTokens(server.id, model, tokensPrompt, tokensGenerated);
        } else {
          this.decrementInFlight(server.id, model);
        }

        // Record successful request metrics
        requestContext.endTime = Date.now();
        requestContext.duration = requestContext.endTime - requestContext.startTime;
        requestContext.success = true;
        requestContext.tokensGenerated = tokensGenerated || undefined;
        requestContext.tokensPrompt = tokensPrompt || undefined;

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
        this.telemetry.recordRequest(requestContext);
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
        this.telemetry.recordRequest(requestContext);

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
        const sameServerRetryable = isRetryableOnSameServer(errorMessage, retryConfig);

        logger.debug(`Error classification for ${server.id}:${model}`, {
          errorType,
          isRetryableOnSameServer: sameServerRetryable,
          retryCount,
          maxRetries: retryConfig.maxRetriesPerServer,
          willRetry: sameServerRetryable && retryCount < retryConfig.maxRetriesPerServer,
        });

        if (sameServerRetryable && retryCount < retryConfig.maxRetriesPerServer) {
          // Calculate delay with exponential backoff + jitter to prevent thundering herd
          const adapter = fromRetryConfig(retryConfig);
          const result = calculateBackoff('exponential', {
            ...adapter.options,
            attempt: retryCount,
          });
          const delay = result.delayMs;

          logger.info(
            `Will retry on same server ${server.id} for model ${model} in ${delay}ms (attempt ${retryCount + 1}/${retryConfig.maxRetriesPerServer})`,
            { errorType, error: errorMessage }
          );

          await sleep(delay);
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

        this.handleServerError(server, model, errorMessage, errorType, errors, endpoint);
        return { success: false };
      }
    }

    return { success: false };
  }

  /**
   * Handle a server error and update state appropriately
   */
  public handleServerError(
    server: AIServer,
    model: string,
    errorMessage: string,
    errorType: ClassifyErrorType,
    errors: Array<{ server: string; error: string; type?: ClassifyErrorType }>,
    endpoint: ProbeEndpoint = 'ollama_generate'
  ): void {
    logger.info(`Handling server error for ${server.id}:${model}`, {
      errorType,
      errorMessage: errorMessage.substring(0, 200), // Truncate for logging
      currentHealthy: server.healthy,
      consecutiveFailures: this.banManager.getFailureCount(server.id),
      endpoint,
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
        // Just put in cooldown for this model — unless the error is an
        // auth/permission/model-not-found/cloud-disabled condition, in
        // which case the server is permanently banned for this model.
        if (this.isPermanentBanError(errorMessage)) {
          this.banManager.addBan(server.id, model);
          logger.error(`PERMANENT BAN: Server ${server.id} banned for model ${model}`, {
            error: errorMessage,
            reason: 'permanent-non-retryable',
          });
        } else {
          this.banManager.markFailure(server.id, model);
          logger.warn(
            `NON-RETRYABLE ERROR: ${server.id} for model ${model} (server stays healthy)`,
            {
              error: errorMessage,
              cooldownUntil: new Date(
                Date.now() + this.config.cooldown.failureCooldownMs
              ).toISOString(),
            }
          );
        }
        this.recordFailure(server.id, errorType, model);
        break;

      case 'transient': {
        // Transient: temporary issue, don't mark unhealthy immediately
        // Only mark unhealthy after multiple consecutive failures
        this.markFailure(server.id, model);
        const failureCount = this.incrementServerFailureCount(server.id);
        const threshold = this.config.circuitBreaker.baseFailureThreshold ?? 3;

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

      case 'rateLimited': {
        // Rate limit errors: temporary, don't mark server unhealthy
        // Use lower threshold (2) for faster circuit breaker response
        this.errorAggregator.recordError(server.id, 'rateLimited');
        this.markFailure(server.id, model);
        const failureCount = this.incrementServerFailureCount(server.id);
        const rateLimitThreshold = 2;

        if (failureCount >= rateLimitThreshold) {
          // Don't mark server unhealthy for rate limits - they're temporary
          logger.warn(
            `RATE LIMIT ERROR: ${server.id} for model ${model} (${failureCount}/${rateLimitThreshold} failures - circuit breaker will handle)`,
            {
              error: errorMessage,
              threshold: rateLimitThreshold,
              model,
            }
          );
        } else {
          logger.warn(
            `RATE LIMIT ERROR: ${server.id} for model ${model} (${failureCount}/${rateLimitThreshold} failures)`,
            {
              error: errorMessage,
              remainingBeforeCircuitBreaker: rateLimitThreshold - failureCount,
            }
          );
        }
        this.recordFailure(server.id, errorType, model);
        break;
      }

      case 'quotaExhausted': {
        // Quota exhaustion is per-user; parse the user ID out of the message and
        // mark an extended cooldown so other users on the same server are not
        // blocked. Falls back to a regular cooldown when no user can be parsed.
        const quotaUserId = this.extractQuotaUserId(errorMessage);
        if (quotaUserId !== null) {
          this.banManager.markExtendedCooldown(server.id, model, quotaUserId, 5 * 60 * 1000);
          logger.warn(
            `QUOTA EXHAUSTED: extended cooldown for ${server.id}/${model} (user=${quotaUserId})`,
            { error: errorMessage }
          );
        } else {
          this.banManager.markFailure(server.id, model);
          logger.warn(`QUOTA EXHAUSTED (unparseable): regular cooldown for ${server.id}/${model}`, {
            error: errorMessage,
          });
        }
        this.recordFailure(server.id, errorType, model);
        break;
      }

      default: {
        // Retryable/unknown: put in cooldown, track failures
        this.markFailure(server.id, model);
        const unknownFailureCount = this.incrementServerFailureCount(server.id);
        const unknownThreshold = this.config.circuitBreaker.baseFailureThreshold ?? 3;

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

    // Feed the probe system with the failure result
    const classification = classify(new Error(errorMessage));
    void this.probeOrchestrator.recordProbeResult(
      { serverId: server.id, model, endpoint },
      false,
      classification
    );
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
  }

  /**
   * Increment in-flight request count with token-weighted tracking
   */
  incrementInFlightWithTokens(
    serverId: string,
    model: string,
    promptTokens: number,
    outputTokens: number,
    bypass: boolean = false
  ): void {
    this.inFlightManager.incrementInFlightWithTokens(
      serverId,
      model,
      promptTokens,
      outputTokens,
      bypass
    );
    this.metricsAggregator.incrementInFlight(serverId, model);
  }

  /**
   * Decrement in-flight request count
   */
  decrementInFlight(serverId: string, model: string, bypass: boolean = false): void {
    this.inFlightManager.decrementInFlight(serverId, model, bypass);
    this.metricsAggregator.decrementInFlight(serverId, model);
  }

  /**
   * Decrement in-flight request count with token-weighted tracking
   */
  decrementInFlightWithTokens(
    serverId: string,
    model: string,
    promptTokens: number,
    outputTokens: number,
    bypass: boolean = false
  ): void {
    this.inFlightManager.decrementInFlightWithTokens(
      serverId,
      model,
      promptTokens,
      outputTokens,
      bypass
    );
    this.metricsAggregator.decrementInFlight(serverId, model);
  }

  /**
   * Get in-flight request count for a server:model
   */
  getInFlight(serverId: string, model: string): number {
    return this.inFlightManager.getInFlight(serverId, model);
  }

  /**
   * Record success for request tracking.
   * Note: Circuit breaker tracking is now handled by the probe system.
   */
  public recordSuccess(serverId: string, model?: string): void {
    // Clear failure tracker on success
    if (model) {
      this.banManager.recordSuccess(serverId, model);
      // Record model-level success for aggregator tracking
      this.modelAggregator.recordSuccess(model);
    }
  }

  /**
   * Record failure for request tracking.
   * Note: Circuit breaker tracking is now handled by the probe system.
   */
  public recordFailure(serverId: string, error: string | Error, model?: string): void {
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

      // Use BanManager for failure tracking
      this.banManager.recordFailure(serverId, model);

      // Feed client-side failures into the per-tuple breaker state machine.
      // This ensures 404 model_not_found and other client errors trip the breaker
      // for the specific (server, model) tuple, not just the aggregate server state.
      const errorType = classifyError(errorMsg);
      const isPermanent = errorType.type === 'non-retryable' || errorType.type === 'permanent';
      void this.probeOrchestrator.recordProbeResult(
        { serverId, model, endpoint: 'ollama_generate' },
        false,
        {
          kind: isPermanent ? 'non_retryable' : 'transient',
          retryable: !isPermanent,
        }
      );

      // Record model-level failure for aggregator tracking
      this.modelAggregator.recordFailure(model);

      // Category-specific ban thresholds based on failure count
      const banThreshold = this.getBanThresholdForCategory(classification.category);
      const currentFailures = this.banManager.getModelFailureCount(serverId, model);

      if (currentFailures >= banThreshold) {
        if (!this.banManager.isBanned(serverId, model)) {
          this.banManager.addBan(serverId, model);
          logger.warn(
            `Banning ${serverId}:${model} after ${currentFailures} consecutive ${classification.category} failures`,
            {
              serverId,
              model,
              failureCount: currentFailures,
              errorCategory: classification.category,
              errorSeverity: classification.severity,
            }
          );
        }
      }
    }
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
   * Get circuit breaker health for a server:model combination
   */
  public getCircuitBreakerHealth(
    serverId: string,
    model?: string
  ):
    | { state: 'closed' | 'open' | 'half-open'; failureCount: number; errorRate: number }
    | undefined {
    const tuple: Tuple = {
      serverId,
      model: model ?? 'ollama_generate',
      endpoint: 'ollama_generate',
    };
    const tupleState = this.probeOrchestrator.getTupleState(tuple);
    if (!tupleState) {
      return undefined;
    }

    const stateMap: Record<ProbeState, 'closed' | 'open' | 'half-open'> = {
      HEALTHY: 'closed',
      SUSPECT: 'closed',
      UNHEALTHY: 'open',
      RECOVERING: 'half-open',
    };

    return {
      state: stateMap[tupleState.state],
      failureCount: tupleState.consecutiveFailures,
      errorRate:
        tupleState.errorWindow.length > 0
          ? tupleState.errorWindow.reduce((a, b) => a + b, 0) / tupleState.errorWindow.length
          : 0,
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
    const tuple: Tuple = { serverId, model: 'ollama_generate', endpoint: 'ollama_generate' };
    const state = this.probeOrchestrator.getState(tuple);
    return state !== 'UNHEALTHY';
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

      // Restore probe state from WAL and start recovery driver
      await this.probeOrchestrator.restoreFromWAL();
      this.recoveryDriver.start();

      // Start PS poll coordinator (non-blocking, does not throw on polling failures)
      try {
        getPsPollCoordinator().start();
      } catch (err) {
        logger.warn('[ps-poll] coordinator start failed (non-fatal)', { error: String(err) });
      }

      // Initialize the daily perf-probe scheduler
      const perfProbeScheduler = getPerfProbeSchedulerInstance();
      await perfProbeScheduler.start();

      // Clean up any leaked test fixture CBs from previous test sessions
      this.probeOrchestrator.cleanupTestFixtures();

      // Start the negative-probe capability detection scheduler
      // (auto-confirm/soft-revoke endpoints every 5 minutes)
      getCapabilityProbeScheduler().start();

      // Start the periodic health-check scheduler that refreshes per-server
      // model lists (server.models, server.v1Models, server.discoveredV1Models)
      // so /api/tags and /v1/models proxy endpoints reflect fleet reality.
      getHealthCheckScheduler().start();

      const DECAY_INTERVAL_MS = 5 * 60 * 1000;
      this.escalationIntervalId = setInterval(() => {
        this.timeoutManager.applyDecay();
        this.timeoutManager.resetAllAfterIdle(600000);
      }, DECAY_INTERVAL_MS);

      const GHOST_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
      this.escalationIntervalId = setInterval(() => {
        const removed = this.cleanupGhostServers();
        if (removed > 0) {
          logger.info(`[Ghost] Cleaned up ${removed} ghost servers`);
        }
      }, GHOST_CLEANUP_INTERVAL_MS);

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
      this.persistence.saveTimeoutsToDisk(persistedData.timeouts);
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
      // Evict probe tuples for this server to reset circuit breaker state
      void this.probeOrchestrator.evictTuple({ serverId, model: '', endpoint: 'ollama_generate' });

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

  /**
   * Check if server:model combo should be skipped due to probe state.
   * Uses probe system for health checking.
   */
  public shouldSkipServerModel(serverId: string, model: string, endpoint?: ProbeEndpoint): boolean {
    const probeEndpoint: ProbeEndpoint = endpoint ?? 'ollama_generate';
    const tuple = { serverId, model, endpoint: probeEndpoint };
    return !this.probeOrchestrator.canServe(tuple, 'routing');
  }

  /**
   * Central route eligibility predicate — aggregates all routing gates into one call.
   * Returns { eligible: boolean, reasons: string[] } so callers can inspect why
   * a server was excluded without making multiple calls.
   *
   * Gates checked (in order):
   * a. AIServer.healthy
   * b. probeOrchestrator.canServe(serverId, model, endpoint)
   * c. BanManager.isBanned(serverId, model)
   * d. QuarantinePool.isQuarantined(serverId)
   * e. modelAvailabilityProvider snapshot source !== 'fallback'
   */
  isServerModelEligible(
    serverId: string,
    model: string,
    endpoint?: ProbeEndpoint
  ): { eligible: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const probeEndpoint: ProbeEndpoint = endpoint ?? 'ollama_generate';

    // Gate a: server healthy
    const server = this.getServer(serverId);
    if (!server || server.healthy === false) {
      reasons.push('server unhealthy');
    }

    // Gate b: probe canServe
    const tuple = { serverId, model, endpoint: probeEndpoint };
    if (!this.probeOrchestrator.canServe(tuple, 'routing')) {
      reasons.push('probe canServe=false');
    }

    // Gate c: not banned
    if (this.banManager.isBanned(serverId, model)) {
      reasons.push('banned');
    }

    // Gate d: not quarantined
    if (getQuarantinePool().isQuarantined(serverId)) {
      reasons.push('quarantined');
    }

    // Gate e: model availability snapshot is not stale (source !== 'fallback')
    if (this.modelAvailabilityProvider) {
      const snapshot = this.modelAvailabilityProvider.getLoadedSnapshot(serverId, model);
      if (snapshot?.source === 'fallback') {
        reasons.push('model availability stale (fallback)');
      }
    }

    return { eligible: reasons.length === 0, reasons };
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

  private isPermanentBanError(errorMessage: string): boolean {
    const permanentPatterns = [
      /HTTP\s*401\b/i,
      /HTTP\s*403\b/i,
      /HTTP\s*404\b/i,
      /\bunauthorized\b/i,
      /\bforbidden\b/i,
      /\bcloud is disabled\b/i,
      /\bmodel not found\b/i,
      /\brequires more system memory\b/i,
    ];
    return permanentPatterns.some(pattern => pattern.test(errorMessage));
  }

  private extractQuotaUserId(errorMessage: string): string | null {
    const match = errorMessage.match(/\(\s*([\w.\-@+]+)\s*\)/);
    return match && match[1] ? match[1] : null;
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
  public resetServerFailureCount(serverId: string): void {
    this.banManager.resetFailureCount(serverId);
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
    circuitBreakersByState: Record<string, number>;
  } {
    const healthyServers = this.servers.filter(s => s.healthy).length;

    const inFlightData = this.inFlightManager.getAllInFlight();
    let inFlightTotal = 0;
    for (const serverData of Object.values(inFlightData)) {
      for (const count of Object.values(serverData)) {
        inFlightTotal += count;
      }
    }

    const allStates = this.probeOrchestrator.getAllStates();
    const circuitBreakers: Record<string, { state: string; failureCount: number }> = {};
    const circuitBreakersByState: Record<string, number> = {};
    for (const [id, state] of allStates) {
      circuitBreakers[id] = {
        state: state.state,
        failureCount: state.consecutiveFailures,
      };
      circuitBreakersByState[state.state] = (circuitBreakersByState[state.state] ?? 0) + 1;
    }

    return {
      uptime: process.uptime(),
      totalServers: this.servers.length,
      healthyServers,
      totalModels: this.getAllModels().length,
      inFlightRequests: inFlightTotal,
      circuitBreakers,
      circuitBreakersByState,
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
   * Get circuit breaker statistics for all servers (probe system)
   */
  getCircuitBreakerStats() {
    return this.probeOrchestrator.getAllStates();
  }

  cleanupGhostServers(ghostTtlMs: number = 86_400_000): number {
    const now = Date.now();
    const ghostIds: string[] = [];
    const ghostServerIds: string[] = [];

    const config = getConfigManager().getConfig();
    const ghostConfig = config.loadBalancer?.ghostServers ?? {
      staleThresholdMs: 300000,
      removeOnCleanup: false,
    };

    const psCoordinator = getPsPollCoordinator();

    for (const server of this.servers) {
      if (server.healthy === false || !server.healthy) {
        const age = now - server.lastResponseTime;
        if (age >= ghostTtlMs) {
          ghostIds.push(server.id);
        }
      } else if (server.healthy) {
        const models = psCoordinator.getModelsOnServer(server.id);
        const lastPollAt = psCoordinator.getServerLastPollAt(server.id);
        const hasModels = models.size > 0;
        if (!hasModels && lastPollAt > 0) {
          const staleDuration = now - lastPollAt;
          if (staleDuration >= ghostConfig.staleThresholdMs) {
            ghostServerIds.push(server.id);
            logger.warn(
              `[Ghost] Server ${server.id} is a ghost (healthy but 0 models for ${Math.round(staleDuration / 1000)}s)`
            );
          }
        }
      }
    }

    for (const id of ghostIds) {
      this.removeServer(id);
      logger.warn(`[Ghost] Removed offline server ${id}`);
    }

    if (ghostConfig.removeOnCleanup) {
      for (const id of ghostServerIds) {
        this.removeServer(id);
        logger.warn(`[Ghost] Removed ghost server ${id} (removeOnCleanup=true)`);
      }
    }

    return ghostIds.length + ghostServerIds.length;
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
        logger.info('Drain complete - all requests finished');
        this.draining = false;
        return true;
      }

      logger.debug(`Draining: ${stats.inFlightRequests} in-flight`);
      await sleep(1000);
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
    this.tagsCacheStore.clear();
    logger.debug('Tags cache cleared');
  }

  /**
   * Invalidate tags cache when server state changes significantly
   */
  invalidateTagsCache(): void {
    if (this.tagsCacheStore.get()) {
      this.tagsCacheStore.invalidate();
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

    // Shutdown metrics aggregator (flushes persistence)
    await this.metricsAggregator.shutdown();

    // Save probe state snapshot
    this.probeOrchestrator.createSnapshot();

    // Also save full probe states to direct-access table for faster recovery
    this.probeOrchestrator.saveAllProbeStates();

    // Persist timeouts on shutdown to ensure they're saved
    if (this.config.enablePersistence) {
      const persistedData = this.timeoutManager.toPersistedData();
      this.persistence.saveTimeoutsToDisk(persistedData.timeouts);
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

    // Stop PS poll coordinator
    getPsPollCoordinator().stop();

    void getPerfProbeSchedulerInstance().stop();

    getOperationalStore().close();

    logger.info('Orchestrator shutdown complete');
  }

  // Stop background schedulers. Idempotent.
  public stop(): void {
    this.metricsAggregator.stopPruneScheduler();
    this.recoveryDriver.stop();
  }

  public onServerAdded(callback: ServerLifecycleCallback): () => void {
    this.serverAddedCallbacks.push(callback);
    return () => {
      const idx = this.serverAddedCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.serverAddedCallbacks.splice(idx, 1);
      }
    };
  }

  public onServerRemoved(callback: ServerLifecycleCallback): () => void {
    this.serverRemovedCallbacks.push(callback);
    return () => {
      const idx = this.serverRemovedCallbacks.indexOf(callback);
      if (idx >= 0) {
        this.serverRemovedCallbacks.splice(idx, 1);
      }
    };
  }
}
