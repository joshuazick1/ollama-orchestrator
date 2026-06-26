/**
 * orchestrator.types.ts
 * Type definitions for AI orchestrator
 */

/**
 * Structural interface for TDigest objects. Defined inline (instead of importing
 * the TDigest class from utils/tdigest.js) so that the frontend type mirror
 * produced by `scripts/sync-types.sh` is self-contained — the sync script strips
 * `import` lines, which would leave a dangling reference.
 *
 * The actual `TDigest` class in src/utils/tdigest.ts satisfies this shape via
 * structural typing, so the backend metrics-aggregator.ts can call `.add()` and
 * `.percentile()` on values stored in `tdigest` fields.
 */
export interface TDigestLike {
  add(value: number): void;
  percentile(p: number): number;
}

export interface PerSizeLatencyBucket {
  rangeMin: number;
  rangeMax: number;
  tdigest: TDigestLike;
  sampleCount: number;
  lastUpdated: number;
}

export interface LoadedModel {
  name: string;
  sizeVram: number;
  expiresAt: string;
  digest: string;
}

export interface VLLMModelMeta {
  max_model_len?: number;
  quantization?: string;
  supports_tool_calling?: boolean;
  supports_vision?: boolean;
}

export interface AIServer {
  id: string;
  url: string;
  type: 'ollama' | 'openai' | 'auto';
  lastResponseTime: number;
  models: string[];
  maxConcurrency?: number;
  version?: string;
  healthy?: boolean;
  // NEW: Endpoint capabilities
  supportsOllama?: boolean; // Whether server supports /api/* Ollama endpoints
  supportsV1?: boolean; // Whether server supports /v1/* OpenAI-compatible endpoints
  // NEW: OpenAI-compatible models (from /v1/models)
  v1Models?: string[];
  discoveredV1Models?: string[];
  // vLLM-specific metadata per model (max_model_len, quantization, etc.)
  vllmMetadata?: Record<string, VLLMModelMeta>;
  // NEW: Anthropic capability
  supportsAnthropic?: boolean; // Whether server supports /v1/messages Anthropic endpoints

  // NEW: Admin override for servers behind opaque proxies that block all probes
  forcedCapabilities?: {
    supportsOllama?: boolean;
    supportsV1?: boolean;
    supportsAnthropic?: boolean;
  };

  // NEW: Custom endpoint paths and auth per protocol
  endpointOverrides?: {
    // Custom path for Anthropic messages endpoint
    anthropic_messages?: string;
    // Custom auth config for this endpoint type
    anthropic_auth?: {
      headerName?: string; // e.g., 'x-api-key'
      headerPrefix?: string; // e.g., 'Bearer' or '' (none)
    };
    // Model name prefix for routing (e.g., 'anthropic/' for Bedrock-style)
    modelPrefix?: string;
  };

  // NEW: Optional API key for authentication
  apiKey?: string;
  deploymentName?: string;
  // Operational state
  draining?: boolean;
  maintenance?: boolean;
  recovering?: boolean;
  drainStartedAt?: Date;
  // Hardware capabilities (populated from API responses)
  hardware?: {
    totalVram?: number;
    usedVram?: number;
    loadedModels?: LoadedModel[];
    lastUpdated: Date;
  };
  // Model context limits (context_window) per model for this server
  // Can be set via config or learned from /api/show responses
  modelContextLimits?: Record<string, number>;
  // Timestamp when context limits were last fetched (for cache invalidation)
  contextLimitsFetchedAt?: number;
  serverAddedAt: number;
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
  /** Total server-level attempts (includes retries/failovers) */
  count: number;
  /** Unique user-facing requests (excludes retries/failovers) */
  userRequests: number;
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

  // ITL (inter-token latency) tracking via all gaps
  recentChunkGaps: number[];
  avgChunkGapMs: number;
  chunkGapPercentiles: LatencyPercentiles;
}

/**
 * Complete metrics for a server:model combination
 */
export interface ServerModelMetrics {
  serverId: string;
  model: string;

  // Model metadata (from /api/show)
  parameterSize?: string; // e.g., "8B", "70B"
  parameterCount?: number; // Actual parameter count (e.g., 8030261248 for 8B model)
  quantization?: string; // e.g., "Q4_K_M", "Q8_0"
  family?: string; // e.g., "llama", "mistral"
  embeddingLength?: number; // Embedding dimension (for embeddings models)

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
  /** Average prompt tokens per request (from prompt_eval_count) */
  avgPromptTokens: number;
  /** Average token generation throughput in tokens/sec (from eval_count/eval_duration) */
  avgTokensPerSecond: number;
  /** Number of cold-start requests observed (load_duration > threshold) */
  coldStartCount: number;
  /** Average network overhead in ms (client latency - server total_duration) */
  avgNetworkOverheadMs?: number;
  /** Average queue/routing wait time in ms before server selection completes */
  avgQueueWaitTimeMs?: number;

  // Wave 4: Metrics expansion fields
  /** Cold start magnitude in ms (EMA of load durations > 1000ms) */
  coldStartMagnitudeMs?: number;
  /** Average cold start magnitude (EMA, alpha=0.2) */
  avgColdStartMagnitudeMs?: number;
  /** Count of cold start events (load_duration > thresholdMs) */
  coldStartEventCount?: number;
  /** Time of last cold start event */
  lastColdStartTime?: number;

  /** Cache hit rate proxy (0-1) from prompt_eval_duration */
  cacheHitRate?: number;
  /** Baseline prompt eval duration in ms (first 20 samples) */
  baselinePromptEvalMs?: number;
  /** Current average prompt eval duration in ms (EMA, alpha=0.2) */
  avgPromptEvalDurationMs?: number;
  /** Samples collected for baseline */
  promptEvalSampleCount?: number;

  /** Latency jitter in ms (derived stddev of window-blended latencies) */
  jitterMs?: number;

  /** Error type histogram (Map<ErrorType, count>) for scoring */
  errorTypeHistogram?: Map<string, number>;

  promptSizeTTFTBuckets?: Record<string, PerSizeLatencyBucket>;

  /** Token-weighted in-flight load (prompt + output tokens) */
  tokenWeightedLoad?: number;

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
  /** Parent request ID linking retries/failovers to the original user request */
  parentRequestId?: string;
  /** Whether this is a retry attempt (not the first try for this user request) */
  isRetry?: boolean;
  /** Whether this request is a health-check probe (not a user request) */
  isProbe?: boolean;
  /** Protocol used for this request — used to interpret usage/duration fields */
  protocol?: 'ollama' | 'openai' | 'anthropic';
  firstTokenTime?: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  tokensGenerated?: number;
  tokensPrompt?: number;
  /** OpenAI-style usage: prompt tokens (input) */
  promptTokens?: number;
  /** OpenAI-style usage: completion tokens (output) */
  completionTokens?: number;
  error?: Error;
  // Streaming-specific metrics
  ttft?: number; // Time to first token in ms
  streamingDuration?: number; // Total streaming duration in ms
  // Chunk tracking
  chunkCount?: number;
  totalBytes?: number;
  maxChunkGapMs?: number;
  avgChunkSizeBytes?: number;
  // Ollama duration fields (nanoseconds, from final streaming chunk)
  evalDuration?: number; // Time spent on token generation (ns)
  promptEvalDuration?: number; // Time spent evaluating the prompt (ns)
  totalDuration?: number; // Total end-to-end duration including load (ns)
  loadDuration?: number; // Time spent loading model into memory (ns); > 0 = cold start
  // Derived from Ollama fields
  tokensPerSecond?: number; // eval_count / (eval_duration / 1e9)
  isColdStart?: boolean; // true when load_duration > cold-start threshold
  /** Anthropic-specific: stop_reason from message_delta */
  lastStopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  /** Queue/routing wait time in ms (time from request receipt to server selection) */
  queueWaitTime?: number;
  /** All inter-chunk gaps (ms) for ITL tracking */
  chunkGaps?: number[];
  /** Error type from classification (for error type histogram) */
  errorType?: string;
  /** Whether thinking was enabled for this request */
  thinkingEnabled?: boolean;
  /** Number of thinking tokens in the response (from thinking content blocks) */
  thinkingTokens?: number;
  /** Cache creation tokens from Anthropic extended thinking (cache_creation_input_tokens) */
  cacheCreationTokens?: number;
  /** Cache read tokens from Anthropic prompt caching (cache_read_input_tokens) */
  cacheReadTokens?: number;
  /** Whether thinking was auto-disabled due to upstream 400 rejection */
  thinkingAutoDisabled?: boolean;
  /** Upstream's request-id (Anthropic) or x-request-id (OpenAI) from response headers */
  upstreamRequestId?: string;
}

/**
 * Global metrics summary
 */
export interface GlobalMetrics {
  /** Total server-level attempts (includes retries/failovers) */
  totalRequests: number;
  /** Total unique user-facing requests (excludes retries/failovers) */
  totalUserRequests: number;
  totalErrors: number;
  totalTokens: number;
  requestsPerSecond: number;
  avgLatency: number;
  errorRate: number;
  streaming?: StreamingMetricsSummary;
  /** Anthropic cache metrics (cache hits, misses, savings) */
  cache?: CacheMetrics;
  /** Anthropic thinking metrics (auto-disabled count, total tokens) */
  thinking?: ThinkingMetrics;
  /** Anthropic image/vision metrics (image count, total bytes) */
  images?: ImageMetrics;
  /** Anthropic tool use metrics */
  tool?: ToolUseMetrics;
  /** OpenAI n parameter parallel completions count */
  parallelCompletionsCount?: number;
}

/**
 * Anthropic cache performance metrics
 */
export interface CacheMetrics {
  /** Number of requests that used cached tokens */
  cacheHits: number;
  /** Number of requests that created new cache but had no cache read */
  cacheMisses: number;
  /** Estimated cost savings from cache reads (in currency units) */
  cacheSavings: number;
}

/**
 * Anthropic thinking metrics
 */
export interface ThinkingMetrics {
  /** Number of requests where thinking was auto-disabled due to upstream rejection */
  thinkingAutoDisabledCount: number;
  /** Total thinking tokens recorded from responses */
  totalThinkingTokens: number;
}

/**
 * Anthropic image/vision metrics
 */
export interface ImageMetrics {
  /** Total number of images processed */
  imageCount: number;
  /** Total bytes of images processed */
  imageBytes: number;
}

/**
 * Anthropic tool use metrics
 */
export interface ToolUseMetrics {
  /** Total number of tool_use blocks encountered in streaming responses */
  toolUseCount: number;
  /** Total number of tool_result blocks encountered in request messages */
  toolResultCount: number;
  /** Unique tool names that were called */
  toolNames: string[];
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
  avgPromptTokens: number;
  avgTokensPerSecond: number;
  coldStartCount: number;
  avgNetworkOverheadMs?: number;
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
