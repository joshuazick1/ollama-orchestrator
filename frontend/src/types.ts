// Configuration types matching backend
export interface QueueConfig {
  maxSize: number;
  timeout: number;
  priorityBoostInterval: number;
  priorityBoostAmount: number;
}

export interface LoadBalancerConfig {
  weights: {
    latency: number;
    successRate: number;
    load: number;
    capacity: number;
  };
  thresholds: {
    maxP95Latency: number;
    minSuccessRate: number;
    latencyPenalty: number;
    errorPenalty: number;
  };
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
}

export interface SecurityConfig {
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  apiKeyHeader?: string;
  apiKeys?: string[];
}

export interface MetricsConfig {
  enabled: boolean;
  prometheusEnabled: boolean;
  prometheusPort: number;
  historyWindowMinutes: number;
}

export interface StreamingConfig {
  enabled: boolean;
  maxConcurrentStreams: number;
  timeoutMs: number;
  bufferSize: number;
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
