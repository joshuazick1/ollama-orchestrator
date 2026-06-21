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
}

export interface LoadBalancerThresholds {
  maxP95Latency: number;
  minSuccessRate: number;
  latencyPenalty: number;
  errorPenalty: number;
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
}

export interface CircuitBreakerErrorPatterns {
  nonRetryable: string[];
  transient: string[];
}

export interface CircuitBreakerModelEscalation {
  enabled: boolean;
  ratioThreshold: number;
  durationThresholdMs: number;
  checkIntervalMs: number;
}

export interface CircuitBreakerConfig {
  baseFailureThreshold: number;
  maxFailureThreshold: number;
  minFailureThreshold: number;
  openTimeout: number;
  halfOpenTimeout: number;
  recoverySuccessThreshold: number;
  errorRateWindow: number;
  errorRateThreshold: number;
  adaptiveThresholds: boolean;
  errorRateSmoothing: number;
  errorPatterns: CircuitBreakerErrorPatterns;
  adaptiveThresholdAdjustment: number;
  nonRetryableRatioThreshold: number;
  transientRatioThreshold: number;
  modelEscalation: CircuitBreakerModelEscalation | undefined;
}

export interface SecurityConfig {
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
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
  historyWindowMinutes: number;
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
  failureThreshold: number;
  successThreshold: number;
  backoffMultiplier: number;
}

export interface TagsConfig {
  cacheTtlMs: number;
  maxConcurrentRequests: number;
  batchDelayMs: number;
  requestTimeoutMs: number;
}

export interface RetryConfig {
  maxRetriesPerServer: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  maxRetryDelayMs: number;
  retryableStatusCodes: number[];
}

export interface CooldownConfig {
  failureCooldownMs: number;
  defaultMaxConcurrency: number;
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
  servers: AIServer[];

  // Persistence
  persistencePath: string;
  configReloadIntervalMs: number;
  storage?: StorageConfig;
}

// Shared types — sourced from backend via scripts/sync-types.sh
export type {
  LoadedModel,
  AIServer,
  ServerModelBenchmark,
  CircuitBreakerInfo,
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
