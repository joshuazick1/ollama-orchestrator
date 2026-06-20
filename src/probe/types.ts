/**
 * probe/types.ts
 * Type definitions for the probe subsystem (health checking + circuit breaker rewrite)
 */

/**
 * Supported probe endpoint types (7 endpoints from health-check-scheduler)
 */
export type ProbeEndpoint =
  | 'ollama_chat'
  | 'ollama_generate'
  | 'ollama_embeddings'
  | 'openai_chat'
  | 'openai_completions'
  | 'openai_embeddings'
  | 'anthropic_messages';

/**
 * Embedding-capable endpoints (support /embeddings operations).
 */
export const EMBEDDING_ENDPOINTS: readonly ProbeEndpoint[] = [
  'ollama_embeddings',
  'openai_embeddings',
];

/**
 * Generation-capable endpoints (support /chat, /generate, /completions, /messages operations).
 */
export const GENERATION_ENDPOINTS: readonly ProbeEndpoint[] = [
  'ollama_chat',
  'ollama_generate',
  'openai_chat',
  'openai_completions',
  'anthropic_messages',
];

/**
 * Well-known embedding model name patterns (case-insensitive matching).
 * Used for model-type inference when no explicit capability data is available.
 */
export const EMBEDDING_MODEL_PATTERNS: readonly string[] = [
  'nomic-embed',
  'all-minilm',
  'mxbai-embed',
  'embed',
  'embedding',
];

/**
 * Known probe endpoint values for parsing tuple keys.
 * Used by parseTupleKey to handle colons in model names.
 */
export const KNOWN_PROBE_ENDPOINTS: readonly ProbeEndpoint[] = [
  'ollama_chat',
  'ollama_generate',
  'ollama_embeddings',
  'openai_chat',
  'openai_completions',
  'openai_embeddings',
  'anthropic_messages',
];

/**
 * Internal probe state machine states
 */
export type ProbeState = 'HEALTHY' | 'SUSPECT' | 'UNHEALTHY' | 'RECOVERING';

/**
 * UI-visible circuit breaker states (mapped from internal ProbeState)
 * UNKNOWN is used when no probe data exists yet
 */
export type UIState = 'OPEN' | 'CLOSED' | 'HALF-OPEN' | 'UNKNOWN';

/**
 * A tuple identifies a unique server:model:endpoint combination
 */
export interface Tuple {
  serverId: string;
  model: string;
  endpoint: ProbeEndpoint;
}

/**
 * String key encoding a Tuple as "serverId:model:endpoint"
 * e.g., "srv1:llama3:ollama_chat"
 */
export type TupleKey = string;

/**
 * Failure classification kinds used for error categorization
 */
export type FailureKind = 'transient' | 'rate_limited' | 'non_retryable' | 'permanent' | 'timeout';

/**
 * Classified failure with retry metadata
 */
export interface Classification {
  kind: FailureKind;
  retryable: boolean;
  /** Suggested retry delay in milliseconds (for retryable failures) */
  retryAfterMs?: number;
}

/**
 * Probe lifecycle events stored in the write-ahead log
 */
export interface ProbeEvent {
  id: string;
  tupleKey: TupleKey;
  eventType: string;
  fromState: ProbeState;
  toState: ProbeState;
  reason: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/**
 * Default configuration for the probe subsystem
 */
export interface ProbeConfig {
  /** How often to run probes on healthy endpoints (ms) */
  intervalMs: number;
  /** Number of failures before marking endpoint as SUSPECT */
  suspectAfterFailures: number;
  /** Number of failures before marking endpoint as UNHEALTHY */
  unhealthyAfterFailures: number;
  /** Error rate threshold to trigger SUSPECT state */
  errorRateSuspectThreshold: number;
  /** Error rate threshold to trigger UNHEALTHY state */
  errorRateUnhealthyThreshold: number;
  /** Time window for error rate calculation (ms) */
  suspectWindowMs: number;
  /** Backoff schedule when recovering: [10s, 30s, 1m, 5m, 15m] */
  recoveryBackoffMs: number[];
  /** Consecutive successes required to transition RECOVERING → HEALTHY */
  recoverySuccessThreshold: number;
  /** Timeout for each probe request (ms) */
  probeTimeoutMs: number;
  /** Maximum concurrent probes (semaphore limit) */
  maxConcurrentProbes: number;
  /** How often to write snapshots (ms) */
  snapshotIntervalMs: number;
  /** WAL truncation threshold — keep last N events */
  walTruncateThreshold: number;
}

/** Default ProbeConfig values */
export const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  intervalMs: 30_000,
  suspectAfterFailures: 1,
  unhealthyAfterFailures: 3,
  errorRateSuspectThreshold: 0.3,
  errorRateUnhealthyThreshold: 0.7,
  suspectWindowMs: 60_000,
  recoveryBackoffMs: [10_000, 30_000, 60_000, 300_000, 900_000],
  recoverySuccessThreshold: 5,
  probeTimeoutMs: 5_000,
  maxConcurrentProbes: 10,
  snapshotIntervalMs: 300_000,
  walTruncateThreshold: 10_000,
};

/**
 * State projection mapping probe state to the frontend CircuitBreakerInfo shape.
 * Includes all 14+ fields that the frontend expects.
 */
export interface StateProjection {
  // --- Identity ---
  serverId: string;
  model: string;
  endpoint: ProbeEndpoint;
  tupleKey: TupleKey;

  // --- State ---
  state: ProbeState;
  uiState: UIState; // mapped from state

  // --- Counts ---
  failureCount: number;
  successCount: number;
  totalRequestCount: number;
  blockedRequestCount: number;
  consecutiveSuccesses: number;

  // --- Timestamps ---
  lastFailure: number;
  lastSuccess: number;
  nextRetryAt: number;
  halfOpenStartedAt: number | undefined;

  // --- Rates ---
  errorRate: number;

  // --- Error breakdown (mirrors frontend errorCounts) ---
  errorCounts: {
    retryable: number;
    'non-retryable': number;
    transient: number;
    permanent: number;
    rateLimited: number;
  };

  // --- Metadata ---
  modelType: 'embedding' | 'generation' | undefined;
  lastFailureReason: string | undefined;
  lastErrorType: string | undefined;
  halfOpenAttempts: number | undefined;
  activeTestsInProgress: number | undefined;

  // --- Load-balancer score (calculated as if circuit was closed) ---
  lbScore: {
    totalScore: number;
    latencyScore: number;
    successRateScore: number;
    loadScore: number;
    capacityScore: number;
    circuitBreakerScore: number;
    timeoutScore: number;
  } | null;
}

/**
 * Build a TupleKey string from a Tuple.
 * Format: "serverId:model:endpoint"
 */
export function tupleKey(t: Tuple): TupleKey {
  return `${t.serverId}:${t.model}:${t.endpoint}`;
}

/**
 * Parse a TupleKey string back into its component Tuple.
 * Handles colons in model names by finding the endpoint from known values.
 * @throws Error if the key does not contain a known endpoint
 */
export function parseTupleKey(k: TupleKey): Tuple {
  const parts = k.split(':');
  if (parts.length < 3) {
    throw new Error(`Invalid tuple key: "${k}" (expected "serverId:model:endpoint")`);
  }
  const endpointPart = parts[parts.length - 1];
  if (!KNOWN_PROBE_ENDPOINTS.includes(endpointPart as ProbeEndpoint)) {
    throw new Error(`Invalid tuple key: "${k}" (no valid endpoint found)`);
  }
  return {
    serverId: parts[0],
    model: parts.slice(1, parts.length - 1).join(':'),
    endpoint: endpointPart as ProbeEndpoint,
  };
}

/**
 * Map internal ProbeState to UI-visible circuit breaker state.
 * HEALTHY → CLOSED, SUSPECT → HALF-OPEN, UNHEALTHY → OPEN, RECOVERING → HALF-OPEN
 */
export function probeStateToUIState(state: ProbeState): UIState {
  switch (state) {
    case 'HEALTHY':
      return 'CLOSED';
    case 'SUSPECT':
      return 'HALF-OPEN';
    case 'UNHEALTHY':
      return 'OPEN';
    case 'RECOVERING':
      return 'HALF-OPEN';
  }
}
