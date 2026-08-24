/**
 * load-balancer.ts
 * Intelligent load balancing using historical metrics
 */

import type { AIServer, ServerModelMetrics } from '../orchestrator/orchestrator.types.js';
import type { EndpointRegistry } from '../probe/endpoint-registry.js';
import type { ModelAvailabilityProvider } from '../probe/model-availability-provider.js';
import type { ProbeOrchestrator } from '../probe/probe-orchestrator.js';
import { GENERATION_ENDPOINTS } from '../probe/types.js';
import { getUserStore } from '../storage/user-store.js';
import { BoundedMap } from '../utils/bounded-map.js';
import { getInFlightManager } from '../utils/in-flight-manager.js';
import { logger } from '../utils/logger.js';
import { getQuarantinePool } from '../utils/quarantine-pool.js';

import { PrefixCacheRouter } from './prefix-cache-router.js';
import { SLOFallbackMonitor } from './slo-fallback.js';
import { getTemporalScorer, type TemporalAdjustment } from './temporal-scorer.js';

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
    throughputScore: number;
    vramScore: number;
    temporalScore?: number;
    contextScore?: number;
    itlScore?: number;
    cacheHitScore?: number;
    promptSizeScore?: number;
    errorTypeScore?: number;
  };
  metrics?: ServerModelMetrics;
  temporalAdjustment?: TemporalAdjustment;
}

/**
 * Configuration for load balancing weights
 */
export interface LoadBalancerConfig {
  weights: {
    latency: number; // Weight for P95 latency (default: 0.17)
    successRate: number; // Weight for success rate (default: 0.17)
    load: number; // Weight for current load (default: 0.17)
    capacity: number; // Weight for available capacity (default: 0.05)
    circuitBreaker: number; // Weight for circuit breaker health (default: 0.12)
    timeout: number; // Weight for timeout penalty (default: 0.05)
    throughput: number; // Weight for token throughput tokens/sec (default: 0.07)
    vram: number; // Weight for VRAM availability (default: 0.05)
    temporal: number; // Weight for temporal scoring (default: 0.10)
    context: number; // Weight for context fit scoring (default: 0.05)
    itl?: number; // Weight for ITL signal (default: 0.05)
    cacheHit?: number; // Weight for cache hit rate (default: 0.05)
    promptSize?: number; // Weight for prompt size latency (default: 0.03)
    errorType?: number; // Weight for error type distribution (default: 0.03)
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
  saturationDiversificationThreshold: number; // (default: 0.5) — above this utilization, score penalty accelerates
  // Default fallback latency when no data available
  defaultLatencyMs: number; // (default: 200)
  // Default max concurrency for servers without explicit setting
  defaultMaxConcurrency: number; // (default: 4)
  // Streaming-optimized algorithm weights
  streaming: {
    ttftWeight: number; // Weight for time-to-first-token (default: 0.6)
    durationWeight: number; // Weight for total duration (default: 0.4)
    ttftBlendAvg: number; // Weight for avgTTFT vs P95 TTFT (default: 0.5)
    ttftBlendP95: number; // Weight for P95 TTFT (default: 0.5)
    durationEstimateMultiplier: number; // Estimate duration as baseLatency * this (default: 2)
    chunkWeight: number; // Weight for chunk throughput (default: 0.2)
    maxChunkGapPenaltyMs: number; // Max gap before penalty (default: 5000ms)
  };
  // Round-robin algorithm settings
  roundRobin: {
    skipUnhealthy: boolean; // Skip unhealthy servers (default: true)
    checkCapacity: boolean; // Skip servers at capacity (default: true)
    stickySessionsTtlMs: number; // TTL for sticky sessions, 0 to disable (default: 0)
    maxStickySessions: number; // LRU cap for sticky sessions (default: 10000)
  };
  // Least-connections algorithm settings
  leastConnections: {
    skipUnhealthy: boolean; // Skip unhealthy servers (default: true)
    considerCapacity: boolean; // Factor in max capacity (default: true)
    considerFailureRate: boolean; // Factor in recent failure rate (default: true)
    failureRatePenalty: number; // Multiplier for failure rate penalty (default: 2.0)
  };
  // Cross-model inference: use metrics from similar models when exact metrics unavailable
  crossModelInference: {
    enabled: boolean; // Enable cross-model inference (default: true)
    useParameterSize: boolean; // Use same parameter size models (default: true)
    minSamplesForExact: number; // Min samples before preferring exact (default: 5)
    fallbackWeight: number; // How much to trust inferred vs actual (default: 0.5)
  };
  // Kill switch: force all algorithms to behave like fastest-response
  fallbackToFastestResponse: boolean;
  // Prefix-cache-aware routing settings
  prefixCacheAware: {
    enabled: boolean;
    hashTokenCount: number;
    hashBuckets: number;
  };
  // SLO fallback mode settings
  sloFallback: {
    enabled: boolean;
    ttftThresholdMs: number;
    p95WindowMs: number;
  };
  // Ghost server cleanup settings
  ghostServers: {
    staleThresholdMs: number;
    removeOnCleanup: boolean;
  };
  // Speculative probing: when the scored-eligible set can't cover the
  // request's concurrency footprint, sample UNKNOWN servers in-band.
  speculativeProbing?: {
    enabled: boolean;
    maxSamples: number;
    requestFootprint: number;
    triggerBelowEligible: number;
  };
  // Token-weighted load tracking settings
  tokenWeightedLoad?: {
    enabled: boolean;
    promptTokenWeight: number;
    outputTokenWeight: number;
  };
  // Quarantine pool settings
  quarantine?: {
    autoQuarantine: boolean;
    autoUnquarantineAfterCleanCycles: number;
    lastResortFallback: boolean;
  };
  // Source of loaded-model data for VRAM/cold-start scoring: 'psPoll' | 'hardware' | 'fallback'
  loadedModelSource?: 'psPoll' | 'hardware' | 'fallback';
}

/**
 * Default load balancer configuration
 */
export const DEFAULT_LB_CONFIG: LoadBalancerConfig = {
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
  saturationDiversificationThreshold: 0.5,
  defaultLatencyMs: 200,
  defaultMaxConcurrency: 4,
  streaming: {
    ttftWeight: 0.6,
    durationWeight: 0.4,
    ttftBlendAvg: 0.5,
    ttftBlendP95: 0.5,
    durationEstimateMultiplier: 2,
    chunkWeight: 0.2,
    maxChunkGapPenaltyMs: 5000,
  },
  roundRobin: {
    skipUnhealthy: true,
    checkCapacity: true,
    stickySessionsTtlMs: 0, // Disabled by default
    maxStickySessions: 10000, // LRU cap; T5 exposes this via env/config
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
    staleThresholdMs: 86400000,
    removeOnCleanup: false,
  },
  speculativeProbing: {
    enabled: true,
    maxSamples: 5,
    requestFootprint: 1,
    triggerBelowEligible: 2,
  },
  tokenWeightedLoad: {
    enabled: true,
    promptTokenWeight: 1.0,
    outputTokenWeight: 4.0,
  },
  loadedModelSource: 'psPoll',
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
  timeoutMs?: number,
  estimatedPromptTokens?: number,
  getContextLimit?: (serverId: string, model: string) => number,
  modelAvailabilityProvider?: ModelAvailabilityProvider
): ServerScore {
  const maxConcurrency = server.maxConcurrency ?? config.defaultMaxConcurrency;

  // When token-weighted load is enabled, use token-weighted load instead of simple count
  let effectiveCurrentLoad = currentLoad;
  let effectiveTotalLoad = totalLoad;
  if (config.tokenWeightedLoad?.enabled) {
    const inFlightManager = getInFlightManager();
    effectiveCurrentLoad = inFlightManager.getTokenWeightedLoad(server.id, model);
    effectiveTotalLoad = inFlightManager.getTotalTokenWeightedLoad(server.id);
  }

  const availableCapacity = maxConcurrency - effectiveCurrentLoad;

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
    // Fix §6.4: smooth curve instead of cliff at 95%
    // Use score = 100 * successRate^3 for smooth falloff
    successRateScore = metrics.successRate * 100 * Math.pow(metrics.successRate, 2);
  } else {
    // Fallback to lastResponseTime if no historical metrics
    const responseTime = server.lastResponseTime || config.defaultLatencyMs;
    latencyScore = Math.max(0, 100 - (responseTime / config.thresholds.maxP95Latency) * 100);
  }

  // B.1: Cold start penalty — penalize latency score when model is NOT loaded in VRAM
  // Mirrors selectFastestResponse() hot/cold awareness for the weighted algorithm.
  // Hot model: latency reflects reality. Cold model: latency will spike from model loading.
  // Use model availability provider when available; fall back to hardware snapshot.
  let loadedSnapshot = modelAvailabilityProvider?.getLoadedSnapshot(server.id, model);
  if (!loadedSnapshot && config.loadedModelSource !== 'fallback') {
    // @deprecated fallback to AIServer.hardware.loadedModels — use PsPollBackedProvider in production
    const hwLoaded = server.hardware?.loadedModels?.find(m => m.name === model);
    if (hwLoaded) {
      loadedSnapshot = {
        serverId: server.id,
        model,
        loadedAt: 0,
        sizeVram: hwLoaded.sizeVram ?? 0,
        expiresAt: hwLoaded.expiresAt ? new Date(hwLoaded.expiresAt).getTime() : 0,
        lastPolledAt: 0,
        source: 'hardware' as const,
      };
    }
  }
  if (!loadedSnapshot || loadedSnapshot.source === 'fallback') {
    // Model is cold (or stale) — apply penalty proportional to observed cold starts
    // Base penalty: reduce latency score by 15% (cold load adds significant latency)
    let coldPenalty = loadedSnapshot?.source === 'fallback' ? 0.8 : 0.85;
    if (metrics && metrics.coldStartCount > 0) {
      coldPenalty = Math.max(0.65, coldPenalty - metrics.coldStartCount * 0.01);
    }
    latencyScore *= coldPenalty;
  }

  // B.2: Model eviction awareness — penalize servers where model is about to be evicted
  // Mirrors selectFastestResponse() expiresAt thresholds for the weighted algorithm.
  // Near-eviction means the next request will likely trigger a cold reload.
  let evictionPenalty = 1.0;
  if (loadedSnapshot?.expiresAt && loadedSnapshot.expiresAt > 0) {
    const expiresIn = loadedSnapshot.expiresAt - Date.now();
    if (expiresIn < 30_000) {
      evictionPenalty = 0.6;
    } else if (expiresIn < 120_000) {
      evictionPenalty = 0.85;
    }
    if (evictionPenalty < 1.0) {
      latencyScore *= evictionPenalty;
    }
  }

  // B.3: Network overhead scoring — penalize servers with high client↔server network overhead
  // avgNetworkOverheadMs = (client-measured latency) - (server-reported total_duration).
  // >100ms overhead is notable; >500ms is severe. Scales latency score down by up to 20%.
  if (metrics?.avgNetworkOverheadMs && metrics.avgNetworkOverheadMs > 100) {
    const overheadFraction = Math.min(1, (metrics.avgNetworkOverheadMs - 100) / 400);
    latencyScore *= 1 - overheadFraction * 0.2;
  }

  // Load score: lower total load is better
  // Normalize: 0 load = 100, maxConcurrency * 2 = 0
  const maxExpectedLoad = maxConcurrency * 2;
  let loadScore = Math.max(0, 100 - (effectiveTotalLoad / maxExpectedLoad) * 100);

  // B.4: Queue wait time penalty — high avg queue wait means this server is congested.
  // >200ms wait is notable; >2000ms is severe. Scales load score down by up to 25%.
  if (metrics?.avgQueueWaitTimeMs && metrics.avgQueueWaitTimeMs > 200) {
    const queueFraction = Math.min(1, (metrics.avgQueueWaitTimeMs - 200) / 1800);
    loadScore *= 1 - queueFraction * 0.25;
  }

  // Capacity score: more available capacity is better
  // Normalize: maxConcurrency = 100, 0 = 0
  // Fix §6.4: capacity can go negative - clamp to 0
  const capacityScore = Math.max(0, (availableCapacity / maxConcurrency) * 100);

  let circuitBreakerScore = 100;
  if (metrics?.windows && metrics.windows['5m']) {
    const win = metrics.windows['5m'];
    if (win.count > 0) {
      const errorRate = win.errors / win.count;
      circuitBreakerScore = Math.max(0, (1 - errorRate) * 100);
    }
  }

  // Timeout score: lower timeout is better
  // Normalize: 30s = 100, 300s = 0 (5 min timeout = worst)
  const timeoutScore = timeoutMs ? Math.max(0, 100 - (timeoutMs / 300000) * 100) : 100;

  // REC-28: Throughput score: higher tokens/sec is better
  // Normalize: 0 t/s = 0, 50 t/s = 100 (capped)
  // Fix §6.4: throughput cold-start penalty - default to 50 (neutral) instead of 0
  let throughputScore = metrics ? Math.min(100, (metrics.avgTokensPerSecond / 50) * 100) : 50;

  // REC-29: VRAM score: prefer servers with enough free VRAM to hold the model
  // Uses loadedModels sizeVram to estimate model size; falls back to neutral 50 if unknown.
  // If model is already loaded (hot), score = 100. Otherwise compute free VRAM ratio.
  let vramScore = 50; // Neutral when no hardware data available
  const hw = server.hardware;
  if (loadedSnapshot && loadedSnapshot.source !== 'fallback') {
    vramScore = loadedSnapshot.sizeVram > 0 ? 100 * evictionPenalty : 75 * evictionPenalty;
  } else if (hw) {
    if (hw.totalVram !== undefined && hw.totalVram > 0) {
      // We have total VRAM info — estimate free VRAM
      const freeVram = hw.totalVram - (hw.usedVram ?? 0);
      // Estimate model size from any loaded model of similar name, or use usedVram as proxy
      // Use average sizeVram of loaded models as a rough model size estimate
      const loadedModels = hw.loadedModels ?? [];
      const modelSizeEstimate =
        loadedModels.length > 0
          ? loadedModels.reduce((sum, m) => sum + m.sizeVram, 0) / loadedModels.length
          : (hw.usedVram ?? 0);
      if (modelSizeEstimate > 0) {
        vramScore =
          freeVram >= modelSizeEstimate ? 100 : Math.max(0, (freeVram / modelSizeEstimate) * 100);
      } else {
        // Can't estimate model size but we know there's free VRAM
        vramScore = freeVram > 0 ? 75 : 25;
      }
    }
  }

  // Phase 3: Temporal scoring - get temporal adjustment if enabled
  const temporalScorer = getTemporalScorer();
  let temporalAdjustment: TemporalAdjustment | undefined;
  let temporalScore = 100; // Default neutral score

  if (temporalScorer.isEnabled()) {
    temporalAdjustment = temporalScorer.getAdjustment(server.id, model);

    // Apply temporal latency multiplier to latency score
    if (temporalAdjustment.confidence >= 0.3) {
      latencyScore = latencyScore / temporalAdjustment.latencyMultiplier;

      // Also adjust throughput based on temporal expectation
      throughputScore = throughputScore * temporalAdjustment.throughputMultiplier;
    }

    // Calculate temporal sub-score (higher is better when server is expected to perform well at this time)
    // 1.0 multiplier = 100 score, 0.5 multiplier = 50 score
    if (!temporalScorer.isShadowMode() && temporalAdjustment.confidence >= 0.3) {
      temporalScore =
        (100 / temporalAdjustment.latencyMultiplier) * temporalAdjustment.successRateMultiplier;
    }

    // Log temporal adjustment in debug mode
    if (temporalAdjustment.confidence > 0) {
      logger.debug('Temporal adjustment applied', {
        serverId: server.id,
        model,
        confidence: temporalAdjustment.confidence,
        latencyMult: temporalAdjustment.latencyMultiplier,
        throughputMult: temporalAdjustment.throughputMultiplier,
        reason: temporalAdjustment.reason,
        shadowMode: temporalScorer.isShadowMode(),
      });
    }
  }

  // REC-XXX: Context fit scoring - prefer servers with more context headroom
  // This rewards servers that can handle the prompt with room to generate
  let contextScore = 100; // Neutral when no estimation or limit data
  if (estimatedPromptTokens !== undefined && estimatedPromptTokens > 0 && getContextLimit) {
    const contextLimit = getContextLimit(server.id, model);
    if (contextLimit > 0) {
      // Compute headroom: how much context is left after the prompt
      // Use 90% of limit as effective (leaving 10% for response generation)
      const effectiveLimit = Math.floor(contextLimit * 0.9);
      const headroom = effectiveLimit - estimatedPromptTokens;

      if (headroom < 0) {
        // Can't handle the prompt - should be filtered earlier, but penalize heavily
        contextScore = 0;
      } else {
        // Score based on headroom ratio
        // headroom = 0 -> score = 50 (tight fit)
        // headroom = effectiveLimit -> score = 100 (lots of room)
        const headroomRatio = headroom / effectiveLimit;
        contextScore = 50 + headroomRatio * 50;
        contextScore = Math.min(100, Math.max(0, contextScore));
      }
    }
  }

  let itlScore = 100;
  let cacheHitScore = 100;
  let promptSizeScore = 100;
  let errorTypeScore = 100;

  if (metrics) {
    if (metrics.streamingMetrics?.avgChunkGapMs) {
      const gapMax = 500;
      itlScore = Math.max(0, 100 - (metrics.streamingMetrics.avgChunkGapMs / gapMax) * 100);
    }
    if (metrics.cacheHitRate !== undefined) {
      cacheHitScore = metrics.cacheHitRate * 100;
    }
    if (metrics.parameterSize) {
      const size = parseInt(metrics.parameterSize) || 0;
      promptSizeScore = size > 0 ? Math.min(100, (100 / size) * 50) : 50;
    }
    if (metrics.errorTypeHistogram) {
      const totalErrors = [...metrics.errorTypeHistogram.values()].reduce((s, c) => s + c, 0);
      errorTypeScore = totalErrors > 0 ? Math.max(0, 100 - Math.min(totalErrors * 10, 100)) : 100;
    }
  }

  // Calculate weighted total score (Phase 3: includes temporal weight)
  const contextWeight = config.weights.context ?? 0.05;
  const itlWeight = config.weights.itl ?? 0;
  const cacheHitWeight = config.weights.cacheHit ?? 0;
  const promptSizeWeight = config.weights.promptSize ?? 0;
  const errorTypeWeight = config.weights.errorType ?? 0;
  const totalScore =
    latencyScore * config.weights.latency +
    successRateScore * config.weights.successRate +
    loadScore * config.weights.load +
    capacityScore * config.weights.capacity +
    circuitBreakerScore * config.weights.circuitBreaker +
    timeoutScore * config.weights.timeout +
    throughputScore * config.weights.throughput +
    vramScore * config.weights.vram +
    temporalScore * (config.weights.temporal ?? 0) +
    contextScore * contextWeight +
    itlScore * itlWeight +
    cacheHitScore * cacheHitWeight +
    promptSizeScore * promptSizeWeight +
    errorTypeScore * errorTypeWeight;

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
      throughputScore,
      vramScore,
      temporalScore,
      contextScore,
      itlScore,
      cacheHitScore,
      promptSizeScore,
      errorTypeScore,
    },
    metrics,
    temporalAdjustment,
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
  | 'weighted-v2'
  | 'round-robin'
  | 'least-connections'
  | 'random'
  | 'fastest-response'
  | 'streaming-optimized'
  | 'prefix-cache-aware';

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
  /**
   * LRU-bounded sticky session cache.
   * Cap is set at construction time from `config.roundRobin.maxStickySessions`
   * (default 10000 if not set). Changing maxStickySessions at runtime requires
   * re-instantiating the LoadBalancer — the cap is NOT hot-reloaded.
   */
  private stickySessions!: BoundedMap<string, StickySessionEntry>;

  /**
   * IDs of servers that were speculatively probed on the most recent
   * `select()` call. Set when the eligible set was below
   * `config.speculativeProbing.triggerBelowEligible` and we sampled
   * UNKNOWN-state servers to act as in-band probes. Cleared at the start
   * of every `select()` call.
   */
  private currentSpeculativeIds: string[] = [];
  private stickySessionCleanupInterval?: NodeJS.Timeout;
  private probeOrchestrator?: ProbeOrchestrator;
  private endpointRegistry?: EndpointRegistry;
  private prefixCacheRouter?: PrefixCacheRouter;
  private sloFallbackMonitor?: SLOFallbackMonitor;
  private modelAvailabilityProvider?: ModelAvailabilityProvider;
  /**
   * Round-robin state per model for diversity tie-breaking in fastest-response.
   * When multiple servers are within 5% of the best score, we round-robin
   * among them to ensure traffic diversity instead of always picking the single best.
   */
  private lastSelectedByModel: Map<string, string> = new Map();

  constructor(config: Partial<LoadBalancerConfig> = {}) {
    this.config = {
      ...DEFAULT_LB_CONFIG,
      ...config,
      roundRobin: { ...DEFAULT_LB_CONFIG.roundRobin, ...config.roundRobin },
      leastConnections: { ...DEFAULT_LB_CONFIG.leastConnections, ...config.leastConnections },
      prefixCacheAware: { ...DEFAULT_LB_CONFIG.prefixCacheAware, ...config.prefixCacheAware },
      sloFallback: { ...DEFAULT_LB_CONFIG.sloFallback, ...config.sloFallback },
    };

    // Initialize LRU-bounded sticky sessions after config merge so maxStickySessions is available
    this.stickySessions = new BoundedMap(this.config.roundRobin.maxStickySessions ?? 10000);

    // Start sticky session cleanup if enabled
    if (this.config.roundRobin.stickySessionsTtlMs > 0) {
      this.startStickySessionCleanup();
    }
  }

  /**
   * Filter candidates based on user access control.
   * Throws 'Access denied' error if no candidates remain after filtering.
   */
  private filterByUserAccess(
    candidates: AIServer[],
    model: string,
    userId?: string,
    isAdmin?: boolean
  ): AIServer[] {
    // If no userId provided or user is admin, bypass filtering
    if (!userId || isAdmin) {
      return candidates;
    }

    const userStore = getUserStore();

    // Get user's allowed servers
    const serverAccess = userStore.listServerAccess(userId);
    const allowedServerIds = new Set(serverAccess.map((s: { serverId: string }) => s.serverId));

    // Get user's allowed models per server
    const modelAccess = userStore.listModelAccess(userId);
    const allowedModelsByServer = new Map<string, Set<string>>();
    for (const access of modelAccess) {
      if (!allowedModelsByServer.has(access.serverId)) {
        allowedModelsByServer.set(access.serverId, new Set());
      }
      allowedModelsByServer.get(access.serverId)!.add(access.model);
    }

    // Check if user has any server access at all
    if (allowedServerIds.size === 0) {
      // User has no servers assigned
      throw new Error('No servers assigned');
    }

    // Filter candidates: keep only servers user has access to
    const filtered = candidates.filter(server => {
      // Check if user has access to this server
      if (!allowedServerIds.has(server.id)) {
        return false;
      }

      // Check if user has access to this model on this server
      const allowedModels = allowedModelsByServer.get(server.id);
      if (allowedModels && !allowedModels.has(model)) {
        return false;
      }

      return true;
    });

    if (filtered.length === 0 && candidates.length > 0) {
      // User has server access but not to this model on any candidate
      throw new Error(`Access denied to model ${model}`);
    }

    return filtered;
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
      prefixCacheAware: {
        ...DEFAULT_LB_CONFIG.prefixCacheAware,
        ...this.config.prefixCacheAware,
        ...config.prefixCacheAware,
      },
      sloFallback: {
        ...DEFAULT_LB_CONFIG.sloFallback,
        ...this.config.sloFallback,
        ...config.sloFallback,
      },
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
    // Clear any existing interval first to prevent duplicates
    this.stopCleanup();

    const ttl = this.config.roundRobin.stickySessionsTtlMs;
    // Cleanup every TTL/2 to ensure timely removal
    // Note: LRU cap enforcement (when maxStickySessions is set) happens
    // automatically on every set() inside selectRoundRobin — no extra work needed here.
    this.stickySessionCleanupInterval = setInterval(() => {
      const now = Date.now();
      // Snapshot keys to avoid iterator issues during concurrent modification
      const clientIds = Array.from(this.stickySessions.keys());
      for (const clientId of clientIds) {
        const entry = this.stickySessions.get(clientId);
        if (entry && now - entry.lastUsed > ttl) {
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
   * Set probe orchestrator for canServe-based routing eligibility checks.
   */
  setProbeOrchestrator(probeOrchestrator: ProbeOrchestrator): void {
    this.probeOrchestrator = probeOrchestrator;
  }

  setEndpointRegistry(endpointRegistry: EndpointRegistry): void {
    this.endpointRegistry = endpointRegistry;
  }

  setPrefixCacheRouter(router: PrefixCacheRouter): void {
    this.prefixCacheRouter = router;
  }

  setSLOFallbackMonitor(monitor: SLOFallbackMonitor): void {
    this.sloFallbackMonitor = monitor;
  }

  /**
   * Set the model availability provider for hot/cold and VRAM scoring.
   * When set, the load balancer reads loaded-model state through the provider
   * instead of directly from server.hardware.loadedModels.
   */
  setModelAvailabilityProvider(provider: ModelAvailabilityProvider): void {
    this.modelAvailabilityProvider = provider;
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
    getTimeout?: (serverId: string, model: string) => number,
    estimatedPromptTokens?: number,
    getContextLimit?: (serverId: string, model: string) => number,
    userId?: string,
    isAdmin?: boolean,
    prompt?: string
  ): AIServer | undefined {
    this.currentSpeculativeIds = [];
    // Apply user access filtering before scoring
    const filteredCandidates = this.filterByUserAccess(candidates, model, userId, isAdmin);

    const quarantinePool = getQuarantinePool();
    const nonQuarantined = filteredCandidates.filter(s => !quarantinePool.isQuarantined(s.id));

    let candidatesToScore = nonQuarantined;
    if (candidatesToScore.length === 0 && this.config.quarantine?.lastResortFallback !== false) {
      candidatesToScore = filteredCandidates;
    }

    if (this.sloFallbackMonitor?.isActive() && this.config.fallbackToFastestResponse !== true) {
      return this.selectFastestResponse(
        candidatesToScore,
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
    }

    if (this.config.fallbackToFastestResponse) {
      return this.selectFastestResponse(
        candidatesToScore,
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
    }

    switch (this.algorithm) {
      case 'weighted':
      case 'weighted-v2':
        return this.selectWeighted(
          candidatesToScore,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          getTimeout,
          estimatedPromptTokens,
          getContextLimit
        );

      case 'round-robin':
        return this.selectRoundRobin(candidatesToScore, getTotalLoad, clientId, model);

      case 'least-connections':
        return this.selectLeastConnections(candidatesToScore, getTotalLoad, getMetrics, model);

      case 'random':
        return this.selectRandom(candidatesToScore);

      case 'fastest-response':
        return this.selectFastestResponse(
          candidatesToScore,
          model,
          getLoad,
          getTotalLoad,
          getMetrics
        );

      case 'streaming-optimized':
        return this.selectStreamingOptimized(
          candidatesToScore,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          isStreaming
        );

      case 'prefix-cache-aware':
        return this.selectPrefixCacheAware(
          candidatesToScore,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          prompt
        );

      default:
        return this.selectWeighted(
          candidatesToScore,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          getTimeout,
          estimatedPromptTokens,
          getContextLimit
        );
    }
  }

  /**
   * Returns true if at least one active endpoint tuple on (serverId, model)
   * can serve routing traffic (HEALTHY or SUSPECT probe state).
   */
  private canServeModel(serverId: string, model: string): boolean {
    if (!this.probeOrchestrator || !this.endpointRegistry) {
      return true;
    }
    const endpoints = this.endpointRegistry.getActiveEndpoints(serverId, model);
    if (endpoints.length === 0) {
      return true;
    }
    return endpoints.some(endpoint =>
      this.probeOrchestrator!.canServe({ serverId, model, endpoint }, 'routing')
    );
  }

  /**
   * Filter candidates to only those with at least one active endpoint tuple
   * that can serve routing traffic (HEALTHY or SUSPECT probe state).
   */
  filterByProbeHealth(candidates: AIServer[], model: string): AIServer[] {
    if (!this.probeOrchestrator || !this.endpointRegistry) {
      return candidates;
    }
    return candidates.filter(server => this.canServeModel(server.id, model));
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
    getTimeout?: (serverId: string, model: string) => number,
    estimatedPromptTokens?: number,
    getContextLimit?: (serverId: string, model: string) => number
  ): AIServer | undefined {
    const eligible = this.filterByProbeHealth(candidates, model);

    const scores = eligible.map(server => {
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
        timeoutMs,
        estimatedPromptTokens,
        getContextLimit,
        this.modelAvailabilityProvider
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
    clientId?: string,
    model?: string
  ): AIServer | undefined {
    if (candidates.length === 0) {
      return undefined;
    }

    const { roundRobin } = this.config;

    const eligibleByProbe = model ? this.filterByProbeHealth(candidates, model) : candidates;

    // Check for sticky session if enabled and clientId provided
    if (roundRobin.stickySessionsTtlMs > 0 && clientId) {
      const stickyEntry = this.stickySessions.get(clientId);
      if (stickyEntry) {
        const stickyServer = candidates.find(s => s.id === stickyEntry.serverId);
        if (stickyServer) {
          const isHealthy = !roundRobin.skipUnhealthy || stickyServer.healthy !== false;
          const hasCapacity =
            !roundRobin.checkCapacity ||
            getTotalLoad(stickyServer.id) <
              (stickyServer.maxConcurrency ?? this.config.defaultMaxConcurrency);
          const isProbeHealthy = !model || this.canServeModel(stickyServer.id, model);

          if (isHealthy && hasCapacity && isProbeHealthy) {
            stickyEntry.lastUsed = Date.now();
            logger.debug('Round-robin: using sticky session', {
              clientId,
              serverId: stickyServer.id,
            });
            return stickyServer;
          }
        }
        this.stickySessions.delete(clientId);
      }
    }

    let eligibleServers = eligibleByProbe;

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
      eligibleServers = candidates;
    }

    const safeIndex =
      eligibleServers.length > 0 ? this.roundRobinIndex % eligibleServers.length : 0;
    const currentIndex = safeIndex;
    this.roundRobinIndex = currentIndex + 1;
    const selected = eligibleServers[currentIndex];

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

    const eligibleServers = this.filterByProbeHealth(candidates, model);

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

    // Sort by score ascending (lower is better for least-connections)
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
  private selectFastestResponseInner(
    candidates: AIServer[],
    model: string,
    getLoad: (serverId: string, model: string) => number,
    getTotalLoad: (serverId: string) => number,
    getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined
  ): AIServer | undefined {
    if (candidates.length === 0) {
      return undefined;
    }

    const eligible = this.filterByProbeHealth(candidates, model);

    if (eligible.length === 0) {
      return undefined;
    }

    const speculativeConfig = this.config.speculativeProbing;
    let augmentedEligible = eligible;
    if (speculativeConfig?.enabled && eligible.length < candidates.length) {
      const requestFootprint = speculativeConfig.requestFootprint ?? 1;
      let availableSlots = 0;
      for (const server of eligible) {
        const maxConcurrency = server.maxConcurrency ?? this.config.defaultMaxConcurrency;
        const inFlight = getTotalLoad(server.id);
        availableSlots += Math.max(0, maxConcurrency - inFlight);
      }
      const eligibleShort = eligible.length <= (speculativeConfig.triggerBelowEligible ?? 2);
      const deficit = Math.max(0, requestFootprint - availableSlots);
      const sampleCount = Math.min(
        speculativeConfig.maxSamples ?? 5,
        eligibleShort || deficit > 0 ? deficit || 1 : 0
      );

      if (sampleCount > 0) {
        const eligibleIds = new Set(eligible.map(s => s.id));
        const untested = candidates.filter(s => !eligibleIds.has(s.id));
        const speculativePicks = this._selectSpeculativeServers(
          untested,
          model,
          sampleCount,
          getLoad,
          getTotalLoad
        );
        if (speculativePicks.length > 0) {
          augmentedEligible = [...eligible, ...speculativePicks];
        }
      }
    }

    if (augmentedEligible.length === 1) {
      return augmentedEligible[0];
    }

    const scored = augmentedEligible.map(server => {
      const metrics = getMetrics(server.id, model);
      const currentLoad = getLoad(server.id, model);
      const maxConcurrency = server.maxConcurrency ?? this.config.defaultMaxConcurrency;

      // Get effective latency (prefer P95 from metrics, fallback to lastResponseTime)
      let latency = server.lastResponseTime || this.config.defaultLatencyMs;
      if (metrics && metrics.percentiles.p95 > 0) {
        // Blend last response time with P95 (configurable weights)
        latency =
          latency * this.config.latencyBlendRecent +
          metrics.percentiles.p95 * this.config.latencyBlendHistorical;
      }

      // Adjust for current load (higher load = higher effective latency). The
      // loadFactorMultiplier (default 0.5) gives a soft linear penalty up to 1.5x
      // at full saturation. We layer a tiered penalty on top so that once a server
      // crosses the configured threshold (default 50% saturation), the penalty
      // accelerates — a saturated hot server should score worse than a cold
      // unprobed server so load spreads when the close group gets too small.
      const utilization = currentLoad / maxConcurrency;
      const loadFactor = 1 + utilization * this.config.loadFactorMultiplier;
      let adjustedLatency = latency * loadFactor;
      const saturationThreshold = this.config.saturationDiversificationThreshold ?? 0.5;
      if (utilization > saturationThreshold) {
        const overshoot = (utilization - saturationThreshold) / (1 - saturationThreshold);
        adjustedLatency *= 1 + overshoot * 2;
      }

      // Hot/cold model awareness: prefer servers where model is already loaded
      let loadedSnapshot = this.modelAvailabilityProvider?.getLoadedSnapshot(server.id, model);
      if (!loadedSnapshot && this.config.loadedModelSource !== 'fallback') {
        const hwLoaded = server.hardware?.loadedModels?.find(m => m.name === model);
        if (hwLoaded) {
          loadedSnapshot = {
            serverId: server.id,
            model,
            loadedAt: 0,
            sizeVram: hwLoaded.sizeVram ?? 0,
            expiresAt: hwLoaded.expiresAt ? new Date(hwLoaded.expiresAt).getTime() : 0,
            lastPolledAt: 0,
            source: 'hardware' as const,
          };
        }
      }
      const isHot = !!(loadedSnapshot && loadedSnapshot.source !== 'fallback');
      if (isHot) {
        // Model is hot - apply moderate boost (lower latency = higher priority)
        // Reduced from 0.5x to 0.8x to allow diversity when multiple servers are competitive
        adjustedLatency *= 0.8;

        // Penalize servers near eviction (model about to be unloaded)
        if (loadedSnapshot && loadedSnapshot.expiresAt && loadedSnapshot.expiresAt > 0) {
          const expiresIn = loadedSnapshot.expiresAt - Date.now();
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
        // Stale fallback gets a slightly worse penalty than truly cold (no data)
        adjustedLatency *= loadedSnapshot?.source === 'fallback' ? 1.15 : 1.1;
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

      if (metrics?.avgColdStartMagnitudeMs && metrics.avgColdStartMagnitudeMs > 1000) {
        const coldFactor = Math.min(1.3, 1 + metrics.avgColdStartMagnitudeMs / 30000);
        adjustedLatency *= coldFactor;
      }

      if (
        metrics?.streamingMetrics?.avgChunkGapMs &&
        metrics.streamingMetrics.avgChunkGapMs > 200
      ) {
        const gapPenalty = Math.min(1.2, 1 + metrics.streamingMetrics.avgChunkGapMs / 2000);
        adjustedLatency *= gapPenalty;
      }

      if (metrics?.errorTypeHistogram) {
        const fatalCount =
          (metrics.errorTypeHistogram.get('fatal') ?? 0) +
          (metrics.errorTypeHistogram.get('model_load_failure') ?? 0);
        if (fatalCount > 0) {
          adjustedLatency *= Math.min(1.3, 1 + fatalCount * 0.05);
        }
      }

      return {
        server,
        latency: adjustedLatency,
        rawLatency: latency,
        load: currentLoad,
        isHot,
      };
    });

    // Sort by adjusted latency (ascending - lower is better)
    scored.sort((a, b) => a.latency - b.latency);

    // Diversity tie-breaker: include enough servers in the close group to
    // satisfy the request footprint. The legacy 5% threshold is the floor;
    // for high-footprint loads (orchestrators fanning out, batch jobs) we
    // widen by 5% increments until the group can carry `requestFootprint`
    // concurrent slots at `defaultMaxConcurrency` per server. We cap at
    // 50% widening to keep the algorithm latency-oriented.
    const requestFootprint = this.config.speculativeProbing?.requestFootprint ?? 1;
    const defaultMaxConcurrency = this.config.defaultMaxConcurrency;
    const minCloseGroup = Math.max(
      2,
      Math.ceil(requestFootprint / Math.max(defaultMaxConcurrency, 1))
    );

    // Saturation penalty: if the close-group is too small to satisfy the
    // request footprint, the hot-server penalty is too weak to push load
    // onto unprobed servers (hot 117ms vs cold 1100ms is 9.4× apart).
    // Strengthen the per-server loadFactor by squaring the (1+load/cap)
    // multiplier for already-saturated servers, then re-sort so they fall
    // out of the close-group. This nudges the LB to consider cold-but-empty
    // servers instead of repeatedly hammering a saturated hot one.
    const saturationThreshold = Math.max(
      1,
      Math.ceil(requestFootprint / Math.max(defaultMaxConcurrency, 1))
    );
    if (augmentedEligible.length > saturationThreshold) {
      let needsDiversification = false;
      for (const s of augmentedEligible) {
        const maxC = s.maxConcurrency ?? defaultMaxConcurrency;
        const load = getLoad(s.id, model);
        if (load / maxC >= 0.5) {
          needsDiversification = true;
          break;
        }
      }
      if (needsDiversification) {
        for (const s of scored) {
          const maxC = s.server.maxConcurrency ?? defaultMaxConcurrency;
          const load = getLoad(s.server.id, model);
          if (load > 0 && maxC > 0) {
            const saturationRatio = load / maxC;
            // Quadratic penalty: at 50% load → 1.25×; at 100% load → 4×.
            // Pushes saturated hot servers past the unprobed 1100ms floor.
            const penalty = Math.pow(1 + saturationRatio, 2);
            s.latency *= penalty;
          }
        }
        scored.sort((a, b) => a.latency - b.latency);
      }
    }

    const bestLatency = scored[0].latency;
    let closeCandidates = scored.filter(s => s.latency <= bestLatency * 1.05);
    let widenedPct = 5;
    while (closeCandidates.length < minCloseGroup && widenedPct <= 200) {
      closeCandidates = scored.filter(s => s.latency <= bestLatency * (1 + widenedPct / 100));
      widenedPct += 5;
    }

    let selectedEntry: (typeof scored)[0];
    if (closeCandidates.length > 1) {
      // Round-robin: find last selected server for this model, pick the next in the close group
      const lastSelectedId = this.lastSelectedByModel.get(model);
      const lastIndex = lastSelectedId
        ? closeCandidates.findIndex(s => s.server.id === lastSelectedId)
        : -1;
      const nextIndex = (lastIndex + 1) % closeCandidates.length;
      selectedEntry = closeCandidates[nextIndex];
      this.lastSelectedByModel.set(model, selectedEntry.server.id);
    } else {
      selectedEntry = scored[0];
    }

    logger.debug('Fastest response selection', {
      candidates: scored.map((s, i) => ({
        rank: i + 1,
        serverId: s.server.id,
        latency: s.latency,
        rawLatency: s.rawLatency,
        load: s.load,
        isHot: s.isHot,
        inCloseGroup: closeCandidates.some(c => c.server.id === s.server.id),
      })),
      selected: selectedEntry.server.id,
      closeGroupSize: closeCandidates.length,
      diversityTieBreak: closeCandidates.length > 1,
    });

    return selectedEntry.server;
  }

  getSpeculativeIds(): string[] {
    return [...this.currentSpeculativeIds];
  }

  /**
   * Pick up to `maxSamples` servers from the candidate pool that are not yet
   * in the eligible set. Excludes UNHEALTHY probe-state tuples; prefers
   * servers with lower current load; tracks picks in `currentSpeculativeIds`
   * so the routing layer can surface them in debug headers.
   */
  private _selectSpeculativeServers(
    candidates: AIServer[],
    model: string,
    maxSamples: number,
    getLoad: (serverId: string, model: string) => number,
    getTotalLoad: (serverId: string) => number
  ): AIServer[] {
    if (candidates.length === 0 || maxSamples <= 0) {
      return [];
    }

    const generationEndpoints = GENERATION_ENDPOINTS;
    const eligibleSpeculative: AIServer[] = [];

    for (const server of candidates) {
      if (!this.probeOrchestrator) {
        eligibleSpeculative.push(server);
        continue;
      }
      let hasUnhealthyTuple = false;
      for (const ep of generationEndpoints) {
        const ts = this.probeOrchestrator.getTupleState({
          serverId: server.id,
          model,
          endpoint: ep,
        });
        if (ts && ts.state === 'UNHEALTHY') {
          hasUnhealthyTuple = true;
          break;
        }
      }
      if (!hasUnhealthyTuple) {
        eligibleSpeculative.push(server);
      }
    }

    eligibleSpeculative.sort((a, b) => {
      const loadA = getTotalLoad(a.id) + getLoad(a.id, model);
      const loadB = getTotalLoad(b.id) + getLoad(b.id, model);
      return loadA - loadB;
    });

    const picks = eligibleSpeculative.slice(0, maxSamples);
    this.currentSpeculativeIds = picks.map(s => s.id);
    return picks;
  }

  selectFastestResponse(
    candidates: AIServer[],
    model: string,
    getLoad: (serverId: string, model: string) => number,
    getTotalLoad: (serverId: string) => number,
    getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined
  ): AIServer | undefined {
    return this.selectFastestResponseInner(candidates, model, getLoad, getTotalLoad, getMetrics);
  }

  private selectPrefixCacheAware(
    candidates: AIServer[],
    model: string,
    getLoad: (serverId: string, model: string) => number,
    getTotalLoad: (serverId: string) => number,
    getMetrics: (serverId: string, model: string) => ServerModelMetrics | undefined,
    prompt?: string
  ): AIServer | undefined {
    if (!this.prefixCacheRouter || !this.config.prefixCacheAware.enabled) {
      return this.selectFastestResponseInner(candidates, model, getLoad, getTotalLoad, getMetrics);
    }
    const result = this.prefixCacheRouter.selectPrefixCacheAware(
      prompt,
      model,
      candidates,
      (servers, m) => this.filterByProbeHealth(servers, m),
      getLoad,
      getTotalLoad,
      getMetrics,
      (servers, m, gl, gtl, gm) => this.selectFastestResponseInner(servers, m, gl, gtl, gm)
    );
    return result ?? undefined;
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

    const eligible = this.filterByProbeHealth(candidates, model);

    if (eligible.length === 0) {
      return undefined;
    }

    if (eligible.length === 1) {
      return eligible[0];
    }

    if (!isStreaming) {
      return this.selectFastestResponse(eligible, model, getLoad, getTotalLoad, getMetrics);
    }

    const { streaming } = this.config;

    const scored = eligible.map(server => {
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
      let chunkThroughputScore = 50; // Default middle score if no chunk data
      let chunkGapPenalty = 1; // No penalty by default

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

        // Calculate chunk throughput score
        // Higher chunks/second = better score (0-100)
        if (sm.avgChunkCount > 0 && sm.avgStreamingDuration > 0) {
          const chunksPerSecond = (sm.avgChunkCount / sm.avgStreamingDuration) * 1000;
          // Normalize: 10 chunks/s = 100, 1 chunk/s = 10
          chunkThroughputScore = Math.min(100, chunksPerSecond * 10);
        }

        // Check for chunk gap penalty (stalled streams)
        if (sm.maxChunkGapPercentiles?.p95 > streaming.maxChunkGapPenaltyMs) {
          chunkGapPenalty = 0.5; // 50% penalty for frequently stalled streams
        }
      }

      // Check for actively stalled requests (real-time stall detection)
      const inFlightManager = getInFlightManager();
      const stalledRequestCount = inFlightManager.getStalledRequestCount(server.id, model);
      if (stalledRequestCount > 0) {
        // Apply penalty based on number of stalled requests
        // More stalled requests = higher penalty (capped at 50% penalty)
        const stallPenalty = Math.max(0.5, 1 - stalledRequestCount * 0.1);
        chunkGapPenalty = Math.min(chunkGapPenalty, stallPenalty);

        logger.debug('Applying stall penalty to server', {
          serverId: server.id,
          model,
          stalledRequestCount,
          chunkGapPenalty,
        });
      }

      // Adjust for load using config value. Layer a tiered penalty on top so
      // that saturated hot servers score worse than cold unprobed ones, so load
      // spreads when the close group gets too small.
      const loadFactor = 1 + (currentLoad / maxConcurrency) * this.config.loadFactorMultiplier;
      const saturationThreshold = this.config.saturationDiversificationThreshold ?? 0.5;
      if (currentLoad / maxConcurrency > saturationThreshold) {
        const overshoot =
          (currentLoad / maxConcurrency - saturationThreshold) / (1 - saturationThreshold);
        const extraPenalty = 1 + overshoot * 2;
        chunkGapPenalty = Math.min(chunkGapPenalty, extraPenalty);
      }

      // Calculate weighted score (lower is better)
      const adjustedTTFT = ttft * loadFactor;
      const adjustedDuration = streamingDuration * loadFactor;

      // Normalize scores to 0-100 scale where lower is better
      // TTFT and duration: convert to score (100 - normalized value)
      const ttftScore = Math.max(0, 100 - adjustedTTFT / 100); // ms -> score
      const durationScore = Math.max(0, 100 - adjustedDuration / 100); // ms -> score

      // Combined streaming score with weights (adjusted to account for chunkWeight)
      const adjustedTtftWeight = streaming.ttftWeight * (1 - streaming.chunkWeight);
      const adjustedDurationWeight = streaming.durationWeight * (1 - streaming.chunkWeight);
      const chunkWeight = streaming.chunkWeight;

      const combinedScore =
        ttftScore * adjustedTtftWeight +
        durationScore * adjustedDurationWeight +
        chunkThroughputScore * chunkWeight;

      // Apply chunk gap penalty
      const finalScore = combinedScore * chunkGapPenalty;

      return {
        server,
        score: finalScore,
        ttft: adjustedTTFT,
        duration: adjustedDuration,
        chunkThroughput: chunkThroughputScore,
        load: currentLoad,
      };
    });

    // Sort by score descending (higher score = better server: higher TTFT/duration scores = lower latency)
    scored.sort((a, b) => b.score - a.score);

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
