/**
 * load-balancer.ts
 * Intelligent load balancing using historical metrics
 */

import type { AIServer, ServerModelMetrics } from './orchestrator.types.js';
import { logger } from './utils/logger.js';

/**
 * Circuit breaker health status
 */
export interface CircuitBreakerHealth {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  errorRate: number;
}

/**
 * Server score with breakdown
 */
export interface ServerScore {
  server: AIServer;
  totalScore: number;
  breakdown: {
    latencyScore: number;
    successRateScore: number;
    loadScore: number;
    capacityScore: number;
    circuitBreakerScore: number;
    timeoutScore: number;
  };
  metrics?: ServerModelMetrics;
}

/**
 * Configuration for load balancing weights
 */
export interface LoadBalancerConfig {
  weights: {
    latency: number; // Weight for P95 latency (default: 0.30)
    successRate: number; // Weight for success rate (default: 0.25)
    load: number; // Weight for current load (default: 0.20)
    capacity: number; // Weight for available capacity (default: 0.15)
    circuitBreaker: number; // Weight for circuit breaker health (default: 0.10)
    timeout: number; // Weight for timeout penalty (default: 0.05)
  };
  thresholds: {
    maxP95Latency: number; // Max acceptable P95 in ms (default: 5000)
    minSuccessRate: number; // Min acceptable success rate (default: 0.95)
    latencyPenalty: number; // Score multiplier for high latency (default: 0.5)
    errorPenalty: number; // Score multiplier for low success rate (default: 0.3)
    circuitBreakerPenalty: number; // Score multiplier for open circuit (default: 0.1)
  };
  // Latency blending: how much weight to give recent vs historical latency
  latencyBlendRecent: number; // Weight for lastResponseTime (default: 0.6)
  latencyBlendHistorical: number; // Weight for P95 (default: 0.4)
  // Load factor: how much current load affects effective latency
  loadFactorMultiplier: number; // (default: 0.5)
  // Default fallback latency when no data available
  defaultLatencyMs: number; // (default: 1000)
  // Default max concurrency for servers without explicit setting
  defaultMaxConcurrency: number; // (default: 4)
  // Streaming-optimized algorithm weights
  streaming: {
    ttftWeight: number; // Weight for time-to-first-token (default: 0.6)
    durationWeight: number; // Weight for total duration (default: 0.4)
    ttftBlendAvg: number; // Weight for avgTTFT vs P95 TTFT (default: 0.5)
    ttftBlendP95: number; // Weight for P95 TTFT (default: 0.5)
    durationEstimateMultiplier: number; // Estimate duration as baseLatency * this (default: 2)
  };
  // Round-robin algorithm settings
  roundRobin: {
    skipUnhealthy: boolean; // Skip unhealthy servers (default: true)
    checkCapacity: boolean; // Skip servers at capacity (default: true)
    stickySessionsTtlMs: number; // TTL for sticky sessions, 0 to disable (default: 0)
  };
  // Least-connections algorithm settings
  leastConnections: {
    skipUnhealthy: boolean; // Skip unhealthy servers (default: true)
    considerCapacity: boolean; // Factor in max capacity (default: true)
    considerFailureRate: boolean; // Factor in recent failure rate (default: true)
    failureRatePenalty: number; // Multiplier for failure rate penalty (default: 2.0)
  };
}

/**
 * Default load balancer configuration
 */
export const DEFAULT_LB_CONFIG: LoadBalancerConfig = {
  weights: {
    latency: 0.25,
    successRate: 0.2,
    load: 0.2,
    capacity: 0.1,
    circuitBreaker: 0.2, // Increased from 0.1 to 0.2 for more aggressive circuit avoidance
    timeout: 0.05,
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
  },
  roundRobin: {
    skipUnhealthy: true,
    checkCapacity: true,
    stickySessionsTtlMs: 0, // Disabled by default
  },
  leastConnections: {
    skipUnhealthy: true,
    considerCapacity: true,
    considerFailureRate: true,
    failureRatePenalty: 2.0,
  },
};

/**
 * Calculate score for a server based on metrics
 */
export function calculateServerScore(
  server: AIServer,
  model: string,
  currentLoad: number,
  totalLoad: number,
  metrics: ServerModelMetrics | undefined,
  config: LoadBalancerConfig = DEFAULT_LB_CONFIG,
  circuitBreakerHealth?: CircuitBreakerHealth,
  timeoutMs?: number
): ServerScore {
  const maxConcurrency = server.maxConcurrency ?? config.defaultMaxConcurrency;
  const availableCapacity = maxConcurrency - currentLoad;

  // Default scores if no metrics available
  let latencyScore = 100;
  let successRateScore = 100;

  if (metrics) {
    // Latency score: lower is better, use P95
    // Normalize: 0ms = 100, maxP95Latency = 0
    const p95 = metrics.percentiles.p95 || server.lastResponseTime || config.defaultLatencyMs;
    latencyScore = Math.max(0, 100 - (p95 / config.thresholds.maxP95Latency) * 100);

    // Penalize high latency
    if (p95 > config.thresholds.maxP95Latency) {
      latencyScore *= config.thresholds.latencyPenalty;
    }

    // Success rate score: higher is better
    // Normalize: 100% = 100, 0% = 0
    successRateScore = metrics.successRate * 100;

    // Penalize low success rate
    if (metrics.successRate < config.thresholds.minSuccessRate) {
      successRateScore *= config.thresholds.errorPenalty;
    }
  } else {
    // Fallback to lastResponseTime if no historical metrics
    const responseTime = server.lastResponseTime || config.defaultLatencyMs;
    latencyScore = Math.max(0, 100 - (responseTime / config.thresholds.maxP95Latency) * 100);
  }

  // Load score: lower total load is better
  // Normalize: 0 load = 100, maxConcurrency * 2 = 0
  const maxExpectedLoad = maxConcurrency * 2;
  const loadScore = Math.max(0, 100 - (totalLoad / maxExpectedLoad) * 100);

  // Capacity score: more available capacity is better
  // Normalize: maxConcurrency = 100, 0 = 0
  const capacityScore = (availableCapacity / maxConcurrency) * 100;

  // Circuit breaker score: heavily penalize open/half-open circuits
  // closed = 100, half-open = 20 (unstable), open = 5 (broken)
  let circuitBreakerScore = 100;
  if (circuitBreakerHealth) {
    if (circuitBreakerHealth.state === 'open') {
      circuitBreakerScore = 5; // Broken - avoid completely
    } else if (circuitBreakerHealth.state === 'half-open') {
      circuitBreakerScore = 20; // Unstable - avoid during recovery testing
    } else {
      // closed - apply minor penalty for recent failures
      circuitBreakerScore = Math.max(0, 100 - circuitBreakerHealth.failureCount * 5);
    }
  }

  // Timeout score: lower timeout is better
  // Normalize: 30s = 100, 300s = 0 (5 min timeout = worst)
  const timeoutScore = timeoutMs ? Math.max(0, 100 - (timeoutMs / 300000) * 100) : 100;

  // Calculate weighted total score
  const totalScore =
    latencyScore * config.weights.latency +
    successRateScore * config.weights.successRate +
    loadScore * config.weights.load +
    capacityScore * config.weights.capacity +
    circuitBreakerScore * config.weights.circuitBreaker +
    timeoutScore * config.weights.timeout;

  return {
    server,
    totalScore,
    breakdown: {
      latencyScore,
      successRateScore,
      loadScore,
      capacityScore,
      circuitBreakerScore,
      timeoutScore,
    },
    metrics,
  };
}

/**
 * Select best server using weighted scoring
 */
export function selectBestServer(candidates: ServerScore[]): AIServer | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  if (candidates.length === 1) {
    return candidates[0].server;
  }

  // Sort by total score descending (higher is better)
  candidates.sort((a, b) => b.totalScore - a.totalScore);

  // Log selection for debugging
  logger.debug('Server selection scores', {
    candidates: candidates.map((score, i) => ({
      rank: i + 1,
      serverId: score.server.id,
      totalScore: score.totalScore?.toFixed(2) ?? 'N/A',
      breakdown: score.breakdown
        ? {
            latency: score.breakdown.latencyScore?.toFixed(1) ?? 'N/A',
            successRate: score.breakdown.successRateScore?.toFixed(1) ?? 'N/A',
            load: score.breakdown.loadScore?.toFixed(1) ?? 'N/A',
            capacity: score.breakdown.capacityScore?.toFixed(1) ?? 'N/A',
            timeout: score.breakdown.timeoutScore?.toFixed(1) ?? 'N/A',
          }
        : 'N/A',
    })),
  });

  return candidates[0].server;
}

/**
 * Algorithm type for load balancing
 */
export type LoadBalancerAlgorithm =
  | 'weighted'
  | 'round-robin'
  | 'least-connections'
  | 'random'
  | 'fastest-response'
  | 'streaming-optimized';

/**
 * Sticky session entry
 */
interface StickySessionEntry {
  serverId: string;
  lastUsed: number;
}

/**
 * Load balancer with algorithm selection
 */
export class LoadBalancer {
  private algorithm: LoadBalancerAlgorithm = 'fastest-response';
  private config: LoadBalancerConfig;
  private roundRobinIndex: number = 0;
  private stickySessions: Map<string, StickySessionEntry> = new Map();
  private stickySessionCleanupInterval?: NodeJS.Timeout;

  constructor(config: Partial<LoadBalancerConfig> = {}) {
    this.config = {
      ...DEFAULT_LB_CONFIG,
      ...config,
      roundRobin: { ...DEFAULT_LB_CONFIG.roundRobin, ...config.roundRobin },
      leastConnections: { ...DEFAULT_LB_CONFIG.leastConnections, ...config.leastConnections },
    };

    // Start sticky session cleanup if enabled
    if (this.config.roundRobin.stickySessionsTtlMs > 0) {
      this.startStickySessionCleanup();
    }
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<LoadBalancerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      weights: { ...this.config.weights, ...config.weights },
      thresholds: { ...this.config.thresholds, ...config.thresholds },
      roundRobin: { ...this.config.roundRobin, ...config.roundRobin },
      leastConnections: { ...this.config.leastConnections, ...config.leastConnections },
    };

    // Start/stop sticky session cleanup based on config change
    if (this.config.roundRobin.stickySessionsTtlMs > 0 && !this.stickySessionCleanupInterval) {
      this.startStickySessionCleanup();
    } else if (
      this.config.roundRobin.stickySessionsTtlMs === 0 &&
      this.stickySessionCleanupInterval
    ) {
      this.stopCleanup();
    }

    logger.info('Load balancer config updated');
  }

  /**
   * Start periodic cleanup of expired sticky sessions
   */
  private startStickySessionCleanup(): void {
    const ttl = this.config.roundRobin.stickySessionsTtlMs;
    // Cleanup every TTL/2 to ensure timely removal
    this.stickySessionCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [clientId, entry] of this.stickySessions) {
        if (now - entry.lastUsed > ttl) {
          this.stickySessions.delete(clientId);
        }
      }
    }, ttl / 2);
  }

  /**
   * Stop sticky session cleanup
   */
  stopCleanup(): void {
    if (this.stickySessionCleanupInterval) {
      clearInterval(this.stickySessionCleanupInterval);
      this.stickySessionCleanupInterval = undefined;
    }
  }

  /**
   * Set algorithm
   */
  setAlgorithm(algorithm: LoadBalancerAlgorithm): void {
    this.algorithm = algorithm;
  }

  /**
   * Get current algorithm
   */
  getAlgorithm(): LoadBalancerAlgorithm {
    return this.algorithm;
  }

  select(
    candidates: AIServer[],
    model: string,
    getLoad: (serverId: string, model: string) => number,
    getTotalLoad: (serverId: string) => number,
    getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined,
    isStreaming: boolean = false,
    clientId?: string,
    getTimeout?: (serverId: string, model: string) => number
  ): AIServer | undefined {
    switch (this.algorithm) {
      case 'weighted':
        return this.selectWeighted(
          candidates,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          getTimeout
        );

      case 'round-robin':
        return this.selectRoundRobin(candidates, getTotalLoad, clientId);

      case 'least-connections':
        return this.selectLeastConnections(candidates, getTotalLoad, getMetrics, model);

      case 'random':
        return this.selectRandom(candidates);

      case 'fastest-response':
        return this.selectFastestResponse(candidates, model, getLoad, getTotalLoad, getMetrics);

      case 'streaming-optimized':
        return this.selectStreamingOptimized(
          candidates,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          isStreaming
        );

      default:
        return this.selectWeighted(
          candidates,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          getTimeout
        );
    }
  }

  /**
   * Weighted scoring selection (default)
   */
  private selectWeighted(
    candidates: AIServer[],
    model: string,
    getLoad: (serverId: string, model: string) => number,
    getTotalLoad: (serverId: string) => number,
    getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined,
    getTimeout?: (serverId: string, model: string) => number
  ): AIServer | undefined {
    const scores = candidates.map(server => {
      const currentLoad = getLoad(server.id, model);
      const totalLoad = getTotalLoad(server.id);
      const metrics = getMetrics(server.id, model);
      const timeoutMs = getTimeout?.(server.id, model);

      return calculateServerScore(
        server,
        model,
        currentLoad,
        totalLoad,
        metrics,
        this.config,
        undefined,
        timeoutMs
      );
    });

    return selectBestServer(scores);
  }

  /**
   * Round-robin selection with health/capacity filtering and sticky sessions
   */
  private selectRoundRobin(
    candidates: AIServer[],
    getTotalLoad: (serverId: string) => number,
    clientId?: string
  ): AIServer | undefined {
    if (candidates.length === 0) {
      return undefined;
    }

    const { roundRobin } = this.config;

    // Check for sticky session if enabled and clientId provided
    if (roundRobin.stickySessionsTtlMs > 0 && clientId) {
      const stickyEntry = this.stickySessions.get(clientId);
      if (stickyEntry) {
        // Find the sticky server in candidates
        const stickyServer = candidates.find(s => s.id === stickyEntry.serverId);
        if (stickyServer) {
          // Check if sticky server is still valid (healthy and has capacity)
          const isHealthy = !roundRobin.skipUnhealthy || stickyServer.healthy !== false;
          const hasCapacity =
            !roundRobin.checkCapacity ||
            getTotalLoad(stickyServer.id) <
              (stickyServer.maxConcurrency ?? this.config.defaultMaxConcurrency);

          if (isHealthy && hasCapacity) {
            // Update last used time and return sticky server
            stickyEntry.lastUsed = Date.now();
            logger.debug('Round-robin: using sticky session', {
              clientId,
              serverId: stickyServer.id,
            });
            return stickyServer;
          }
        }
        // Sticky server no longer valid, remove entry
        this.stickySessions.delete(clientId);
      }
    }

    // Filter candidates based on config
    let eligibleServers = candidates;

    if (roundRobin.skipUnhealthy) {
      eligibleServers = eligibleServers.filter(s => s.healthy !== false);
    }

    if (roundRobin.checkCapacity) {
      eligibleServers = eligibleServers.filter(s => {
        const load = getTotalLoad(s.id);
        const maxConcurrency = s.maxConcurrency ?? this.config.defaultMaxConcurrency;
        return load < maxConcurrency;
      });
    }

    if (eligibleServers.length === 0) {
      logger.debug(
        'Round-robin: no eligible servers after filtering, falling back to all candidates'
      );
      eligibleServers = candidates; // Fall back to all candidates
    }

    // Select using round-robin from eligible servers
    const selected = eligibleServers[this.roundRobinIndex % eligibleServers.length];
    this.roundRobinIndex++;

    // Store sticky session if enabled
    if (roundRobin.stickySessionsTtlMs > 0 && clientId && selected) {
      this.stickySessions.set(clientId, {
        serverId: selected.id,
        lastUsed: Date.now(),
      });
      logger.debug('Round-robin: created sticky session', {
        clientId,
        serverId: selected.id,
      });
    }

    return selected;
  }

  /**
   * Least connections selection with health/capacity/failure rate consideration
   */
  private selectLeastConnections(
    candidates: AIServer[],
    getTotalLoad: (serverId: string) => number,
    getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined,
    model: string
  ): AIServer | undefined {
    if (candidates.length === 0) {
      return undefined;
    }

    const { leastConnections } = this.config;

    // Filter candidates based on config
    let eligibleServers = candidates;

    if (leastConnections.skipUnhealthy) {
      eligibleServers = eligibleServers.filter(s => s.healthy !== false);
    }

    if (eligibleServers.length === 0) {
      logger.debug(
        'Least-connections: no eligible servers after filtering, falling back to all candidates'
      );
      eligibleServers = candidates;
    }

    // Score each server - lower score is better
    const scored = eligibleServers.map(server => {
      const load = getTotalLoad(server.id);
      const maxConcurrency = server.maxConcurrency ?? this.config.defaultMaxConcurrency;

      // Calculate load ratio (0-1, lower is better)
      let score: number;
      if (leastConnections.considerCapacity) {
        // Use load ratio instead of absolute load for fairer comparison
        score = load / maxConcurrency;
      } else {
        // Use absolute load
        score = load;
      }

      // Apply failure rate penalty if enabled
      if (leastConnections.considerFailureRate) {
        const metrics = getMetrics(server.id, model);
        if (metrics && metrics.successRate < 1) {
          // Failure rate = 1 - success rate
          // Penalty increases score (making server less preferred)
          const failureRate = 1 - metrics.successRate;
          score *= 1 + failureRate * leastConnections.failureRatePenalty;
        }
      }

      return { server, score, load, maxConcurrency };
    });

    // Sort by score ascending (lower is better)
    scored.sort((a, b) => a.score - b.score);

    logger.debug('Least-connections selection', {
      candidates: scored.map((s, i) => ({
        rank: i + 1,
        serverId: s.server.id,
        score: s.score.toFixed(3),
        load: s.load,
        maxConcurrency: s.maxConcurrency,
      })),
    });

    return scored[0].server;
  }

  /**
   * Random selection (for testing/chaos)
   */
  private selectRandom(candidates: AIServer[]): AIServer | undefined {
    if (candidates.length === 0) {
      return undefined;
    }

    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  /**
   * Fastest response selection - prioritizes lowest latency
   * Uses a combination of recent response time and P95 latency
   * Includes hot/cold model awareness - prefers servers where model is already loaded
   */
  private selectFastestResponse(
    candidates: AIServer[],
    model: string,
    getLoad: (serverId: string, model: string) => number,
    getTotalLoad: (serverId: string) => number,
    getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined
  ): AIServer | undefined {
    if (candidates.length === 0) {
      return undefined;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    // Score candidates based on latency
    const scored = candidates.map(server => {
      const metrics = getMetrics(server.id, model);
      const currentLoad = getLoad(server.id, model);
      const maxConcurrency = server.maxConcurrency ?? this.config.defaultMaxConcurrency;

      // Get effective latency (prefer P95 from metrics, fallback to lastResponseTime)
      let latency = server.lastResponseTime || this.config.defaultLatencyMs;
      if (metrics && metrics.percentiles.p95 > 0) {
        // Blend last response time with P95 (configurable weights)
        latency =
          server.lastResponseTime * this.config.latencyBlendRecent +
          metrics.percentiles.p95 * this.config.latencyBlendHistorical;
      }

      // Adjust for current load (higher load = higher effective latency)
      const loadFactor = 1 + (currentLoad / maxConcurrency) * this.config.loadFactorMultiplier;
      let adjustedLatency = latency * loadFactor;

      // Hot/cold model awareness: prefer servers where model is already loaded
      const loadedModel = server.hardware?.loadedModels?.find(m => m.name === model);
      if (loadedModel) {
        // Model is hot - apply significant boost (lower latency = higher priority)
        adjustedLatency *= 0.5; // 50% latency reduction for hot models

        // Penalize servers near eviction (model about to be unloaded)
        if (loadedModel.expiresAt) {
          const expiresIn = new Date(loadedModel.expiresAt).getTime() - Date.now();
          if (expiresIn < 30000) {
            // Expires in < 30s - heavy penalty
            adjustedLatency *= 2.0;
          } else if (expiresIn < 120000) {
            // Expires in < 2 min - slight penalty
            adjustedLatency *= 1.2;
          }
        }
      } else {
        // Model is cold - slight penalty to prefer hot servers
        adjustedLatency *= 1.1;
      }

      // Add success rate consideration
      const successRate = metrics?.successRate ?? 1.0;
      if (successRate < 0.95) {
        adjustedLatency *= 0.5 + successRate / 2; // Penalize low success rate
      }

      // Use short-window metrics for recent degradation detection
      const recentWindow = metrics?.windows?.['1m'];
      if (recentWindow && recentWindow.count > 5) {
        const recentErrorRate = recentWindow.errors / recentWindow.count;
        const overallErrorRate = 1 - successRate;
        if (recentErrorRate > overallErrorRate * 1.5) {
          // Recent error rate is significantly worse - server may be degrading
          adjustedLatency *= 1.3;
        }
      }

      return {
        server,
        latency: adjustedLatency,
        rawLatency: latency,
        load: currentLoad,
        isHot: !!loadedModel,
      };
    });

    // Sort by adjusted latency (ascending - lower is better)
    scored.sort((a, b) => a.latency - b.latency);

    logger.debug('Fastest response selection', {
      candidates: scored.map((s, i) => ({
        rank: i + 1,
        serverId: s.server.id,
        latency: s.latency,
        rawLatency: s.rawLatency,
        load: s.load,
        isHot: s.isHot,
      })),
    });

    return scored[0].server;
  }

  /**
   * Streaming-optimized selection - balances TTFT vs total duration
   * For streaming: weights TTFT vs total completion time
   * For non-streaming: falls back to fastest-response
   */
  private selectStreamingOptimized(
    candidates: AIServer[],
    model: string,
    getLoad: (serverId: string, model: string) => number,
    getTotalLoad: (serverId: string) => number,
    getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined,
    isStreaming: boolean
  ): AIServer | undefined {
    if (candidates.length === 0) {
      return undefined;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    // If not streaming, use fastest-response logic
    if (!isStreaming) {
      return this.selectFastestResponse(candidates, model, getLoad, getTotalLoad, getMetrics);
    }

    // For streaming: balance TTFT vs total duration using config weights
    const { streaming } = this.config;

    const scored = candidates.map(server => {
      const metrics = getMetrics(server.id, model);
      const currentLoad = getLoad(server.id, model);
      const maxConcurrency = server.maxConcurrency ?? this.config.defaultMaxConcurrency;

      // Get base latency using config values
      let baseLatency = server.lastResponseTime || this.config.defaultLatencyMs;
      if (metrics && metrics.percentiles.p95 > 0) {
        baseLatency =
          server.lastResponseTime * this.config.latencyBlendRecent +
          metrics.percentiles.p95 * this.config.latencyBlendHistorical;
      }

      // Get streaming metrics if available
      let ttft = baseLatency; // Default to base latency if no TTFT data
      let streamingDuration = baseLatency * streaming.durationEstimateMultiplier; // Estimate if no data

      if (metrics?.streamingMetrics) {
        const sm = metrics.streamingMetrics;
        if (sm.ttftPercentiles.p95 > 0) {
          ttft =
            sm.avgTTFT > 0
              ? sm.avgTTFT * streaming.ttftBlendAvg +
                sm.ttftPercentiles.p95 * streaming.ttftBlendP95
              : sm.ttftPercentiles.p95;
        }
        if (sm.streamingDurationPercentiles.p95 > 0) {
          streamingDuration = sm.streamingDurationPercentiles.p95;
        }
      }

      // Adjust for load using config value
      const loadFactor = 1 + (currentLoad / maxConcurrency) * this.config.loadFactorMultiplier;

      // Calculate weighted score (lower is better)
      const adjustedTTFT = ttft * loadFactor;
      const adjustedDuration = streamingDuration * loadFactor;
      const score =
        adjustedTTFT * streaming.ttftWeight + adjustedDuration * streaming.durationWeight;

      return {
        server,
        score,
        ttft: adjustedTTFT,
        duration: adjustedDuration,
        load: currentLoad,
      };
    });

    // Sort by score (ascending - lower is better)
    scored.sort((a, b) => a.score - b.score);

    logger.debug('Streaming-optimized selection', {
      candidates: scored.map((s, i) => ({
        rank: i + 1,
        serverId: s.server.id,
        score: s.score,
        ttft: s.ttft,
        duration: s.duration,
        load: s.load,
      })),
    });

    return scored[0].server;
  }
}
