// Configuration types matching backend
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
}

export interface LoadBalancerRoundRobin {
  skipUnhealthy: boolean;
  checkCapacity: boolean;
  stickySessionsTtlMs: number;
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
  halfOpenMaxRequests: number;
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
  ttftWeight: number;
  durationWeight: number;
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
}

// ... existing types ...
export interface AIServer {
  id: string;
  url: string;
  type: 'ollama';
  healthy: boolean;
  lastResponseTime: number;
  models: string[];
  maxConcurrency?: number;
  version?: string;
  // NEW: Endpoint capabilities
  supportsOllama?: boolean;
  supportsV1?: boolean;
  // NEW: OpenAI-compatible models
  v1Models?: string[];
  // NEW: Optional API key (redacted in responses)
  apiKey?: string;
}

export interface ServerModelBenchmark {
  latencyMs: number;
  throughput: number; // requests/sec
  lastTested: number;
}

export interface CircuitBreakerState {
  failureCount: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  nextRetryAt: number;
}

// ==========================================
// Historical Metrics Types
// ==========================================

/**
 * Individual metric data point for a single request
 */
export interface MetricDataPoint {
  timestamp: number;
  duration: number;
  success: boolean;
  tokensGenerated?: number;
  tokensPrompt?: number;
  errorType?: string;
}

/**
 * Aggregated metrics for a time window
 */
export interface MetricsWindow {
  startTime: number;
  endTime: number;
  count: number;
  latencySum: number;
  latencySquaredSum: number;
  minLatency: number;
  maxLatency: number;
  errors: number;
  tokensGenerated: number;
  tokensPrompt: number;
  error?: string; // Corrected from errorType based on usage inference or standardizing
}

/**
 * Pre-calculated percentiles
 */
export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Time window names
 */
export type TimeWindow = '1m' | '5m' | '15m' | '1h';

/**
 * Streaming metrics for tracking time-to-first-token
 */
export interface StreamingMetrics {
  // TTFT (time to first token) tracking
  recentTTFTs: number[]; // Last 1000 TTFT measurements
  ttftPercentiles: LatencyPercentiles;
  avgTTFT: number;

  // Total streaming duration tracking
  recentStreamingDurations: number[];
  streamingDurationPercentiles: LatencyPercentiles;
}

/**
 * Complete metrics for a server:model combination
 */
export interface ServerModelMetrics {
  serverId: string;
  model: string;

  // Real-time stats
  inFlight: number;
  queued: number;

  // Historical windows
  windows: Record<TimeWindow, MetricsWindow>;

  // Computed percentiles
  percentiles: LatencyPercentiles;

  // Derived metrics
  successRate: number;
  throughput: number; // requests per minute
  avgTokensPerRequest: number;

  // Streaming-specific metrics
  streamingMetrics?: StreamingMetrics;

  // Last update timestamp
  lastUpdated: number;

  // Raw data points for percentile calculation (sliding window)
  recentLatencies: number[];
}

/**
 * Request context for tracking
 */
export interface RequestContext {
  id: string;
  startTime: number;
  serverId?: string;
  model: string;
  endpoint: 'generate' | 'chat' | 'embeddings';
  streaming: boolean;
  firstTokenTime?: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  tokensGenerated?: number;
  tokensPrompt?: number;
  error?: Error;
  // Streaming-specific metrics
  ttft?: number; // Time to first token in ms
  streamingDuration?: number; // Total streaming duration in ms
}

/**
 * Global metrics summary
 */
export interface GlobalMetrics {
  totalRequests: number;
  totalErrors: number;
  totalTokens: number;
  requestsPerSecond: number;
  avgLatency: number;
  errorRate: number;
}

/**
 * Metrics export format
 */
export interface MetricsExport {
  timestamp: number;
  global: GlobalMetrics;
  servers: Record<string, ServerMetricsExport>;
}

export interface ServerMetricsExport {
  healthy: boolean;
  inFlight: number;
  queued: number;
  models: Record<string, ModelMetricsExport>;
}

export interface ModelMetricsExport {
  windows: Record<TimeWindow, MetricsWindow>;
  percentiles: LatencyPercentiles;
  successRate: number;
  throughput: number;
  avgTokensPerRequest: number;
}

/**
 * Prometheus metric format
 */
export interface PrometheusMetric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  help: string;
  labels?: Record<string, string>;
  value: number;
  buckets?: Record<string, number>;
}
