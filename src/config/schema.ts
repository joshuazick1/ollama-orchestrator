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
  type: z.enum(['ollama', 'openai', 'auto']).default('auto'),
  maxConcurrency: z.number().int().min(1).max(100).default(4),
  apiKey: z
    .string()
    .regex(/^(env:[A-Z_][A-Z0-9_]*|sk-[a-zA-Z0-9-_]*)?$/)
    .optional(),
});

/**
 * Security configuration schema
 */
export const securityConfigSchema = z.object({
  corsOrigins: z.array(z.string()).default([]),
  rateLimitWindowMs: z.number().int().min(1000).default(60000), // 1 minute
  rateLimitMax: z.number().int().min(1).default(100),
  authMustBeEnabled: z.boolean().default(false),
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
  batchFlushIntervalMs: z.number().int().min(100).default(100),
  pruneIntervalMs: z.number().int().min(0).default(300000), // 5 min; 0 disables
  maxEntries: z.number().int().min(1).default(100000), // reserved cap; prune scheduler is primary
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
  activityTimeoutMs: z.number().int().min(1000).default(60000), // 60 seconds between chunks
  stallThresholdMs: z.number().int().min(1000).default(300000), // 5 minutes - mark as stalled
  stallCheckIntervalMs: z.number().int().min(1000).default(10000), // check every 10 seconds
  maxHandoffAttempts: z.number().int().min(0).max(10).default(2), // max failover attempts
});

/**
 * Health check configuration schema
 */
export const healthCheckConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    intervalMs: z.number().int().min(1000).default(30000), // 30 seconds
    timeoutMs: z.number().int().min(1000).default(5000), // 5 seconds
    maxConcurrentChecks: z.number().int().min(1).default(10),
    retryAttempts: z.number().int().min(0).default(2),
    retryDelayMs: z.number().int().min(100).default(1000),
    recoveryIntervalMs: z.number().int().min(1000).default(60000),
    backoffMultiplier: z.number().min(1).default(1.5),
  })
  .strict();

/**
 * Tags aggregation configuration schema
 */
export const tagsConfigSchema = z.object({
  cacheTtlMs: z.number().int().min(1000).default(300000), // 5 minutes
  maxConcurrentRequests: z.number().int().min(1).default(10),
  batchDelayMs: z.number().int().min(0).default(50),
  requestTimeoutMs: z.number().int().min(1000).default(5000),
  maxCachedModels: z.number().int().min(1).default(1000), // FIFO slice cap for tags cache
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
  jitterFactor: z.number().min(0).max(1).default(0.25), // Jitter variance (0-1, default ±25%)
  maxBudget: z.number().int().min(1).default(10), // Max total retry attempts across all servers
});

/**
 * Cooldown/failure handling configuration schema
 */
export const cooldownConfigSchema = z.object({
  failureCooldownMs: z.number().int().min(1000).default(120000), // 2 minutes
  defaultMaxConcurrency: z.number().int().min(1).max(100).default(4),
});

export const debugConfigSchema = z.object({
  streamProgress: z.boolean().default(false),
});

/**
 * Rate limit configuration schema
 */
export const rateLimitConfigSchema = z.object({
  defaultRetryAfterMs: z.number().int().min(0).default(60000), // Default retry delay when no Retry-After header
  maxRetryAfterMs: z.number().int().min(0).default(300000), // Maximum retry delay cap
  enableRetryAfterHeader: z.boolean().default(true), // Whether to respect Retry-After header
  jitterFactor: z.number().min(0).max(1).default(0.25), // Jitter factor for exponential backoff (0-1, default ±25%)
});

/**
 * Load balancer configuration schema
 */
export const loadBalancerConfigSchema = z.object({
  weights: z
    .object({
      latency: z.number().min(0).max(1).default(0.17),
      successRate: z.number().min(0).max(1).default(0.17),
      load: z.number().min(0).max(1).default(0.17),
      capacity: z.number().min(0).max(1).default(0.05),
      circuitBreaker: z.number().min(0).max(1).default(0.12),
      timeout: z.number().min(0).max(1).default(0.05),
      throughput: z.number().min(0).max(1).default(0.07),
      vram: z.number().min(0).max(1).default(0.05),
      temporal: z.number().min(0).max(1).default(0.1),
      context: z.number().min(0).max(1).default(0.05),
      itl: z.number().min(0).max(1).default(0.05),
      cacheHit: z.number().min(0).max(1).default(0.05),
      promptSize: z.number().min(0).max(1).default(0.03),
      errorType: z.number().min(0).max(1).default(0.03),
    })
    .refine(
      weights => {
        const sum =
          weights.latency +
          weights.successRate +
          weights.load +
          weights.capacity +
          weights.circuitBreaker +
          weights.timeout +
          weights.throughput +
          weights.vram +
          weights.temporal +
          weights.context +
          (weights.itl ?? 0) +
          (weights.cacheHit ?? 0) +
          (weights.promptSize ?? 0) +
          (weights.errorType ?? 0);
        return Math.abs(sum - 1) < 0.001;
      },
      { message: 'Weights must sum to 1.0' }
    ),
  thresholds: z.object({
    maxP95Latency: z.number().int().min(100).default(5000),
    minSuccessRate: z.number().min(0).max(1).default(0.95),
    latencyPenalty: z.number().min(0).max(1).default(0.5),
    errorPenalty: z.number().min(0).max(1).default(0.3),
    circuitBreakerPenalty: z.number().min(0).max(1).default(0.1),
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
    chunkWeight: z.number().min(0).max(1).default(0.2), // Weight for chunk throughput
    maxChunkGapPenaltyMs: z.number().min(0).default(5000), // Max gap before penalty
    stallThresholdMs: z.number().int().min(1000).default(300000), // 5 minutes - mark as stalled after no chunks
    stallCheckIntervalMs: z.number().int().min(1000).default(10000), // Check every 10 seconds
    maxHandoffAttempts: z.number().int().min(0).max(5).default(2), // Max handoff attempts before giving up
  }),
  // Round-robin algorithm settings
  roundRobin: z.object({
    skipUnhealthy: z.boolean().default(true), // Skip unhealthy servers
    checkCapacity: z.boolean().default(true), // Skip servers at capacity
    stickySessionsTtlMs: z.number().int().min(0).default(0), // TTL for sticky sessions, 0 to disable
    maxStickySessions: z.number().int().min(1).default(10000), // LRU cap; constructor-only
  }),
  // Least-connections algorithm settings
  leastConnections: z.object({
    skipUnhealthy: z.boolean().default(true), // Skip unhealthy servers
    considerCapacity: z.boolean().default(true), // Factor in max capacity (use ratio instead of absolute)
    considerFailureRate: z.boolean().default(true), // Factor in recent failure rate
    failureRatePenalty: z.number().min(0).max(10).default(2.0), // Multiplier for failure rate penalty
  }),
  // Cross-model inference settings
  crossModelInference: z.object({
    enabled: z.boolean().default(true), // Enable cross-model inference
    useParameterSize: z.boolean().default(true), // Use same parameter size models
    minSamplesForExact: z.number().int().min(1).default(5), // Min samples before preferring exact
    fallbackWeight: z.number().min(0).max(1).default(0.5), // How much to trust inferred vs actual
  }),
  // Fallback to fastest-response kill switch for all algorithms
  fallbackToFastestResponse: z.boolean().default(false),
  // Prefix-cache-aware routing settings
  prefixCacheAware: z
    .object({
      enabled: z.boolean().default(false),
      hashTokenCount: z.number().int().min(1).default(512),
      hashBuckets: z.number().int().min(1).default(256),
    })
    .default({ enabled: false, hashTokenCount: 512, hashBuckets: 256 }),
  // SLO fallback mode settings
  sloFallback: z
    .object({
      enabled: z.boolean().default(false),
      ttftThresholdMs: z.number().int().min(100).default(2000),
      p95WindowMs: z.number().int().min(1000).default(60000),
    })
    .default({ enabled: false, ttftThresholdMs: 2000, p95WindowMs: 60000 }),
  // Token-weighted load tracking settings
  tokenWeightedLoad: z
    .object({
      enabled: z.boolean().default(true),
      promptTokenWeight: z.number().min(0).default(1.0),
      outputTokenWeight: z.number().min(0).default(4.0),
    })
    .default({ enabled: true, promptTokenWeight: 1.0, outputTokenWeight: 4.0 }),
  // Cold start magnitude tracking settings
  coldStartMagnitude: z
    .object({
      enabled: z.boolean().default(true),
      thresholdMs: z.number().int().min(100).default(1000),
      penaltyDurationMs: z.number().int().min(1000).default(60000),
    })
    .default({ enabled: true, thresholdMs: 1000, penaltyDurationMs: 60000 }),
  // Ghost server cleanup settings
  ghostServers: z
    .object({
      staleThresholdMs: z.number().int().min(60000).default(300000), // 5 minutes - PS poll shows 0 models for this duration = ghost
      removeOnCleanup: z.boolean().default(false), // Whether to auto-remove ghosts (default false, just mark)
    })
    .default({ staleThresholdMs: 300000, removeOnCleanup: false }),
});

/**
 * Circuit breaker thresholds configuration schema
 * Simplified threshold values for circuit breaker behavior
 */
export const circuitBreakerThresholdsConfigSchema = z.object({
  failureThreshold: z.number().int().min(1).default(5), // Number of failures before opening
  openTimeout: z.number().int().min(1000).default(120000), // Time to stay open before trying half-open (ms)
  halfOpenTimeout: z.number().int().min(1000).default(300000), // Time to stay in half-open before reverting (ms)
  recoverySuccessThreshold: z.number().int().min(1).default(5), // Consecutive successes needed to close
  errorWindow: z.number().int().min(1000).default(60000), // Time window for error rate calculation (ms)
  errorRateThreshold: z.number().min(0).max(1).default(0.3), // Error rate (0-1) that triggers open state
});

/**
 * Circuit breaker configuration schema
 */
export const circuitBreakerConfigSchema = z.object({
  baseFailureThreshold: z.number().int().min(1).default(5),
  maxFailureThreshold: z.number().int().min(1).default(10),
  minFailureThreshold: z.number().int().min(1).default(3),
  openTimeout: z.number().int().min(1000).default(120000), // 2 minutes
  halfOpenTimeout: z.number().int().min(1000).default(300000), // 5 minutes - match activeTestTimeout
  recoverySuccessThreshold: z.number().int().min(1).default(3),
  activeTestTimeout: z.number().int().min(5000).max(600000).default(300000), // 5 minutes
  maxHalfOpenPerServer: z.number().int().min(1).max(20).default(3),
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
  rateLimitFailureThreshold: z.number().int().min(1).default(2),
  backoff: z
    .object({
      standardDelaysMs: z
        .array(z.number().int().min(0))
        .default([30000, 60000, 120000, 240000, 480000, 900000, 1800000, 1800000]),
      permanentDelaysMs: z
        .array(z.number().int().min(0))
        .default([300000, 600000, 1200000, 2400000, 3600000]),
      rateLimitBaseMs: z.number().int().min(0).default(300000),
      rateLimitMultiplier: z.number().min(1).default(3),
      rateLimitMaxMs: z.number().int().min(0).default(3600000),
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
  contextLimitTtlMs: z.number().int().min(1000).default(86400000), // 24 hours
});

/**
 * TimeoutManager configuration schema
 */
export const timeoutConfigSchema = z.object({
  /** Default timeout for new server:model pairs (ms) */
  defaultTimeoutMs: z.number().int().min(1000).default(120000), // 2 minutes
  /** Minimum allowed timeout (ms) */
  minTimeoutMs: z.number().int().min(1000).default(15000), // 15 seconds
  /** Maximum allowed timeout (ms) */
  maxTimeoutMs: z.number().int().min(1000).default(600000), // 10 minutes
  /** Timeout multiplier for recovery/active-test requests */
  recoveryTestMultiplier: z.number().min(1).default(3),
  /** Timeout multiplier for normal (non-test) requests */
  normalRequestMultiplier: z.number().min(1).default(2),
  /**
   * Decay rate per millisecond toward baseTimeout.
   * Default: 5% reduction every 5 minutes ≈ 1.67e-7 per ms.
   * Set to 0 to disable decay.
   */
  decayRatePerMs: z.number().min(0).default(1.67e-7),
  /**
   * Stall detection threshold multiplier applied to the effective timeout.
   * A stream is considered stalled when no chunks arrive for
   * `effectiveTimeout * stallThresholdMultiplier` milliseconds.
   * Default: 1.5x (stream stalled after 1.5x the timeout gap)
   */
  stallThresholdMultiplier: z.number().min(1).default(1.5),
  /**
   * Cap for stall threshold in milliseconds.
   * Prevents excessively long stall detection windows.
   * Default: 120000 (2 minutes)
   */
  stallThresholdCapMs: z.number().int().min(1000).default(120000),
});

/**
 * Recovery test configuration schema
 */
export const recoveryTestConfigSchema = z.object({
  /** Minimum ms between recovery tests on the same server */
  serverCooldownMs: z.number().int().min(0).default(10000), // 10 seconds
  /** Maximum ms to wait for in-flight requests to clear before testing */
  maxWaitForInFlightMs: z.number().int().min(0).default(5000), // 5 seconds
  /** Timeout for model-level inference recovery tests (ms) */
  modelTestTimeoutMs: z.number().int().min(1000).default(120000), // 120 seconds
  /** Timeout for lightweight /api/tags recovery tests (ms) */
  tagsTestTimeoutMs: z.number().int().min(1000).default(5000), // 5 seconds
  /** Number of tokens to use in active test prompts */
  testPromptTokens: z.number().int().min(1).default(256),
});

/**
 * Storage retention configuration schema
 */
export const storageRetentionConfigSchema = z.object({
  /** Days to retain individual request rows */
  requests: z.number().int().min(1).default(30),
  /** Days to retain decision + candidate rows */
  decisions: z.number().int().min(1).default(30),
  /** Days to retain hourly/daily rollup rows */
  rollups: z.number().int().min(1).default(90),
  /** Trailing days used to build temporal profiles */
  profiles: z.number().int().min(1).default(14),
});

/**
 * Storage performance configuration schema
 */
export const storagePerformanceConfigSchema = z.object({
  /** Max requests buffered before forced flush */
  batchSize: z.number().int().min(1).default(100),
  /** Max ms between forced flushes */
  batchFlushIntervalMs: z.number().int().min(100).default(100),
  /** Minutes past the hour before rollup runs regardless of in-flight count */
  rollupDeadlineMinutes: z.number().int().min(1).default(10),
  /** Ms between daily profile rebuild jobs */
  profileRebuildIntervalMs: z.number().int().min(60000).default(86400000), // 24 hours
  /** Ms between retention pruning runs */
  retentionCheckIntervalMs: z.number().int().min(60000).default(3600000), // 1 hour
});

/**
 * Storage temporal configuration schema
 */
export const storageTemporalConfigSchema = z.object({
  /** Enable temporal scoring adjustments in load balancer */
  enabled: z.boolean().default(true),
  /** Minimum confidence to apply temporal adjustment */
  minConfidence: z.number().min(0).max(1).default(0.3),
  /** Maximum latency multiplier from temporal scoring */
  maxAdjustment: z.number().min(1).default(2.0),
  /** Log-only shadow mode — adjustments not applied to routing */
  shadowMode: z.boolean().default(false),
  /** Confidence multiplier for model-wide Level 2 fallback */
  modelFallbackConfidence: z.number().min(0).max(1).default(0.6),
  /** Confidence multiplier for server-wide Level 3 fallback */
  serverFallbackConfidence: z.number().min(0).max(1).default(0.4),
});

/**
 * Storage configuration schema
 */
export const storageConfigSchema = z.object({
  /** Path to the SQLite database file */
  dbPath: z.string().default('./data/metrics.db'),
  retention: storageRetentionConfigSchema,
  performance: storagePerformanceConfigSchema,
  temporal: storageTemporalConfigSchema,
});

/**
 * Probe scheduler configuration schema
 */
export const probeSchedulerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().min(60000).default(3600000),
  maxConcurrentProbes: z.number().int().min(1).max(10).default(2),
  maxProbesPerServer: z.number().int().min(1).max(5).default(1),
  probeTimeoutMs: z.number().int().min(5000).max(300000).default(30000),
  cooldownAfterUserRequestMs: z.number().int().min(0).default(300000),
  minSamplesForCoverage: z.number().int().min(1).default(5),
  onlyDuringLowTraffic: z.boolean().default(true),
  lowTrafficThreshold: z.number().min(0).max(1).default(0.3),
});

/**
 * Probe configuration schema (replaces circuitBreaker per-server health probing)
 */
export const probeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().positive().default(30000),
  suspectAfterFailures: z.number().int().positive().default(1),
  unhealthyAfterFailures: z.number().int().positive().default(3),
  errorRateSuspectThreshold: z.number().min(0).max(1).default(0.3),
  errorRateUnhealthyThreshold: z.number().min(0).max(1).default(0.7),
  suspectWindowMs: z.number().int().positive().default(60000),
  recoveryBackoffMs: z
    .array(z.number().int().positive())
    .default([10000, 30000, 60000, 300000, 900000]),
  recoverySuccessThreshold: z.number().int().positive().default(5),
  probeTimeoutMs: z.number().int().positive().default(5000),
  maxConcurrentProbes: z.number().int().positive().default(10),
  snapshotIntervalMs: z.number().int().positive().default(300000),
  walTruncateThreshold: z.number().int().positive().default(10000),
});

/**
 * Capability probe configuration schema for periodic negative probing.
 */
export const capabilityProbeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().min(60000).default(300000), // 5 minutes
  consecutiveFailureThreshold: z.number().int().min(1).default(3),
  requestTimeoutMs: z.number().int().min(1000).default(5000),
  staggerOffsetMs: z.number().int().min(0).default(30000), // 0-30s per server stagger
  allowPrivateNetwork: z.boolean().default(false),
});

export const errorAggregatorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  rateLimitThreshold: z.number().int().min(2).default(5),
  timeWindowMs: z.number().int().min(1000).default(10000),
  clusterBackoffMs: z.number().int().default(30000),
  clusterSize: z.number().int().min(1).optional(),
});

export const adaptiveWeightTunerConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export const recoveryBackoffConfigSchema = z.object({
  modelCapability: z.array(z.number().int().min(0)).default([30000, 30000]),
  modelFile: z.array(z.number().int().min(0)).default([60000, 300000, 600000]),
  permanent: z.array(z.number().int().min(0)).default([300000, 600000, 1200000, 2400000, 3600000]),
  standard: z
    .array(z.number().int().min(0))
    .default([30000, 60000, 120000, 240000, 480000, 900000, 1800000, 1800000]),
});

/**
 * Anthropic cache metrics configuration schema
 */
export const anthropicCacheMetricsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  savingsRatePerToken: z.number().min(0).default(0.0001),
});

export type AnthropicCacheMetricsConfig = z.infer<typeof anthropicCacheMetricsConfigSchema>;

/**
 * Anthropic image configuration schema
 */
export const anthropicImageConfigSchema = z.object({
  maxImageBytes: z
    .number()
    .int()
    .min(1)
    .default(5 * 1024 * 1024), // 5MB default
});

export type AnthropicImageConfig = z.infer<typeof anthropicImageConfigSchema>;

/**
 * Anthropic configuration schema
 */
export const anthropicConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  supportedFeatures: z.array(z.string()).default([]),
  modelsCacheTtlMs: z.number().int().min(1000).default(30000), // 30s default
  cacheMetrics: anthropicCacheMetricsConfigSchema.default({
    enabled: true,
    savingsRatePerToken: 0.0001,
  }),
  thinkingAutoDisable: z.boolean().default(true),
  maxImageBytes: z
    .number()
    .int()
    .min(1)
    .default(5 * 1024 * 1024), // 5MB default
  /**
   * Lifecycle mode controls which server types can use Anthropic lifecycle endpoints.
   * - 'saas-only': Only /v1/models listing; lifecycle endpoints (like /messages) return 404 for SaaS
   * - 'self-hosted-only': Full lifecycle support; /v1/models only includes self-hosted servers
   * - 'both': Detect server type per-request; return 501 for SaaS on lifecycle endpoints (default)
   */
  lifecycleMode: z.enum(['saas-only', 'self-hosted-only', 'both']).default('both'),
});

/**
 * Main orchestrator configuration schema
 */
export const orchestratorConfigSchema = z.object({
  // Server settings
  port: z.number().int().min(1).max(65535).default(5100),
  host: z.string().default('0.0.0.0'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Feature toggles
  enableQueue: z.boolean().default(true),
  enableCircuitBreaker: z.boolean().default(true),
  enableMetrics: z.boolean().default(true),
  enableStreaming: z.boolean().default(true),
  enablePersistence: z.boolean().default(true),

  // Total request timeout for failover (ms) - budget that aborts when exceeded
  inferenceTimeoutMs: z.number().int().min(1000).default(90000),

  // Sub-configurations
  loadBalancer: loadBalancerConfigSchema,
  circuitBreaker: circuitBreakerConfigSchema,
  security: securityConfigSchema,
  metrics: metricsConfigSchema,
  streaming: streamingConfigSchema,
  healthCheck: healthCheckConfigSchema,
  tags: tagsConfigSchema,
  retry: retryConfigSchema,
  cooldown: cooldownConfigSchema,
  rateLimit: rateLimitConfigSchema,
  modelManager: modelManagerConfigSchema,
  recoveryTest: recoveryTestConfigSchema,
  timeout: timeoutConfigSchema,
  storage: storageConfigSchema,
  probeScheduler: probeSchedulerConfigSchema,
  probe: probeConfigSchema.optional(),
  capabilityProbe: capabilityProbeConfigSchema,
  debug: debugConfigSchema,
  anthropic: anthropicConfigSchema,
  errorAggregator: errorAggregatorConfigSchema,
  adaptiveWeightTuner: z.object({
    enabled: z.boolean().default(true),
  }),
  recoveryBackoff: recoveryBackoffConfigSchema,

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
export type RateLimitConfig = z.infer<typeof rateLimitConfigSchema>;
export type LoadBalancerConfig = z.infer<typeof loadBalancerConfigSchema>;
export type CircuitBreakerConfig = z.infer<typeof circuitBreakerConfigSchema>;
export type CircuitBreakerThresholdsConfig = z.infer<typeof circuitBreakerThresholdsConfigSchema>;
export type QueueConfig = z.infer<typeof queueConfigSchema>;
export type ModelManagerConfig = z.infer<typeof modelManagerConfigSchema>;
export type RecoveryTestConfig = z.infer<typeof recoveryTestConfigSchema>;
export type StorageRetentionConfig = z.infer<typeof storageRetentionConfigSchema>;
export type StoragePerformanceConfig = z.infer<typeof storagePerformanceConfigSchema>;
export type StorageTemporalConfig = z.infer<typeof storageTemporalConfigSchema>;
export type StorageConfig = z.infer<typeof storageConfigSchema>;
export type ProbeSchedulerConfig = z.infer<typeof probeSchedulerConfigSchema>;
export type ProbeConfig = z.infer<typeof probeConfigSchema>;
export type CapabilityProbeConfig = z.infer<typeof capabilityProbeConfigSchema>;
export type DebugConfig = z.infer<typeof debugConfigSchema>;
export type AnthropicConfig = z.infer<typeof anthropicConfigSchema>;
export type ErrorAggregatorConfig = z.infer<typeof errorAggregatorConfigSchema>;
export type TimeoutConfig = z.infer<typeof timeoutConfigSchema>;
export type RecoveryBackoffConfig = z.infer<typeof recoveryBackoffConfigSchema>;
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
