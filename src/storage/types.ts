/**
 * types.ts
 * TypeScript types for the SQLite metrics storage layer.
 * These mirror the SQL schema defined in schema.ts.
 */

// ============================================================
// Unified error type (replaces divergent classifiers in
// analytics-engine.ts and request-history.ts)
// ============================================================
export type UnifiedErrorType =
  | 'timeout'
  | 'oom'
  | 'connection'
  | 'model_not_found'
  | 'circuit_breaker'
  | 'capacity'
  | 'rate_limited'
  | 'server_error'
  | 'unknown';

// ============================================================
// Row types (what SQLite returns)
// ============================================================

export interface RequestRow {
  id: string;
  parent_request_id: string | null;
  is_retry: number; // 0 or 1
  timestamp: number;
  server_id: string;
  model: string;
  endpoint: string;
  streaming: number; // 0 or 1

  success: number; // 0 or 1
  duration_ms: number | null;
  error_type: UnifiedErrorType | null;
  error_message: string | null;

  tokens_prompt: number | null;
  tokens_generated: number | null;
  tokens_per_second: number | null;

  ttft_ms: number | null;
  streaming_duration_ms: number | null;
  chunk_count: number | null;
  total_bytes: number | null;
  max_chunk_gap_ms: number | null;
  avg_chunk_size: number | null;

  eval_duration: number | null;
  prompt_eval_duration: number | null;
  total_duration: number | null;
  load_duration: number | null;
  is_cold_start: number; // 0 or 1

  queue_wait_ms: number | null;

  is_probe: number; // 0 or 1

  hour_of_day: number;
  day_of_week: number;
  date_str: string;
}

export interface DecisionRow {
  id: number;
  timestamp: number;
  model: string;
  selected_server: string;
  algorithm: string;
  selection_reason: string | null;
  candidate_count: number;

  total_score: number | null;
  latency_score: number | null;
  success_rate_score: number | null;
  load_score: number | null;
  capacity_score: number | null;
  cb_score: number | null;
  timeout_score: number | null;
  throughput_score: number | null;
  vram_score: number | null;

  p95_latency: number | null;
  success_rate: number | null;
  in_flight: number | null;
  throughput: number | null;

  hour_of_day: number;
  day_of_week: number;
}

export interface DecisionCandidateRow {
  decision_id: number;
  server_id: string;
  total_score: number | null;
  latency_score: number | null;
  success_rate_score: number | null;
  load_score: number | null;
  capacity_score: number | null;
  cb_score: number | null;
  timeout_score: number | null;
  throughput_score: number | null;
  vram_score: number | null;
  p95_latency: number | null;
  success_rate: number | null;
  in_flight: number | null;
  throughput: number | null;
}

export interface FailoverAttemptRow {
  id: number;
  timestamp: number;
  request_id: string;
  model: string;
  phase: number;
  server_id: string;
  result: string;
  error_type: string | null;
  latency_ms: number | null;
}

export interface HourlyRollupRow {
  server_id: string;
  model: string;
  hour_start: number;

  total_requests: number;
  user_requests: number;
  successes: number;
  failures: number;
  cold_starts: number;

  latency_sum: number;
  latency_sq_sum: number;
  latency_min: number | null;
  latency_max: number | null;
  latency_p50: number | null;
  latency_p95: number | null;
  latency_p99: number | null;

  ttft_count: number;
  ttft_sum: number;
  ttft_p50: number | null;
  ttft_p95: number | null;

  tokens_generated: number;
  tokens_prompt: number;
  avg_tokens_per_second: number | null;

  errors_timeout: number;
  errors_oom: number;
  errors_connection: number;
  errors_other: number;

  hour_of_day: number;
  day_of_week: number;
}

export interface DailyRollupRow {
  server_id: string;
  model: string;
  date_str: string;

  total_requests: number;
  user_requests: number;
  successes: number;
  failures: number;
  cold_starts: number;

  latency_sum: number;
  latency_sq_sum: number;
  latency_min: number | null;
  latency_max: number | null;
  latency_p50: number | null;
  latency_p95: number | null;
  latency_p99: number | null;

  ttft_count: number;
  ttft_sum: number;
  ttft_p50: number | null;
  ttft_p95: number | null;

  tokens_generated: number;
  tokens_prompt: number;
  avg_tokens_per_second: number | null;

  errors_timeout: number;
  errors_oom: number;
  errors_connection: number;
  errors_other: number;

  day_of_week: number;
}

export interface TemporalProfileRow {
  id: number;
  server_id: string | null;
  model: string | null;
  hour_of_day: number;
  day_of_week: number;
  profile_type: 'exact' | 'model' | 'server';

  sample_count: number;
  total_requests: number;
  avg_latency_ms: number | null;
  avg_latency_stddev: number | null;
  p95_latency_ms: number | null;
  success_rate: number | null;
  avg_tokens_per_second: number | null;
  cold_start_rate: number | null;
  avg_ttft_ms: number | null;

  confidence: number;
  updated_at: number;
}

export interface UserRow {
  id: number;
  username: string;
  email: string;
  created_at: number;
  updated_at: number;
}

export interface UserServerAccessRow {
  id: number;
  user_id: number;
  server_id: string;
  granted_at: number;
}

export interface UserModelAccessRow {
  id: number;
  user_id: number;
  model: string;
  granted_at: number;
}

// ============================================================
// Query option types
// ============================================================

export interface RequestQuery {
  serverId?: string;
  model?: string;
  endpoint?: string;
  success?: boolean;
  startTime?: number;
  endTime?: number;
  isRetry?: boolean;
  isProbe?: boolean;
  limit?: number;
  offset?: number;
}

export interface DecisionQuery {
  model?: string;
  serverId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export interface RollupQuery {
  serverId?: string;
  model?: string;
  startTime?: number;
  endTime?: number;
}

// ============================================================
// Aggregate result types
// ============================================================

export interface RequestStats {
  totalRequests: number;
  userRequests: number;
  successes: number;
  failures: number;
  errorRate: number;
  avgDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
  avgTokensPerSecond: number | null;
  coldStartCount: number;
}

export interface DecisionDetail extends DecisionRow {
  candidates: DecisionCandidateRow[];
}

// ============================================================
// Storage configuration
// ============================================================

export type {
  StorageRetentionConfig,
  StoragePerformanceConfig,
  StorageTemporalConfig,
} from '../config/config.js';

export interface MetricsStoreConfig {
  /** Path to the SQLite database file (default: './data/metrics.db') */
  dbPath: string;
  retention: import('../config/config.js').StorageRetentionConfig;
  performance: import('../config/config.js').StoragePerformanceConfig;
  temporal: import('../config/config.js').StorageTemporalConfig;
  /**
   * Callback returning the current number of in-flight requests.
   * Used by the rollup scheduler to wait for a quiet moment.
   * Defaults to () => 0 (rollup runs immediately at deadline).
   */
  getInFlightCount: () => number;
}

export const DEFAULT_STORAGE_CONFIG: MetricsStoreConfig = {
  dbPath: './data/metrics.db',
  retention: {
    requests: 30,
    decisions: 30,
    rollups: 90,
    profiles: 14,
  },
  performance: {
    batchSize: 100,
    batchFlushIntervalMs: 100,
    rollupDeadlineMinutes: 10,
    profileRebuildIntervalMs: 86_400_000,
    retentionCheckIntervalMs: 3_600_000,
  },
  temporal: {
    enabled: true,
    minConfidence: 0.3,
    maxAdjustment: 2.0,
    shadowMode: false,
    modelFallbackConfidence: 0.6,
    serverFallbackConfidence: 0.4,
  },
  getInFlightCount: () => 0,
};
