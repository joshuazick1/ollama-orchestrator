import type { TDigest } from '../utils/tdigest.js';

export interface PrefixHashResult {
  hash: string;
  tokenCount: number;
  originalLength: number;
}

export interface ServerScoreBreakdown {
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
}

export interface SLOMode {
  mode: 'normal' | 'fallback';
  triggeredAt?: number;
  reason?: string;
}

export interface TokenWeightedLoad {
  currentLoad: number;
  tokenLoad: number;
  connectionLoad: number;
}

export interface ColdStartEvent {
  serverId: string;
  model: string;
  loadDurationMs: number;
  timestamp: number;
}

export interface ErrorTypeMetric {
  serverId: string;
  model: string;
  errorType: string;
  count: number;
  lastSeen: number;
}

export interface PerSizeLatencyBucket {
  rangeMin: number;
  rangeMax: number;
  tdigest: TDigest;
  sampleCount: number;
  lastUpdated: number;
}
