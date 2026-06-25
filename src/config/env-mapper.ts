/**
 * envMapper.ts
 * Maps environment variables to configuration paths
 */

import { logger } from '../utils/logger.js';

/**
 * Environment variable to config path mapping
 * Format: ENV_VAR_NAME: 'nested.config.path'
 */
export const ENV_CONFIG_MAPPING: Record<string, string> = {
  // Server settings
  ORCHESTRATOR_PORT: 'port',
  ORCHESTRATOR_HOST: 'host',
  ORCHESTRATOR_LOG_LEVEL: 'logLevel',
  ORCHESTRATOR_USER_AGENT: 'userAgent',

  // Feature toggles
  ORCHESTRATOR_ENABLE_QUEUE: 'enableQueue',
  ORCHESTRATOR_ENABLE_CIRCUIT_BREAKER: 'enableCircuitBreaker',
  ORCHESTRATOR_ENABLE_METRICS: 'enableMetrics',
  ORCHESTRATOR_ENABLE_STREAMING: 'enableStreaming',
  ORCHESTRATOR_ENABLE_PERSISTENCE: 'enablePersistence',
  ORCHESTRATOR_ENABLE_AUTH: 'enableAuth',

  // Queue settings
  ORCHESTRATOR_QUEUE_MAX_SIZE: 'queue.maxSize',
  ORCHESTRATOR_QUEUE_TIMEOUT: 'queue.timeout',
  ORCHESTRATOR_QUEUE_PRIORITY_BOOST_INTERVAL: 'queue.priorityBoostInterval',
  ORCHESTRATOR_QUEUE_PRIORITY_BOOST_AMOUNT: 'queue.priorityBoostAmount',
  ORCHESTRATOR_QUEUE_MAX_PRIORITY: 'queue.maxPriority',

  // Load balancer settings
  ORCHESTRATOR_LB_WEIGHT_LATENCY: 'loadBalancer.weights.latency',
  ORCHESTRATOR_GHOST_STALE_THRESHOLD_MS: 'loadBalancer.ghostServers.staleThresholdMs',
  ORCHESTRATOR_GHOST_REMOVE_ON_CLEANUP: 'loadBalancer.ghostServers.removeOnCleanup',
  ORCHESTRATOR_LB_WEIGHT_SUCCESS_RATE: 'loadBalancer.weights.successRate',
  ORCHESTRATOR_LB_WEIGHT_LOAD: 'loadBalancer.weights.load',
  ORCHESTRATOR_LB_WEIGHT_CAPACITY: 'loadBalancer.weights.capacity',
  ORCHESTRATOR_LB_MAX_P95_LATENCY: 'loadBalancer.thresholds.maxP95Latency',
  ORCHESTRATOR_LB_MIN_SUCCESS_RATE: 'loadBalancer.thresholds.minSuccessRate',
  ORCHESTRATOR_LB_LATENCY_PENALTY: 'loadBalancer.thresholds.latencyPenalty',
  ORCHESTRATOR_LB_ERROR_PENALTY: 'loadBalancer.thresholds.errorPenalty',

  // Circuit breaker settings
  ORCHESTRATOR_CB_FAILURE_THRESHOLD: 'circuitBreaker.baseFailureThreshold',
  ORCHESTRATOR_CB_MAX_FAILURE_THRESHOLD: 'circuitBreaker.maxFailureThreshold',
  ORCHESTRATOR_CB_MIN_FAILURE_THRESHOLD: 'circuitBreaker.minFailureThreshold',
  ORCHESTRATOR_CB_OPEN_TIMEOUT: 'circuitBreaker.openTimeout',
  ORCHESTRATOR_CB_HALF_OPEN_TIMEOUT: 'circuitBreaker.halfOpenTimeout',
  ORCHESTRATOR_CB_RECOVERY_SUCCESS_THRESHOLD: 'circuitBreaker.recoverySuccessThreshold',
  ORCHESTRATOR_CB_ERROR_RATE_WINDOW: 'circuitBreaker.errorRateWindow',
  ORCHESTRATOR_CB_ERROR_RATE_THRESHOLD: 'circuitBreaker.errorRateThreshold',
  ORCHESTRATOR_CB_ADAPTIVE_THRESHOLDS: 'circuitBreaker.adaptiveThresholds',
  ORCHESTRATOR_CB_ERROR_RATE_SMOOTHING: 'circuitBreaker.errorRateSmoothing',

  // Security settings
  ORCHESTRATOR_CORS_ORIGINS: 'security.corsOrigins',
  ORCHESTRATOR_RATE_LIMIT_WINDOW: 'security.rateLimitWindowMs',
  ORCHESTRATOR_RATE_LIMIT_MAX: 'security.rateLimitMax',
  ORCHESTRATOR_AUTH_MUST_BE_ENABLED: 'security.authMustBeEnabled',
  ORCHESTRATOR_API_KEY_HEADER: 'security.apiKeyHeader',
  ORCHESTRATOR_API_KEYS: 'security.apiKeys',
  ORCHESTRATOR_ADMIN_API_KEYS: 'security.adminApiKeys',

  // Metrics settings
  ORCHESTRATOR_METRICS_ENABLED: 'metrics.enabled',
  ORCHESTRATOR_METRICS_PROMETHEUS_ENABLED: 'metrics.prometheusEnabled',
  ORCHESTRATOR_METRICS_PROMETHEUS_PORT: 'metrics.prometheusPort',

  // Streaming settings
  ORCHESTRATOR_STREAMING_ENABLED: 'streaming.enabled',
  ORCHESTRATOR_STREAMING_MAX_CONCURRENT: 'streaming.maxConcurrentStreams',
  ORCHESTRATOR_STREAMING_TIMEOUT: 'streaming.timeoutMs',
  ORCHESTRATOR_STREAMING_BUFFER_SIZE: 'streaming.bufferSize',
  ORCHESTRATOR_STREAMING_TTFT_WEIGHT: 'streaming.ttftWeight',
  ORCHESTRATOR_STREAMING_DURATION_WEIGHT: 'streaming.durationWeight',
  ORCHESTRATOR_STREAMING_STALL_THRESHOLD_MS: 'streaming.stallThresholdMs',
  ORCHESTRATOR_STREAMING_STALL_CHECK_INTERVAL_MS: 'streaming.stallCheckIntervalMs',
  ORCHESTRATOR_STREAMING_MAX_HANDOFF_ATTEMPTS: 'streaming.maxHandoffAttempts',

  // Health check settings
  ORCHESTRATOR_HC_ENABLED: 'healthCheck.enabled',
  ORCHESTRATOR_HC_INTERVAL: 'healthCheck.intervalMs',
  ORCHESTRATOR_HC_TIMEOUT: 'healthCheck.timeoutMs',
  ORCHESTRATOR_HC_MAX_CONCURRENT: 'healthCheck.maxConcurrentChecks',
  ORCHESTRATOR_HC_RETRY_ATTEMPTS: 'healthCheck.retryAttempts',
  ORCHESTRATOR_HC_RETRY_DELAY: 'healthCheck.retryDelayMs',
  ORCHESTRATOR_HC_RECOVERY_INTERVAL: 'healthCheck.recoveryIntervalMs',
  ORCHESTRATOR_HC_FAILURE_THRESHOLD: 'healthCheck.failureThreshold',
  ORCHESTRATOR_HC_SUCCESS_THRESHOLD: 'healthCheck.successThreshold',
  ORCHESTRATOR_HC_BACKOFF_MULTIPLIER: 'healthCheck.backoffMultiplier',

  // Tags settings
  ORCHESTRATOR_TAGS_CACHE_TTL: 'tags.cacheTtlMs',
  ORCHESTRATOR_TAGS_MAX_CONCURRENT: 'tags.maxConcurrentRequests',
  ORCHESTRATOR_TAGS_BATCH_DELAY: 'tags.batchDelayMs',
  ORCHESTRATOR_TAGS_REQUEST_TIMEOUT: 'tags.requestTimeoutMs',

  // Retry settings
  ORCHESTRATOR_RETRY_MAX_RETRIES: 'retry.maxRetriesPerServer',
  ORCHESTRATOR_RETRY_DELAY: 'retry.retryDelayMs',
  ORCHESTRATOR_RETRY_BACKOFF_MULTIPLIER: 'retry.backoffMultiplier',
  ORCHESTRATOR_RETRY_MAX_DELAY: 'retry.maxRetryDelayMs',
  ORCHESTRATOR_RETRY_STATUS_CODES: 'retry.retryableStatusCodes',

  // Timeout settings
  ORCHESTRATOR_TIMEOUT_DEFAULT_MS: 'timeout.defaultTimeoutMs',
  ORCHESTRATOR_TIMEOUT_MIN_MS: 'timeout.minTimeoutMs',
  ORCHESTRATOR_TIMEOUT_MAX_MS: 'timeout.maxTimeoutMs',
  ORCHESTRATOR_TIMEOUT_RECOVERY_MULTIPLIER: 'timeout.recoveryTestMultiplier',
  ORCHESTRATOR_TIMEOUT_NORMAL_MULTIPLIER: 'timeout.normalRequestMultiplier',
  ORCHESTRATOR_TIMEOUT_DECAY_RATE: 'timeout.decayRatePerMs',
  ORCHESTRATOR_TIMEOUT_STALL_MULTIPLIER: 'timeout.stallThresholdMultiplier',
  ORCHESTRATOR_TIMEOUT_STALL_CAP_MS: 'timeout.stallThresholdCapMs',

  // Model manager settings
  ORCHESTRATOR_MM_MAX_RETRIES: 'modelManager.maxRetries',
  ORCHESTRATOR_MM_RETRY_DELAY_BASE: 'modelManager.retryDelayBaseMs',
  ORCHESTRATOR_MM_WARMUP_TIMEOUT: 'modelManager.warmupTimeoutMs',
  ORCHESTRATOR_MM_IDLE_THRESHOLD: 'modelManager.idleThresholdMs',
  ORCHESTRATOR_MM_MEMORY_SAFETY_MARGIN: 'modelManager.memorySafetyMargin',
  ORCHESTRATOR_MM_GB_PER_BILLION_PARAMS: 'modelManager.gbPerBillionParams',

  ORCHESTRATOR_ADAPTIVE_WEIGHT_TUNER_ENABLED: 'adaptiveWeightTuner.enabled',
  ORCHESTRATOR_PERSISTENCE_PATH: 'persistencePath',

  // Auto warmup settings
  AUTO_WARMUP_ENABLED: 'autoWarmup.enabled',
  AUTO_WARMUP_INTERVAL_MS: 'autoWarmup.intervalMs',
  AUTO_WARMUP_TOP_N: 'autoWarmup.topN',
  AUTO_WARMUP_SERVERS_PER_MODEL: 'autoWarmup.serversPerModel',
  ORCHESTRATOR_CONFIG_RELOAD_INTERVAL: 'configReloadIntervalMs',

  // Honeypot probe settings
  ORCHESTRATOR_HONEYPOT_ENABLED: 'honeypotProbes.enabled',
  ORCHESTRATOR_HONEYPOT_INTERVAL_MS: 'honeypotProbes.intervalMs',
  ORCHESTRATOR_HONEYPOT_BATCH_SIZE: 'honeypotProbes.batchSize',
  ORCHESTRATOR_HONEYPOT_TIMEOUT_MS: 'honeypotProbes.timeoutMs',
  ORCHESTRATOR_HONEYPOT_SCORE_THRESHOLD_SUSPICIOUS: 'honeypotProbes.scoreThreshold.suspicious',
  ORCHESTRATOR_HONEYPOT_SCORE_THRESHOLD_FLAGGED: 'honeypotProbes.scoreThreshold.flagged',
  ORCHESTRATOR_HONEYPOT_TIER2_ENABLED: 'honeypotProbes.tier2.enabled',
  ORCHESTRATOR_HONEYPOT_TIER2_ENTROPY_SAMPLE_COUNT: 'honeypotProbes.tier2.entropySampleCount',
  ORCHESTRATOR_HONEYPOT_TIER2_TLS_TIMEOUT_MS: 'honeypotProbes.tier2.tlsTimeoutMs',
  ORCHESTRATOR_HONEYPOT_TIER2_INTERVAL_MS: 'honeypotProbes.tier2.intervalMs',
};

/**
 * Parse environment variable value to appropriate type
 */
function parseEnvValue(value: string): string | number | boolean | string[] | number[] {
  // Try to parse as boolean
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }

  // Try to parse as number
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }

  // Try to parse as array (comma-separated)
  if (value.includes(',')) {
    const items = value.split(',').map(s => s.trim());
    // Check if all items are numbers
    if (items.every(item => /^-?\d+$/.test(item))) {
      return items.map(item => parseInt(item, 10));
    }
    return items;
  }

  // Return as string
  return value;
}

/**
 * Set a nested value in an object by path
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * Apply environment variable overrides to config
 */
export function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const result = { ...config };
  let appliedCount = 0;

  for (const [envVar, configPath] of Object.entries(ENV_CONFIG_MAPPING)) {
    const value = process.env[envVar];
    if (value !== undefined) {
      const parsedValue = parseEnvValue(value);
      setNestedValue(result, configPath, parsedValue);
      appliedCount++;
      logger.debug(`Applied config override from env: ${envVar} -> ${configPath}`);
    }
  }

  if (appliedCount > 0) {
    logger.info(`Applied ${appliedCount} configuration overrides from environment variables`);
  }

  return result;
}

/**
 * Get list of environment variables that affect configuration
 */
export function getConfigurableEnvVars(): Array<{
  envVar: string;
  configPath: string;
  description: string;
}> {
  return Object.entries(ENV_CONFIG_MAPPING).map(([envVar, configPath]) => ({
    envVar,
    configPath,
    description: getEnvVarDescription(envVar),
  }));
}

/**
 * Get description for environment variable
 */
function getEnvVarDescription(envVar: string): string {
  const descriptions: Record<string, string> = {
    ORCHESTRATOR_PORT: 'Server port (default: 5100)',
    ORCHESTRATOR_HOST: 'Server host (default: 0.0.0.0)',
    ORCHESTRATOR_LOG_LEVEL: 'Log level: debug, info, warn, error (default: info)',
    ORCHESTRATOR_ENABLE_AUTH: 'Enable API key authentication (default: true)',
    ORCHESTRATOR_API_KEYS: 'Comma-separated list of API keys',
    ORCHESTRATOR_ADMIN_API_KEYS: 'Comma-separated list of admin API keys',
    ORCHESTRATOR_QUEUE_MAX_SIZE: 'Maximum queue size (default: 1000)',
    ORCHESTRATOR_LB_WEIGHT_LATENCY: 'Load balancer latency weight (default: 0.35)',
    ORCHESTRATOR_CB_FAILURE_THRESHOLD: 'Circuit breaker failure threshold (default: 5)',
    ORCHESTRATOR_HC_INTERVAL: 'Health check interval in ms (default: 30000)',
  };

  return descriptions[envVar] || `Configures ${ENV_CONFIG_MAPPING[envVar]}`;
}
