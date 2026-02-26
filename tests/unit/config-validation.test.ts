/**
 * config-validation.test.ts
 * Configuration validation and edge case tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelManager } from '../../src/model-manager.js';
import { LoadBalancer } from '../../src/load-balancer.js';
import { RequestQueue } from '../../src/queue/index.js';
import type { AIServer } from '../../src/orchestrator.types.js';

describe('Configuration Validation Tests', () => {
  // ============================================================================
  // SECTION 1: Model Manager Configuration Tests
  // ============================================================================

  describe('Model Manager Configuration', () => {
    it('should use default model manager config', () => {
      const modelManager = new ModelManager({});
      expect(modelManager).toBeDefined();
    });

    it('should handle custom model manager config', () => {
      const modelManager = new ModelManager({
        maxRetries: 5,
        retryDelayBaseMs: 2000,
        warmupTimeoutMs: 120000,
        idleThresholdMs: 300000,
        memorySafetyMargin: 1.5,
        gbPerBillionParams: 1.0,
        defaultModelSizeGb: 10,
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle zero retries', () => {
      const modelManager = new ModelManager({
        maxRetries: 0,
        retryDelayBaseMs: 100,
        warmupTimeoutMs: 60000,
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle high retries', () => {
      const modelManager = new ModelManager({
        maxRetries: 100,
        retryDelayBaseMs: 100,
        warmupTimeoutMs: 600000,
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle zero warmup timeout', () => {
      const modelManager = new ModelManager({
        maxRetries: 3,
        warmupTimeoutMs: 0,
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle very long warmup timeout', () => {
      const modelManager = new ModelManager({
        maxRetries: 3,
        warmupTimeoutMs: 3600000,
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle zero idle threshold', () => {
      const modelManager = new ModelManager({
        idleThresholdMs: 0,
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle very large idle threshold', () => {
      const modelManager = new ModelManager({
        idleThresholdMs: 86400000,
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle custom load time estimates', () => {
      const modelManager = new ModelManager({
        loadTimeEstimates: {
          tiny: 1000,
          small: 2000,
          medium: 5000,
          large: 10000,
          xl: 20000,
          xxl: 40000,
        },
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle zero load time estimates', () => {
      const modelManager = new ModelManager({
        loadTimeEstimates: {
          tiny: 0,
          small: 0,
          medium: 0,
          large: 0,
          xl: 0,
          xxl: 0,
        },
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle custom memory settings', () => {
      const modelManager = new ModelManager({
        memorySafetyMargin: 2.0,
        gbPerBillionParams: 1.5,
        defaultModelSizeGb: 20,
      });
      expect(modelManager).toBeDefined();
    });

    it('should handle edge case memory settings', () => {
      const modelManager = new ModelManager({
        memorySafetyMargin: 1.0,
        gbPerBillionParams: 0.1,
        defaultModelSizeGb: 1,
      });
      expect(modelManager).toBeDefined();
    });
  });

  // ============================================================================
  // SECTION 2: Load Balancer Configuration Tests
  // ============================================================================

  describe('Load Balancer Configuration', () => {
    it('should use default load balancer config', () => {
      const loadBalancer = new LoadBalancer({});
      expect(loadBalancer).toBeDefined();
    });

    it('should handle custom weight config', () => {
      const loadBalancer = new LoadBalancer({
        weights: {
          latency: 0.4,
          successRate: 0.3,
          load: 0.2,
          capacity: 0.05,
          circuitBreaker: 0.03,
          timeout: 0.02,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle equal weights', () => {
      const loadBalancer = new LoadBalancer({
        weights: {
          latency: 0.17,
          successRate: 0.17,
          load: 0.17,
          capacity: 0.17,
          circuitBreaker: 0.16,
          timeout: 0.16,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle zero capacity weight', () => {
      const loadBalancer = new LoadBalancer({
        weights: {
          latency: 0.4,
          successRate: 0.3,
          load: 0.3,
          capacity: 0,
          circuitBreaker: 0,
          timeout: 0,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle custom thresholds', () => {
      const loadBalancer = new LoadBalancer({
        thresholds: {
          maxP95Latency: 10000,
          minSuccessRate: 0.8,
          latencyPenalty: 0.3,
          errorPenalty: 0.2,
          circuitBreakerPenalty: 0.05,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle zero threshold values', () => {
      const loadBalancer = new LoadBalancer({
        thresholds: {
          maxP95Latency: 0,
          minSuccessRate: 0,
          latencyPenalty: 0,
          errorPenalty: 0,
          circuitBreakerPenalty: 0,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle latency blend config', () => {
      const loadBalancer = new LoadBalancer({
        latencyBlendRecent: 0.8,
        latencyBlendHistorical: 0.2,
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle inverse latency blend', () => {
      const loadBalancer = new LoadBalancer({
        latencyBlendRecent: 0.1,
        latencyBlendHistorical: 0.9,
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle load factor multiplier', () => {
      const loadBalancer = new LoadBalancer({
        loadFactorMultiplier: 1.0,
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle zero load factor', () => {
      const loadBalancer = new LoadBalancer({
        loadFactorMultiplier: 0,
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle custom default latency', () => {
      const loadBalancer = new LoadBalancer({
        defaultLatencyMs: 5000,
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle zero default latency', () => {
      const loadBalancer = new LoadBalancer({
        defaultLatencyMs: 0,
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle custom default max concurrency', () => {
      const loadBalancer = new LoadBalancer({
        defaultMaxConcurrency: 10,
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle zero default max concurrency', () => {
      const loadBalancer = new LoadBalancer({
        defaultMaxConcurrency: 0,
      });
      expect(loadBalancer).toBeDefined();
    });
  });

  // ============================================================================
  // SECTION 3: Streaming Configuration Tests
  // ============================================================================

  describe('Streaming Configuration', () => {
    it('should use default streaming config', () => {
      const queue = new RequestQueue({});
      expect(queue).toBeDefined();
    });

    it('should handle custom streaming config', () => {
      const queue = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 100,
          timeoutMs: 300000,
          bufferSize: 8192,
          activityTimeoutMs: 60000,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle high concurrent stream limit', () => {
      const queue = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 500,
          timeoutMs: 600000,
          bufferSize: 16384,
          activityTimeoutMs: 120000,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle low concurrent stream limit', () => {
      const queue = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 1,
          timeoutMs: 60000,
          bufferSize: 1024,
          activityTimeoutMs: 30000,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle disabled streaming', () => {
      const queue = new RequestQueue({
        streaming: {
          enabled: false,
          maxConcurrentStreams: 0,
          timeoutMs: 0,
          bufferSize: 0,
          activityTimeoutMs: 0,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle very long timeout', () => {
      const queue = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 50,
          timeoutMs: 3600000,
          bufferSize: 8192,
          activityTimeoutMs: 300000,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle zero activity timeout', () => {
      const queue = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 50,
          timeoutMs: 300000,
          bufferSize: 8192,
          activityTimeoutMs: 0,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle zero buffer size', () => {
      const queue = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 10,
          timeoutMs: 60000,
          bufferSize: 0,
          activityTimeoutMs: 10000,
        },
      } as any);
      expect(queue).toBeDefined();
    });
  });

  // ============================================================================
  // SECTION 4: Queue Configuration Tests
  // ============================================================================

  describe('Queue Configuration', () => {
    it('should use default queue config', () => {
      const queue = new RequestQueue({});
      expect(queue).toBeDefined();
    });

    it('should handle custom queue size', () => {
      const queue = new RequestQueue({
        queue: {
          maxSize: 10000,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle zero queue size', () => {
      const queue = new RequestQueue({
        queue: {
          maxSize: 0,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle very large queue size', () => {
      const queue = new RequestQueue({
        queue: {
          maxSize: 1000000,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle priority queue config', () => {
      const queue = new RequestQueue({
        queue: {
          priorityEnabled: true,
          priorityLevels: 5,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle single priority level', () => {
      const queue = new RequestQueue({
        queue: {
          priorityEnabled: true,
          priorityLevels: 1,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle zero priority levels', () => {
      const queue = new RequestQueue({
        queue: {
          priorityEnabled: true,
          priorityLevels: 0,
        },
      } as any);
      expect(queue).toBeDefined();
    });
  });

  // ============================================================================
  // SECTION 5: Retry Configuration Tests
  // ============================================================================

  describe('Retry Configuration', () => {
    it('should use default retry config values', () => {
      const queue = new RequestQueue({});
      expect(queue).toBeDefined();
    });

    it('should handle custom retry config', () => {
      const queue = new RequestQueue({
        retry: {
          maxRetries: 5,
          retryDelayMs: 1000,
          backoffMultiplier: 3,
          maxRetryDelayMs: 30000,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle zero retries', () => {
      const queue = new RequestQueue({
        retry: {
          maxRetries: 0,
          retryDelayMs: 100,
          backoffMultiplier: 1,
          maxRetryDelayMs: 1000,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle large retry delays', () => {
      const queue = new RequestQueue({
        retry: {
          maxRetries: 10,
          retryDelayMs: 5000,
          backoffMultiplier: 2,
          maxRetryDelayMs: 120000,
        },
      } as any);
      expect(queue).toBeDefined();
    });

    it('should handle backoff multiplier of 1', () => {
      const queue = new RequestQueue({
        retry: {
          maxRetries: 5,
          retryDelayMs: 100,
          backoffMultiplier: 1,
          maxRetryDelayMs: 10000,
        },
      } as any);
      expect(queue).toBeDefined();
    });
  });

  // ============================================================================
  // SECTION 6: Load Balancer Streaming Settings
  // ============================================================================

  describe('Load Balancer Streaming Settings', () => {
    it('should handle custom streaming weights', () => {
      const loadBalancer = new LoadBalancer({
        streaming: {
          ttftWeight: 0.8,
          durationWeight: 0.2,
          ttftBlendAvg: 0.7,
          ttftBlendP95: 0.3,
          durationEstimateMultiplier: 3,
          chunkWeight: 0.3,
          maxChunkGapPenaltyMs: 10000,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle equal streaming weights', () => {
      const loadBalancer = new LoadBalancer({
        streaming: {
          ttftWeight: 0.5,
          durationWeight: 0.5,
          ttftBlendAvg: 0.5,
          ttftBlendP95: 0.5,
          durationEstimateMultiplier: 2,
          chunkWeight: 0.2,
          maxChunkGapPenaltyMs: 5000,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle zero streaming weights', () => {
      const loadBalancer = new LoadBalancer({
        streaming: {
          ttftWeight: 0,
          durationWeight: 0,
          ttftBlendAvg: 0,
          ttftBlendP95: 0,
          durationEstimateMultiplier: 1,
          chunkWeight: 0,
          maxChunkGapPenaltyMs: 0,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle high chunk weight', () => {
      const loadBalancer = new LoadBalancer({
        streaming: {
          ttftWeight: 0.4,
          durationWeight: 0.3,
          ttftBlendAvg: 0.5,
          ttftBlendP95: 0.5,
          durationEstimateMultiplier: 2,
          chunkWeight: 1.0,
          maxChunkGapPenaltyMs: 10000,
        },
      });
      expect(loadBalancer).toBeDefined();
    });
  });

  // ============================================================================
  // SECTION 7: Load Balancer Algorithm Settings
  // ============================================================================

  describe('Load Balancer Algorithm Settings', () => {
    it('should handle round-robin settings', () => {
      const loadBalancer = new LoadBalancer({
        roundRobin: {
          skipUnhealthy: true,
          checkCapacity: true,
          stickySessionsTtlMs: 300000,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle disabled sticky sessions', () => {
      const loadBalancer = new LoadBalancer({
        roundRobin: {
          skipUnhealthy: true,
          checkCapacity: true,
          stickySessionsTtlMs: 0,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle least connections settings', () => {
      const loadBalancer = new LoadBalancer({
        leastConnections: {
          skipUnhealthy: true,
          considerCapacity: true,
          considerFailureRate: true,
          failureRatePenalty: 3.0,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle disabled failure rate consideration', () => {
      const loadBalancer = new LoadBalancer({
        leastConnections: {
          skipUnhealthy: true,
          considerCapacity: true,
          considerFailureRate: false,
          failureRatePenalty: 1.0,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle cross-model inference settings', () => {
      const loadBalancer = new LoadBalancer({
        crossModelInference: {
          enabled: true,
          useParameterSize: true,
          minSamplesForExact: 10,
          fallbackWeight: 0.6,
        },
      });
      expect(loadBalancer).toBeDefined();
    });

    it('should handle disabled cross-model inference', () => {
      const loadBalancer = new LoadBalancer({
        crossModelInference: {
          enabled: false,
          useParameterSize: false,
          minSamplesForExact: 5,
          fallbackWeight: 0.5,
        },
      });
      expect(loadBalancer).toBeDefined();
    });
  });

  // ============================================================================
  // SECTION 8: Configuration Edge Cases
  // ============================================================================

  describe('Configuration Edge Cases', () => {
    it('should handle all defaults', () => {
      const modelManager = new ModelManager({});
      const queue = new RequestQueue({});
      const loadBalancer = new LoadBalancer({});

      expect(modelManager).toBeDefined();
      expect(queue).toBeDefined();
      expect(loadBalancer).toBeDefined();
    });

    it('should handle empty config object', () => {
      const modelManager = new ModelManager({});
      const queue = new RequestQueue({});
      const loadBalancer = new LoadBalancer({});

      expect(modelManager).toBeDefined();
      expect(queue).toBeDefined();
      expect(loadBalancer).toBeDefined();
    });

    it('should handle undefined config', () => {
      const modelManager = new ModelManager(undefined);
      const queue = new RequestQueue(undefined);
      const loadBalancer = new LoadBalancer(undefined);

      expect(modelManager).toBeDefined();
      expect(queue).toBeDefined();
      expect(loadBalancer).toBeDefined();
    });

    it('should handle partial config', () => {
      const modelManager = new ModelManager({
        maxRetries: 5,
      });
      const queue = new RequestQueue({
        queue: { maxSize: 100 },
      } as any);

      expect(modelManager).toBeDefined();
      expect(queue).toBeDefined();
    });
  });

  // ============================================================================
  // SECTION 9: Configuration Combination Tests
  // ============================================================================

  describe('Configuration Combination Tests', () => {
    it('should handle all configs combined', () => {
      const fullConfig = {
        maxRetries: 4,
        retryDelayBaseMs: 1500,
        warmupTimeoutMs: 180000,
        idleThresholdMs: 240000,
        memorySafetyMargin: 1.3,
        gbPerBillionParams: 0.8,
        defaultModelSizeGb: 8,
        loadTimeEstimates: {
          tiny: 2000,
          small: 4000,
          medium: 8000,
          large: 16000,
          xl: 32000,
          xxl: 64000,
        },
      };

      const modelManager = new ModelManager(fullConfig);
      const queue = new RequestQueue({
        streaming: {
          enabled: true,
          maxConcurrentStreams: 75,
          timeoutMs: 240000,
          bufferSize: 8192,
          activityTimeoutMs: 45000,
        },
        queue: {
          maxSize: 5000,
          priorityEnabled: true,
          priorityLevels: 3,
        },
        retry: {
          maxRetries: 4,
          retryDelayMs: 750,
          backoffMultiplier: 2,
          maxRetryDelayMs: 15000,
        },
      } as any);
      const loadBalancer = new LoadBalancer({
        weights: {
          latency: 0.35,
          successRate: 0.3,
          load: 0.2,
          capacity: 0.1,
          circuitBreaker: 0.03,
          timeout: 0.02,
        },
        streaming: {
          ttftWeight: 0.6,
          durationWeight: 0.4,
          ttftBlendAvg: 0.5,
          ttftBlendP95: 0.5,
          durationEstimateMultiplier: 2,
          chunkWeight: 0.2,
          maxChunkGapPenaltyMs: 5000,
        },
      });

      expect(modelManager).toBeDefined();
      expect(queue).toBeDefined();
      expect(loadBalancer).toBeDefined();
    });

    it('should handle minimal configs', () => {
      const modelManager = new ModelManager({
        maxRetries: 0,
        warmupTimeoutMs: 0,
        idleThresholdMs: 0,
      });
      const loadBalancer = new LoadBalancer({
        weights: {
          latency: 1.0,
          successRate: 0,
          load: 0,
          capacity: 0,
          circuitBreaker: 0,
          timeout: 0,
        },
      });

      expect(modelManager).toBeDefined();
      expect(loadBalancer).toBeDefined();
    });

    it('should handle extreme values', () => {
      const extremeConfig = {
        maxRetries: 100,
        retryDelayBaseMs: 100,
        warmupTimeoutMs: 3600000,
        idleThresholdMs: 1,
        memorySafetyMargin: 10,
        gbPerBillionParams: 10,
        defaultModelSizeGb: 100,
        loadTimeEstimates: {
          tiny: 1,
          small: 1,
          medium: 1,
          large: 1,
          xl: 1,
          xxl: 1,
        },
      };

      const modelManager = new ModelManager(extremeConfig);
      const loadBalancer = new LoadBalancer({
        weights: {
          latency: 1.0,
          successRate: 0,
          load: 0,
          capacity: 0,
          circuitBreaker: 0,
          timeout: 0,
        },
        defaultLatencyMs: 100000,
        defaultMaxConcurrency: 100,
      });

      expect(modelManager).toBeDefined();
      expect(loadBalancer).toBeDefined();
    });
  });
});
