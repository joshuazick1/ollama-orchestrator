import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeneralTab } from '../tabs/GeneralTab';
import { QueueTab } from '../tabs/QueueTab';
import { CircuitBreakerTab } from '../tabs/CircuitBreakerTab';
import { HealthCheckTab } from '../tabs/HealthCheckTab';
import { MetricsTab } from '../tabs/MetricsTab';
import { StorageTab } from '../tabs/StorageTab';
import { RetryTab } from '../tabs/RetryTab';
import {
  generalTabSchema,
  queueTabSchema,
  circuitBreakerTabSchema,
  healthCheckTabSchema,
  metricsTabSchema,
  storageTabSchema,
  retryTabSchema,
  validateSection,
} from '../validation';

const mockOnUpdateField = vi.fn();

const createMockConfig = (): import('../../../types').OrchestratorConfig => ({
  port: 5100,
  host: '0.0.0.0',
  logLevel: 'info',
  inferenceTimeoutMs: 90000,
  enableQueue: true,
  enableCircuitBreaker: true,
  enableMetrics: true,
  enableStreaming: true,
  enablePersistence: true,
  queue: {
    maxSize: 1000,
    timeout: 300000,
    priorityBoostInterval: 5000,
    priorityBoostAmount: 5,
    maxPriority: 100,
  },
  loadBalancer: {
    weights: {
      latency: 0.17,
      successRate: 0.17,
      load: 0.17,
      capacity: 0.05,
      circuitBreaker: 0.12,
      timeout: 0.05,
      throughput: 0.07,
      vram: 0.05,
      temporal: 0.1,
      context: 0.05,
      itl: 0,
      cacheHit: 0,
      promptSize: 0,
      errorType: 0,
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
    fallbackToFastestResponse: false,
    prefixCacheAware: {
      enabled: false,
      hashTokenCount: 512,
      hashBuckets: 256,
    },
    sloFallback: {
      enabled: false,
      ttftThresholdMs: 2000,
      p95WindowMs: 60000,
    },
    ghostServers: {
      staleThresholdMs: 300000,
      removeOnCleanup: false,
    },
    tokenWeightedLoad: {
      enabled: true,
      promptTokenWeight: 1.0,
      outputTokenWeight: 4.0,
    },
    coldStartMagnitude: {
      enabled: true,
      thresholdMs: 1000,
      penaltyDurationMs: 60000,
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
  },
  security: {
    corsOrigins: ['*'],
    rateLimitWindowMs: 60000,
    rateLimitMax: 100,
    authMustBeEnabled: false,
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
    ttftWeight: 0.6,
    durationWeight: 0.4,
    activityTimeoutMs: 60000,
    stallThresholdMs: 300000,
    stallCheckIntervalMs: 10000,
    maxHandoffAttempts: 2,
    chunkWeight: 0.2,
    maxChunkGapPenaltyMs: 5000,
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
});

beforeEach(() => {
  mockOnUpdateField.mockClear();
});

describe('Settings Validation Schemas', () => {
  describe('generalTabSchema', () => {
    it('accepts valid general config', () => {
      const validConfig = {
        port: 5100,
        host: '0.0.0.0',
        logLevel: 'info',
        inferenceTimeoutMs: 90000,
        enableQueue: true,
        enableCircuitBreaker: true,
        enableMetrics: true,
        enableStreaming: true,
        enablePersistence: true,
      };
      const result = validateSection(generalTabSchema, validConfig);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual({});
    });

    it('rejects port out of range', () => {
      const invalidConfig = {
        port: 70000,
        host: '0.0.0.0',
        logLevel: 'info',
        inferenceTimeoutMs: 90000,
        enableQueue: true,
        enableCircuitBreaker: true,
        enableMetrics: true,
        enableStreaming: true,
        enablePersistence: true,
      };
      const result = validateSection(generalTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors.port).toBeDefined();
    });

    it('rejects invalid log level', () => {
      const invalidConfig = {
        port: 5100,
        host: '0.0.0.0',
        logLevel: 'verbose',
        inferenceTimeoutMs: 90000,
        enableQueue: true,
        enableCircuitBreaker: true,
        enableMetrics: true,
        enableStreaming: true,
        enablePersistence: true,
      };
      const result = validateSection(generalTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });

    it('rejects negative inference timeout', () => {
      const invalidConfig = {
        port: 5100,
        host: '0.0.0.0',
        logLevel: 'info',
        inferenceTimeoutMs: -100,
        enableQueue: true,
        enableCircuitBreaker: true,
        enableMetrics: true,
        enableStreaming: true,
        enablePersistence: true,
      };
      const result = validateSection(generalTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });
  });

  describe('queueTabSchema', () => {
    it('accepts valid queue config', () => {
      const validConfig = {
        maxSize: 1000,
        timeout: 300000,
        priorityBoostInterval: 5000,
        priorityBoostAmount: 5,
        maxPriority: 100,
      };
      const result = validateSection(queueTabSchema, validConfig);
      expect(result.valid).toBe(true);
    });

    it('rejects maxSize below 1', () => {
      const invalidConfig = {
        maxSize: 0,
        timeout: 300000,
        priorityBoostInterval: 5000,
        priorityBoostAmount: 5,
        maxPriority: 100,
      };
      const result = validateSection(queueTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });

    it('rejects timeout below 1000', () => {
      const invalidConfig = {
        maxSize: 1000,
        timeout: 500,
        priorityBoostInterval: 5000,
        priorityBoostAmount: 5,
        maxPriority: 100,
      };
      const result = validateSection(queueTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });
  });

  describe('circuitBreakerTabSchema', () => {
    it('accepts valid circuit breaker config', () => {
      const validConfig = {
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
        adaptiveThresholdAdjustment: 2,
        nonRetryableRatioThreshold: 0.5,
        transientRatioThreshold: 0.7,
        rateLimitFailureThreshold: 2,
      };
      const result = validateSection(circuitBreakerTabSchema, validConfig);
      expect(result.valid).toBe(true);
    });

    it('rejects error rate threshold above 1', () => {
      const invalidConfig = {
        baseFailureThreshold: 5,
        maxFailureThreshold: 10,
        minFailureThreshold: 3,
        openTimeout: 120000,
        halfOpenTimeout: 300000,
        recoverySuccessThreshold: 3,
        activeTestTimeout: 300000,
        maxHalfOpenPerServer: 3,
        errorRateWindow: 60000,
        errorRateThreshold: 1.5,
        adaptiveThresholds: true,
        errorRateSmoothing: 0.3,
        adaptiveThresholdAdjustment: 2,
        nonRetryableRatioThreshold: 0.5,
        transientRatioThreshold: 0.7,
        rateLimitFailureThreshold: 2,
      };
      const result = validateSection(circuitBreakerTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });

    it('rejects activeTestTimeout above 600000', () => {
      const invalidConfig = {
        baseFailureThreshold: 5,
        maxFailureThreshold: 10,
        minFailureThreshold: 3,
        openTimeout: 120000,
        halfOpenTimeout: 300000,
        recoverySuccessThreshold: 3,
        activeTestTimeout: 700000,
        maxHalfOpenPerServer: 3,
        errorRateWindow: 60000,
        errorRateThreshold: 0.5,
        adaptiveThresholds: true,
        errorRateSmoothing: 0.3,
        adaptiveThresholdAdjustment: 2,
        nonRetryableRatioThreshold: 0.5,
        transientRatioThreshold: 0.7,
        rateLimitFailureThreshold: 2,
      };
      const result = validateSection(circuitBreakerTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });
  });

  describe('healthCheckTabSchema', () => {
    it('accepts valid health check config', () => {
      const validConfig = {
        enabled: true,
        intervalMs: 30000,
        timeoutMs: 5000,
        maxConcurrentChecks: 10,
        retryAttempts: 2,
        retryDelayMs: 1000,
        recoveryIntervalMs: 60000,
        backoffMultiplier: 1.5,
      };
      const result = validateSection(healthCheckTabSchema, validConfig);
      expect(result.valid).toBe(true);
    });

    it('rejects negative retry attempts', () => {
      const invalidConfig = {
        enabled: true,
        intervalMs: 30000,
        timeoutMs: 5000,
        maxConcurrentChecks: 10,
        retryAttempts: -1,
        retryDelayMs: 1000,
        recoveryIntervalMs: 60000,
        backoffMultiplier: 1.5,
      };
      const result = validateSection(healthCheckTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });

    it('rejects backoff multiplier below 1', () => {
      const invalidConfig = {
        enabled: true,
        intervalMs: 30000,
        timeoutMs: 5000,
        maxConcurrentChecks: 10,
        retryAttempts: 2,
        retryDelayMs: 1000,
        recoveryIntervalMs: 60000,
        backoffMultiplier: 0.5,
      };
      const result = validateSection(healthCheckTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });
  });

  describe('metricsTabSchema', () => {
    it('accepts valid metrics config', () => {
      const validConfig = {
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
      };
      const result = validateSection(metricsTabSchema, validConfig);
      expect(result.valid).toBe(true);
    });

    it('rejects prometheus port above 65535', () => {
      const invalidConfig = {
        enabled: true,
        prometheusEnabled: true,
        prometheusPort: 70000,
        batchFlushIntervalMs: 100,
        pruneIntervalMs: 300000,
        maxEntries: 100000,
        decay: {
          enabled: true,
          halfLifeMs: 300000,
          minDecayFactor: 0.1,
          staleThresholdMs: 120000,
        },
      };
      const result = validateSection(metricsTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });
  });

  describe('storageTabSchema', () => {
    it('accepts valid storage config', () => {
      const validConfig = {
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
      };
      const result = validateSection(storageTabSchema, validConfig);
      expect(result.valid).toBe(true);
    });

    it('rejects retention days below 1', () => {
      const invalidConfig = {
        dbPath: './data/metrics.db',
        retention: {
          requests: 0,
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
      };
      const result = validateSection(storageTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });
  });

  describe('retryTabSchema', () => {
    it('accepts valid retry config', () => {
      const validConfig = {
        maxRetriesPerServer: 2,
        retryDelayMs: 500,
        backoffMultiplier: 2,
        maxRetryDelayMs: 5000,
        retryableStatusCodes: [503, 502, 504],
      };
      const result = validateSection(retryTabSchema, validConfig);
      expect(result.valid).toBe(true);
    });

    it('rejects negative max retries', () => {
      const invalidConfig = {
        maxRetriesPerServer: -1,
        retryDelayMs: 500,
        backoffMultiplier: 2,
        maxRetryDelayMs: 5000,
        retryableStatusCodes: [503, 502, 504],
      };
      const result = validateSection(retryTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });

    it('rejects backoff multiplier below 1', () => {
      const invalidConfig = {
        maxRetriesPerServer: 2,
        retryDelayMs: 500,
        backoffMultiplier: 0.5,
        maxRetryDelayMs: 5000,
        retryableStatusCodes: [503, 502, 504],
      };
      const result = validateSection(retryTabSchema, invalidConfig);
      expect(result.valid).toBe(false);
    });
  });
});

describe('Settings Tab Rendering', () => {
  it('GeneralTab renders without crashing', () => {
    const config = createMockConfig();
    render(<GeneralTab config={config} onUpdateField={mockOnUpdateField} />);
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Port')).toBeInTheDocument();
    expect(screen.getByText('Host')).toBeInTheDocument();
  });

  it('QueueTab renders without crashing', () => {
    const config = createMockConfig();
    render(<QueueTab config={config} onUpdateField={mockOnUpdateField} />);
    expect(screen.getByText('Queue')).toBeInTheDocument();
    expect(screen.getByText('Max Size')).toBeInTheDocument();
  });

  it('CircuitBreakerTab renders without crashing', () => {
    const config = createMockConfig();
    render(<CircuitBreakerTab config={config} onUpdateField={mockOnUpdateField} />);
    expect(screen.getByText('Circuit Breaker')).toBeInTheDocument();
    expect(screen.getByText('Base Failure Threshold')).toBeInTheDocument();
  });

  it('HealthCheckTab renders without crashing', () => {
    const config = createMockConfig();
    render(<HealthCheckTab config={config} onUpdateField={mockOnUpdateField} />);
    expect(screen.getByText('Health Check')).toBeInTheDocument();
    expect(screen.getByText('Interval')).toBeInTheDocument();
  });

  it('MetricsTab renders without crashing', () => {
    const config = createMockConfig();
    render(<MetricsTab config={config} onUpdateField={mockOnUpdateField} />);
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Prometheus Port')).toBeInTheDocument();
  });

  it('StorageTab renders without crashing', () => {
    const config = createMockConfig();
    render(<StorageTab config={config} onUpdateField={mockOnUpdateField} />);
    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText('Database Path')).toBeInTheDocument();
  });

  it('RetryTab renders without crashing', () => {
    const config = createMockConfig();
    render(<RetryTab config={config} onUpdateField={mockOnUpdateField} />);
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Max Retries Per Server')).toBeInTheDocument();
  });
});
