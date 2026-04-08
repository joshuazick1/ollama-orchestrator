/**
 * temporal-scorer.ts
 * Temporal-aware load balancing using historical performance patterns
 */

import { getMetricsStore } from '../storage/metrics-store.js';
import type { TemporalProfileRow, DailyRollupRow } from '../storage/types.js';
import { logger } from '../utils/logger.js';

export interface TemporalAdjustment {
  latencyMultiplier: number;
  successRateMultiplier: number;
  throughputMultiplier: number;
  confidence: number;
  reason: string;
}

export interface TemporalConfig {
  enabled: boolean;
  minConfidence: number;
  maxAdjustment: number;
  shadowMode: boolean;
  modelFallbackConfidence: number;
  serverFallbackConfidence: number;
}

const DEFAULT_TEMPORAL_CONFIG: TemporalConfig = {
  enabled: true,
  minConfidence: 0.3,
  maxAdjustment: 2.0,
  shadowMode: false,
  modelFallbackConfidence: 0.6,
  serverFallbackConfidence: 0.4,
};

export class TemporalScorer {
  private config: TemporalConfig;
  private profileCache: Map<string, TemporalProfileRow | null> = new Map();
  private overallCache: Map<string, DailyRollupRow | null> = new Map();
  private cacheTTL: number = 60_000; // 1 minute cache
  private lastCacheUpdate: number = 0;

  constructor(config: Partial<TemporalConfig> = {}) {
    this.config = { ...DEFAULT_TEMPORAL_CONFIG, ...config };
  }

  updateConfig(config: Partial<TemporalConfig>): void {
    this.config = { ...this.config, ...config };
    this.clearCache();
  }

  clearCache(): void {
    this.profileCache.clear();
    this.overallCache.clear();
    this.lastCacheUpdate = 0;
  }

  private getHourOfDay(date: Date = new Date()): number {
    return date.getUTCHours();
  }

  private getDayOfWeek(date: Date = new Date()): number {
    return date.getUTCDay();
  }

  private getCacheKey(
    serverId: string,
    model: string,
    hourOfDay: number,
    dayOfWeek: number
  ): string {
    return `${serverId}:${model}:${hourOfDay}:${dayOfWeek}`;
  }

  private getOverallCacheKey(serverId: string, model: string): string {
    return `${serverId}:${model}`;
  }

  private isCacheValid(): boolean {
    return Date.now() - this.lastCacheUpdate < this.cacheTTL;
  }

  getAdjustment(serverId: string, model: string, now?: Date): TemporalAdjustment {
    if (!this.config.enabled) {
      return this.neutralAdjustment('disabled');
    }

    const date = now ?? new Date();
    const hourOfDay = this.getHourOfDay(date);
    const dayOfWeek = this.getDayOfWeek(date);

    const profile = this.getTemporalProfile(serverId, model, hourOfDay, dayOfWeek);
    if (!profile || profile.confidence < this.config.minConfidence) {
      return this.neutralAdjustment('low-confidence');
    }

    const overall = this.getOverallAverage(serverId, model);
    if (!overall) {
      return this.neutralAdjustment('no-overall-data');
    }

    const effectiveConfidence = this.applyFallbackConfidence(profile);
    const overallLatency =
      overall.total_requests > 0 ? overall.latency_sum / overall.total_requests : null;
    const overallSuccessRate =
      overall.total_requests > 0 ? overall.successes / overall.total_requests : null;
    const latencyMult = this.calculateMultiplier(
      profile.avg_latency_ms,
      overallLatency,
      effectiveConfidence
    );
    const successMult = this.calculateMultiplier(
      profile.success_rate,
      overallSuccessRate,
      effectiveConfidence,
      true
    );
    const throughputMult = this.calculateMultiplier(
      profile.avg_tokens_per_second,
      overall.avg_tokens_per_second,
      effectiveConfidence,
      true
    );

    const reason = this.buildReason(profile, effectiveConfidence, hourOfDay, dayOfWeek);

    return {
      latencyMultiplier: this.clampMultiplier(latencyMult),
      successRateMultiplier: this.clampMultiplier(successMult, true),
      throughputMultiplier: this.clampMultiplier(throughputMult, true),
      confidence: effectiveConfidence,
      reason,
    };
  }

  getComparativeAdjustments(
    model: string,
    serverIds: string[],
    now?: Date
  ): Map<string, TemporalAdjustment> {
    const adjustments = new Map<string, TemporalAdjustment>();
    for (const serverId of serverIds) {
      adjustments.set(serverId, this.getAdjustment(serverId, model, now));
    }
    return adjustments;
  }

  private getTemporalProfile(
    serverId: string,
    model: string,
    hourOfDay: number,
    dayOfWeek: number
  ): TemporalProfileRow | null {
    const cacheKey = this.getCacheKey(serverId, model, hourOfDay, dayOfWeek);

    if (this.profileCache.has(cacheKey)) {
      return this.profileCache.get(cacheKey) ?? null;
    }

    if (!this.isCacheValid()) {
      this.clearCache();
    }

    try {
      const store = getMetricsStore();
      const profile = store.getTemporalProfile(serverId, model, hourOfDay, dayOfWeek);
      this.profileCache.set(cacheKey, profile ?? null);
      this.lastCacheUpdate = Date.now();
      return profile;
    } catch (error) {
      logger.warn('Failed to get temporal profile', {
        error,
        serverId,
        model,
        hourOfDay,
        dayOfWeek,
      });
      return null;
    }
  }

  private getOverallAverage(serverId: string, model: string): DailyRollupRow | null {
    const cacheKey = this.getOverallCacheKey(serverId, model);

    if (this.overallCache.has(cacheKey)) {
      return this.overallCache.get(cacheKey) ?? null;
    }

    if (!this.isCacheValid()) {
      this.clearCache();
    }

    try {
      const store = getMetricsStore();
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // 14 days
      const rollups = store.getDailyRollups({
        serverId,
        model,
        startTime: cutoff,
      });

      if (rollups.length === 0) {
        this.overallCache.set(cacheKey, null);
        return null;
      }

      const totalRequests = rollups.reduce((sum, r) => sum + r.total_requests, 0);
      if (totalRequests === 0) {
        this.overallCache.set(cacheKey, null);
        return null;
      }

      const totalLatency = rollups.reduce((sum, r) => sum + r.latency_sum, 0);
      const totalSuccesses = rollups.reduce((sum, r) => sum + r.successes, 0);
      const totalTokens = rollups.reduce((sum, r) => sum + r.tokens_generated, 0);

      const weighted: DailyRollupRow = {
        server_id: serverId,
        model: model,
        date_str: '',
        total_requests: totalRequests,
        user_requests: 0,
        successes: totalSuccesses,
        failures: rollups.reduce((sum, r) => sum + r.failures, 0),
        cold_starts: 0,
        latency_sum: totalLatency,
        latency_sq_sum: 0,
        latency_min: null,
        latency_max: null,
        latency_p50: null,
        latency_p95: null,
        latency_p99: null,
        ttft_count: 0,
        ttft_sum: 0,
        ttft_p50: null,
        ttft_p95: null,
        tokens_generated: totalTokens,
        tokens_prompt: rollups.reduce((sum, r) => sum + r.tokens_prompt, 0),
        avg_tokens_per_second:
          totalTokens > 0 && totalRequests > 0 ? totalTokens / totalRequests : null,
        errors_timeout: 0,
        errors_oom: 0,
        errors_connection: 0,
        errors_other: 0,
        day_of_week: 0,
      };

      weighted.avg_tokens_per_second =
        weighted.tokens_generated > 0 && totalRequests > 0
          ? weighted.tokens_generated / totalRequests
          : null;

      this.overallCache.set(cacheKey, weighted);
      this.lastCacheUpdate = Date.now();
      return weighted;
    } catch (error) {
      logger.warn('Failed to get overall average', { error, serverId, model });
      return null;
    }
  }

  private applyFallbackConfidence(profile: TemporalProfileRow): number {
    let effectiveConfidence = profile.confidence;

    if (profile.profile_type === 'model') {
      effectiveConfidence *= this.config.modelFallbackConfidence;
    } else if (profile.profile_type === 'server') {
      effectiveConfidence *= this.config.serverFallbackConfidence;
    }

    return effectiveConfidence;
  }

  private calculateMultiplier(
    profileValue: number | null,
    overallValue: number | null,
    confidence: number,
    invert: boolean = false
  ): number {
    if (profileValue === null || overallValue === null || overallValue === 0) {
      return 1.0;
    }

    let rawMultiplier = profileValue / overallValue;

    if (invert) {
      rawMultiplier = overallValue / profileValue;
    }

    const effectiveMultiplier = 1.0 + (rawMultiplier - 1.0) * confidence;
    return effectiveMultiplier;
  }

  private clampMultiplier(multiplier: number, invert: boolean = false): number {
    if (invert) {
      return Math.max(0.5, Math.min(2.0, multiplier));
    }
    return Math.max(0.5, Math.min(this.config.maxAdjustment, multiplier));
  }

  private neutralAdjustment(reason: string): TemporalAdjustment {
    return {
      latencyMultiplier: 1.0,
      successRateMultiplier: 1.0,
      throughputMultiplier: 1.0,
      confidence: 0,
      reason,
    };
  }

  private buildReason(
    profile: TemporalProfileRow,
    effectiveConfidence: number,
    hourOfDay: number,
    dayOfWeek: number
  ): string {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const timeStr = `${dayNames[dayOfWeek]} ${hourOfDay}:00 UTC`;

    let typeStr = 'exact';
    if (profile.profile_type === 'model') {
      typeStr = 'model-wide';
    }
    if (profile.profile_type === 'server') {
      typeStr = 'server-wide';
    }

    return `${typeStr} profile at ${timeStr}, confidence ${effectiveConfidence.toFixed(2)}, ${profile.sample_count} samples`;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isShadowMode(): boolean {
    return this.config.shadowMode;
  }

  getConfig(): TemporalConfig {
    return { ...this.config };
  }
}

let temporalScorerInstance: TemporalScorer | null = null;

export function getTemporalScorer(config?: Partial<TemporalConfig>): TemporalScorer {
  if (!temporalScorerInstance) {
    temporalScorerInstance = new TemporalScorer(config);
  }
  return temporalScorerInstance;
}

export function resetTemporalScorer(): void {
  temporalScorerInstance = null;
}
