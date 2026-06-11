/**
 * factories.ts
 * Factory functions for creating test entities with customizable parameters.
 * Supports both happy-path and edge-case scenarios, including chaos presets.
 */

import type { OrchestratorConfig } from '../../src/config/config.js';
import type {
  AIServer,
  ServerModelMetrics,
  LatencyPercentiles,
  MetricsWindow,
  RequestContext,
} from '../../src/orchestrator/orchestrator.types.js';
import type { RequestRow, DecisionRow, DecisionCandidateRow } from '../../src/storage/types.js';

// ============================================================
// Server Factory
// ============================================================

export interface ServerFactoryOptions {
  id?: string;
  url?: string;
  type?: 'ollama' | 'openai' | 'auto';
  healthy?: boolean;
  lastResponseTime?: number;
  models?: string[];
  maxConcurrency?: number;
  version?: string;
  supportsOllama?: boolean;
  supportsV1?: boolean;
  supportsAnthropic?: boolean;
  v1Models?: string[];
  apiKey?: string;
  draining?: boolean;
  maintenance?: boolean;
}

export function createServer(options: ServerFactoryOptions = {}): AIServer {
  return {
    id: options.id ?? 'server-test-1',
    url: options.url ?? 'http://localhost:11434',
    type: options.type ?? 'ollama',
    healthy: options.healthy ?? true,
    lastResponseTime: options.lastResponseTime ?? 50,
    models: options.models ?? ['llama3:latest', 'mistral:latest'],
    maxConcurrency: options.maxConcurrency ?? 4,
    version: options.version,
    supportsOllama: options.supportsOllama ?? true,
    supportsV1: options.supportsV1 ?? false,
    supportsAnthropic: options.supportsAnthropic ?? false,
    v1Models: options.v1Models,
    apiKey: options.apiKey,
    draining: options.draining ?? false,
    maintenance: options.maintenance ?? false,
  };
}

export function createUnhealthyServer(options: ServerFactoryOptions = {}): AIServer {
  return createServer({
    ...options,
    healthy: false,
    lastResponseTime: Infinity,
    models: [],
    id: options.id ?? 'server-unhealthy-1',
  });
}

export function createSlowServer(options: ServerFactoryOptions = {}): AIServer {
  return createServer({
    ...options,
    id: options.id ?? 'server-slow-1',
    lastResponseTime: options.lastResponseTime ?? 2000,
    healthy: true,
  });
}

export function createFlakyServer(options: ServerFactoryOptions = {}): AIServer {
  // Flaky server appears healthy but has high lastResponseTime variance
  return createServer({
    ...options,
    id: options.id ?? 'server-flaky-1',
    healthy: true,
    lastResponseTime: options.lastResponseTime ?? 100,
  });
}

export function createDegradedServer(options: ServerFactoryOptions = {}): AIServer {
  return createServer({
    ...options,
    id: options.id ?? 'server-degraded-1',
    healthy: true,
    lastResponseTime: options.lastResponseTime ?? 1500,
    maxConcurrency: options.maxConcurrency ?? 1,
  });
}

export function createDrainingServer(options: ServerFactoryOptions = {}): AIServer {
  return createServer({
    ...options,
    id: options.id ?? 'server-draining-1',
    draining: true,
    drainStartedAt: new Date(),
  });
}

export function createMaintenanceServer(options: ServerFactoryOptions = {}): AIServer {
  return createServer({
    ...options,
    id: options.id ?? 'server-maintenance-1',
    maintenance: true,
  });
}

// ============================================================
// Model Factory
// ============================================================

export interface ModelFactoryOptions {
  name?: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  parameterSize?: string;
  quantization?: string;
  family?: string;
}

export interface AIModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

export function createModel(options: ModelFactoryOptions = {}): AIModel {
  const name = options.name ?? 'llama3:latest';
  return {
    name,
    model: options.model ?? name,
    modified_at: options.modified_at ?? '2024-01-01T00:00:00Z',
    size: options.size ?? 4700000000,
    digest: options.digest ?? 'sha256:abc123',
    details: {
      parent_model: '',
      format: 'gguf',
      family: options.family ?? 'llama',
      families: options.family ? [options.family] : ['llama'],
      parameter_size: options.parameterSize ?? '8B',
      quantization_level: options.quantization ?? 'Q4_0',
    },
  };
}

export function createSmallModel(options: ModelFactoryOptions = {}): AIModel {
  return createModel({
    ...options,
    name: options.name ?? 'smollm2:135m',
    parameterSize: '134M',
    size: 270898672,
  });
}

export function createLargeModel(options: ModelFactoryOptions = {}): AIModel {
  return createModel({
    ...options,
    name: options.name ?? 'llama3:70b',
    parameterSize: '70B',
    size: 39000000000,
  });
}

// ============================================================
// User Factory
// ============================================================

export interface UserFactoryOptions {
  id?: string;
  username?: string;
  email?: string;
  role?: 'admin' | 'user' | 'readonly';
  isActive?: boolean;
  createdAt?: number;
  updatedAt?: number;
  apiKey?: string;
  apiKeyCreatedAt?: number;
  serverAccess?: string[];
  modelAccess?: Array<{ serverId: string; model: string }>;
}

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user' | 'readonly';
  is_active: boolean;
  created_at: number;
  updated_at: number;
  api_key: string | null;
  api_key_created_at: number | null;
}

export function createUser(options: UserFactoryOptions = {}): User {
  const id = options.id ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    username: options.username ?? `testuser_${id.slice(-6)}`,
    email: options.email ?? `${id}@test.local`,
    password_hash: '$2b$10$hashedpasswordplaceholder',
    role: options.role ?? 'user',
    is_active: options.isActive ?? true,
    created_at: options.createdAt ?? Date.now(),
    updated_at: options.updatedAt ?? Date.now(),
    api_key: options.apiKey ?? null,
    api_key_created_at: options.apiKeyCreatedAt ?? null,
  };
}

export function createAdminUser(options: UserFactoryOptions = {}): User {
  return createUser({ ...options, role: 'admin' });
}

export function createReadonlyUser(options: UserFactoryOptions = {}): User {
  return createUser({ ...options, role: 'readonly' });
}

export function createApiKeyUser(options: UserFactoryOptions = {}): User {
  return createUser({
    ...options,
    apiKey: `sk-test-${Math.random().toString(36).slice(2, 18)}`,
    apiKeyCreatedAt: Date.now(),
  });
}

// ============================================================
// Request Factory
// ============================================================

export interface RequestFactoryOptions {
  id?: string;
  parentRequestId?: string;
  isRetry?: boolean;
  timestamp?: number;
  serverId?: string;
  model?: string;
  endpoint?: 'generate' | 'chat' | 'embeddings';
  streaming?: boolean;
  success?: boolean;
  durationMs?: number;
  errorType?: string;
  errorMessage?: string;
  tokensPrompt?: number;
  tokensGenerated?: number;
  tokensPerSecond?: number;
  ttftMs?: number;
  streamingDurationMs?: number;
  chunkCount?: number;
  totalBytes?: number;
  isColdStart?: boolean;
  queueWaitMs?: number;
  isProbe?: boolean;
  protocol?: 'ollama' | 'openai' | 'anthropic';
}

export function createRequest(options: RequestFactoryOptions = {}): RequestRow {
  const id = options.id ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = options.timestamp ?? Date.now();
  const d = new Date(now);

  return {
    id,
    parent_request_id: options.parentRequestId ?? null,
    is_retry: options.isRetry ? 1 : 0,
    timestamp: options.timestamp ?? now,
    server_id: options.serverId ?? 'server-test-1',
    model: options.model ?? 'llama3:latest',
    endpoint: options.endpoint ?? 'chat',
    streaming: options.streaming ? 1 : 0,
    success: options.success !== undefined ? (options.success ? 1 : 0) : 1,
    duration_ms: options.durationMs ?? null,
    error_type: options.errorType ?? null,
    error_message: options.errorMessage ?? null,
    tokens_prompt: options.tokensPrompt ?? null,
    tokens_generated: options.tokensGenerated ?? null,
    tokens_per_second: options.tokensPerSecond ?? null,
    ttft_ms: options.ttftMs ?? null,
    streaming_duration_ms: options.streamingDurationMs ?? null,
    chunk_count: options.chunkCount ?? null,
    total_bytes: options.totalBytes ?? null,
    max_chunk_gap_ms: null,
    avg_chunk_size_bytes: null,
    eval_duration: null,
    prompt_eval_duration: null,
    total_duration: null,
    load_duration: null,
    is_cold_start: options.isColdStart ? 1 : 0,
    queue_wait_ms: options.queueWaitMs ?? null,
    is_probe: options.isProbe ? 1 : 0,
    hour_of_day: d.getHours(),
    day_of_week: d.getDay(),
    date_str: d.toISOString().split('T')[0],
  };
}

export function createFailedRequest(options: RequestFactoryOptions = {}): RequestRow {
  return createRequest({
    ...options,
    success: false,
    errorType: options.errorType ?? 'timeout',
    errorMessage: options.errorMessage ?? 'Request timeout',
    durationMs: options.durationMs ?? 30000,
  });
}

export function createColdStartRequest(options: RequestFactoryOptions = {}): RequestRow {
  return createRequest({
    ...options,
    isColdStart: true,
    durationMs: options.durationMs ?? 5000,
    load_duration: 4000000000, // 4 seconds in nanoseconds
  });
}

export function createStreamingRequest(options: RequestFactoryOptions = {}): RequestRow {
  return createRequest({
    ...options,
    streaming: true,
    ttftMs: options.ttftMs ?? 150,
    streamingDurationMs: options.streamingDurationMs ?? 2000,
    chunkCount: options.chunkCount ?? 50,
    totalBytes: options.totalBytes ?? 10240,
  });
}

// ============================================================
// Decision Factory
// ============================================================

export interface DecisionFactoryOptions {
  id?: number;
  timestamp?: number;
  model?: string;
  selectedServer?: string;
  algorithm?: string;
  selectionReason?: string;
  candidateCount?: number;
  totalScore?: number;
  latencyScore?: number;
  successRateScore?: number;
  loadScore?: number;
  capacityScore?: number;
  cbScore?: number;
  timeoutScore?: number;
  throughputScore?: number;
  vramScore?: number;
  p95Latency?: number;
  successRate?: number;
  inFlight?: number;
  throughput?: number;
}

export function createDecision(options: DecisionFactoryOptions = {}): DecisionRow {
  const now = options.timestamp ?? Date.now();
  const d = new Date(now);

  return {
    id: options.id ?? Math.floor(Math.random() * 100000),
    timestamp: now,
    model: options.model ?? 'llama3:latest',
    selected_server: options.selectedServer ?? 'server-test-1',
    algorithm: options.algorithm ?? 'weighted',
    selection_reason: options.selectionReason ?? null,
    candidate_count: options.candidateCount ?? 3,
    total_score: options.totalScore ?? 0.85,
    latency_score: options.latencyScore ?? 0.9,
    success_rate_score: options.successRateScore ?? 0.95,
    load_score: options.loadScore ?? 0.7,
    capacity_score: options.capacityScore ?? 0.8,
    cb_score: options.cbScore ?? 1.0,
    timeout_score: options.timeoutScore ?? 0.95,
    throughput_score: options.throughputScore ?? 0.75,
    vram_score: options.vramScore ?? 0.9,
    p95_latency: options.p95Latency ?? 150,
    success_rate: options.successRate ?? 0.98,
    in_flight: options.inFlight ?? 2,
    throughput: options.throughput ?? 10,
    hour_of_day: d.getHours(),
    day_of_week: d.getDay(),
  };
}

export function createDecisionCandidate(
  decisionId: number,
  options: DecisionCandidateOptions = {}
): DecisionCandidateRow {
  return {
    decision_id: decisionId,
    server_id: options.serverId ?? 'server-test-1',
    total_score: options.totalScore ?? 0.85,
    latency_score: options.latencyScore ?? 0.9,
    success_rate_score: options.successRateScore ?? 0.95,
    load_score: options.loadScore ?? 0.7,
    capacity_score: options.capacityScore ?? 0.8,
    p95_latency: options.p95Latency ?? 150,
    success_rate: options.successRate ?? 0.98,
    in_flight: options.inFlight ?? 2,
    throughput: options.throughput ?? 10,
  };
}

export interface DecisionCandidateOptions {
  serverId?: string;
  totalScore?: number;
  latencyScore?: number;
  successRateScore?: number;
  loadScore?: number;
  capacityScore?: number;
  p95Latency?: number;
  successRate?: number;
  inFlight?: number;
  throughput?: number;
}

// ============================================================
// Metrics Factory
// ============================================================

export interface MetricsFactoryOptions {
  serverId?: string;
  model?: string;
  inFlight?: number;
  queued?: number;
  count?: number;
  userRequests?: number;
  latencySum?: number;
  errors?: number;
  tokensGenerated?: number;
  tokensPrompt?: number;
  minLatency?: number;
  maxLatency?: number;
  p50?: number;
  p95?: number;
  p99?: number;
}

export function createMetricsWindow(options: Partial<MetricsWindow> = {}): MetricsWindow {
  return {
    startTime: options.startTime ?? Date.now() - 60000,
    endTime: options.endTime ?? Date.now(),
    count: options.count ?? 100,
    userRequests: options.userRequests ?? 95,
    latencySum: options.latencySum ?? 15000,
    latencySquaredSum: options.latencySquaredSum ?? 2500000,
    minLatency: options.minLatency ?? 20,
    maxLatency: options.maxLatency ?? 500,
    errors: options.errors ?? 5,
    tokensGenerated: options.tokensGenerated ?? 5000,
    tokensPrompt: options.tokensPrompt ?? 2500,
  };
}

export function createLatencyPercentiles(
  options: Partial<LatencyPercentiles> = {}
): LatencyPercentiles {
  return {
    p50: options.p50 ?? 50,
    p95: options.p95 ?? 150,
    p99: options.p99 ?? 300,
  };
}

export function createServerModelMetrics(options: MetricsFactoryOptions = {}): ServerModelMetrics {
  const windows: Record<string, MetricsWindow> = {
    '1m': createMetricsWindow({ count: 50, latencySum: 7500 }),
    '5m': createMetricsWindow({ count: 250, latencySum: 37500 }),
    '15m': createMetricsWindow({ count: 750, latencySum: 112500 }),
    '1h': createMetricsWindow({ count: 3000, latencySum: 450000 }),
    '24h': createMetricsWindow({ count: 72000, latencySum: 10800000 }),
  };

  return {
    serverId: options.serverId ?? 'server-test-1',
    model: options.model ?? 'llama3:latest',
    inFlight: options.inFlight ?? 0,
    queued: options.queued ?? 0,
    windows,
    percentiles: createLatencyPercentiles({
      p50: options.p50,
      p95: options.p95,
      p99: options.p99,
    }),
    successRate: 0.95,
    throughput: 10,
    avgTokensPerRequest: 50,
    avgPromptTokens: 25,
    avgTokensPerSecond: 25,
    coldStartCount: 5,
    lastUpdated: Date.now(),
    recentLatencies: [45, 52, 48, 55, 50, 47, 53, 49, 51, 48],
  };
}

export function createHighLatencyMetrics(options: MetricsFactoryOptions = {}): ServerModelMetrics {
  return createServerModelMetrics({
    ...options,
    p50: 500,
    p95: 2000,
    p99: 5000,
  });
}

export function createLowSuccessRateMetrics(
  options: MetricsFactoryOptions = {}
): ServerModelMetrics {
  const metrics = createServerModelMetrics(options);
  metrics.successRate = 0.7;
  metrics.windows['1m'].errors = 30;
  metrics.windows['1m'].count = 100;
  return metrics;
}

// ============================================================
// Config Factory
// ============================================================

export interface ConfigFactoryOptions {
  port?: number;
  host?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  enableQueue?: boolean;
  enableCircuitBreaker?: boolean;
  enableMetrics?: boolean;
  enableStreaming?: boolean;
  enablePersistence?: boolean;
  servers?: Array<{
    id: string;
    url: string;
    type: 'ollama' | 'openai' | 'auto';
    maxConcurrency?: number;
  }>;
}

export function createConfig(options: ConfigFactoryOptions = {}): OrchestratorConfig {
  // Import default config to use as base
  const { DEFAULT_CONFIG } = require('../../src/config/config.js');

  const config = { ...DEFAULT_CONFIG };

  if (options.port !== undefined) {
    config.port = options.port;
  }
  if (options.host !== undefined) {
    config.host = options.host;
  }
  if (options.logLevel !== undefined) {
    config.logLevel = options.logLevel;
  }
  if (options.enableQueue !== undefined) {
    config.enableQueue = options.enableQueue;
  }
  if (options.enableCircuitBreaker !== undefined) {
    config.enableCircuitBreaker = options.enableCircuitBreaker;
  }
  if (options.enableMetrics !== undefined) {
    config.enableMetrics = options.enableMetrics;
  }
  if (options.enableStreaming !== undefined) {
    config.enableStreaming = options.enableStreaming;
  }
  if (options.enablePersistence !== undefined) {
    config.enablePersistence = options.enablePersistence;
  }
  if (options.servers !== undefined) {
    config.servers = options.servers;
  }

  return config;
}

export function createMinimalConfig(): OrchestratorConfig {
  return createConfig({
    enableMetrics: false,
    enableStreaming: false,
  });
}

export function createChaosConfig(): OrchestratorConfig {
  return createConfig({
    logLevel: 'debug',
  });
}

// ============================================================
// Chaos Presets
// ============================================================

export const ChaosPresets = {
  // Server chaos presets
  createFlakyServer: (options?: ServerFactoryOptions) => createFlakyServer(options),
  createSlowServer: (options?: ServerFactoryOptions) => createSlowServer(options),
  createDegradedServer: (options?: ServerFactoryOptions) => createDegradedServer(options),
  createUnhealthyServer: (options?: ServerFactoryOptions) => createUnhealthyServer(options),

  // Metrics chaos presets
  createHighLatencyMetrics: (options?: MetricsFactoryOptions) => createHighLatencyMetrics(options),
  createLowSuccessRateMetrics: (options?: MetricsFactoryOptions) =>
    createLowSuccessRateMetrics(options),

  // Request chaos presets
  createFailedRequest: (options?: RequestFactoryOptions) => createFailedRequest(options),
  createColdStartRequest: (options?: RequestFactoryOptions) => createColdStartRequest(options),
};

// ============================================================
// Batch Factory Helpers
// ============================================================

export function createServerBatch(
  count: number,
  baseOptions: ServerFactoryOptions = {}
): AIServer[] {
  return Array.from({ length: count }, (_, i) =>
    createServer({
      ...baseOptions,
      id: baseOptions.id ? `${baseOptions.id}-${i}` : `server-${i}`,
      url: baseOptions.url ? `${baseOptions.url.replace(/:\d+$/, '')}:${11434 + i}` : undefined,
    })
  );
}

export function createRequestBatch(
  count: number,
  baseOptions: RequestFactoryOptions = {}
): RequestRow[] {
  return Array.from({ length: count }, (_, i) =>
    createRequest({
      ...baseOptions,
      timestamp: (baseOptions.timestamp ?? Date.now()) + i * 1000,
    })
  );
}

export function createDecisionBatch(
  count: number,
  baseOptions: DecisionFactoryOptions = {}
): DecisionRow[] {
  return Array.from({ length: count }, (_, i) =>
    createDecision({
      ...baseOptions,
      timestamp: (baseOptions.timestamp ?? Date.now()) - i * 60000,
      id: baseOptions.id ? baseOptions.id + i : undefined,
    })
  );
}

// ============================================================
// Randomization Helpers
// ============================================================

export function randomLatency(min = 10, max = 5000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomErrorRate(max = 0.3): number {
  return Math.random() * max;
}

export function randomSuccessRate(min = 0.5): number {
  return min + Math.random() * (1 - min);
}

export function randomTimestamp(hoursAgo = 24): number {
  return Date.now() - Math.floor(Math.random() * hoursAgo * 60 * 60 * 1000);
}
