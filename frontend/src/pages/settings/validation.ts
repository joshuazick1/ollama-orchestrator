import { z } from 'zod';

export const generalTabSchema = z.object({
  port: z.number().int().min(1).max(65535),
  host: z.string().min(1),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  inferenceTimeoutMs: z.number().int().min(1000),
  enableQueue: z.boolean(),
  enableCircuitBreaker: z.boolean(),
  enableMetrics: z.boolean(),
  enableStreaming: z.boolean(),
  enablePersistence: z.boolean(),
});

export const queueTabSchema = z.object({
  maxSize: z.number().int().min(1).max(10000),
  timeout: z.number().int().min(1000),
  priorityBoostInterval: z.number().int().min(1000),
  priorityBoostAmount: z.number().int().min(1),
  maxPriority: z.number().int().min(1),
});

export const loadBalancerWeightsSchema = z.object({
  latency: z.number().min(0).max(1),
  successRate: z.number().min(0).max(1),
  load: z.number().min(0).max(1),
  capacity: z.number().min(0).max(1),
  circuitBreaker: z.number().min(0).max(1),
  timeout: z.number().min(0).max(1),
  throughput: z.number().min(0).max(1),
  vram: z.number().min(0).max(1),
  temporal: z.number().min(0).max(1),
  context: z.number().min(0).max(1),
  itl: z.number().min(0).max(1).optional(),
  cacheHit: z.number().min(0).max(1).optional(),
  promptSize: z.number().min(0).max(1).optional(),
  errorType: z.number().min(0).max(1).optional(),
});

export const loadBalancerThresholdsSchema = z.object({
  maxP95Latency: z.number().int().min(100),
  minSuccessRate: z.number().min(0).max(1),
  latencyPenalty: z.number().min(0).max(1),
  errorPenalty: z.number().min(0).max(1),
  circuitBreakerPenalty: z.number().min(0).max(1),
});

export const loadBalancerStreamingSchema = z.object({
  ttftWeight: z.number().min(0).max(1),
  durationWeight: z.number().min(0).max(1),
  ttftBlendAvg: z.number().min(0).max(1),
  ttftBlendP95: z.number().min(0).max(1),
  durationEstimateMultiplier: z.number().min(1).max(10),
  chunkWeight: z.number().min(0).max(1),
  maxChunkGapPenaltyMs: z.number().int().min(0),
  stallThresholdMs: z.number().int().min(1000),
  stallCheckIntervalMs: z.number().int().min(1000),
  maxHandoffAttempts: z.number().int().min(0).max(5),
});

export const loadBalancerRoundRobinSchema = z.object({
  skipUnhealthy: z.boolean(),
  checkCapacity: z.boolean(),
  stickySessionsTtlMs: z.number().int().min(0),
  maxStickySessions: z.number().int().min(1),
});

export const loadBalancerLeastConnectionsSchema = z.object({
  skipUnhealthy: z.boolean(),
  considerCapacity: z.boolean(),
  considerFailureRate: z.boolean(),
  failureRatePenalty: z.number().min(0).max(10),
});

export const loadBalancerCrossModelInferenceSchema = z.object({
  enabled: z.boolean(),
  useParameterSize: z.boolean(),
  minSamplesForExact: z.number().int().min(1),
  fallbackWeight: z.number().min(0).max(1),
});

export const loadBalancerPrefixCacheAwareSchema = z.object({
  enabled: z.boolean(),
  hashTokenCount: z.number().int().min(1),
  hashBuckets: z.number().int().min(1),
});

export const loadBalancerSloFallbackSchema = z.object({
  enabled: z.boolean(),
  ttftThresholdMs: z.number().int().min(100),
  p95WindowMs: z.number().int().min(1000),
});

export const loadBalancerGhostServersSchema = z.object({
  staleThresholdMs: z.number().int().min(60000),
  removeOnCleanup: z.boolean(),
});

export const loadBalancerTokenWeightedLoadSchema = z.object({
  enabled: z.boolean(),
  promptTokenWeight: z.number().min(0),
  outputTokenWeight: z.number().min(0),
});

export const loadBalancerColdStartMagnitudeSchema = z.object({
  enabled: z.boolean(),
  thresholdMs: z.number().int().min(100),
  penaltyDurationMs: z.number().int().min(1000),
});

export const loadBalancerTabSchema = z.object({
  weights: loadBalancerWeightsSchema,
  thresholds: loadBalancerThresholdsSchema,
  latencyBlendRecent: z.number().min(0).max(1),
  latencyBlendHistorical: z.number().min(0).max(1),
  loadFactorMultiplier: z.number().min(0).max(2),
  defaultLatencyMs: z.number().int().min(100),
  defaultMaxConcurrency: z.number().int().min(1).max(100),
  streaming: loadBalancerStreamingSchema,
  roundRobin: loadBalancerRoundRobinSchema,
  leastConnections: loadBalancerLeastConnectionsSchema,
  crossModelInference: loadBalancerCrossModelInferenceSchema,
  fallbackToFastestResponse: z.boolean(),
  prefixCacheAware: loadBalancerPrefixCacheAwareSchema,
  sloFallback: loadBalancerSloFallbackSchema,
  ghostServers: loadBalancerGhostServersSchema,
  tokenWeightedLoad: loadBalancerTokenWeightedLoadSchema,
  coldStartMagnitude: loadBalancerColdStartMagnitudeSchema,
});

export const rateLimitTabSchema = z.object({
  rateLimitWindowMs: z.number().int().min(1000),
  rateLimitMax: z.number().int().min(1),
});

export const securityTabSchema = z.object({
  corsOrigins: z.array(z.string()),
  rateLimitWindowMs: z.number().int().min(1000),
  rateLimitMax: z.number().int().min(1),
  authMustBeEnabled: z.boolean(),
  apiKeyHeader: z.string().optional(),
  adminApiKeys: z.array(z.string()).optional(),
});

export const loggingTabSchema = z.object({
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
});

export const circuitBreakerTabSchema = z.object({
  baseFailureThreshold: z.number().int().min(1),
  maxFailureThreshold: z.number().int().min(1),
  minFailureThreshold: z.number().int().min(1),
  openTimeout: z.number().int().min(1000),
  halfOpenTimeout: z.number().int().min(1000),
  recoverySuccessThreshold: z.number().int().min(1),
  activeTestTimeout: z.number().int().min(5000).max(600000),
  maxHalfOpenPerServer: z.number().int().min(1).max(20),
  errorRateWindow: z.number().int().min(1000),
  errorRateThreshold: z.number().min(0).max(1),
  adaptiveThresholds: z.boolean(),
  errorRateSmoothing: z.number().min(0).max(1),
  adaptiveThresholdAdjustment: z.number().int().min(1).max(10),
  nonRetryableRatioThreshold: z.number().min(0).max(1),
  transientRatioThreshold: z.number().min(0).max(1),
  rateLimitFailureThreshold: z.number().int().min(1),
});

export const metricsDecayTabSchema = z.object({
  enabled: z.boolean(),
  halfLifeMs: z.number().int().min(1000),
  minDecayFactor: z.number().min(0).max(1),
  staleThresholdMs: z.number().int().min(1000),
});

export const metricsTabSchema = z.object({
  enabled: z.boolean(),
  prometheusEnabled: z.boolean(),
  prometheusPort: z.number().int().min(1).max(65535),
  batchFlushIntervalMs: z.number().int().min(100),
  pruneIntervalMs: z.number().int().min(0),
  maxEntries: z.number().int().min(1),
  decay: metricsDecayTabSchema,
});

export const healthCheckTabSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number().int().min(1000),
  timeoutMs: z.number().int().min(1000),
  maxConcurrentChecks: z.number().int().min(1),
  retryAttempts: z.number().int().min(0),
  retryDelayMs: z.number().int().min(100),
  recoveryIntervalMs: z.number().int().min(1000),
  backoffMultiplier: z.number().min(1),
});

export const retryTabSchema = z.object({
  maxRetriesPerServer: z.number().int().min(0),
  retryDelayMs: z.number().int().min(100),
  backoffMultiplier: z.number().min(1),
  maxRetryDelayMs: z.number().int().min(100),
  retryableStatusCodes: z.array(z.number().int()),
});

export const storageRetentionTabSchema = z.object({
  requests: z.number().int().min(1),
  decisions: z.number().int().min(1),
  rollups: z.number().int().min(1),
  profiles: z.number().int().min(1),
});

export const storagePerformanceTabSchema = z.object({
  batchSize: z.number().int().min(1),
  batchFlushIntervalMs: z.number().int().min(100),
  rollupDeadlineMinutes: z.number().int().min(1),
  profileRebuildIntervalMs: z.number().int().min(60000),
  retentionCheckIntervalMs: z.number().int().min(60000),
});

export const storageTemporalTabSchema = z.object({
  enabled: z.boolean(),
  minConfidence: z.number().min(0).max(1),
  maxAdjustment: z.number().min(1),
  shadowMode: z.boolean(),
  modelFallbackConfidence: z.number().min(0).max(1),
  serverFallbackConfidence: z.number().min(0).max(1),
});

export const storageTabSchema = z.object({
  dbPath: z.string(),
  retention: storageRetentionTabSchema,
  performance: storagePerformanceTabSchema,
  temporal: storageTemporalTabSchema,
});

export const streamingTabSchema = z.object({
  enabled: z.boolean(),
  maxConcurrentStreams: z.number().int().min(1),
  timeoutMs: z.number().int().min(1000),
  bufferSize: z.number().int().min(1),
  ttftWeight: z.number().min(0).max(1),
  durationWeight: z.number().min(0).max(1),
  activityTimeoutMs: z.number().int().min(1000),
  stallThresholdMs: z.number().int().min(1000),
  stallCheckIntervalMs: z.number().int().min(1000),
  maxHandoffAttempts: z.number().int().min(0).max(10),
});

export const modelManagerLoadTimeEstimatesSchema = z.object({
  tiny: z.number().int().min(1000),
  small: z.number().int().min(1000),
  medium: z.number().int().min(1000),
  large: z.number().int().min(1000),
  xl: z.number().int().min(1000),
  xxl: z.number().int().min(1000),
});

export const modelManagerTabSchema = z.object({
  maxRetries: z.number().int().min(0),
  retryDelayBaseMs: z.number().int().min(100),
  warmupTimeoutMs: z.number().int().min(1000),
  idleThresholdMs: z.number().int().min(1000),
  memorySafetyMargin: z.number().min(1),
  gbPerBillionParams: z.number().min(0.1),
  defaultModelSizeGb: z.number().min(0.1),
  loadTimeEstimates: modelManagerLoadTimeEstimatesSchema,
  contextLimitTtlMs: z.number().int().min(1000),
});

export const timeoutTabSchema = z.object({
  defaultTimeoutMs: z.number().int().min(1000),
  minTimeoutMs: z.number().int().min(1000),
  maxTimeoutMs: z.number().int().min(1000),
  recoveryTestMultiplier: z.number().min(1),
  normalRequestMultiplier: z.number().min(1),
  decayRatePerMs: z.number().min(0),
  stallThresholdMultiplier: z.number().min(1).max(5),
  stallThresholdCapMs: z.number().int().min(1000),
});

export const recoveryTestTabSchema = z.object({
  serverCooldownMs: z.number().int().min(0),
  maxWaitForInFlightMs: z.number().int().min(0),
  modelTestTimeoutMs: z.number().int().min(1000),
  tagsTestTimeoutMs: z.number().int().min(1000),
  testPromptTokens: z.number().int().min(1),
});

export const probeSchedulerTabSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number().int().min(60000),
  maxConcurrentProbes: z.number().int().min(1).max(10),
  maxProbesPerServer: z.number().int().min(1).max(5),
  probeTimeoutMs: z.number().int().min(5000).max(300000),
  cooldownAfterUserRequestMs: z.number().int().min(0),
  minSamplesForCoverage: z.number().int().min(1),
  onlyDuringLowTraffic: z.boolean(),
  lowTrafficThreshold: z.number().min(0).max(1),
});

export const probeTabSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number().int().positive(),
  suspectAfterFailures: z.number().int().positive(),
  unhealthyAfterFailures: z.number().int().positive(),
  errorRateSuspectThreshold: z.number().min(0).max(1),
  errorRateUnhealthyThreshold: z.number().min(0).max(1),
  suspectWindowMs: z.number().int().positive(),
  recoveryBackoffMs: z.array(z.number().int().positive()),
  recoverySuccessThreshold: z.number().int().positive(),
  probeTimeoutMs: z.number().int().positive(),
  maxConcurrentProbes: z.number().int().positive(),
  snapshotIntervalMs: z.number().int().positive(),
  walTruncateThreshold: z.number().int().positive(),
});

export const capabilityProbeTabSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number().int().min(60000),
  consecutiveFailureThreshold: z.number().int().min(1),
  requestTimeoutMs: z.number().int().min(1000),
  staggerOffsetMs: z.number().int().min(0),
  allowPrivateNetwork: z.boolean(),
});

export const errorAggregatorTabSchema = z.object({
  enabled: z.boolean(),
  rateLimitThreshold: z.number().int().min(2),
  timeWindowMs: z.number().int().min(1000),
  clusterBackoffMs: z.number().int().min(0),
});

export const adaptiveWeightTunerTabSchema = z.object({
  enabled: z.boolean(),
});

export const recoveryBackoffTabSchema = z.object({
  modelCapability: z.array(z.number().int().min(0)),
  modelFile: z.array(z.number().int().min(0)),
  permanent: z.array(z.number().int().min(0)),
  standard: z.array(z.number().int().min(0)),
});

export const debugTabSchema = z.object({
  streamProgress: z.boolean(),
});

export const anthropicTabSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  supportedFeatures: z.array(z.string()),
});

export const advancedTabSchema = z.object({
  errorAggregator: errorAggregatorTabSchema,
  adaptiveWeightTuner: adaptiveWeightTunerTabSchema,
  recoveryBackoff: recoveryBackoffTabSchema,
  debug: debugTabSchema,
  anthropic: anthropicTabSchema,
});

export type ValidationResult = {
  valid: boolean;
  errors: Record<string, string>;
};

export function validateField<T>(schema: z.ZodSchema<T>, value: unknown, fieldPath: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues.map(i => i.message).join(', ');
    throw new Error(`Validation failed for ${fieldPath}: ${message}`);
  }
  return result.data;
}

export function validateSection<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult {
  const result = schema.safeParse(data);
  if (result.success) {
    return { valid: true, errors: {} };
  }
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    errors[path] = issue.message;
  }
  return { valid: false, errors };
}
