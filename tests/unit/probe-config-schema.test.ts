import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  probeConfigSchema,
  orchestratorConfigSchema,
  healthCheckConfigSchema,
  circuitBreakerConfigSchema,
} from '../../src/config/schema.js';

describe('probeConfigSchema', () => {
  describe('valid config', () => {
    it('should accept empty object and apply defaults', () => {
      const result = probeConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(true);
        expect(result.data.intervalMs).toBe(30000);
        expect(result.data.suspectAfterFailures).toBe(1);
        expect(result.data.unhealthyAfterFailures).toBe(3);
        expect(result.data.errorRateSuspectThreshold).toBe(0.3);
        expect(result.data.errorRateUnhealthyThreshold).toBe(0.7);
        expect(result.data.suspectWindowMs).toBe(60000);
        expect(result.data.recoveryBackoffMs).toEqual([10000, 30000, 60000, 300000, 900000]);
        expect(result.data.recoverySuccessThreshold).toBe(5);
        expect(result.data.probeTimeoutMs).toBe(5000);
        expect(result.data.maxConcurrentProbes).toBe(10);
        expect(result.data.snapshotIntervalMs).toBe(300000);
        expect(result.data.walTruncateThreshold).toBe(10000);
      }
    });

    it('should accept full valid config', () => {
      const fullConfig = {
        enabled: false,
        intervalMs: 60000,
        suspectAfterFailures: 2,
        unhealthyAfterFailures: 5,
        errorRateSuspectThreshold: 0.4,
        errorRateUnhealthyThreshold: 0.8,
        suspectWindowMs: 120000,
        recoveryBackoffMs: [5000, 15000, 30000, 60000],
        recoverySuccessThreshold: 3,
        probeTimeoutMs: 10000,
        maxConcurrentProbes: 20,
        snapshotIntervalMs: 600000,
        walTruncateThreshold: 20000,
      };
      const result = probeConfigSchema.safeParse(fullConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(false);
        expect(result.data.intervalMs).toBe(60000);
        expect(result.data.maxConcurrentProbes).toBe(20);
      }
    });

    it('should accept partial config and merge with defaults', () => {
      const partialConfig = {
        enabled: false,
        intervalMs: 45000,
      };
      const result = probeConfigSchema.safeParse(partialConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(false);
        expect(result.data.intervalMs).toBe(45000);
        expect(result.data.suspectAfterFailures).toBe(1);
        expect(result.data.unhealthyAfterFailures).toBe(3);
      }
    });
  });

  describe('validation rules', () => {
    it('should reject negative intervalMs', () => {
      const result = probeConfigSchema.safeParse({ intervalMs: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject zero intervalMs', () => {
      const result = probeConfigSchema.safeParse({ intervalMs: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer intervalMs', () => {
      const result = probeConfigSchema.safeParse({ intervalMs: 30.5 });
      expect(result.success).toBe(false);
    });

    it('should reject errorRateSuspectThreshold > 1', () => {
      const result = probeConfigSchema.safeParse({ errorRateSuspectThreshold: 1.5 });
      expect(result.success).toBe(false);
    });

    it('should reject errorRateSuspectThreshold < 0', () => {
      const result = probeConfigSchema.safeParse({ errorRateSuspectThreshold: -0.1 });
      expect(result.success).toBe(false);
    });

    it('should reject invalid recoveryBackoffMs element', () => {
      const result = probeConfigSchema.safeParse({ recoveryBackoffMs: [10000, -30000] });
      expect(result.success).toBe(false);
    });

    it('should accept valid error rate thresholds', () => {
      const result = probeConfigSchema.safeParse({
        errorRateSuspectThreshold: 0,
        errorRateUnhealthyThreshold: 1,
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('orchestratorConfigSchema with probe', () => {
  const minimalValidConfig = {
    port: 5100,
    host: '0.0.0.0',
    logLevel: 'info' as const,
    enableQueue: true,
    enableCircuitBreaker: true,
    enableMetrics: true,
    enableStreaming: true,
    enablePersistence: true,
    inferenceTimeoutMs: 90000,
    loadBalancer: {
      weights: {
        latency: 0.14,
        successRate: 0.14,
        load: 0.14,
        capacity: 0.04,
        circuitBreaker: 0.1,
        timeout: 0.04,
        throughput: 0.06,
        vram: 0.04,
        temporal: 0.08,
        context: 0.06,
        itl: 0.05,
        cacheHit: 0.05,
        promptSize: 0.03,
        errorType: 0.03,
      },
      thresholds: {
        maxP95Latency: 5000,
        minSuccessRate: 0.95,
        latencyPenalty: 0.5,
        errorPenalty: 0.3,
        circuitBreakerPenalty: 0.1,
      },
      latencyBlendRecent: 0.6,
      latencyBlendHistorical: 0.4,
      loadFactorMultiplier: 0.5,
      defaultLatencyMs: 1000,
      defaultMaxConcurrency: 4,
      streaming: {
        ttftWeight: 0.6,
        durationWeight: 0.4,
        ttftBlendAvg: 0.5,
        ttftBlendP95: 0.5,
        durationEstimateMultiplier: 2,
        chunkWeight: 0.2,
        maxChunkGapPenaltyMs: 5000,
        stallThresholdMs: 300000,
        stallCheckIntervalMs: 10000,
        maxHandoffAttempts: 2,
      },
      roundRobin: {
        skipUnhealthy: true,
        checkCapacity: true,
        stickySessionsTtlMs: 0,
        maxStickySessions: 10000,
      },
      leastConnections: {
        skipUnhealthy: true,
        considerCapacity: true,
        considerFailureRate: true,
        failureRatePenalty: 2.0,
      },
      crossModelInference: {
        enabled: true,
        useParameterSize: true,
        minSamplesForExact: 5,
        fallbackWeight: 0.5,
      },
    },
    circuitBreaker: {
      baseFailureThreshold: 5,
      maxFailureThreshold: 10,
      minFailureThreshold: 3,
      openTimeout: 120000,
      halfOpenTimeout: 300000,
      recoverySuccessThreshold: 3,
      activeTestTimeout: 300000,
      maxHalfOpenPerServer: 3,
      errorRateWindow: 60000,
      errorRateThreshold: 0.5,
      adaptiveThresholds: true,
      errorRateSmoothing: 0.3,
      errorPatterns: {
        nonRetryable: ['not found', 'invalid'],
        transient: ['timeout', 'rate limit'],
      },
      adaptiveThresholdAdjustment: 2,
      nonRetryableRatioThreshold: 0.5,
      transientRatioThreshold: 0.7,
      rateLimitFailureThreshold: 2,
      backoff: {
        standardDelaysMs: [30000, 60000, 120000],
        permanentDelaysMs: [300000, 600000],
        rateLimitBaseMs: 300000,
        rateLimitMultiplier: 3,
        rateLimitMaxMs: 3600000,
      },
    },
    security: {
      corsOrigins: [],
      rateLimitWindowMs: 60000,
      rateLimitMax: 100,
    },
    metrics: {
      enabled: true,
      prometheusEnabled: true,
      prometheusPort: 9090,
      batchFlushIntervalMs: 100,
      pruneIntervalMs: 300000,
      maxEntries: 100000,
      decay: {
        enabled: true,
        halfLifeMs: 300000,
        minDecayFactor: 0.1,
        staleThresholdMs: 120000,
      },
    },
    streaming: {
      enabled: true,
      maxConcurrentStreams: 100,
      timeoutMs: 300000,
      bufferSize: 1024,
      activityTimeoutMs: 60000,
      stallThresholdMs: 300000,
      stallCheckIntervalMs: 10000,
      maxHandoffAttempts: 2,
      ttftWeight: 0.6,
      durationWeight: 0.4,
    },
    healthCheck: {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxConcurrentChecks: 10,
      retryAttempts: 2,
      retryDelayMs: 1000,
      recoveryIntervalMs: 60000,
      backoffMultiplier: 1.5,
    },
    tags: {
      cacheTtlMs: 300000,
      maxConcurrentRequests: 10,
      batchDelayMs: 50,
      requestTimeoutMs: 5000,
      maxCachedModels: 1000,
    },
    retry: {
      maxRetriesPerServer: 2,
      retryDelayMs: 500,
      backoffMultiplier: 2,
      maxRetryDelayMs: 5000,
      retryableStatusCodes: [503, 502, 504],
      jitterFactor: 0.25,
      maxBudget: 10,
    },
    cooldown: {
      failureCooldownMs: 120000,
      defaultMaxConcurrency: 4,
    },
    rateLimit: {
      defaultRetryAfterMs: 60000,
      maxRetryAfterMs: 300000,
      enableRetryAfterHeader: true,
      jitterFactor: 0.25,
    },
    modelManager: {
      maxRetries: 3,
      retryDelayBaseMs: 1000,
      warmupTimeoutMs: 60000,
      idleThresholdMs: 1800000,
      memorySafetyMargin: 1.2,
      gbPerBillionParams: 0.75,
      defaultModelSizeGb: 5,
      loadTimeEstimates: {
        tiny: 3000,
        small: 5000,
        medium: 10000,
        large: 20000,
        xl: 40000,
        xxl: 80000,
      },
      contextLimitTtlMs: 86400000,
    },
    recoveryTest: {
      serverCooldownMs: 10000,
      maxWaitForInFlightMs: 5000,
      modelTestTimeoutMs: 120000,
      tagsTestTimeoutMs: 5000,
      testPromptTokens: 256,
    },
    timeout: {
      defaultTimeoutMs: 120000,
      minTimeoutMs: 15000,
      maxTimeoutMs: 600000,
      recoveryTestMultiplier: 3,
      normalRequestMultiplier: 2,
      decayRatePerMs: 1.67e-7,
      stallThresholdMultiplier: 1.5,
      stallThresholdCapMs: 120000,
    },
    storage: {
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
        profileRebuildIntervalMs: 86400000,
        retentionCheckIntervalMs: 3600000,
      },
      temporal: {
        enabled: true,
        minConfidence: 0.3,
        maxAdjustment: 2.0,
        shadowMode: false,
        modelFallbackConfidence: 0.6,
        serverFallbackConfidence: 0.4,
      },
    },
    probeScheduler: {
      enabled: true,
      intervalMs: 3600000,
      maxConcurrentProbes: 2,
      maxProbesPerServer: 1,
      probeTimeoutMs: 30000,
      cooldownAfterUserRequestMs: 300000,
      minSamplesForCoverage: 5,
      onlyDuringLowTraffic: true,
      lowTrafficThreshold: 0.3,
    },
    probe: {
      enabled: true,
      intervalMs: 30000,
      suspectAfterFailures: 1,
      unhealthyAfterFailures: 3,
      errorRateSuspectThreshold: 0.3,
      errorRateUnhealthyThreshold: 0.7,
      suspectWindowMs: 60000,
      recoveryBackoffMs: [10000, 30000, 60000, 300000, 900000],
      recoverySuccessThreshold: 5,
      probeTimeoutMs: 5000,
      maxConcurrentProbes: 10,
      snapshotIntervalMs: 300000,
      walTruncateThreshold: 10000,
    },
    anthropic: {
      enabled: true,
      supportedFeatures: [],
    },
    errorAggregator: {
      enabled: true,
      rateLimitThreshold: 5,
      timeWindowMs: 10000,
      clusterBackoffMs: 30000,
    },
    adaptiveWeightTuner: {
      enabled: true,
    },
    recoveryBackoff: {
      modelCapability: [30000, 30000],
      modelFile: [60000, 300000, 600000],
      permanent: [300000, 600000, 1200000, 2400000, 3600000],
      standard: [30000, 60000, 120000, 240000, 480000, 900000, 1800000, 1800000],
    },
    servers: [],
    persistencePath: './data',
    configReloadIntervalMs: 0,
    capabilityProbe: {
      enabled: true,
      intervalMs: 300000,
      consecutiveFailureThreshold: 3,
      requestTimeoutMs: 5000,
      staggerOffsetMs: 30000,
      allowPrivateNetwork: false,
    },
    debug: {
      streamProgress: false,
    },
  };

  it('should accept orchestrator config with probe section', () => {
    const config = {
      ...minimalValidConfig,
      probe: {
        enabled: true,
        intervalMs: 30000,
      },
    };
    const result = orchestratorConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.probe).toBeDefined();
      expect(result.data.probe.enabled).toBe(true);
      expect(result.data.probe.intervalMs).toBe(30000);
    }
  });

  it('should accept orchestrator config with probe omitted (probe is optional)', () => {
    const config = { ...minimalValidConfig };
    delete (config as any).probe;
    const result = orchestratorConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should accept probe with custom values alongside all other config sections', () => {
    const config = {
      ...minimalValidConfig,
      probe: {
        enabled: false,
        intervalMs: 60000,
        suspectAfterFailures: 3,
        unhealthyAfterFailures: 7,
      },
    };
    const result = orchestratorConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.probe.enabled).toBe(false);
      expect(result.data.probe.intervalMs).toBe(60000);
      expect(result.data.probe.suspectAfterFailures).toBe(3);
      expect(result.data.probe.unhealthyAfterFailures).toBe(7);
    }
  });
});

describe('healthCheckConfigSchema without old fields', () => {
  it('should not have failureThreshold field', () => {
    const result = healthCheckConfigSchema.safeParse({
      failureThreshold: 5,
    });
    expect(result.success).toBe(false);
  });

  it('should not have successThreshold field', () => {
    const result = healthCheckConfigSchema.safeParse({
      successThreshold: 3,
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid healthCheck config without old fields', () => {
    const result = healthCheckConfigSchema.safeParse({
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxConcurrentChecks: 10,
      retryAttempts: 2,
      retryDelayMs: 1000,
      recoveryIntervalMs: 60000,
      backoffMultiplier: 1.5,
    });
    expect(result.success).toBe(true);
  });
});

describe('circuitBreakerConfigSchema without modelEscalation', () => {
  it('should not accept modelEscalation field', () => {
    const result = circuitBreakerConfigSchema.safeParse({
      modelEscalation: {
        enabled: true,
        ratioThreshold: 0.5,
        durationThresholdMs: 300000,
        checkIntervalMs: 300000,
      },
    });
    expect(result.success).toBe(false);
  });
});
