/**
 * config.ts
 * Configuration management system with hot reload and environment variable support
 */

import fs from 'fs/promises';
import path from 'path';

import type { CircuitBreakerConfig } from '../circuit-breaker.js';
import type { LoadBalancerConfig } from '../load-balancer.js';
import type { ModelManagerConfig } from '../model-manager.js';
import type { QueueConfig } from '../queue/index.js';
import { logger } from '../utils/logger.js';

// Configuration types
export interface ServerConfig {
  id: string;
  url: string;
  type: 'ollama';
  maxConcurrency?: number;
}

export interface SecurityConfig {
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  apiKeyHeader?: string;
  apiKeys?: string[];
}

export interface MetricsDecayConfig {
  enabled: boolean;
  halfLifeMs: number;
  minDecayFactor: number;
  staleThresholdMs: number;
}

export interface MetricsConfig {
  enabled: boolean;
  prometheusEnabled: boolean;
  prometheusPort: number;
  historyWindowMinutes: number;
  decay: MetricsDecayConfig;
}

export interface StreamingConfig {
  enabled: boolean;
  maxConcurrentStreams: number;
  timeoutMs: number;
  bufferSize: number;
  activityTimeoutMs: number; // Timeout between chunks - resets on each chunk received
}

export interface HealthCheckConfig {
  enabled: boolean;
  intervalMs: number; // How often to run health checks
  timeoutMs: number; // Timeout for individual health check requests
  maxConcurrentChecks: number; // Max servers to check concurrently
  retryAttempts: number; // Number of retries per server
  retryDelayMs: number; // Delay between retries
  recoveryIntervalMs: number; // How often to check unhealthy servers
  failureThreshold: number; // Consecutive failures before marking unhealthy
  successThreshold: number; // Consecutive successes for recovery
  backoffMultiplier: number; // Exponential backoff for retries
}

export interface TagsConfig {
  cacheTtlMs: number; // How long to cache aggregated tags results
  maxConcurrentRequests: number; // Max servers to query concurrently for tags
  batchDelayMs: number; // Delay between batches of concurrent requests
  requestTimeoutMs: number; // Timeout for individual tag requests
}

export interface RetryConfig {
  maxRetriesPerServer: number; // Max retries on same server for transient errors
  retryDelayMs: number; // Base delay between retries
  backoffMultiplier: number; // Exponential backoff multiplier
  maxRetryDelayMs: number; // Maximum delay between retries
  retryableStatusCodes: number[]; // HTTP status codes to retry on same server
}

export interface CooldownConfig {
  failureCooldownMs: number; // How long to keep a server:model in cooldown after failure
  defaultMaxConcurrency: number; // Default max concurrency for servers
}

export interface OrchestratorConfig {
  // Server settings
  port: number;
  host: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // Feature toggles
  enableQueue: boolean;
  enableCircuitBreaker: boolean;
  enableMetrics: boolean;
  enableStreaming: boolean;
  enablePersistence: boolean;

  // Sub-configurations
  queue: QueueConfig;
  loadBalancer: LoadBalancerConfig;
  circuitBreaker: CircuitBreakerConfig;
  security: SecurityConfig;
  metrics: MetricsConfig;
  streaming: StreamingConfig;
  healthCheck: HealthCheckConfig;
  tags: TagsConfig;
  retry: RetryConfig;
  cooldown: CooldownConfig;
  modelManager: ModelManagerConfig;

  // Ollama servers
  servers: ServerConfig[];

  // Persistence
  persistencePath: string;
  configReloadIntervalMs: number;
}

// Default configuration
export const DEFAULT_CONFIG: OrchestratorConfig = {
  port: 5100,
  host: '0.0.0.0',
  logLevel: 'info',

  enableQueue: true,
  enableCircuitBreaker: true,
  enableMetrics: true,
  enableStreaming: true,
  enablePersistence: true,

  queue: {
    maxSize: 1000,
    timeout: 300000, // 5 minutes
    priorityBoostInterval: 30000, // 30 seconds
    priorityBoostAmount: 5,
    maxPriority: 100,
  },

  loadBalancer: {
    weights: {
      latency: 0.3,
      successRate: 0.25,
      load: 0.2,
      capacity: 0.15,
      circuitBreaker: 0.1,
      timeout: 0.05,
    },
    thresholds: {
      maxP95Latency: 5000,
      minSuccessRate: 0.95,
      latencyPenalty: 0.5,
      errorPenalty: 0.3,
      circuitBreakerPenalty: 0.1,
    },
    latencyBlendRecent: 0.6,
    latencyBlendHistorical: 0.4,
    loadFactorMultiplier: 0.5,
    defaultLatencyMs: 1000,
    defaultMaxConcurrency: 4,
    streaming: {
      ttftWeight: 0.6,
      durationWeight: 0.4,
      ttftBlendAvg: 0.5,
      ttftBlendP95: 0.5,
      durationEstimateMultiplier: 2,
    },
    roundRobin: {
      skipUnhealthy: true,
      checkCapacity: true,
      stickySessionsTtlMs: 0, // Disabled by default
    },
    leastConnections: {
      skipUnhealthy: true,
      considerCapacity: true,
      considerFailureRate: true,
      failureRatePenalty: 2.0,
    },
  },

  circuitBreaker: {
    baseFailureThreshold: 5,
    maxFailureThreshold: 10,
    minFailureThreshold: 3,
    openTimeout: 30000,
    halfOpenTimeout: 300000, // 5 minutes - match activeTestTimeout
    halfOpenMaxRequests: 5,
    recoverySuccessThreshold: 3,
    activeTestTimeout: 300000, // 5 minutes
    errorRateWindow: 60000,
    errorRateThreshold: 0.5,
    adaptiveThresholds: true,
    errorRateSmoothing: 0.3,
    errorPatterns: {
      nonRetryable: [
        'not found',
        'invalid',
        'unauthorized',
        'forbidden',
        'authentication failed',
        'bad request',
        'not enough ram',
        'out of memory',
        'runner process has terminated',
        'fatal model server error',
      ],
      transient: [
        'timeout',
        'temporarily unavailable',
        'rate limit',
        'too many requests',
        'service unavailable',
        'gateway timeout',
        'econnrefused',
        'econnreset',
        'etimedout',
      ],
    },
    adaptiveThresholdAdjustment: 2,
    nonRetryableRatioThreshold: 0.5,
    transientRatioThreshold: 0.7,
    modelEscalation: {
      enabled: true,
      ratioThreshold: 0.5, // 50%
      durationThresholdMs: 600000, // 10 minutes
      checkIntervalMs: 300000, // 5 minutes
    },
  },

  security: {
    corsOrigins: ['*'],
    rateLimitWindowMs: 60000,
    rateLimitMax: 100,
  },

  metrics: {
    enabled: true,
    prometheusEnabled: true,
    prometheusPort: 9090,
    historyWindowMinutes: 60,
    decay: {
      enabled: true,
      halfLifeMs: 300000, // 5 minutes
      minDecayFactor: 0.1,
      staleThresholdMs: 120000, // 2 minutes
    },
  },

  streaming: {
    enabled: true,
    maxConcurrentStreams: 100,
    timeoutMs: 300000,
    bufferSize: 1024,
    activityTimeoutMs: 60000, // 60 seconds between chunks before timeout
  },

  healthCheck: {
    enabled: true,
    intervalMs: 30000, // 30 seconds
    timeoutMs: 10000, // 10 seconds
    maxConcurrentChecks: 10,
    retryAttempts: 2,
    retryDelayMs: 1000, // 1 second
    recoveryIntervalMs: 60000, // 1 minute
    failureThreshold: 3,
    successThreshold: 2,
    backoffMultiplier: 1.5,
  },

  tags: {
    cacheTtlMs: 300000, // 5 minutes
    maxConcurrentRequests: 10,
    batchDelayMs: 50, // 50ms delay between batches
    requestTimeoutMs: 5000, // 5 seconds
  },

  retry: {
    maxRetriesPerServer: 2, // Retry up to 2 times on same server for transient errors
    retryDelayMs: 500, // 500ms base delay
    backoffMultiplier: 2, // Double delay each retry
    maxRetryDelayMs: 5000, // Max 5 seconds between retries
    retryableStatusCodes: [503, 502, 504], // Gateway errors - retry on same server
  },

  cooldown: {
    failureCooldownMs: 120000, // 2 minutes
    defaultMaxConcurrency: 4,
  },

  modelManager: {
    maxRetries: 3,
    retryDelayBaseMs: 1000,
    warmupTimeoutMs: 60000,
    idleThresholdMs: 1800000, // 30 minutes
    memorySafetyMargin: 1.2,
    gbPerBillionParams: 0.75,
    defaultModelSizeGb: 5,
    loadTimeEstimates: {
      tiny: 3000,
      small: 5000,
      medium: 10000,
      large: 20000,
      xl: 40000,
      xxl: 80000,
    },
  },

  servers: [],

  persistencePath: './data',
  configReloadIntervalMs: 30000, // 30 seconds
};

// Configuration validation schema
interface ValidationError {
  path: string;
  message: string;
  value: unknown;
}

export class ConfigValidationError extends Error {
  errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    super(
      `Configuration validation failed: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`
    );
    this.errors = errors;
    this.name = 'ConfigValidationError';
  }
}

export class ConfigManager {
  private config: OrchestratorConfig;
  private configPath?: string;
  private watchers = new Set<(config: OrchestratorConfig) => void>();
  private componentWatchers = new Map<string, (config: OrchestratorConfig) => void>();
  private reloadInterval?: NodeJS.Timeout;
  private lastModified = 0;
  private isReloading = false;

  constructor(initialConfig?: Partial<OrchestratorConfig>) {
    this.config = this.mergeWithDefaults(initialConfig ?? {});
    this.applyEnvironmentOverrides();
  }

  /**
   * Load configuration from file (JSON or YAML)
   */
  async loadFromFile(filePath: string): Promise<void> {
    try {
      const resolvedPath = path.resolve(filePath);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const ext = path.extname(resolvedPath).toLowerCase();

      let parsed: Partial<OrchestratorConfig>;

      if (ext === '.json') {
        parsed = JSON.parse(content) as Partial<OrchestratorConfig>;
      } else if (ext === '.yaml' || ext === '.yml') {
        // Dynamic import to avoid requiring yaml if not used
        const yaml = await import('js-yaml');
        parsed = yaml.load(content) as Partial<OrchestratorConfig>;
      } else {
        throw new Error(`Unsupported config file format: ${ext}. Use .json, .yaml, or .yml`);
      }

      // Validate before applying
      const errors = this.validateConfig(parsed);
      if (errors.length > 0) {
        throw new ConfigValidationError(errors);
      }

      this.config = this.mergeWithDefaults(parsed);
      this.applyEnvironmentOverrides();
      this.configPath = resolvedPath;

      // Get file stats for change detection
      const stats = await fs.stat(resolvedPath);
      this.lastModified = stats.mtimeMs;

      logger.info(`Configuration loaded from ${resolvedPath}`);
      this.notifyWatchers();
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error;
      }
      logger.error(`Failed to load configuration from ${filePath}:`, { error });
      throw error;
    }
  }

  /**
   * Save current configuration to file
   */
  async saveToFile(filePath?: string): Promise<void> {
    const targetPath = filePath ?? this.configPath;
    if (!targetPath) {
      throw new Error('No file path specified for saving configuration');
    }

    try {
      const resolvedPath = path.resolve(targetPath);
      const ext = path.extname(resolvedPath).toLowerCase();

      let content: string;

      if (ext === '.json') {
        content = JSON.stringify(this.config, null, 2);
      } else if (ext === '.yaml' || ext === '.yml') {
        const yaml = await import('js-yaml');
        content = yaml.dump(this.config, { indent: 2, lineWidth: -1 });
      } else {
        throw new Error(`Unsupported config file format: ${ext}`);
      }

      // Ensure directory exists
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(resolvedPath, content, 'utf-8');

      const stats = await fs.stat(resolvedPath);
      this.lastModified = stats.mtimeMs;

      logger.info(`Configuration saved to ${resolvedPath}`);
    } catch (error) {
      logger.error(`Failed to save configuration to ${filePath}:`, { error });
      throw error;
    }
  }

  /**
   * Start hot reload watching
   */
  startHotReload(intervalMs?: number): void {
    if (this.reloadInterval) {
      return; // Already watching
    }

    const interval = intervalMs ?? this.config.configReloadIntervalMs;

    this.reloadInterval = setInterval(() => {
      void this.checkAndReload();
    }, interval);

    logger.info(`Hot reload enabled (checking every ${interval}ms)`);
  }

  /**
   * Stop hot reload watching
   */
  stopHotReload(): void {
    if (this.reloadInterval) {
      clearInterval(this.reloadInterval);
      this.reloadInterval = undefined;
      logger.info('Hot reload disabled');
    }
  }

  /**
   * Check for config file changes and reload if needed
   */
  private async checkAndReload(): Promise<void> {
    if (!this.configPath || this.isReloading) {
      return;
    }

    try {
      const stats = await fs.stat(this.configPath);

      if (stats.mtimeMs > this.lastModified) {
        this.isReloading = true;
        logger.info('Configuration file changed, reloading...');

        await this.loadFromFile(this.configPath);
        this.lastModified = stats.mtimeMs;

        logger.info('Configuration reloaded successfully');
      }
    } catch (error) {
      logger.error('Failed to check/reload configuration:', { error });
    } finally {
      this.isReloading = false;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): OrchestratorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(updates: Partial<OrchestratorConfig>): void {
    const errors = this.validateConfig(updates);
    if (errors.length > 0) {
      throw new ConfigValidationError(errors);
    }

    this.config = this.mergeWithDefaults({
      ...this.config,
      ...updates,
    });

    logger.info('Configuration updated at runtime');
    this.notifyWatchers();
  }

  /**
   * Update a specific section of the configuration
   */
  updateSection<K extends keyof OrchestratorConfig>(
    section: K,
    updates: Partial<OrchestratorConfig[K]>
  ): void {
    const currentSection = this.config[section] as unknown as Record<string, unknown>;
    this.config = {
      ...this.config,
      [section]: {
        ...currentSection,
        ...updates,
      },
    };

    logger.info(`Configuration section '${section}' updated`);
    this.notifyWatchers();
  }

  /**
   * Subscribe to configuration changes
   */
  onChange(callback: (config: OrchestratorConfig) => void): () => void {
    this.watchers.add(callback);

    // Return unsubscribe function
    return () => {
      this.watchers.delete(callback);
    };
  }

  /**
   * Register a component-specific watcher that receives full config on changes
   */
  registerComponentWatcher(
    componentId: string,
    callback: (config: OrchestratorConfig) => void
  ): () => void {
    this.componentWatchers.set(componentId, callback);

    return () => {
      this.componentWatchers.delete(componentId);
    };
  }

  /**
   * Get configuration as plain object for serialization
   */
  toJSON(): OrchestratorConfig {
    return this.getConfig();
  }

  /**
   * Apply environment variable overrides
   */
  private applyEnvironmentOverrides(): void {
    const env = process.env;

    // Server settings
    if (env.ORCHESTRATOR_PORT) {
      const port = parseInt(env.ORCHESTRATOR_PORT, 10);
      if (!isNaN(port)) {
        this.config.port = port;
      }
    }

    if (env.ORCHESTRATOR_HOST) {
      this.config.host = env.ORCHESTRATOR_HOST;
    }

    if (env.ORCHESTRATOR_LOG_LEVEL) {
      const level = env.ORCHESTRATOR_LOG_LEVEL as OrchestratorConfig['logLevel'];
      if (['debug', 'info', 'warn', 'error'].includes(level)) {
        this.config.logLevel = level;
      }
    }

    // Feature toggles
    if (env.ORCHESTRATOR_ENABLE_QUEUE) {
      this.config.enableQueue = env.ORCHESTRATOR_ENABLE_QUEUE === 'true';
    }

    if (env.ORCHESTRATOR_ENABLE_CIRCUIT_BREAKER) {
      this.config.enableCircuitBreaker = env.ORCHESTRATOR_ENABLE_CIRCUIT_BREAKER === 'true';
    }

    if (env.ORCHESTRATOR_ENABLE_METRICS) {
      this.config.enableMetrics = env.ORCHESTRATOR_ENABLE_METRICS === 'true';
    }

    if (env.ORCHESTRATOR_ENABLE_STREAMING) {
      this.config.enableStreaming = env.ORCHESTRATOR_ENABLE_STREAMING === 'true';
    }

    // Queue settings
    if (env.ORCHESTRATOR_QUEUE_MAX_SIZE) {
      const maxSize = parseInt(env.ORCHESTRATOR_QUEUE_MAX_SIZE, 10);
      if (!isNaN(maxSize)) {
        this.config.queue.maxSize = maxSize;
      }
    }

    // Security settings
    if (env.ORCHESTRATOR_CORS_ORIGINS) {
      this.config.security.corsOrigins = env.ORCHESTRATOR_CORS_ORIGINS.split(',');
    }

    if (env.ORCHESTRATOR_RATE_LIMIT_MAX) {
      const rateLimit = parseInt(env.ORCHESTRATOR_RATE_LIMIT_MAX, 10);
      if (!isNaN(rateLimit)) {
        this.config.security.rateLimitMax = rateLimit;
      }
    }

    // Metrics settings
    if (env.ORCHESTRATOR_PROMETHEUS_PORT) {
      const port = parseInt(env.ORCHESTRATOR_PROMETHEUS_PORT, 10);
      if (!isNaN(port)) {
        this.config.metrics.prometheusPort = port;
      }
    }

    // Streaming settings
    if (env.ORCHESTRATOR_STREAMING_TIMEOUT_MS) {
      const timeout = parseInt(env.ORCHESTRATOR_STREAMING_TIMEOUT_MS, 10);
      if (!isNaN(timeout) && timeout >= 1000) {
        this.config.streaming.timeoutMs = timeout;
      }
    }

    if (env.ORCHESTRATOR_STREAMING_ACTIVITY_TIMEOUT_MS) {
      const timeout = parseInt(env.ORCHESTRATOR_STREAMING_ACTIVITY_TIMEOUT_MS, 10);
      if (!isNaN(timeout) && timeout >= 1000) {
        this.config.streaming.activityTimeoutMs = timeout;
      }
    }

    // Health check settings
    if (env.ORCHESTRATOR_HEALTH_CHECK_ENABLED) {
      this.config.healthCheck.enabled = env.ORCHESTRATOR_HEALTH_CHECK_ENABLED === 'true';
    }

    if (env.ORCHESTRATOR_HEALTH_CHECK_INTERVAL_MS) {
      const interval = parseInt(env.ORCHESTRATOR_HEALTH_CHECK_INTERVAL_MS, 10);
      if (!isNaN(interval) && interval >= 1000) {
        this.config.healthCheck.intervalMs = interval;
      }
    }

    if (env.ORCHESTRATOR_HEALTH_CHECK_TIMEOUT_MS) {
      const timeout = parseInt(env.ORCHESTRATOR_HEALTH_CHECK_TIMEOUT_MS, 10);
      if (!isNaN(timeout) && timeout >= 500) {
        this.config.healthCheck.timeoutMs = timeout;
      }
    }

    if (env.ORCHESTRATOR_HEALTH_CHECK_MAX_CONCURRENT) {
      const maxConcurrent = parseInt(env.ORCHESTRATOR_HEALTH_CHECK_MAX_CONCURRENT, 10);
      if (!isNaN(maxConcurrent) && maxConcurrent >= 1) {
        this.config.healthCheck.maxConcurrentChecks = maxConcurrent;
      }
    }

    // Persistence
    if (env.ORCHESTRATOR_PERSISTENCE_PATH) {
      this.config.persistencePath = env.ORCHESTRATOR_PERSISTENCE_PATH;
    }

    logger.debug('Environment variable overrides applied');
  }

  /**
   * Merge partial config with defaults
   */
  private mergeWithDefaults(partial: Partial<OrchestratorConfig>): OrchestratorConfig {
    return {
      port: partial.port ?? DEFAULT_CONFIG.port,
      host: partial.host ?? DEFAULT_CONFIG.host,
      logLevel: partial.logLevel ?? DEFAULT_CONFIG.logLevel,
      enableQueue: partial.enableQueue ?? DEFAULT_CONFIG.enableQueue,
      enableCircuitBreaker: partial.enableCircuitBreaker ?? DEFAULT_CONFIG.enableCircuitBreaker,
      enableMetrics: partial.enableMetrics ?? DEFAULT_CONFIG.enableMetrics,
      enableStreaming: partial.enableStreaming ?? DEFAULT_CONFIG.enableStreaming,
      enablePersistence: partial.enablePersistence ?? DEFAULT_CONFIG.enablePersistence,
      queue: { ...DEFAULT_CONFIG.queue, ...partial.queue },
      loadBalancer: { ...DEFAULT_CONFIG.loadBalancer, ...partial.loadBalancer },
      circuitBreaker: { ...DEFAULT_CONFIG.circuitBreaker, ...partial.circuitBreaker },
      security: { ...DEFAULT_CONFIG.security, ...partial.security },
      metrics: { ...DEFAULT_CONFIG.metrics, ...partial.metrics },
      streaming: { ...DEFAULT_CONFIG.streaming, ...partial.streaming },
      healthCheck: { ...DEFAULT_CONFIG.healthCheck, ...partial.healthCheck },
      tags: { ...DEFAULT_CONFIG.tags, ...partial.tags },
      retry: { ...DEFAULT_CONFIG.retry, ...partial.retry },
      cooldown: { ...DEFAULT_CONFIG.cooldown, ...partial.cooldown },
      modelManager: { ...DEFAULT_CONFIG.modelManager, ...partial.modelManager },
      servers: partial.servers ?? DEFAULT_CONFIG.servers,
      persistencePath: partial.persistencePath ?? DEFAULT_CONFIG.persistencePath,
      configReloadIntervalMs:
        partial.configReloadIntervalMs ?? DEFAULT_CONFIG.configReloadIntervalMs,
    };
  }

  /**
   * Validate configuration values
   */
  private validateConfig(config: Partial<OrchestratorConfig>): ValidationError[] {
    const errors: ValidationError[] = [];

    // Validate port
    if (config.port !== undefined) {
      if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
        errors.push({
          path: 'port',
          message: 'Port must be a number between 1 and 65535',
          value: config.port,
        });
      }
    }

    // Validate log level
    if (config.logLevel !== undefined) {
      const validLevels = ['debug', 'info', 'warn', 'error'];
      if (!validLevels.includes(config.logLevel)) {
        errors.push({
          path: 'logLevel',
          message: `Log level must be one of: ${validLevels.join(', ')}`,
          value: config.logLevel,
        });
      }
    }

    // Validate queue config
    if (config.queue) {
      if (
        config.queue.maxSize !== undefined &&
        (typeof config.queue.maxSize !== 'number' || config.queue.maxSize < 1)
      ) {
        errors.push({
          path: 'queue.maxSize',
          message: 'Queue maxSize must be a positive number',
          value: config.queue.maxSize,
        });
      }
    }

    // Validate health check config
    if (config.healthCheck) {
      if (
        config.healthCheck.intervalMs !== undefined &&
        (typeof config.healthCheck.intervalMs !== 'number' || config.healthCheck.intervalMs < 1000)
      ) {
        errors.push({
          path: 'healthCheck.intervalMs',
          message: 'Health check interval must be at least 1000ms',
          value: config.healthCheck.intervalMs,
        });
      }

      if (
        config.healthCheck.timeoutMs !== undefined &&
        (typeof config.healthCheck.timeoutMs !== 'number' || config.healthCheck.timeoutMs < 500)
      ) {
        errors.push({
          path: 'healthCheck.timeoutMs',
          message: 'Health check timeout must be at least 500ms',
          value: config.healthCheck.timeoutMs,
        });
      }

      if (
        config.healthCheck.maxConcurrentChecks !== undefined &&
        (typeof config.healthCheck.maxConcurrentChecks !== 'number' ||
          config.healthCheck.maxConcurrentChecks < 1)
      ) {
        errors.push({
          path: 'healthCheck.maxConcurrentChecks',
          message: 'Max concurrent checks must be at least 1',
          value: config.healthCheck.maxConcurrentChecks,
        });
      }
    }

    // Validate servers
    if (config.servers) {
      if (!Array.isArray(config.servers)) {
        errors.push({
          path: 'servers',
          message: 'Servers must be an array',
          value: config.servers,
        });
      } else {
        config.servers.forEach((server, index) => {
          if (!server.id) {
            errors.push({
              path: `servers[${index}].id`,
              message: 'Server ID is required',
              value: server.id,
            });
          }
          if (!server.url) {
            errors.push({
              path: `servers[${index}].url`,
              message: 'Server URL is required',
              value: server.url,
            });
          }
          if (server.url && !this.isValidUrl(server.url)) {
            errors.push({
              path: `servers[${index}].url`,
              message: 'Server URL must be a valid URL',
              value: server.url,
            });
          }
        });
      }
    }

    return errors;
  }

  /**
   * Check if string is a valid URL
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Notify all watchers of configuration change
   */
  private notifyWatchers(): void {
    const config = this.getConfig();

    // Notify general watchers
    for (const watcher of this.watchers) {
      try {
        watcher(config);
      } catch (error) {
        logger.error('Error in config watcher:', { error });
      }
    }

    // Notify component-specific watchers
    for (const [id, watcher] of this.componentWatchers) {
      try {
        watcher(config);
      } catch (error) {
        logger.error(`Error in component watcher (${id}):`, { error });
      }
    }
  }
}

// Singleton instance
let globalConfigManager: ConfigManager | undefined;

export function getConfigManager(): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager();
  }
  return globalConfigManager;
}

export function setConfigManager(manager: ConfigManager): void {
  globalConfigManager = manager;
}
