// Shared TypeScript types for the API client
// Extracted from frontend/src/api.ts

import type { AIServer } from '../types/generated/orchestrator.types';
import type { OrchestratorConfig } from '../types';

// Re-export AIServer from generated types (used throughout api.ts)
export type { AIServer };

// ==========================================
// General Types
// ==========================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

export interface ApiErrorInfo {
  message: string;
  status?: number;
  code?: string;
  details?: unknown;
}

// ==========================================
// Streaming / Progress Types
// ==========================================

export interface StreamingRequestProgress {
  id: string;
  serverId: string;
  model: string;
  startTime: number;
  chunkCount: number;
  lastChunkTime: number;
  isStalled: boolean;
}

/** SSE progress event from a model pull/copy operation */
export interface PullProgressEvent {
  type: 'progress' | 'complete' | 'error';
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  serverId?: string;
  model?: string;
  message?: string;
  error?: string;
}

// ==========================================
// Circuit Breaker Types
// ==========================================

/**
 * Supported probe endpoint types (7 endpoints from health-check-scheduler).
 * Mirrors backend ProbeEndpoint from src/probe/types.ts:9-16.
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
 * Aggregated response for GET /circuit-breakers/:serverId/:model/endpoints
 */
export interface EndpointStatesResponse {
  serverId: string;
  model: string;
  /** Array of CircuitBreakerInfo, one per known probe endpoint (7 entries) */
  endpoints: CircuitBreakerInfo[];
}

/**
 * Response shape for GET /circuit-breakers (fleet-wide listing)
 */
export interface CircuitBreakerResponse {
  success: boolean;
  circuitBreakers: CircuitBreakerInfo[];
  byState: Record<string, number>;
}

/**
 * Circuit breaker state for a server:model:endpoint tuple.
 * Uses structured fields (serverId, model, endpoint) — no composite keys.
 */
export interface CircuitBreakerInfo {
  serverId: string;
  model: string;
  endpoint?: ProbeEndpoint;
  state: 'OPEN' | 'CLOSED' | 'HALF-OPEN';
  uiState: 'OPEN' | 'CLOSED' | 'HALF-OPEN' | 'UNKNOWN';
  failureCount: number;
  successCount: number;
  totalRequestCount: number;
  blockedRequestCount: number;
  lastFailure: number;
  lastSuccess: number;
  nextRetryAt: number;
  errorRate: number;
  errorCounts: {
    retryable: number;
    'non-retryable': number;
    transient: number;
    permanent: number;
    rateLimited: number;
  };
  consecutiveSuccesses: number;
  modelType?: 'embedding' | 'generation';
  lastFailureReason?: string;
  halfOpenStartedAt?: number;
  halfOpenAttempts?: number;
  lastErrorType?: string;
  activeTestsInProgress?: number;
  // LB score calculated as if circuit was closed
  lbScore?: {
    totalScore: number;
    latencyScore: number;
    successRateScore: number;
    loadScore: number;
    capacityScore: number;
    circuitBreakerScore: number;
    timeoutScore: number;
  } | null;
}

/** Single endpoint mutation result entry */
export interface EndpointMutationResult {
  endpoint: ProbeEndpoint;
  previousState: string;
}

/** Response shape for per-endpoint mutation operations (reset, force-open, force-close, force-half-open) */
export interface EndpointMutationResponse {
  success: boolean;
  message: string;
  results: EndpointMutationResult[];
  previousStates: Record<string, string>;
  currentState: string;
  uiState: 'OPEN' | 'CLOSED' | 'HALF-OPEN';
}

// ==========================================
// Ban Management Types
// ==========================================

export interface BanEntry {
  serverId: string;
  model: string;
  reason?: string;
  bannedAt: number;
  expiresAt?: number;
}

// ==========================================
// Recovery / Analytics Types
// ==========================================

export interface RecoveryFailureSummary {
  totalServers: number;
  serversWithFailures: number;
  totalFailures: number;
  recentFailures: number;
}

export interface ServerRecoveryStats {
  serverId: string;
  failureCount: number;
  lastFailure: number;
  recoveryAttempts: number;
  successfulRecoveries: number;
}

export interface MetricsSummarySnapshot {
  timestamp: number;
  servers: {
    [serverId: string]: {
      [model: string]: {
        avgLatency: number;
        avgTokenThroughput: number;
        requestCount: number;
        errorRate: number;
      };
    };
  };
}

// ==========================================
// Config Types
// ==========================================

export interface ConfigExport {
  exportedAt: string;
  version: number;
  config: OrchestratorConfig;
}

export interface ImportConfigResult {
  success: boolean;
  message: string;
  config: OrchestratorConfig;
  mode: 'merge' | 'replace';
}

// ==========================================
// Error Event Types
// ==========================================

export interface ErrorEvent {
  id: string;
  serverId: string;
  circuitId: string;
  errorType: 'retryable' | 'non_retryable' | 'transient' | 'permanent' | 'rate_limited';
  errorMessage: string;
  timestamp: string;
  retryable: boolean;
  category: 'resource' | 'compatibility' | 'network' | 'auth' | 'config' | 'unknown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  matchedPattern: string | null;
}

export interface ErrorEventsResponse {
  success: boolean;
  count: number;
  errors: ErrorEvent[];
}

// ==========================================
// User Management Types
// ==========================================

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UserAccess {
  serverAccess: string[];
  modelAccess: Array<{ serverId: string; model: string }>;
}

export interface CreateUserData {
  username: string;
  email: string;
  password: string;
  role?: 'user' | 'admin';
}

export interface UpdateUserData {
  username?: string;
  email?: string;
  password?: string;
  role?: 'user' | 'admin';
}
