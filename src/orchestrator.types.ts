/**
 * orchestrator.types.ts
 * Type definitions for AI orchestrator
 */

export interface LoadedModel {
  name: string;
  sizeVram: number;
  expiresAt: string;
  digest: string;
}

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
  supportsOllama?: boolean; // Whether server supports /api/* Ollama endpoints
  supportsV1?: boolean; // Whether server supports /v1/* OpenAI-compatible endpoints
  // NEW: OpenAI-compatible models (from /v1/models)
  v1Models?: string[];
  // NEW: Optional API key for authentication
  apiKey?: string;
  // Operational state
  draining?: boolean;
  maintenance?: boolean;
  drainStartedAt?: Date;
  // Hardware capabilities (populated from API responses)
  hardware?: {
    totalVram?: number;
    usedVram?: number;
    loadedModels?: LoadedModel[];
    lastUpdated: Date;
  };
  // Streaming request tracking - set temporarily during streaming requests
  _streamingRequestId?: string;
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
export type TimeWindow = '1m' | '5m' | '15m' | '1h' | '24h';

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
  avgStreamingDuration: number;

  // Chunk tracking
  recentChunkCounts: number[];
  chunkCountPercentiles: LatencyPercentiles;
  avgChunkCount: number;
  recentMaxChunkGaps: number[];
  maxChunkGapPercentiles: LatencyPercentiles;
  avgChunkSizeBytes: number;
  recentChunkSizes: number[];
  chunkSizePercentiles: LatencyPercentiles;
}

/**
 * Complete metrics for a server:model combination
 */
export interface ServerModelMetrics {
  serverId: string;
  model: string;

  // Model metadata (from /api/show)
  parameterSize?: string; // e.g., "8B", "70B"
  quantization?: string; // e.g., "Q4_K_M", "Q8_0"
  family?: string; // e.g., "llama", "mistral"

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
  // Chunk tracking
  chunkCount?: number;
  totalBytes?: number;
  maxChunkGapMs?: number;
  avgChunkSizeBytes?: number;
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
  streaming?: StreamingMetricsSummary;
}

/**
 * Aggregated streaming metrics across all server:model combinations
 */
export interface StreamingMetricsSummary {
  totalStreamingRequests: number;
  avgChunkCount: number;
  avgTTFT: number;
  avgStreamingDuration: number;
  avgChunkSizeBytes: number;
  p95ChunkGap: number;
  streamingPercentage: number;
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
  streamingMetrics?: StreamingMetrics;
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
