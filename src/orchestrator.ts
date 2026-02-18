/**
 * orchestrator.ts
 * Ollama Orchestrator with Historical Metrics - Server management and request routing
 */

import {
  getRecoveryFailureTracker,
  type RecoveryFailureRecord,
} from './analytics/recovery-failure-tracker.js';
import {
  CircuitBreakerPersistence,
  type CircuitBreakerData,
} from './circuit-breaker-persistence.js';
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  type CircuitBreakerConfig,
  type ErrorType,
} from './circuit-breaker.js';
import type { HealthCheckConfig, OrchestratorConfig, RetryConfig } from './config/config.js';
import { DEFAULT_CONFIG } from './config/config.js';
import { getDecisionHistory } from './decision-history.js';
import { HealthCheckScheduler, type HealthCheckResult } from './health-check-scheduler.js';
import { LoadBalancer, calculateServerScore, type LoadBalancerConfig } from './load-balancer.js';
import { MetricsAggregator } from './metrics/index.js';
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
import { RequestQueue, type QueueConfig } from './queue/index.js';
import { getRecoveryTestCoordinator } from './recovery-test-coordinator.js';
import { getRequestHistory } from './request-history.js';
import { classifyError, ErrorCategory } from './utils/errorClassifier.js';
import { fetchWithTimeout } from './utils/fetchWithTimeout.js';
import { logger } from './utils/logger.js';
import { normalizeServerUrl, areUrlsEquivalent } from './utils/urlUtils.js';

export type { AIServer } from './orchestrator.types.js';

/** Routing context for debug headers - tracks which server was selected and circuit breaker states */
export interface RoutingContext {
  selectedServerId?: string;
  serverCircuitState?: string;
  modelCircuitState?: string;
  availableServerCount?: number;
  routedToOpenCircuit?: boolean;
  retryCount?: number;
}

export class AIOrchestrator {
  private servers: AIServer[] = [];
  private inFlight: Map<string, number> = new Map(); // serverId:model -> count
  private inFlightBypass: Map<string, number> = new Map(); // serverId:model -> count (bypassed requests, e.g., active tests)
  private failureCooldown: Map<string, number> = new Map(); // serverId:model -> timestamp
  private permanentBan: Set<string> = new Set(); // serverId:model
  private serverFailureCount: Map<string, number> = new Map(); // serverId -> consecutive failure count
  private modelFailureTracker: Map<string, { count: number; lastSuccess: number }> = new Map(); // serverId:model -> failure tracking
  private circuitBreakerRegistry: CircuitBreakerRegistry;
  private circuitBreakerPersistence: CircuitBreakerPersistence;
  private metricsAggregator: MetricsAggregator;
  private loadBalancer: LoadBalancer;
  private requestQueue: RequestQueue;
  private healthCheckScheduler: HealthCheckScheduler;
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

  // Track per server:model timeouts
  private timeouts: Map<string, number> = new Map();

  // Track active test failure counts for progressive timeout extension
  private activeTestFailureCount: Map<string, number> = new Map();

  // Track model VRAM sizes from /api/ps for adaptive timeout calculation (in MB)
  private modelVramSizes: Map<string, number> = new Map();

  // Track healthy server count for logging changes
  private lastHealthyCount = 0;

  // Escalation check interval handle for cleanup
  private escalationIntervalId?: NodeJS.Timeout;

  // Suppress persistence during bulk operations (e.g., loading from disk)
  private _suppressPersistence = false;

  constructor(
    loadBalancerConfig?: LoadBalancerConfig,
    queueConfig?: QueueConfig,
    circuitBreakerConfig?: CircuitBreakerConfig,
    healthCheckConfig?: HealthCheckConfig,
    config?: OrchestratorConfig
  ) {
    this.config = config ?? { ...DEFAULT_CONFIG };
    this.metricsAggregator = new MetricsAggregator();
    this.loadBalancer = new LoadBalancer(loadBalancerConfig ?? this.config.loadBalancer);
    this.requestQueue = new RequestQueue(queueConfig ?? this.config.queue);
    this.circuitBreakerRegistry = new CircuitBreakerRegistry(
      circuitBreakerConfig ?? this.config.circuitBreaker
    );
    this.circuitBreakerPersistence = new CircuitBreakerPersistence({
      filePath: this.config.persistencePath
        ? `${this.config.persistencePath}/circuit-breakers.json`
        : undefined,
    });

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
    ): import('./circuit-breaker.js').CircuitBreaker => {
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
      () => this.servers,
      result => this.onHealthCheckResult(result),
      results => this.onAllHealthChecksComplete(results),
      server => this.runActiveTestsForServer(server)
    );

    // Load timeouts from persistence
    if (this.config.enablePersistence) {
      this.timeouts = new Map(Object.entries(loadTimeoutsFromDisk()));
    }
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
        if (result.models && JSON.stringify(result.models) !== JSON.stringify(server.models)) {
          server.models = result.models;
          needsPersistence = true;
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
          JSON.stringify(result.v1Models) !== JSON.stringify(server.v1Models)
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

          // Store VRAM sizes for adaptive timeout calculation (convert bytes to MB)
          for (const loadedModel of result.loadedModels) {
            if (loadedModel.name && loadedModel.sizeVram > 0) {
              const vramKey = `${server.id}:${loadedModel.name}`;
              const vramMB = Math.round(loadedModel.sizeVram / (1024 * 1024));
              this.modelVramSizes.set(vramKey, vramMB);
              logger.debug(`Stored VRAM for ${vramKey}: ${vramMB}MB`);
            }
          }
        }

        this.recordSuccess(server.id);

        // Pre-create circuit breakers for all known models on this server
        // This ensures they appear in monitoring UI even before first use
        for (const model of server.models) {
          // This will create the circuit breaker if it doesn't exist
          this.getModelCircuitBreaker(server.id, model);
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

        // Invalidate cache since server is now healthy
        this.invalidateServerTagsCache(server.id);
      }
    } else {
      server.healthy = false;
      server.models = []; // Clear models on failure
      this.recordFailure(server.id, result.error || 'Health check failed');

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
   * Execute an active test request to a specific server:model
   * Tests both inference (/api/generate) and embeddings (/api/embeddings)
   */
  private async executeActiveTest(
    serverId: string,
    model: string,
    timeoutMs: number
  ): Promise<{
    success: boolean;
    duration: number;
    error?: string;
    detectedModelType?: 'embedding' | 'generation';
    nonCircuitBreaking?: boolean; // Special flag for failures that shouldn't trigger circuit breaker
  }> {
    const server = this.getServer(serverId);
    if (!server) {
      return { success: false, duration: 0, error: 'Server not found' };
    }

    const modelCb = this.getModelCircuitBreaker(serverId, model);
    const storedModelType = modelCb.getModelType();

    // First, check model name patterns - these are definitive indicators
    // This takes precedence over stored type because stored type may be wrong
    const modelNameLower = model.toLowerCase();
    const isEmbeddingModelByName =
      modelNameLower.includes('embed') ||
      modelNameLower.includes('pygmalion') ||
      modelNameLower.includes('nomic-embed') ||
      modelNameLower.includes('text-embedding') ||
      modelNameLower.includes('sentence') ||
      modelNameLower.includes('bge-') ||
      modelNameLower.includes('gte-') ||
      modelNameLower.includes('e5-') ||
      modelNameLower.includes('all-minilm') ||
      modelNameLower.includes('all-mpnet');

    if (isEmbeddingModelByName) {
      // Model name indicates it's embedding-only, use embedding test
      if (storedModelType !== 'embedding') {
        // Update stored type if it was wrong
        modelCb.setModelType('embedding');
        this.scheduleCircuitBreakerSave();
        logger.info(`Corrected model type for ${model} to embedding based on name pattern`);
      }
      return this.executeEmbeddingActiveTest(server, model, timeoutMs);
    }

    // If we have a stored model type and name doesn't indicate embedding, use stored type
    if (storedModelType === 'embedding') {
      return this.executeEmbeddingActiveTest(server, model, timeoutMs);
    } else if (storedModelType === 'generation') {
      return this.executeInferenceActiveTest(server, model, timeoutMs);
    }

    // No stored type - need to detect
    // Try inference first (most models are generation)
    const inferenceResult = await this.executeInferenceActiveTest(server, model, 10000); // Short timeout for detection

    if (inferenceResult.success) {
      // It's a generation model
      modelCb.setModelType('generation');
      this.scheduleCircuitBreakerSave(); // Persist the model type
      return { ...inferenceResult, detectedModelType: 'generation' };
    }

    // Inference failed - check if it's because it's an embedding model
    const errorLower = (inferenceResult.error || '').toLowerCase();
    const isEmbeddingError =
      errorLower.includes('embed') ||
      errorLower.includes('not supported') ||
      errorLower.includes('cannot generate') ||
      errorLower.includes('model does not support');

    if (isEmbeddingError) {
      // Try embedding endpoint
      logger.info(`Model ${model} appears to be embedding-only, trying embeddings endpoint`);
      const embeddingResult = await this.executeEmbeddingActiveTest(server, model, timeoutMs);

      // Mark as embedding model regardless of embedding test result
      // The generate failure indicates it's not a generation model
      modelCb.setModelType('embedding');
      this.scheduleCircuitBreakerSave(); // Persist the model type
      logger.info(`Model ${model} detected as embedding-only, model type persisted`);

      if (embeddingResult.success) {
        return { ...embeddingResult, detectedModelType: 'embedding' };
      } else {
        // Embedding test failed, but this is not a circuit-breaking error
        // The model is still valid as an embedding model, server just may be temporarily unavailable
        logger.warn(
          `Model ${model} embedding test failed on ${server.id}: ${embeddingResult.error}. This indicates the embedding endpoint is temporarily unavailable, not that the model is broken. Model type has been set to 'embedding' for future requests.`
        );
        // Return a special result that doesn't trigger circuit breaker failure recording
        return {
          success: false, // Test failed
          duration: embeddingResult.duration,
          error: embeddingResult.error,
          detectedModelType: 'embedding',
          nonCircuitBreaking: true, // Special flag to indicate this is not circuit-breaking
        };
      }
    }

    // Return the inference error (original failure)
    return inferenceResult;
  }

  /**
   * Execute an active test for inference models (/api/generate)
   * Uses requestToServer with bypassCircuitBreaker to test half-open circuits
   */
  private async executeInferenceActiveTest(
    server: AIServer,
    model: string,
    timeoutMs: number
  ): Promise<{ success: boolean; duration: number; error?: string }> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Use requestToServer with bypassCircuitBreaker to test half-open circuits
      await this.requestToServer(
        server.id,
        model,
        async targetServer => {
          const response = await fetch(`${targetServer.url}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: model,
              prompt: 'Hi', // Minimal prompt for quick response
              stream: false,
              options: {
                num_predict: 1, // Only generate 1 token for speed
              },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }

          // Parse response to verify it worked
          const data = await response.json().catch(() => null);
          if (!data) {
            throw new Error('Invalid response');
          }

          return data;
        },
        { bypassCircuitBreaker: true, signal: controller.signal }
      );

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      return { success: true, duration };
    } catch (error) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, duration, error: `Timeout after ${timeoutMs}ms` };
        }
        return { success: false, duration, error: error.message };
      }

      return { success: false, duration, error: 'Unknown error' };
    }
  }

  /**
   * Execute an active test for embedding models (/api/embeddings)
   */
  /**
   * Execute an active test for embedding models (/api/embeddings)
   * Uses requestToServer with bypassCircuitBreaker to test half-open circuits
   */
  private async executeEmbeddingActiveTest(
    server: AIServer,
    model: string,
    timeoutMs: number
  ): Promise<{ success: boolean; duration: number; error?: string }> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Use requestToServer with bypassCircuitBreaker to test half-open circuits
      await this.requestToServer(
        server.id,
        model,
        async targetServer => {
          const response = await fetch(`${targetServer.url}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: model,
              prompt: 'test', // Minimal text for embedding
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }

          // Parse response to verify it worked
          const data = await response.json().catch(() => null);
          if (!data?.embedding) {
            throw new Error('Invalid response - no embedding');
          }

          return data;
        },
        { bypassCircuitBreaker: true, signal: controller.signal }
      );

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      return { success: true, duration };
    } catch (error) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, duration, error: `Timeout after ${timeoutMs}ms` };
        }
        return { success: false, duration, error: error.message };
      }

      return { success: false, duration, error: 'Unknown error' };
    }
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
      type: 'ollama',
      healthy: true,
      lastResponseTime: Infinity,
      models: [],
      maxConcurrency: server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency,
    };

    this.servers.push(newServer);
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

    if (this.servers.length < initialCount) {
      logger.info(`Removed server ${serverId}. Remaining servers: ${this.servers.length}`);
      // Invalidate cache since we removed a server
      this.invalidateTagsCache();

      // Clean up circuit breakers for this server (server-level and all model-level)
      this.circuitBreakerRegistry.removeByPrefix(serverId);

      // Persist servers to disk if enabled
      if (this.config.enablePersistence) {
        logger.info(`Saving ${this.servers.length} servers to disk after removal...`);
        saveServersToDisk(this.servers);
      } else {
        logger.warn(`Persistence disabled - server removal will not be saved to disk`);
      }
    } else {
      logger.warn(`Server ${serverId} not found for removal`);
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
  updateServer(serverId: string, updates: Partial<Pick<AIServer, 'maxConcurrency'>>): boolean {
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      return false;
    }

    if (typeof updates.maxConcurrency === 'number') {
      server.maxConcurrency = updates.maxConcurrency;
      logger.info(`Updated server ${serverId} maxConcurrency to ${updates.maxConcurrency}`);
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
        // Skip permanently banned servers
        const bannedModels = Array.from(this.permanentBan)
          .filter(ban => ban.startsWith(`${server.id}:`))
          .map(ban => ban.slice(server.id.length + 1));

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

      const [response, versionResponse] = await Promise.all([
        fetch(`${server.url}/api/tags`, {
          signal: controller.signal,
        }),
        fetch(`${server.url}/api/version`, {
          signal: controller.signal,
        }).catch(() => null),
      ]);

      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as { models?: unknown };

      // Handle version
      if (versionResponse?.ok) {
        try {
          const versionData = (await versionResponse.json()) as { version: string };
          server.version = versionData.version;
        } catch (e) {
          // Ignore version parsing errors
        }
      }

      server.healthy = true;
      server.lastResponseTime = responseTime;

      // Extract models from response
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
    const modelMap: Record<string, string[]> = {};

    for (const server of this.servers) {
      if (!server.healthy) {
        continue;
      }

      for (const model of server.models) {
        if (!modelMap[model]) {
          modelMap[model] = [];
        }
        if (!modelMap[model].includes(server.id)) {
          modelMap[model].push(server.id);
        }
      }
    }

    return modelMap;
  }

  /**
   * Get all unique models across healthy servers
   */
  getAllModels(): string[] {
    return Object.keys(this.getModelMap());
  }

  /**
   * Get current model list from all servers (regardless of health)
   */
  getCurrentModelList(): string[] {
    const models = new Set<string>();

    for (const server of this.servers) {
      for (const model of server.models) {
        models.add(model);
      }
    }

    return Array.from(models);
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
        // Model already exists, add this server to the list
        const existing = allTags.get(modelKey)!;
        const servers = existing.servers as string[];
        if (!servers.includes(serverId)) {
          servers.push(serverId);
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
          const servers = modelToServers.get(modelId)!;
          if (!servers.includes(server.id)) {
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
          created: Date.now(),
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
   * Find the best server for a given model using historical metrics
   */
  getBestServerForModel(model: string, isStreaming: boolean = false): AIServer | undefined {
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

      // Must not be permanently banned for this model
      if (this.permanentBan.has(`${server.id}:${model}`)) {
        return false;
      }

      // Must not be circuit breaker open
      if (this.shouldSkipServer(server.id)) {
        return false;
      }

      // Must have capacity
      const maxConcurrency = server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
      const currentLoad = this.getInFlight(server.id, model);
      if (currentLoad >= maxConcurrency) {
        return false;
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
        const currentLoad = this.getInFlight(server.id, model);
        const totalLoad = this.getTotalInFlight(server.id);
        const metrics = this.metricsAggregator.getMetrics(server.id, model);
        const cbHealth = this.getCircuitBreakerHealth(server.id, model);
        return calculateServerScore(
          server,
          model,
          currentLoad,
          totalLoad,
          metrics,
          undefined,
          cbHealth,
          this.getTimeout(server.id, model)
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
      (serverId, model) => this.getInFlight(serverId, model),
      serverId => this.getTotalInFlight(serverId),
      (serverId, model) => this.metricsAggregator.getMetrics(serverId, model),
      isStreaming,
      undefined,
      (serverId, model) => this.getTimeout(serverId, model)
    );

    // Record the decision for historical analysis
    if (selected) {
      const scores = candidates.map(server => {
        const currentLoad = this.getInFlight(server.id, model);
        const totalLoad = this.getTotalInFlight(server.id);
        const metrics = this.metricsAggregator.getMetrics(server.id, model);
        const cbHealth = this.getCircuitBreakerHealth(server.id, model);
        return calculateServerScore(
          server,
          model,
          currentLoad,
          totalLoad,
          metrics,
          undefined,
          cbHealth,
          this.getTimeout(server.id, model)
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
      if (this.permanentBan.has(`${server.id}:${model}`)) {
        return false;
      }
      if (this.shouldSkipServer(server.id)) {
        return false;
      }
      const maxConcurrency = server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
      const currentLoad = this.getInFlight(server.id, model);
      if (currentLoad >= maxConcurrency) {
        return false;
      }
      return true;
    });

    return candidates
      .map(server => {
        const currentLoad = this.getInFlight(server.id, model);
        const totalLoad = this.getTotalInFlight(server.id);
        const metrics = this.metricsAggregator.getMetrics(server.id, model);
        const cbHealth = this.getCircuitBreakerHealth(server.id, model);
        return calculateServerScore(
          server,
          model,
          currentLoad,
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
   * Execute a request with automatic failover
   * Strategy: Try all servers first (no same-server retries), then retry the full cycle once more.
   * Only after exhausting all servers twice, attempt same-server retries on the original server.
   */
  async tryRequestWithFailover<T>(
    model: string,
    fn: (server: AIServer) => Promise<T>,
    isStreaming: boolean = false,
    endpoint: 'generate' | 'embeddings' = 'generate',
    requiredCapability?: 'ollama' | 'openai',
    routingContext?: RoutingContext
  ): Promise<T> {
    const errors: Array<{ server: string; error: string; type?: ErrorType }> = [];

    // Get candidate servers using load balancer with historical metrics
    const eligibleServers = this.servers.filter(s => {
      // Check capability requirement
      if (requiredCapability === 'ollama' && s.supportsOllama === false) {
        return false;
      }
      if (requiredCapability === 'openai' && s.supportsV1 === false) {
        return false;
      }

      return (
        s.healthy &&
        s.models.includes(model) &&
        !this.isInCooldown(s.id, model) &&
        !this.permanentBan.has(`${s.id}:${model}`) &&
        !this.shouldSkipServerModel(s.id, model, endpoint)
      );
    });

    // Sort candidates using load balancer (historical metrics)
    const candidates: AIServer[] = [];
    const remainingServers = [...eligibleServers];
    let firstSelectionRecorded = false;

    while (remainingServers.length > 0) {
      const selected = this.loadBalancer.select(
        remainingServers,
        model,
        (serverId, model) => this.getInFlight(serverId, model),
        serverId => this.getTotalInFlight(serverId),
        (serverId, model) => this.metricsAggregator.getMetrics(serverId, model),
        isStreaming,
        undefined,
        (serverId, model) => this.getTimeout(serverId, model)
      );

      if (!selected) {
        break;
      }

      // Record decision for the first selection (actual routing decision)
      if (!firstSelectionRecorded) {
        const scores = remainingServers.map(server => {
          const currentLoad = this.getInFlight(server.id, model);
          const totalLoad = this.getTotalInFlight(server.id);
          const metrics = this.metricsAggregator.getMetrics(server.id, model);
          const cbHealth = this.getCircuitBreakerHealth(server.id, model);
          return calculateServerScore(
            server,
            model,
            currentLoad,
            totalLoad,
            metrics,
            undefined,
            cbHealth,
            this.getTimeout(server.id, model)
          );
        });

        getDecisionHistory().recordDecision(
          model,
          selected,
          this.loadBalancer.getAlgorithm(),
          scores,
          'failover_routing'
        );
        firstSelectionRecorded = true;
      }

      candidates.push(selected);
      const index = remainingServers.findIndex(s => s.id === selected.id);
      if (index >= 0) {
        remainingServers.splice(index, 1);
      }
    }

    if (candidates.length === 0) {
      throw new Error(`No healthy servers available for model '${model}'`);
    }

    const initialServer = candidates[0];

    // Populate routing context with available server count
    if (routingContext) {
      routingContext.availableServerCount = candidates.length;
    }

    logger.info(`Selected server ${initialServer.id} for model ${model}`, {
      totalCandidates: candidates.length,
      initialServer: initialServer.id,
      serverHealth: initialServer.healthy,
      serverLoad: this.getInFlight(initialServer.id, model),
    });

    const retryConfig = this.config.retry;
    let retryCount = 0;

    // Phase 1: Try each candidate once (failover-first strategy)
    logger.info(`Phase 1: Trying ${candidates.length} candidate(s) once each`, { model });
    for (const server of candidates) {
      const maxConcurrency = server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
      const currentLoad = this.getInFlight(server.id, model);

      if (currentLoad >= maxConcurrency) {
        logger.info(`Skipping server ${server.id} for model ${model}: at max concurrency`, {
          currentLoad,
          maxConcurrency,
        });
        continue;
      }

      // Try request WITHOUT same-server retries (failover immediately)
      const result = await this.tryRequestOnServerNoRetry(server, model, fn, isStreaming, errors);

      if (result.success) {
        if (routingContext) {
          routingContext.retryCount = retryCount;
        }
        this.populateRoutingContext(routingContext, server.id, model);
        return result.value;
      }

      retryCount++;
      logger.info(`Server ${server.id} failed, failing over to next candidate`, { model });
    }

    // Phase 2: Retry full cycle once more (all servers one more time)
    logger.info(`Phase 2: Retrying full cycle of ${candidates.length} candidate(s)`, { model });
    for (const server of candidates) {
      const maxConcurrency = server.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
      const currentLoad = this.getInFlight(server.id, model);

      if (currentLoad >= maxConcurrency) {
        continue;
      }

      const result = await this.tryRequestOnServerNoRetry(server, model, fn, isStreaming, errors);

      if (result.success) {
        if (routingContext) {
          routingContext.retryCount = retryCount;
        }
        this.populateRoutingContext(routingContext, server.id, model);
        return result.value;
      }
      retryCount++;
    }

    // Phase 3: All servers exhausted twice, now try same-server retries on initial server only
    logger.info(
      `Phase 3: All servers exhausted twice. Attempting same-server retries on initial server ${initialServer.id}`,
      { model }
    );
    const maxConcurrency =
      initialServer.maxConcurrency ?? this.config.cooldown.defaultMaxConcurrency;
    const currentLoad = this.getInFlight(initialServer.id, model);

    if (currentLoad < maxConcurrency) {
      const result = await this.tryRequestOnServerWithRetries(
        initialServer,
        model,
        fn,
        isStreaming,
        retryConfig,
        errors
      );

      if (result.success) {
        if (routingContext) {
          routingContext.retryCount = retryCount;
        }
        this.populateRoutingContext(routingContext, initialServer.id, model);
        return result.value;
      }
    }

    // All candidates exhausted
    const errorMessage =
      errors.length > 0
        ? `All ${candidates.length} candidate(s) failed after 2 full cycles and same-server retries. ` +
          `Errors: ${errors.map(e => `${e.server}: ${e.error.substring(0, 100)}`).join('; ')}`
        : `No servers available for model '${model}'`;

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
    fn: (server: AIServer) => Promise<T>,
    options: {
      isStreaming?: boolean;
      bypassCircuitBreaker?: boolean;
      signal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const { isStreaming: _isStreaming = false, bypassCircuitBreaker = false, signal } = options;

    // Check for abort before starting
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    // Find the server by ID
    const server = this.servers.find(s => s.id === serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
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
    if (!bypassCircuitBreaker && this.permanentBan.has(`${server.id}:${model}`)) {
      throw new Error(`Server ${serverId} is permanently banned for model ${model}`);
    }

    // Check circuit breaker (skip if bypassing)
    const modelCb = this.getModelCircuitBreaker(server.id, model);
    if (!bypassCircuitBreaker && !modelCb.canExecute()) {
      throw new Error(`Circuit breaker is open for ${serverId}:${model}`);
    }

    // Execute with in-flight tracking (this is the key difference - uses normal request tracking)
    const startTime = Date.now();
    this.incrementInFlight(server.id, model, bypassCircuitBreaker);

    try {
      const result = await fn(server);

      // Record success
      this.decrementInFlight(server.id, model, bypassCircuitBreaker);

      // Only record circuit breaker success if not bypassing
      if (!bypassCircuitBreaker) {
        modelCb.recordSuccess();
        this.recordSuccess(server.id, model, Date.now() - startTime);
      }

      return result;
    } catch (error) {
      this.decrementInFlight(server.id, model, bypassCircuitBreaker);

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = this.classifyError(errorMessage);

      // Record failure in circuit breaker (skip if bypassing)
      if (!bypassCircuitBreaker) {
        modelCb.recordFailure(error instanceof Error ? error : new Error(errorMessage), errorType);
        this.recordFailure(server.id, errorMessage, model);
      }

      throw error;
    }
  }

  private async tryRequestOnServerNoRetry<T>(
    server: AIServer,
    model: string,
    fn: (server: AIServer) => Promise<T>,
    isStreaming: boolean,
    errors: Array<{ server: string; error: string; type?: ErrorType }>,
    _timeoutMs?: number
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
              failedBreaker.recordFailure(new Error(errorMsg), 'transient');
              logger.warn(`Recovery test failed for breaker, transitioning back to open`);
            }
          }

          const errorMsg = `Circuit breaker recovery failed or deferred for ${server.id}:${model}`;
          logger.debug(errorMsg);
          errors.push({ server: server.id, error: errorMsg, type: 'transient' });
          return { success: false };
        }
      } catch (error) {
        logger.warn(`Recovery test error for ${server.id}:${model}`, { error });
        const errorMsg = `Circuit breaker recovery error for ${server.id}:${model}`;
        errors.push({ server: server.id, error: errorMsg, type: 'transient' });
        return { success: false };
      }
    }

    if (!serverCb.canExecute() || !modelCb.canExecute()) {
      const circuitState = !serverCb.canExecute() ? serverCb.getState() : modelCb.getState();
      const errorMsg = `Circuit breaker ${circuitState} for ${server.id}:${model}`;
      logger.debug(errorMsg);
      errors.push({ server: server.id, error: errorMsg, type: 'transient' });
      return { success: false };
    }

    const requestContext: RequestContext = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      startTime: Date.now(),
      serverId: server.id,
      model,
      endpoint: 'generate',
      streaming: isStreaming,
      success: false,
    };

    try {
      this.incrementInFlight(server.id, model);
      const result = await fn(server);
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

      this.metricsAggregator.recordRequest(requestContext);
      getRequestHistory().recordRequest(requestContext);

      // Reset failure count on success - server is working
      this.resetServerFailureCount(server.id);
      this.recordSuccess(server.id, model, requestContext.duration);

      // Check if this was an active test (half-open circuit breaker)
      const serverCb = this.getCircuitBreaker(server.id);
      const modelCb = this.getModelCircuitBreaker(server.id, model);
      const wasActiveTest =
        serverCb.getState() === 'half-open' || modelCb.getState() === 'half-open';

      if (wasActiveTest && requestContext.duration > 0) {
        // Update timeout based on actual response time from active test
        // Set timeout to 3x the actual response time, with bounds
        const newTimeout = Math.max(
          15000, // Minimum 15 seconds
          Math.min(600000, requestContext.duration * 3) // Max 10 minutes, 3x actual time
        );
        this.setTimeout(server.id, model, newTimeout);
        logger.info(
          `Active test success: updated timeout for ${server.id}:${model} to ${newTimeout}ms (3x ${requestContext.duration}ms response time)`
        );

        // Reset active test failure count on success
        const key = `${server.id}:${model}`;
        this.activeTestFailureCount.delete(key);
      } else if (requestContext.duration > 5000) {
        // For regular requests taking >5s, also update timeout if it's longer than current
        const currentTimeout = this.getTimeout(server.id, model);
        const suggestedTimeout = Math.max(15000, Math.min(600000, requestContext.duration * 2));
        if (suggestedTimeout > currentTimeout) {
          this.setTimeout(server.id, model, suggestedTimeout);
          logger.debug(
            `Updated timeout for ${server.id}:${model} to ${suggestedTimeout}ms based on response time of ${requestContext.duration}ms`
          );
        }
      }

      logger.info(`Request succeeded on ${server.id} for model ${model}`, {
        duration: requestContext.duration,
        wasActiveTest,
      });

      return { success: true, value: result };
    } catch (error) {
      this.decrementInFlight(server.id, model);
      const lastError = error instanceof Error ? error : new Error(String(error));

      // Record failed request metrics
      requestContext.endTime = Date.now();
      requestContext.duration = requestContext.endTime - requestContext.startTime;
      requestContext.success = false;
      requestContext.error = lastError;
      this.metricsAggregator.recordRequest(requestContext);
      getRequestHistory().recordRequest(requestContext);

      const errorMessage = lastError.message;
      const errorType = this.classifyError(errorMessage);

      logger.warn(`Request failed on ${server.id} for model ${model}`, {
        error: errorMessage,
        errorType,
        duration: requestContext.duration,
      });

      // Track active test failures for progressive timeout extension
      const serverCb = this.getCircuitBreaker(server.id);
      const modelCb = this.getModelCircuitBreaker(server.id, model);
      const wasActiveTest =
        serverCb.getState() === 'half-open' || modelCb.getState() === 'half-open';
      if (
        wasActiveTest &&
        errorType === 'transient' &&
        errorMessage.toLowerCase().includes('timeout')
      ) {
        const key = `${server.id}:${model}`;
        const currentCount = this.activeTestFailureCount.get(key) ?? 0;
        this.activeTestFailureCount.set(key, currentCount + 1);
        logger.debug(`Active test failure count for ${key}: ${currentCount + 1}`);
      }

      this.handleServerError(server, model, errorMessage, errorType, errors);
      return { success: false };
    }
  }

  private async tryRequestOnServerWithRetries<T>(
    server: AIServer,
    model: string,
    fn: (server: AIServer) => Promise<T>,
    isStreaming: boolean,
    retryConfig: RetryConfig,
    errors: Array<{ server: string; error: string; type?: ErrorType }>,
    _timeoutMs?: number
  ): Promise<{ success: true; value: T } | { success: false }> {
    let lastError: Error | undefined;
    let retryCount = 0;

    logger.info(`Attempting request on server ${server.id} for model ${model} with retries`, {
      isStreaming,
      maxRetries: retryConfig.maxRetriesPerServer,
      serverHealth: server.healthy,
      serverLoad: this.getInFlight(server.id, model),
    });

    while (retryCount <= retryConfig.maxRetriesPerServer) {
      const requestContext: RequestContext = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        startTime: Date.now(),
        serverId: server.id,
        model,
        endpoint: 'generate',
        streaming: isStreaming,
        success: false,
      };

      try {
        this.incrementInFlight(server.id, model);

        if (retryCount > 0) {
          logger.info(
            `Retry ${retryCount}/${retryConfig.maxRetriesPerServer} on ${server.id} for model ${model}`
          );
        }

        const result = await fn(server);
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

        this.metricsAggregator.recordRequest(requestContext);
        getRequestHistory().recordRequest(requestContext);

        // Reset failure count on success - server is working
        this.resetServerFailureCount(server.id);
        this.recordSuccess(server.id, model, requestContext.duration);

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
        lastError = error instanceof Error ? error : new Error(String(error));

        // Record failed request metrics
        requestContext.endTime = Date.now();
        requestContext.duration = requestContext.endTime - requestContext.startTime;
        requestContext.success = false;
        requestContext.error = lastError;
        this.metricsAggregator.recordRequest(requestContext);
        getRequestHistory().recordRequest(requestContext);

        const errorMessage = lastError.message;
        const errorType = this.classifyError(errorMessage);

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
          // Calculate delay with exponential backoff
          const delay = Math.min(
            retryConfig.retryDelayMs * Math.pow(retryConfig.backoffMultiplier, retryCount),
            retryConfig.maxRetryDelayMs
          );

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
      consecutiveFailures: this.serverFailureCount.get(server.id) ?? 0,
    });

    switch (errorType) {
      case 'permanent': {
        // Permanent errors: ban server:model combo forever
        this.permanentBan.add(`${server.id}:${model}`);
        const isServerWide = this.isServerWideError(errorMessage);
        // Only mark server unhealthy if it's a server-wide issue
        if (isServerWide) {
          server.healthy = false;
        }
        this.recordFailure(server.id, errorType, model);
        logger.error(`PERMANENT BAN: Server ${server.id} banned for model ${model}`, {
          error: errorMessage,
          serverMarkedUnhealthy: isServerWide,
          totalBans: this.permanentBan.size,
        });
        break;
      }

      case 'non-retryable':
        // Non-retryable: model-specific issue, don't mark server unhealthy
        // Just put in cooldown for this model
        this.markFailure(server.id, model);
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
    const result: Record<
      string,
      { total: number; byModel: Record<string, { regular: number; bypass: number }> }
    > = {};

    // Process regular in-flight requests
    for (const [key, count] of this.inFlight.entries()) {
      const colonIdx = key.indexOf(':');
      const serverId = key.slice(0, colonIdx);
      const model = key.slice(colonIdx + 1);
      if (!result[serverId]) {
        result[serverId] = { total: 0, byModel: {} };
      }
      result[serverId].total += count;
      if (!result[serverId].byModel[model]) {
        result[serverId].byModel[model] = { regular: 0, bypass: 0 };
      }
      result[serverId].byModel[model].regular = count;
    }

    // Process bypass in-flight requests
    for (const [key, count] of this.inFlightBypass.entries()) {
      const colonIdx = key.indexOf(':');
      const serverId = key.slice(0, colonIdx);
      const model = key.slice(colonIdx + 1);
      if (!result[serverId]) {
        result[serverId] = { total: 0, byModel: {} };
      }
      result[serverId].total += count;
      if (!result[serverId].byModel[model]) {
        result[serverId].byModel[model] = { regular: 0, bypass: 0 };
      }
      result[serverId].byModel[model].bypass = count;
    }

    return result;
  }

  /**
   * Get total in-flight requests for a server
   */
  getTotalInFlight(serverId: string): number {
    let total = 0;
    for (const [key, count] of this.inFlight.entries()) {
      if (key.startsWith(`${serverId}:`)) {
        total += count;
      }
    }
    return total;
  }

  /**
   * Increment in-flight count
   */
  incrementInFlight(serverId: string, model: string, bypass: boolean = false): void {
    const key = `${serverId}:${model}`;
    if (bypass) {
      this.inFlightBypass.set(key, (this.inFlightBypass.get(key) ?? 0) + 1);
    } else {
      this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
    }
    this.metricsAggregator.incrementInFlight(serverId, model);
    logger.info(
      `In-flight incremented for ${serverId}:${model}, bypass: ${bypass}, total: ${this.getTotalInFlight(serverId)}`
    );
  }

  /**
   * Decrement in-flight count
   */
  decrementInFlight(serverId: string, model: string, bypass: boolean = false): void {
    const key = `${serverId}:${model}`;
    if (bypass) {
      const val = (this.inFlightBypass.get(key) ?? 1) - 1;
      if (val <= 0) {
        this.inFlightBypass.delete(key);
      } else {
        this.inFlightBypass.set(key, val);
      }
    } else {
      const val = (this.inFlight.get(key) ?? 1) - 1;
      if (val <= 0) {
        this.inFlight.delete(key);
      } else {
        this.inFlight.set(key, val);
      }
    }
    this.metricsAggregator.decrementInFlight(serverId, model);
    logger.info(
      `In-flight decremented for ${serverId}:${model}, bypass: ${bypass}, total: ${this.getTotalInFlight(serverId)}`
    );
  }

  /**
   * Get in-flight request count for a server:model
   */
  getInFlight(serverId: string, model: string): number {
    return this.inFlight.get(`${serverId}:${model}`) ?? 0;
  }

  /**
   * Record success for circuit breaker (both server and model level)
   * If responseTime is provided and success occurred during active test (half-open state),
   * adjust the timeout for this server:model pair based on the actual response time.
   */
  private recordSuccess(serverId: string, model?: string, responseTime?: number): void {
    const serverCb = this.getCircuitBreaker(serverId);
    const modelCb = model ? this.getModelCircuitBreaker(serverId, model) : null;

    // Check if either breaker was in half-open state before recording success
    const wasServerHalfOpen = serverCb.getState() === 'half-open';
    const wasModelHalfOpen = modelCb?.getState() === 'half-open';
    const wasActiveTest = wasServerHalfOpen || wasModelHalfOpen;

    serverCb.recordSuccess();

    // Also record at model level if provided
    if (model) {
      const modelCb = this.getModelCircuitBreaker(serverId, model);
      modelCb.recordSuccess();

      // Clear failure tracker on success
      const key = `${serverId}:${model}`;
      this.modelFailureTracker.delete(key);
    }

    // Adjust timeout based on active test response time
    if (wasActiveTest && responseTime !== undefined && responseTime > 0 && model) {
      // Set timeout to 2-3x the actual response time, with minimum of 5s and maximum of 5 minutes
      const adjustedTimeout = Math.max(5000, Math.min(300000, responseTime * 3));
      this.setTimeout(serverId, model, adjustedTimeout);
      logger.info(
        `Active test success: adjusted timeout for ${serverId}:${model} to ${adjustedTimeout}ms (3x ${responseTime}ms response time)`
      );
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

    // Map enhanced classification to legacy error types for backward compatibility
    let legacyErrorType: ErrorType;
    switch (classification.category) {
      case ErrorCategory.RESOURCE:
        legacyErrorType = 'permanent'; // Resource issues are usually permanent
        break;
      case ErrorCategory.COMPATIBILITY:
        legacyErrorType = 'non-retryable'; // Model compatibility issues
        break;
      case ErrorCategory.NETWORK:
        legacyErrorType = 'transient'; // Network issues can be transient
        break;
      case ErrorCategory.AUTHENTICATION:
        legacyErrorType = 'non-retryable'; // Auth issues don't retry
        break;
      case ErrorCategory.CONFIGURATION:
        legacyErrorType = 'permanent'; // Config issues are permanent
        break;
      case ErrorCategory.UNKNOWN:
      default:
        legacyErrorType = 'retryable'; // Default to retryable for unknown
        break;
    }

    const cb = this.getCircuitBreaker(serverId);
    cb.recordFailure(typeof error === 'string' ? new Error(error) : error, legacyErrorType);

    // Also record at model level if provided
    if (model) {
      const modelCb = this.getModelCircuitBreaker(serverId, model);
      modelCb.recordFailure(typeof error === 'string' ? new Error(error) : error, legacyErrorType);

      // Enhanced model failure tracking with category-specific handling
      const key = `${serverId}:${model}`;
      const now = Date.now();
      const tracker = this.modelFailureTracker.get(key) || { count: 0, lastSuccess: now };

      // Reset counter based on error category
      const resetWindowMs = this.getResetWindowForCategory(classification.category);
      if (now - tracker.lastSuccess > resetWindowMs) {
        tracker.count = 0;
      }

      tracker.count++;
      this.modelFailureTracker.set(key, tracker);

      // Category-specific ban thresholds
      const banThreshold = this.getBanThresholdForCategory(classification.category);
      const modelStats = modelCb.getStats();

      if (
        tracker.count >= banThreshold &&
        modelStats.errorRate >= this.getErrorRateThresholdForCategory(classification.category) &&
        modelStats.successCount === 0
      ) {
        if (!this.permanentBan.has(key)) {
          this.permanentBan.add(key);
          logger.warn(
            `Banning ${key} after ${tracker.count} consecutive ${classification.category} failures (${Math.round(modelStats.errorRate * 100)}% error rate)`,
            {
              serverId,
              model,
              failureCount: tracker.count,
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
    const key = `${serverId}:${model}`;
    const lastFail = this.failureCooldown.get(key);
    if (!lastFail) {
      return false;
    }
    return Date.now() - lastFail < this.config.cooldown.failureCooldownMs;
  }

  /**
   * Mark a server:model combination as failed and put it in cooldown
   */
  private markFailure(serverId: string, model: string): void {
    const key = `${serverId}:${model}`;
    this.failureCooldown.set(key, Date.now());
  }

  /**
   * Load bans from persisted data
   */
  loadBans(bans: Set<string>): void {
    for (const ban of bans) {
      this.permanentBan.add(ban);
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

      // Initialize circuit breaker persistence
      await this.circuitBreakerPersistence.initialize();

      // Load persisted circuit breaker states
      const persistedBreakerData = await this.circuitBreakerPersistence.load();
      if (persistedBreakerData) {
        this.circuitBreakerRegistry.loadPersistedState(persistedBreakerData.breakers);
      }

      // Initialize recovery test coordinator
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

      logger.info('Orchestrator: Recovery test coordinator callbacks have been set up');

      // Start health check scheduler
      this.healthCheckScheduler.start();

      logger.info(
        'Orchestrator initialized with persistence, circuit breakers, and recovery test coordinator'
      );
    } catch (error) {
      logger.error('Failed to initialize orchestrator:', { error });
      throw error;
    }
  }

  /**
   * Calculate adaptive timeout for active tests based on model size, historical performance, and server health
   */
  private calculateAdaptiveActiveTestTimeout(serverId: string, model: string): number {
    // Base timeout estimation from model size (using actual VRAM if available)
    const modelSizeMultiplier = this.calculateModelSizeMultiplier(serverId, model);
    const baseTimeout = 60000; // 60 seconds base for small models (was 30s - increased to prevent premature timeouts)
    const modelSizeTimeout = baseTimeout * modelSizeMultiplier;

    // Historical response time multiplier
    const historicalMultiplier = this.getHistoricalResponseMultiplier(serverId, model);

    // Server performance multiplier from recent health checks
    const serverPerformanceMultiplier = this.getServerPerformanceMultiplier(serverId);

    // Progressive extension for failed active tests
    const progressiveMultiplier = this.getProgressiveExtensionMultiplier(serverId, model);

    // Calculate adaptive timeout
    let adaptiveTimeout =
      modelSizeTimeout * historicalMultiplier * serverPerformanceMultiplier * progressiveMultiplier;

    // Apply caps
    const minTimeout = 15000; // 15 seconds minimum
    const maxTimeout = 900000; // 15 minutes maximum
    adaptiveTimeout = Math.max(minTimeout, Math.min(maxTimeout, adaptiveTimeout));

    logger.debug(`Adaptive timeout calculation for ${serverId}:${model}:`, {
      modelSizeMultiplier: modelSizeMultiplier.toFixed(2),
      historicalMultiplier: historicalMultiplier.toFixed(2),
      serverPerformanceMultiplier: serverPerformanceMultiplier.toFixed(2),
      progressiveMultiplier: progressiveMultiplier.toFixed(2),
      modelSizeTimeout,
      adaptiveTimeout,
    });

    return adaptiveTimeout;
  }

  /**
   * Calculate model size multiplier using real VRAM data if available, otherwise estimate from name
   */
  private calculateModelSizeMultiplier(serverId: string, model: string): number {
    // First check if we have actual VRAM data from /api/ps
    const vramKey = `${serverId}:${model}`;
    const actualVramMB = this.modelVramSizes.get(vramKey);

    if (actualVramMB && actualVramMB > 0) {
      // Use actual VRAM: base calculation on ~500MB = 1x (typical small model)
      // A 7B model typically uses ~4-6GB, 70B uses ~40-50GB
      // Scale: 500MB = 1x, 5GB (5000MB) = 10x, 50GB (50000MB) = 100x
      const baseVramMB = 500; // 500MB baseline
      const multiplier = Math.max(1, actualVramMB / baseVramMB);
      logger.debug(
        `Using actual VRAM for ${vramKey}: ${actualVramMB}MB, multiplier: ${multiplier.toFixed(2)}x`
      );
      return multiplier;
    }

    // Fall back to estimating from model name
    return this.estimateModelSizeMultiplierFromName(model);
  }

  /**
   * Estimate model size multiplier from model name (e.g., "7b", "70b", "8x7b")
   */
  private estimateModelSizeMultiplierFromName(model: string): number {
    const modelLower = model.toLowerCase();

    // Extract size patterns like "7b", "70b", "8x7b", "13b", etc.
    const sizePatterns = [
      /(\d+)x(\d+)b/g, // MoE patterns like "8x7b", "16x12b"
      /(\d+)b/g, // Standard patterns like "7b", "70b", "13b"
    ];

    let maxSize = 7; // Default to 7B if no size found

    for (const pattern of sizePatterns) {
      const matches = [...modelLower.matchAll(pattern)];
      for (const match of matches) {
        if (match[2]) {
          // MoE pattern: 8x7b = 8 * 7 = 56
          const experts = parseInt(match[1]);
          const expertSize = parseInt(match[2]);
          maxSize = Math.max(maxSize, experts * expertSize);
        } else {
          // Standard pattern: 70b = 70
          const size = parseInt(match[1]);
          maxSize = Math.max(maxSize, size);
        }
      }
    }

    // Size multiplier: 7B = 1x, 70B = 10x, 405B = 58x, etc.
    const multiplier = Math.max(1, maxSize / 7);
    return multiplier;
  }

  /**
   * Get historical response time multiplier from past successful requests
   */
  private getHistoricalResponseMultiplier(serverId: string, model: string): number {
    const metrics = this.metricsAggregator.getMetrics(serverId, model);
    if (!metrics) {
      return 1.0; // No historical data, use neutral multiplier
    }

    // Get total request count from recent windows
    const recentWindow = metrics.windows['1m'];
    const totalRequests = recentWindow ? recentWindow.count : 0;

    if (totalRequests < 3) {
      return 1.0; // Not enough data
    }

    // Use 95th percentile response time as reference
    const p95Time = metrics.percentiles.p95;
    if (p95Time <= 0) {
      return 1.0;
    }

    // Calculate multiplier relative to base 30s timeout
    // If historical P95 is 60s, multiplier is 2.0
    // If historical P95 is 15s, multiplier is 0.5
    const baseTimeout = 30000; // 30 seconds
    const multiplier = p95Time / baseTimeout;

    // Bound between 0.5x and 3x
    return Math.max(0.5, Math.min(3.0, multiplier));
  }

  /**
   * Get server performance multiplier from recent health check times
   */
  private getServerPerformanceMultiplier(serverId: string): number {
    const server = this.getServer(serverId);
    if (!server || server.lastResponseTime === Infinity) {
      return 1.0; // Unknown performance
    }

    const healthCheckTime = server.lastResponseTime;
    const baseHealthCheckTime = 1000; // Assume 1 second is good

    // Slower health checks indicate slower server
    const multiplier = healthCheckTime / baseHealthCheckTime;

    // Bound between 0.5x and 2x
    return Math.max(0.5, Math.min(2.0, multiplier));
  }

  /**
   * Get progressive extension multiplier for failed active tests
   * Increases timeout on repeated failures to allow for slow model loading
   */
  private getProgressiveExtensionMultiplier(serverId: string, model: string): number {
    const key = `${serverId}:${model}`;
    const failureCount = this.activeTestFailureCount.get(key) ?? 0;

    if (failureCount === 0) {
      return 1.0; // No recent failures
    }

    // Progressive extension: 1.5x, 2.0x, 2.5x, 3.0x for consecutive failures
    const multiplier = 1.0 + failureCount * 0.5;
    return Math.min(3.0, multiplier); // Cap at 3x
  }

  /**
   * Get timeout for a server:model pair, with fallback to default
   * Uses adaptive timeouts for active tests based on model size, historical performance, and server health
   */
  getTimeout(serverId: string, model: string): number {
    // Check if any circuit breaker is half-open (doing active test)
    // During half-open, use stored timeout - the scheduler handles doubling for active tests
    const serverCb = this.getCircuitBreaker(serverId);
    const modelCb = this.getModelCircuitBreaker(serverId, model);

    if (serverCb.getState() === 'half-open' || modelCb.getState() === 'half-open') {
      // Use stored timeout - scheduler handles adaptive timeout calculation for active tests
      const key = `${serverId}:${model}`;
      return this.timeouts.get(key) ?? 60000;
    }

    // Use configured timeout
    const key = `${serverId}:${model}`;
    return this.timeouts.get(key) ?? 60000; // Default 60s
  }

  /**
   * Set timeout for a server:model pair
   */
  setTimeout(serverId: string, model: string, timeoutMs: number): void {
    const key = `${serverId}:${model}`;
    this.timeouts.set(key, timeoutMs);

    // Persist if enabled
    if (this.config.enablePersistence) {
      saveTimeoutsToDisk(Object.fromEntries(this.timeouts));
    }
  }

  /**
   * Remove a specific ban for a server:model combination
   * @returns true if the ban was removed, false if it didn't exist
   */
  unban(serverId: string, model: string): boolean {
    const key = `${serverId}:${model}`;
    const existed = this.permanentBan.has(key);
    if (existed) {
      this.permanentBan.delete(key);
      logger.info(`Removed ban for ${key}`);
    }
    return existed;
  }

  /**
   * Remove all bans for a specific server
   * @returns number of bans removed
   */
  unbanServer(serverId: string): number {
    let removed = 0;

    for (const ban of this.permanentBan) {
      if (ban.startsWith(`${serverId}:`)) {
        this.permanentBan.delete(ban);
        removed++;
      }
    }

    if (removed > 0) {
      // Reset circuit breakers for this server
      this.circuitBreakerRegistry.remove(serverId);

      // Clear cooldowns for this server
      for (const key of this.failureCooldown.keys()) {
        if (key.startsWith(`${serverId}:`)) {
          this.failureCooldown.delete(key);
        }
      }

      logger.info(`Removed ${removed} bans for server ${serverId}`);
    }

    return removed;
  }

  /**
   * Remove all bans for a specific model (across all servers)
   * @returns number of bans removed
   */
  unbanModel(model: string): number {
    let removed = 0;

    for (const ban of this.permanentBan) {
      if (ban.endsWith(`:${model}`)) {
        this.permanentBan.delete(ban);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info(`Removed ${removed} bans for model ${model}`);
    }

    return removed;
  }

  /**
   * Clear all permanent bans
   * @returns number of bans cleared
   */
  clearAllBans(): number {
    const count = this.permanentBan.size;
    this.permanentBan.clear();

    if (count > 0) {
      logger.info(`Cleared all ${count} permanent bans`);
    }

    return count;
  }

  /**
   * Get detailed ban information
   */
  getBanDetails(): Array<{ serverId: string; model: string; key: string }> {
    return Array.from(this.permanentBan).map(key => {
      const [serverId, ...modelParts] = key.split(':');
      return {
        serverId,
        model: modelParts.join(':'), // Handle models with colons in name
        key,
      };
    });
  }

  // Track which servers are currently being tested to prevent hammering
  private serversUndergoingActiveTests = new Set<string>();
  private readonly MAX_MODELS_PER_SERVER_PER_CYCLE = 2; // Limit tests per cycle
  private async runActiveTestsForServer(
    server: AIServer
  ): Promise<Array<{ model: string; success: boolean; duration: number; error?: string }>> {
    const results: Array<{ model: string; success: boolean; duration: number; error?: string }> =
      [];

    // Skip if this server is already undergoing active tests
    if (this.serversUndergoingActiveTests.has(server.id)) {
      logger.debug(`Skipping active tests for ${server.id} - already in progress`);
      return results;
    }

    // First, check for any OPEN breakers whose nextRetryAt has passed and transition them to half-open
    // This ensures breakers don't get stuck in OPEN state when the system is idle
    const now = Date.now();
    const allStats = this.circuitBreakerRegistry.getAllStats();
    for (const [breakerName, stats] of Object.entries(allStats)) {
      if (stats.state === 'open' && stats.nextRetryAt && stats.nextRetryAt <= now) {
        const breaker = this.circuitBreakerRegistry.get(breakerName);
        if (breaker) {
          // Call canExecute to trigger the transition to half-open
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
    // This prevents half-open circuits from being stuck indefinitely
    for (const [breakerName, stats] of Object.entries(allStats)) {
      if (stats.state === 'half-open' && stats.halfOpenStartedAt && stats.halfOpenStartedAt > 0) {
        const breaker = this.circuitBreakerRegistry.get(breakerName);
        if (breaker) {
          const config = breaker.getConfig();
          const timeInHalfOpen = now - stats.halfOpenStartedAt;
          if (timeInHalfOpen > config.halfOpenTimeout) {
            // Don't timeout if there are active tests in progress
            if (stats.activeTestsInProgress && stats.activeTestsInProgress > 0) {
              logger.debug(
                `Half-open breaker ${breakerName} timed out but has ${stats.activeTestsInProgress} active tests in progress, skipping timeout`,
                {
                  halfOpenStartedAt: stats.halfOpenStartedAt,
                  timeInHalfOpen,
                  halfOpenTimeout: config.halfOpenTimeout,
                  activeTestsInProgress: stats.activeTestsInProgress,
                }
              );
              continue;
            }

            logger.warn(
              `Half-open breaker ${breakerName} timed out after ${timeInHalfOpen}ms (limit: ${config.halfOpenTimeout}ms), transitioning back to open`,
              {
                halfOpenStartedAt: stats.halfOpenStartedAt,
                timeInHalfOpen,
                halfOpenTimeout: config.halfOpenTimeout,
              }
            );
            // Force open without incrementing failed recovery count (timeout ≠ failure)
            breaker.forceOpen();
          }
        }
      }
    }

    // Check if server circuit is half-open (server-level recovery)
    const serverCb = this.getCircuitBreaker(server.id);
    if (serverCb.getState() === 'half-open') {
      // Server is recovering - instead of testing individual models,
      // just do a simple health check to confirm server is working
      logger.info(`Server ${server.id} circuit is half-open, performing recovery health check`);

      this.serversUndergoingActiveTests.add(server.id);

      try {
        const healthCheckResult = await this.performRecoveryHealthCheck(server);

        if (healthCheckResult.success) {
          // Server is healthy - close the server circuit
          serverCb.forceClose();
          logger.info(`Server ${server.id} recovery confirmed, circuit closed`);
        } else {
          // Server still failing - let circuit breaker handle backoff
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

      return results; // No individual model results for server recovery
    }

    // For model-level half-open circuits, test them individually (legacy behavior)
    // But with the new approach, model circuits should reopen naturally, so this may not trigger often

    // Get all circuit breakers for this server and filter for half-open model ones
    const halfOpenModels: Array<{
      model: string;
      failureReason: string;
      errorType?: 'retryable' | 'non-retryable' | 'transient' | 'permanent' | 'rateLimited';
      halfOpenStartedAt: number;
    }> = [];

    // Iterate through all breakers to find half-open model ones for this server
    for (const [breakerName, breaker] of Object.entries(this.getCircuitBreakerStats())) {
      if (!breakerName.startsWith(`${server.id}:`)) {
        continue;
      }

      if (breaker.state === 'half-open') {
        const model = breakerName.slice(server.id.length + 1);
        const failureReason = breaker.lastFailureReason || 'unknown';
        const errorType = breaker.lastErrorType;
        const halfOpenStartedAt = breaker.halfOpenStartedAt || 0;

        // Add half-open model to test list with timestamp for prioritization
        // Note: We don't check canExecute() here because for half-open breakers,
        // canExecute() returns false to block normal requests, but we explicitly
        // want to test them via active recovery tests
        halfOpenModels.push({ model, failureReason, errorType, halfOpenStartedAt });
      }
    }

    // Sort by halfOpenStartedAt - oldest first (oldest failing models get tested first)
    halfOpenModels.sort((a, b) => a.halfOpenStartedAt - b.halfOpenStartedAt);

    // Limit the number of models to test per cycle to avoid overwhelming the server
    const modelsToTest = halfOpenModels.slice(0, this.MAX_MODELS_PER_SERVER_PER_CYCLE);

    if (modelsToTest.length === 0) {
      return results;
    }

    // Mark server as undergoing active tests
    this.serversUndergoingActiveTests.add(server.id);

    logger.info(
      `Running active tests for ${modelsToTest.length}/${halfOpenModels.length} half-open models on ${server.id}`,
      {
        models: modelsToTest.map(m => m.model),
        failureReasons: modelsToTest.map(m => m.failureReason),
      }
    );

    try {
      // Run active tests using the health check scheduler's logic
      const testResults = await this.healthCheckScheduler.runActiveTests(
        server,
        modelsToTest,
        async (serverId: string, model: string, timeoutMs: number) => {
          return this.executeActiveTest(serverId, model, timeoutMs);
        },
        // onTestStart: increment active tests counter to prevent timeout during test
        (serverId: string, model: string) => {
          const modelCb = this.getModelCircuitBreaker(serverId, model);
          modelCb.startActiveTest();
        },
        // onTestEnd: decrement active tests counter after test completes
        (serverId: string, model: string) => {
          const modelCb = this.getModelCircuitBreaker(serverId, model);
          modelCb.endActiveTest();
        },
        // getCurrentTimeout: get stored timeout (not adaptive) for active test scaling
        (serverId: string, model: string) => {
          const key = `${serverId}:${model}`;
          return this.timeouts.get(key) ?? 60000; // Default 60s
        }
      );

      // Update circuit breakers based on results
      for (const result of testResults) {
        const modelCb = this.getModelCircuitBreaker(server.id, result.model);

        if (result.success) {
          modelCb.recordSuccess();
          logger.info(`Active test succeeded for ${server.id}:${result.model}`);
        } else if (!result.nonCircuitBreaking) {
          // Only record failure if this is not a non-circuit-breaking error
          const errorType = this.classifyError(result.error || 'Unknown error');
          modelCb.recordFailure(new Error(result.error || 'Active test failed'), errorType);
          logger.warn(`Active test failed for ${server.id}:${result.model}: ${result.error}`);
        } else {
          // Non-circuit-breaking failure (e.g., embedding test failed due to server unavailability)
          logger.info(
            `Active test failed for ${server.id}:${result.model} but not recording as circuit breaker failure: ${result.error}`
          );
        }

        results.push(result);
      }
    } finally {
      // Always remove server from undergoing tests
      this.serversUndergoingActiveTests.delete(server.id);
    }

    return results;
  }

  /**
   * Get circuit breaker for a server (with server-level half-open limits)
   */
  private getCircuitBreaker(serverId: string): import('./circuit-breaker.js').CircuitBreaker {
    return this.circuitBreakerRegistry.getOrCreate(serverId, undefined, (oldState, newState) => {
      // Enforce server-level half-open circuit limits
      if (newState === 'half-open') {
        const halfOpenCount = this.countHalfOpenCircuits(serverId);
        const maxHalfOpenPerServer = 3; // Configurable limit

        if (halfOpenCount >= maxHalfOpenPerServer) {
          logger.warn(
            `Server ${serverId} already has ${halfOpenCount} half-open circuits (max ${maxHalfOpenPerServer}). Preventing transition to half-open.`
          );
          // Force back to open state and extend the timeout
          const breaker = this.circuitBreakerRegistry.get(serverId);
          if (breaker) {
            breaker.forceOpen();
            // Extend next retry time exponentially
            const _currentStats = breaker.getStats();
            // We can't directly set nextRetryAt, so we'll record a failure to trigger the backoff logic
            breaker.recordFailure(new Error('Server-level half-open limit exceeded'), 'transient');
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
  ): import('./circuit-breaker.js').CircuitBreaker {
    const key = `${serverId}:${model}`;
    return this.circuitBreakerRegistry.getOrCreate(key, undefined, (oldState, newState) => {
      // Enforce server-level half-open circuit limits
      if (newState === 'half-open') {
        const halfOpenCount = this.countHalfOpenCircuits(serverId);
        const maxHalfOpenPerServer = 3; // Configurable limit

        if (halfOpenCount >= maxHalfOpenPerServer) {
          logger.warn(
            `Server ${serverId} already has ${halfOpenCount} half-open circuits (max ${maxHalfOpenPerServer}). Preventing transition to half-open for model ${model}.`
          );
          // Force back to open state and extend the timeout
          const breaker = this.circuitBreakerRegistry.get(key);
          if (breaker) {
            breaker.forceOpen();
            // Extend next retry time exponentially
            breaker.recordFailure(new Error('Server-level half-open limit exceeded'), 'transient');
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
    model: string
  ): void {
    if (!context) return;

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
  ): import('./circuit-breaker.js').CircuitBreaker | undefined {
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
  ): import('./circuit-breaker.js').CircuitBreaker | undefined {
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
   */
  private shouldSkipServerModel(
    serverId: string,
    model: string,
    endpoint?: 'generate' | 'embeddings'
  ): boolean {
    // Check both server-level and model-level circuit breakers
    const serverCb = this.getCircuitBreaker(serverId);
    const modelCb = this.getModelCircuitBreaker(serverId, model);

    // Skip if circuit is open (can't execute)
    if (!serverCb.canExecute() || !modelCb.canExecute()) {
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
   * Classify an error message to determine handling strategy
   */
  private classifyError(errorMessage: string): ErrorType {
    // Check for embedding model errors first - these shouldn't open circuit breakers
    // Embedding models failing on generation requests is expected behavior
    const embeddingModelErrors = [
      /embedding model.*not support/i,
      /does not support generate/i,
      /cannot generate.*embedding/i,
      /embed.*model.*only/i,
      /this model only supports embeddings/i,
    ];
    for (const pattern of embeddingModelErrors) {
      if (pattern.test(errorMessage)) {
        // Return as non-retryable - these won't trigger circuit breaker
        // because they're client errors (wrong endpoint for model type)
        return 'non-retryable';
      }
    }

    // Permanent errors: model cannot run on this server
    const permanentPatterns = [
      /not enough ram/i,
      /out of memory/i,
      /runner process has terminated/i,
      /fatal model server error/i,
      /model.*not found/i,
      /model.*does not exist/i,
    ];
    for (const pattern of permanentPatterns) {
      if (pattern.test(errorMessage)) {
        return 'permanent';
      }
    }

    // Non-retryable: client/request error, not server's fault
    const nonRetryablePatterns = [
      /invalid/i,
      /unauthorized/i,
      /forbidden/i,
      /authentication failed/i,
      /bad request/i,
      /http 4\d{2}/i,
    ];
    for (const pattern of nonRetryablePatterns) {
      if (pattern.test(errorMessage)) {
        return 'non-retryable';
      }
    }

    // Transient: temporary issues that should resolve
    const transientPatterns = [
      /timeout/i,
      /temporarily unavailable/i,
      /rate limit/i,
      /too many requests/i,
      /service unavailable/i,
      /gateway timeout/i,
      /econnrefused/i,
      /econnreset/i,
      /etimedout/i,
      /enotfound/i,
      /network/i,
      /fetch failed/i,
      /http 503/i,
      /http 502/i,
      /http 504/i,
    ];
    for (const pattern of transientPatterns) {
      if (pattern.test(errorMessage)) {
        return 'transient';
      }
    }

    // HTTP 500: could be model-specific or server-wide, treat as retryable
    if (/http 500/i.test(errorMessage)) {
      return 'retryable';
    }

    // Default: unknown errors are retryable
    return 'retryable';
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
    const count = (this.serverFailureCount.get(serverId) ?? 0) + 1;
    this.serverFailureCount.set(serverId, count);
    return count;
  }

  /**
   * Reset consecutive failure count for a server (on successful request)
   */
  private resetServerFailureCount(serverId: string): void {
    this.serverFailureCount.delete(serverId);
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

    const openModelBreakers = modelBreakers.filter(cb => !cb.canExecute());
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
    totalServers: number;
    healthyServers: number;
    totalModels: number;
    inFlightRequests: number;
    circuitBreakers: Record<string, { state: string; failureCount: number }>;
  } {
    const healthyServers = this.servers.filter(s => s.healthy).length;

    let inFlightTotal = 0;
    for (const count of this.inFlight.values()) {
      inFlightTotal += count;
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
   * Get queue statistics
   */
  getQueueStats() {
    return this.requestQueue.getStats();
  }

  /**
   * Get detailed queue items with wait times
   */
  getQueueItems() {
    return this.requestQueue.getAllItems();
  }

  /**
   * Pause request queue
   */
  pauseQueue(): void {
    this.requestQueue.pause();
  }

  /**
   * Resume request queue
   */
  resumeQueue(): void {
    this.requestQueue.resume();
  }

  /**
   * Check if queue is paused
   */
  isQueuePaused(): boolean {
    return this.requestQueue.isPaused();
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

      if (stats.inFlightRequests === 0 && this.requestQueue.size() === 0) {
        logger.info('Drain complete - all requests finished');
        this.draining = false;
        return true;
      }

      logger.debug(
        `Draining: ${stats.inFlightRequests} in-flight, ${this.requestQueue.size()} queued`
      );
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
    if (this.config.enablePersistence && this.timeouts.size > 0) {
      saveTimeoutsToDisk(Object.fromEntries(this.timeouts));
      logger.info(`Persisted ${this.timeouts.size} timeouts on shutdown`);
    }

    // Persist decision and request history
    await getDecisionHistory().persist();
    await getRequestHistory().persist();

    // Stop persistence timers
    getDecisionHistory().stop();
    getRequestHistory().stop();

    // Drain queue first
    this.requestQueue.shutdown();

    this.inFlight.clear();
    this.failureCooldown.clear();
    this.circuitBreakerRegistry.clear();

    logger.info('Orchestrator shutdown complete');
  }
}
