// AUTO-GENERATED — do not edit. Run scripts/sync-types.sh to update.

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
  /** Queue/routing wait time in ms (time from request receipt to server selection) */
  queueWaitTime?: number;
  /** All inter-chunk gaps (ms) for ITL tracking */
  chunkGaps?: number[];
  /** Error type from classification (for error type histogram) */
  errorType?: string;
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

// =============================================================================
// Anthropic Types
// =============================================================================

/**
 * Base64-encoded image source
 */
export interface AnthropicImageSourceBase64 {
  type: 'base64';
  media_type: string;
  data: string;
  [key: string]: unknown;
}

/**
 * URL image source
 */
export interface AnthropicImageSourceUrl {
  type: 'url';
  url: string;
  media_type?: string;
  [key: string]: unknown;
}

/**
 * Image source (base64 or url)
 */
export type AnthropicImageSource = AnthropicImageSourceBase64 | AnthropicImageSourceUrl;

/**
 * Text content block
 */
export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  [key: string]: unknown;
}

/**
 * Image content block
 */
export interface AnthropicImageBlock {
  type: 'image';
  source: AnthropicImageSource;
  [key: string]: unknown;
}

/**
 * Tool use content block
 */
export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Tool result content block
 */
export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  [key: string]: unknown;
}

/**
 * Thinking content block (for extended thinking mode)
 */
export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
  [key: string]: unknown;
}

/**
 * Discriminated union of all Anthropic content block types
 */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock;

/**
 * Anthropic message with role and content
 */
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
  [key: string]: unknown;
}

/**
 * Text block for system prompt (used in array form)
 */
export interface AnthropicSystemTextBlock {
  type: 'text';
  text: string;
  [key: string]: unknown;
}

/**
 * System prompt can be a plain string or an array of text blocks
 */
export type AnthropicSystemPrompt = string | AnthropicSystemTextBlock[];

/**
 * Anthropic tool definition
 */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Tool choice configuration
 */
export interface AnthropicToolChoice {
  type: 'auto' | 'any' | 'tool';
  name?: string;
  [key: string]: unknown;
}

/**
 * Extended thinking configuration
 */
export interface AnthropicThinkingConfig {
  type: 'enabled' | 'disabled';
  budget_tokens?: number;
  [key: string]: unknown;
}

/**
 * Cache control for ephemeral caching
 */
export interface AnthropicCacheControl {
  type: 'ephemeral';
  [key: string]: unknown;
}

/**
 * Main Messages API request body
 */
export interface AnthropicMessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: AnthropicSystemPrompt;
  max_tokens: number;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  thinking?: AnthropicThinkingConfig;
  cache_control?: AnthropicCacheControl;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: Record<string, unknown>;
  stream_options?: { include_usage?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Usage statistics in the response
 */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  [key: string]: unknown;
}

/**
 * Main Messages API response body
 */
export interface AnthropicMessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence?: string;
  usage: AnthropicUsage;
  [key: string]: unknown;
}

/**
 * message_start event - first event when a message begins
 */
export interface AnthropicMessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content?: AnthropicContentBlock[];
    stop_reason?: string | null;
    stop_sequence?: string | null;
    usage?: AnthropicUsage;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * content_block_start event - when a content block begins
 */
export interface AnthropicContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block:
    | AnthropicTextBlock
    | AnthropicImageBlock
    | AnthropicToolUseBlock
    | AnthropicThinkingBlock;
  [key: string]: unknown;
}

/**
 * content_block_delta event - incremental updates to content blocks
 */
export interface AnthropicContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'input_json_delta'; partial_json: string };
  [key: string]: unknown;
}

/**
 * content_block_stop event - when a content block ends
 */
export interface AnthropicContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
  [key: string]: unknown;
}

/**
 * message_delta event - final updates to message delta
 */
export interface AnthropicMessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason?: string | null;
    stop_sequence?: string | null;
    [key: string]: unknown;
  };
  usage?: AnthropicUsage;
  [key: string]: unknown;
}

/**
 * message_stop event - final event when message is complete
 */
export interface AnthropicMessageStopEvent {
  type: 'message_stop';
  [key: string]: unknown;
}

/**
 * ping event - heartbeat for keep-alive
 */
export interface AnthropicPingEvent {
  type: 'ping';
  [key: string]: unknown;
}

/**
 * error event - indicates an error occurred
 */
export interface AnthropicErrorEvent {
  type: 'error';
  error: {
    type: string;
    message: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Union of all Anthropic stream event types
 */
export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent
  | AnthropicErrorEvent;

// =============================================================================
// OpenAI Extended Types
// =============================================================================

/**
 * Logprobs content entry for chat completion choices.
 * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-logprobs
 */
export interface OpenAILogprobsContentEntry {
  token: string;
  bytes?: number[];
  logprob: number;
  top_logprobs: Array<{
    token: string;
    bytes?: number[];
    logprob: number;
  }>;
}

/**
 * Logprobs root for chat completion.
 * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-logprobs
 */
export interface OpenAILogprobs {
  content?: OpenAILogprobsContentEntry[];
}

/**
 * Chat completion chunk choice with optional logprobs.
 * Used in streaming responses (/v1/chat/completions stream).
 * @see https://platform.openai.com/docs/api-reference/chat/streaming#chat-stream-choices
 */
export interface OpenAIChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason?: string | null;
  logprobs?: OpenAILogprobs;
}

/**
 * OpenAI Chat Completion Request with extended fields
 * @see https://platform.openai.com/docs/api-reference/chat/create
 */
export interface OpenAIChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  /** Number of chat completion choices to generate. Defaults to 1, max 10. */
  n?: number;
  /** Whether to return log probabilities of the output tokens. */
  logprobs?: boolean;
  /** Max number of top logprobs to return per token. Only meaningful when logprobs=true. */
  top_logprobs?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  /**
   * Response format constraint.
   * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-response_format
   */
  response_format?:
    | { type: 'text' }
    | { type: 'json_object' }
    | {
        type: 'json_schema';
        json_schema: {
          name: string;
          description?: string;
          schema?: object;
          strict?: boolean;
        };
      };
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: object };
  }>;
  /**
   * Whether to allow parallel function calls.
   * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-parallel_tool_calls
   */
  parallel_tool_calls?: boolean;
  /**
   * Controls which function is called. 'auto', 'none', 'required', or an explicit function object.
   * @see https://platform.openai.com/docs/api-reference/chat/create#chat-create-tool_choice
   */
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  stream_options?: { include_usage?: boolean };
}

/**
 * OpenAI Completion Request with extended fields
 * @see https://platform.openai.com/docs/api-reference/completions/create
 */
export interface OpenAICompletionRequest {
  model: string;
  prompt: string | string[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  logprobs?: number;
  top_logprobs?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  suffix?: string;
  stream_options?: { include_usage?: boolean };
}

// =============================================================================
// Provider Defaults
// Provider string values: 'deepseek', 'groq', 'vllm' flow through string types
// =============================================================================

/**
 * Known AI provider identifiers
 */
export type AIProvider = 'ollama' | 'openai' | 'deepseek' | 'groq' | 'vllm';
