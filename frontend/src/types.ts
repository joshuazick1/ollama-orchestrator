import type { AIServer } from './types/generated/orchestrator.types.js';

export interface QueueConfig {
  maxSize: number;
  timeout: number;
  priorityBoostInterval: number;
  priorityBoostAmount: number;
  maxPriority: number;
}

export interface LoadBalancerWeights {
  latency: number;
  successRate: number;
  load: number;
  capacity: number;
  circuitBreaker: number;
  timeout: number;
  throughput: number;
  vram: number;
  temporal: number;
  context: number;
  itl: number;
  cacheHit: number;
  promptSize: number;
  errorType: number;
}

export interface LoadBalancerThresholds {
  maxP95Latency: number;
  minSuccessRate: number;
  latencyPenalty: number;
  errorPenalty: number;
  circuitBreakerPenalty: number;
}

export interface LoadBalancerStreaming {
  ttftWeight: number;
  durationWeight: number;
  ttftBlendAvg: number;
  ttftBlendP95: number;
  durationEstimateMultiplier: number;
  chunkWeight: number;
  maxChunkGapPenaltyMs: number;
  stallThresholdMs: number;
  stallCheckIntervalMs: number;
  maxHandoffAttempts: number;
}

export interface LoadBalancerCrossModelInference {
  enabled: boolean;
  useParameterSize: boolean;
  minSamplesForExact: number;
  fallbackWeight: number;
}

export interface LoadBalancerRoundRobin {
  skipUnhealthy: boolean;
  checkCapacity: boolean;
  stickySessionsTtlMs: number;
  maxStickySessions: number;
}

export interface LoadBalancerLeastConnections {
  skipUnhealthy: boolean;
  considerCapacity: boolean;
  considerFailureRate: boolean;
  failureRatePenalty: number;
}

export interface LoadBalancerPrefixCacheAware {
  enabled: boolean;
  hashTokenCount: number;
  hashBuckets: number;
}

export interface LoadBalancerSloFallback {
  enabled: boolean;
  ttftThresholdMs: number;
  p95WindowMs: number;
}

export interface LoadBalancerTokenWeightedLoad {
  enabled: boolean;
  promptTokenWeight: number;
  outputTokenWeight: number;
}

export interface LoadBalancerColdStartMagnitude {
  enabled: boolean;
  thresholdMs: number;
  penaltyDurationMs: number;
}

export interface LoadBalancerGhostServers {
  staleThresholdMs: number;
  removeOnCleanup: boolean;
}

export interface LoadBalancerConfig {
  weights: LoadBalancerWeights;
  thresholds: LoadBalancerThresholds;
  latencyBlendRecent: number;
  latencyBlendHistorical: number;
  loadFactorMultiplier: number;
  defaultLatencyMs: number;
  defaultMaxConcurrency: number;
  streaming: LoadBalancerStreaming;
  roundRobin: LoadBalancerRoundRobin;
  leastConnections: LoadBalancerLeastConnections;
  crossModelInference: LoadBalancerCrossModelInference;
  fallbackToFastestResponse: boolean;
  prefixCacheAware: LoadBalancerPrefixCacheAware;
  sloFallback: LoadBalancerSloFallback;
  tokenWeightedLoad: LoadBalancerTokenWeightedLoad;
  coldStartMagnitude: LoadBalancerColdStartMagnitude;
  ghostServers: LoadBalancerGhostServers;
}

export interface CircuitBreakerErrorPatterns {
  nonRetryable: string[];
  transient: string[];
}

export interface CircuitBreakerBackoff {
  standardDelaysMs: number[];
  permanentDelaysMs: number[];
  rateLimitBaseMs: number;
  rateLimitMultiplier: number;
  rateLimitMaxMs: number;
}

export interface CircuitBreakerConfig {
  baseFailureThreshold: number;
  maxFailureThreshold: number;
  minFailureThreshold: number;
  openTimeout: number;
  halfOpenTimeout: number;
  recoverySuccessThreshold: number;
  activeTestTimeout: number;
  maxHalfOpenPerServer: number;
  errorRateWindow: number;
  errorRateThreshold: number;
  adaptiveThresholds: boolean;
  errorRateSmoothing: number;
  errorPatterns: CircuitBreakerErrorPatterns;
  adaptiveThresholdAdjustment: number;
  nonRetryableRatioThreshold: number;
  transientRatioThreshold: number;
  rateLimitFailureThreshold: number;
  backoff?: CircuitBreakerBackoff;
}

export interface SecurityConfig {
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  authMustBeEnabled: boolean;
  apiKeyHeader?: string;
  apiKeys?: string[];
  adminApiKeys?: string[];
}

export interface MetricsDecay {
  enabled: boolean;
  halfLifeMs: number;
  minDecayFactor: number;
  staleThresholdMs: number;
}

export interface MetricsConfig {
  enabled: boolean;
  prometheusEnabled: boolean;
  prometheusPort: number;
  batchFlushIntervalMs: number;
  pruneIntervalMs: number;
  maxEntries: number;
  decay: MetricsDecay;
}

export interface StreamingConfig {
  enabled: boolean;
  maxConcurrentStreams: number;
  timeoutMs: number;
  bufferSize: number;
  activityTimeoutMs: number;
  ttftWeight: number;
  durationWeight: number;
  chunkWeight: number;
  maxChunkGapPenaltyMs: number;
  stallThresholdMs: number;
  stallCheckIntervalMs: number;
  maxHandoffAttempts: number;
}

export interface HealthCheckConfig {
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
  maxConcurrentChecks: number;
  retryAttempts: number;
  retryDelayMs: number;
  recoveryIntervalMs: number;
  backoffMultiplier: number;
}

export interface TagsConfig {
  cacheTtlMs: number;
  maxConcurrentRequests: number;
  batchDelayMs: number;
  requestTimeoutMs: number;
  maxCachedModels: number;
}

export interface RetryConfig {
  maxRetriesPerServer: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  maxRetryDelayMs: number;
  retryableStatusCodes: number[];
  jitterFactor: number;
  maxBudget: number;
}

export interface RateLimitConfig {
  defaultRetryAfterMs: number;
  maxRetryAfterMs: number;
  enableRetryAfterHeader: boolean;
  jitterFactor: number;
}

export interface CooldownConfig {
  failureCooldownMs: number;
  defaultMaxConcurrency: number;
}

export interface RecoveryTestConfig {
  serverCooldownMs: number;
  maxWaitForInFlightMs: number;
  modelTestTimeoutMs: number;
  tagsTestTimeoutMs: number;
  testPromptTokens: number;
}

export interface TimeoutConfig {
  defaultTimeoutMs: number;
  minTimeoutMs: number;
  maxTimeoutMs: number;
  recoveryTestMultiplier: number;
  normalRequestMultiplier: number;
  decayRatePerMs: number;
  stallThresholdMultiplier: number;
  stallThresholdCapMs: number;
}

export interface ProbeSchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  maxConcurrentProbes: number;
  maxProbesPerServer: number;
  probeTimeoutMs: number;
  cooldownAfterUserRequestMs: number;
  minSamplesForCoverage: number;
  onlyDuringLowTraffic: boolean;
  lowTrafficThreshold: number;
}

export interface ProbeConfig {
  enabled: boolean;
  intervalMs: number;
  suspectAfterFailures: number;
  unhealthyAfterFailures: number;
  errorRateSuspectThreshold: number;
  errorRateUnhealthyThreshold: number;
  suspectWindowMs: number;
  recoveryBackoffMs: number[];
  recoverySuccessThreshold: number;
  probeTimeoutMs: number;
  maxConcurrentProbes: number;
  snapshotIntervalMs: number;
  walTruncateThreshold: number;
}

export interface CapabilityProbeConfig {
  enabled: boolean;
  intervalMs: number;
  consecutiveFailureThreshold: number;
  requestTimeoutMs: number;
  staggerOffsetMs: number;
  allowPrivateNetwork: boolean;
}

export interface DebugConfig {
  streamProgress: boolean;
}

export interface AnthropicConfig {
  enabled: boolean;
  apiKey?: string;
  supportedFeatures: string[];
}

export interface ErrorAggregatorConfig {
  enabled: boolean;
  rateLimitThreshold: number;
  timeWindowMs: number;
  clusterBackoffMs: number;
}

export interface AdaptiveWeightTunerConfig {
  enabled: boolean;
}

export interface RecoveryBackoffConfig {
  modelCapability: number[];
  modelFile: number[];
  permanent: number[];
  standard: number[];
}

export interface ModelManagerLoadTimeEstimates {
  tiny: number;
  small: number;
  medium: number;
  large: number;
  xl: number;
  xxl: number;
}

export interface ModelManagerConfig {
  maxRetries: number;
  retryDelayBaseMs: number;
  warmupTimeoutMs: number;
  idleThresholdMs: number;
  memorySafetyMargin: number;
  gbPerBillionParams: number;
  defaultModelSizeGb: number;
  loadTimeEstimates: ModelManagerLoadTimeEstimates;
  contextLimitTtlMs: number;
}

export interface StorageTemporalConfig {
  enabled: boolean;
  minConfidence: number;
  maxAdjustment: number;
  shadowMode: boolean;
  modelFallbackConfidence: number;
  serverFallbackConfidence: number;
}

export interface StorageConfig {
  dbPath: string;
  retention: {
    requests: number;
    decisions: number;
    rollups: number;
    profiles: number;
  };
  performance: {
    batchSize: number;
    batchFlushIntervalMs: number;
    rollupDeadlineMinutes: number;
    profileRebuildIntervalMs: number;
    retentionCheckIntervalMs: number;
  };
  temporal: StorageTemporalConfig;
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

  inferenceTimeoutMs: number;

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
  rateLimit: RateLimitConfig;
  modelManager: ModelManagerConfig;
  recoveryTest: RecoveryTestConfig;
  timeout: TimeoutConfig;
  storage: StorageConfig;
  probeScheduler: ProbeSchedulerConfig;
  probe?: ProbeConfig;
  capabilityProbe: CapabilityProbeConfig;
  debug: DebugConfig;
  anthropic: AnthropicConfig;
  errorAggregator: ErrorAggregatorConfig;
  adaptiveWeightTuner: AdaptiveWeightTunerConfig;
  recoveryBackoff: RecoveryBackoffConfig;

  // Ollama servers
  servers: AIServer[];

  // Persistence
  persistencePath: string;
  configReloadIntervalMs: number;
}

// Shared types — sourced from backend via scripts/sync-types.sh
export type {
  LoadedModel,
  AIServer,
  ServerModelBenchmark,
  MetricDataPoint,
  MetricsWindow,
  LatencyPercentiles,
  TimeWindow,
  StreamingMetrics,
  ServerModelMetrics,
  RequestContext,
  GlobalMetrics,
  StreamingMetricsSummary,
  MetricsExport,
  ServerMetricsExport,
  ModelMetricsExport,
  PrometheusMetric,
} from './types/generated/orchestrator.types.js';
