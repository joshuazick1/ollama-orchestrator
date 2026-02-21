/**
 * schema.ts
 * Centralized Zod configuration schema with validation
 */

import { z } from 'zod';

/**
 * Server configuration schema
 */
export const serverConfigSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9-_]+$/),
  url: z.string().url(),
  type: z.enum(['ollama']).default('ollama'),
  maxConcurrency: z.number().int().min(1).max(1000).default(4),
  apiKey: z.string().optional(),
});

/**
 * Security configuration schema
 */
export const securityConfigSchema = z.object({
  corsOrigins: z.array(z.string()).default(['*']),
  rateLimitWindowMs: z.number().int().min(1000).default(900000), // 15 minutes
  rateLimitMax: z.number().int().min(1).default(100),
  apiKeyHeader: z.string().optional(),
  apiKeys: z.array(z.string()).optional(),
  adminApiKeys: z.array(z.string()).optional(),
});

/**
 * Metrics configuration schema
 */
/**
 * Metrics decay configuration schema
 */
export const metricsDecayConfigSchema = z.object({
  enabled: z.boolean().default(true),
  halfLifeMs: z.number().int().min(1000).default(300000), // 5 minutes
  minDecayFactor: z.number().min(0).max(1).default(0.1),
  staleThresholdMs: z.number().int().min(1000).default(120000), // 2 minutes
});

/**
 * Metrics configuration schema
 */
export const metricsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  prometheusEnabled: z.boolean().default(true),
  prometheusPort: z.number().int().min(1).max(65535).default(9090),
  historyWindowMinutes: z.number().int().min(1).default(60),
  decay: metricsDecayConfigSchema,
});

/**
 * Streaming configuration schema
 */
export const streamingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxConcurrentStreams: z.number().int().min(1).default(100),
  timeoutMs: z.number().int().min(1000).default(300000), // 5 minutes
  bufferSize: z.number().int().min(1).default(1024),
  ttftWeight: z.number().min(0).max(1).default(0.6),
  durationWeight: z.number().min(0).max(1).default(0.4),
});

/**
 * Health check configuration schema
 */
export const healthCheckConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().min(1000).default(30000), // 30 seconds
  timeoutMs: z.number().int().min(1000).default(5000), // 5 seconds
  maxConcurrentChecks: z.number().int().min(1).default(10),
  retryAttempts: z.number().int().min(0).default(2),
  retryDelayMs: z.number().int().min(100).default(1000),
  recoveryIntervalMs: z.number().int().min(1000).default(60000),
  failureThreshold: z.number().int().min(1).default(3),
  successThreshold: z.number().int().min(1).default(2),
  backoffMultiplier: z.number().min(1).default(1.5),
});

/**
 * Tags aggregation configuration schema
 */
export const tagsConfigSchema = z.object({
  cacheTtlMs: z.number().int().min(1000).default(30000), // 30 seconds
  maxConcurrentRequests: z.number().int().min(1).default(10),
  batchDelayMs: z.number().int().min(0).default(50),
  requestTimeoutMs: z.number().int().min(1000).default(5000),
});

/**
 * Retry configuration schema
 */
export const retryConfigSchema = z.object({
  maxRetriesPerServer: z.number().int().min(0).default(2),
  retryDelayMs: z.number().int().min(100).default(500),
  backoffMultiplier: z.number().min(1).default(2),
  maxRetryDelayMs: z.number().int().min(100).default(5000),
  retryableStatusCodes: z.array(z.number()).default([503, 502, 504]),
});

/**
 * Cooldown/failure handling configuration schema
 */
export const cooldownConfigSchema = z.object({
  failureCooldownMs: z.number().int().min(1000).default(120000), // 2 minutes
  defaultMaxConcurrency: z.number().int().min(1).max(100).default(4),
});

/**
 * Load balancer configuration schema
 */
export const loadBalancerConfigSchema = z.object({
  weights: z
    .object({
      latency: z.number().min(0).max(1).default(0.35),
      successRate: z.number().min(0).max(1).default(0.3),
      load: z.number().min(0).max(1).default(0.2),
      capacity: z.number().min(0).max(1).default(0.15),
    })
    .refine(
      weights => {
        const sum = weights.latency + weights.successRate + weights.load + weights.capacity;
        return Math.abs(sum - 1) < 0.001;
      },
      { message: 'Weights must sum to 1.0' }
    ),
  thresholds: z.object({
    maxP95Latency: z.number().int().min(100).default(5000),
    minSuccessRate: z.number().min(0).max(1).default(0.95),
    latencyPenalty: z.number().min(0).max(1).default(0.5),
    errorPenalty: z.number().min(0).max(1).default(0.3),
  }),
  // Latency blending: how much weight to give recent vs historical latency
  latencyBlendRecent: z.number().min(0).max(1).default(0.6), // Weight for lastResponseTime
  latencyBlendHistorical: z.number().min(0).max(1).default(0.4), // Weight for P95
  // Load factor: how much current load affects effective latency
  loadFactorMultiplier: z.number().min(0).max(2).default(0.5),
  // Default fallback latency when no data available
  defaultLatencyMs: z.number().int().min(100).default(1000),
  // Default max concurrency for servers
  defaultMaxConcurrency: z.number().int().min(1).max(100).default(4),
  // Streaming-optimized algorithm weights
  streaming: z.object({
    ttftWeight: z.number().min(0).max(1).default(0.6), // Weight for time-to-first-token
    durationWeight: z.number().min(0).max(1).default(0.4), // Weight for total duration
    ttftBlendAvg: z.number().min(0).max(1).default(0.5), // Weight for avgTTFT vs P95 TTFT
    ttftBlendP95: z.number().min(0).max(1).default(0.5), // Weight for P95 TTFT
    durationEstimateMultiplier: z.number().min(1).max(10).default(2), // Estimate duration as baseLatency * this
  }),
  // Round-robin algorithm settings
  roundRobin: z.object({
    skipUnhealthy: z.boolean().default(true), // Skip unhealthy servers
    checkCapacity: z.boolean().default(true), // Skip servers at capacity
    stickySessionsTtlMs: z.number().int().min(0).default(0), // TTL for sticky sessions, 0 to disable
  }),
  // Least-connections algorithm settings
  leastConnections: z.object({
    skipUnhealthy: z.boolean().default(true), // Skip unhealthy servers
    considerCapacity: z.boolean().default(true), // Factor in max capacity (use ratio instead of absolute)
    considerFailureRate: z.boolean().default(true), // Factor in recent failure rate
    failureRatePenalty: z.number().min(0).max(10).default(2.0), // Multiplier for failure rate penalty
  }),
});

/**
 * Circuit breaker configuration schema
 */
export const circuitBreakerConfigSchema = z.object({
  baseFailureThreshold: z.number().int().min(1).default(5),
  maxFailureThreshold: z.number().int().min(1).default(10),
  minFailureThreshold: z.number().int().min(1).default(3),
  openTimeout: z.number().int().min(1000).default(120000), // 2 minutes
  halfOpenTimeout: z.number().int().min(1000).default(60000), // 1 minute
  halfOpenMaxRequests: z.number().int().min(1).default(5),
  recoverySuccessThreshold: z.number().int().min(1).default(3),
  errorRateWindow: z.number().int().min(1000).default(60000), // 1 minute
  errorRateThreshold: z.number().min(0).max(1).default(0.5),
  adaptiveThresholds: z.boolean().default(true),
  errorRateSmoothing: z.number().min(0).max(1).default(0.3),
  // Configurable error patterns for classification
  errorPatterns: z.object({
    nonRetryable: z
      .array(z.string())
      .default([
        'not found',
        'invalid',
        'unauthorized',
        'forbidden',
        'authentication failed',
        'bad request',
        'not enough ram',
        'out of memory',
        'runner process has terminated',
        'fatal model server error',
      ]),
    transient: z
      .array(z.string())
      .default([
        'timeout',
        'temporarily unavailable',
        'rate limit',
        'too many requests',
        'service unavailable',
        'gateway timeout',
        'econnrefused',
        'econnreset',
        'etimedout',
      ]),
  }),
  // Adaptive threshold adjustment settings
  adaptiveThresholdAdjustment: z.number().int().min(1).max(10).default(2),
  nonRetryableRatioThreshold: z.number().min(0).max(1).default(0.5),
  transientRatioThreshold: z.number().min(0).max(1).default(0.7),
  // Model-to-server breaker escalation settings
  modelEscalation: z
    .object({
      enabled: z.boolean().default(true),
      ratioThreshold: z.number().min(0).max(1).default(0.5),
      durationThresholdMs: z.number().int().min(1000).default(300000), // 5 minutes
      checkIntervalMs: z.number().int().min(1000).default(300000), // 5 minutes
    })
    .optional(),
});

/**
 * Queue configuration schema
 */
export const queueConfigSchema = z.object({
  maxSize: z.number().int().min(1).max(10000).default(1000),
  timeout: z.number().int().min(1000).default(300000), // 5 minutes
  priorityBoostInterval: z.number().int().min(1000).default(5000),
  priorityBoostAmount: z.number().int().min(1).default(5),
  maxPriority: z.number().int().min(1).default(100),
});

/**
 * Model manager configuration schema
 */
export const modelManagerConfigSchema = z.object({
  maxRetries: z.number().int().min(0).default(3),
  retryDelayBaseMs: z.number().int().min(100).default(1000),
  warmupTimeoutMs: z.number().int().min(1000).default(60000),
  idleThresholdMs: z.number().int().min(1000).default(1800000), // 30 minutes
  memorySafetyMargin: z.number().min(1).default(1.2),
  gbPerBillionParams: z.number().min(0.1).default(0.75),
  defaultModelSizeGb: z.number().min(0.1).default(5), // Default model size if unknown
  loadTimeEstimates: z.object({
    tiny: z.number().int().min(1000).default(3000),
    small: z.number().int().min(1000).default(5000),
    medium: z.number().int().min(1000).default(10000),
    large: z.number().int().min(1000).default(20000),
    xl: z.number().int().min(1000).default(40000),
    xxl: z.number().int().min(1000).default(80000),
  }),
});

/**
 * Main orchestrator configuration schema
 */
export const orchestratorConfigSchema = z.object({
  // Server settings
  port: z.number().int().min(1).max(65535).default(5100),
  host: z.string().default('0.0.0.0'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  userAgent: z
    .string()
    .default(`ollama-orchestrator/${process.env.npm_package_version ?? '1.0.0'}`),

  // Feature toggles
  enableQueue: z.boolean().default(true),
  enableCircuitBreaker: z.boolean().default(true),
  enableMetrics: z.boolean().default(true),
  enableStreaming: z.boolean().default(true),
  enablePersistence: z.boolean().default(true),
  enableAuth: z.boolean().default(false),

  // Sub-configurations
  queue: queueConfigSchema,
  loadBalancer: loadBalancerConfigSchema,
  circuitBreaker: circuitBreakerConfigSchema,
  security: securityConfigSchema,
  metrics: metricsConfigSchema,
  streaming: streamingConfigSchema,
  healthCheck: healthCheckConfigSchema,
  tags: tagsConfigSchema,
  retry: retryConfigSchema,
  cooldown: cooldownConfigSchema,
  modelManager: modelManagerConfigSchema,

  // Ollama servers
  servers: z.array(serverConfigSchema).default([]),

  // Persistence
  persistencePath: z.string().default('./data'),
  configReloadIntervalMs: z.number().int().min(0).default(0), // 0 = disabled
});

// Export TypeScript types derived from schemas
export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type SecurityConfig = z.infer<typeof securityConfigSchema>;
export type MetricsDecayConfig = z.infer<typeof metricsDecayConfigSchema>;
export type MetricsConfig = z.infer<typeof metricsConfigSchema>;
export type StreamingConfig = z.infer<typeof streamingConfigSchema>;
export type HealthCheckConfig = z.infer<typeof healthCheckConfigSchema>;
export type TagsConfig = z.infer<typeof tagsConfigSchema>;
export type RetryConfig = z.infer<typeof retryConfigSchema>;
export type CooldownConfig = z.infer<typeof cooldownConfigSchema>;
export type LoadBalancerConfig = z.infer<typeof loadBalancerConfigSchema>;
export type CircuitBreakerConfig = z.infer<typeof circuitBreakerConfigSchema>;
export type QueueConfig = z.infer<typeof queueConfigSchema>;
export type ModelManagerConfig = z.infer<typeof modelManagerConfigSchema>;
export type OrchestratorConfig = z.infer<typeof orchestratorConfigSchema>;

/**
 * Validate configuration against schema
 */
export function validateConfig(config: unknown): OrchestratorConfig {
  const result = orchestratorConfigSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues.map((issue: z.ZodIssue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    throw new Error(
      `Configuration validation failed:\n${errors.map(e => `  ${e.path}: ${e.message}`).join('\n')}`
    );
  }

  return result.data;
}

/**
 * Partial validation for configuration updates
 */
export function validatePartialConfig(config: unknown): Partial<OrchestratorConfig> {
  // Create a partial schema that allows optional fields at all levels
  const partialSchema = orchestratorConfigSchema.partial();
  const result = partialSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues.map((issue: z.ZodIssue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    throw new Error(
      `Configuration update validation failed:\n${errors.map((err: { path: string; message: string }) => `  ${err.path}: ${err.message}`).join('\n')}`
    );
  }

  return result.data as Partial<OrchestratorConfig>;
}
