/**
 * adaptive-weight-tuner.ts
 * Auto-adjusts load balancer scoring weights based on observed performance outcomes.
 */

import type { DecisionHistory, DecisionEvent, FailoverAttempt } from '../decision-history.js';
import type { MetricsStore } from '../storage/metrics-store.js';
import { logger } from '../utils/logger.js';

import type { LoadBalancerConfig } from './load-balancer.js';
import type { LoadBalancer } from './load-balancer.js';

export interface AdaptiveWeightTunerConfig {
  enabled: boolean;
  tuningIntervalMs: number;
  analysisWindowMs: number;
  learningRate: number;
  minSamplesForTuning: number;
  maxWeightDelta: number;
  weightFloor: number;
  weightCeiling: number;
}

const DEFAULT_TUNER_CONFIG: AdaptiveWeightTunerConfig = {
  enabled: true,
  tuningIntervalMs: 300_000,
  analysisWindowMs: 900_000,
  learningRate: 0.05,
  minSamplesForTuning: 50,
  maxWeightDelta: 0.03,
  weightFloor: 0.02,
  weightCeiling: 0.35,
};

export interface TuningResult {
  timestamp: number;
  samplesAnalyzed: number;
  previousWeights: Record<string, number>;
  newWeights: Record<string, number>;
  adjustments: Record<string, number>;
  reason: string;
}

// The 4 dimensions available in DecisionEvent.candidates[].breakdown
const TUNABLE_DIMS = ['latency', 'successRate', 'load', 'capacity'] as const;
type TunableDim = (typeof TUNABLE_DIMS)[number];

// Proximity window to match a decision to a failover attempt
const CORRELATION_WINDOW_MS = 5000;

export class AdaptiveWeightTuner {
  private config: AdaptiveWeightTunerConfig;
  private getDecisionHistory: () => DecisionHistory;
  private getLoadBalancer: () => LoadBalancer;
  private getMetricsStore: () => MetricsStore;
  private intervalHandle?: NodeJS.Timeout;
  private lastTuningResult?: TuningResult;
  // Track current weights for the 4 tunable dims (start from LB defaults)
  private currentTunableWeights: Record<TunableDim, number> = {
    latency: 0.17,
    successRate: 0.17,
    load: 0.17,
    capacity: 0.05,
  };

  constructor(
    config: Partial<AdaptiveWeightTunerConfig>,
    getDecisionHistory: () => DecisionHistory,
    getLoadBalancer: () => LoadBalancer,
    getMetricsStore: () => MetricsStore
  ) {
    this.config = { ...DEFAULT_TUNER_CONFIG, ...config };
    this.getDecisionHistory = getDecisionHistory;
    this.getLoadBalancer = getLoadBalancer;
    this.getMetricsStore = getMetricsStore;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  start(): void {
    if (this.intervalHandle) {
      return;
    }
    logger.info('[AdaptiveWeightTuner] Starting', {
      tuningIntervalMs: this.config.tuningIntervalMs,
    });
    this.intervalHandle = setInterval(() => {
      this.tune();
    }, this.config.tuningIntervalMs);
  }

  stop(): void {
    if (!this.intervalHandle) {
      return;
    }
    clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
    logger.info('[AdaptiveWeightTuner] Stopped');
  }

  getLastTuningResult(): TuningResult | undefined {
    return this.lastTuningResult;
  }

  tune(): void {
    const now = Date.now();
    const cutoff = now - this.config.analysisWindowMs;
    const history = this.getDecisionHistory();

    // Step 1: Gather recent decisions and failover attempts
    const allDecisions = history.getRecentEvents(500);
    const allFailovers = history.getRecentFailoverAttempts(500);

    // Step 2: Filter to analysis window
    const decisions = allDecisions.filter(d => d.timestamp >= cutoff);
    const failovers = allFailovers.filter(f => f.timestamp >= cutoff);

    // Step 3: Check minimum sample threshold
    if (decisions.length < this.config.minSamplesForTuning) {
      logger.debug('[AdaptiveWeightTuner] Skipping tune — insufficient samples', {
        samplesFound: decisions.length,
        minRequired: this.config.minSamplesForTuning,
      });
      this.lastTuningResult = {
        timestamp: now,
        samplesAnalyzed: decisions.length,
        previousWeights: { ...this.currentTunableWeights },
        newWeights: { ...this.currentTunableWeights },
        adjustments: Object.fromEntries(TUNABLE_DIMS.map(d => [d, 0])),
        reason: 'insufficient_samples',
      };
      return;
    }

    // Step 4: Correlate decisions with outcomes
    // Prefer direct correlation via getRequestsByDecisionId when decision.id is a real UUID.
    // Fall back to failover heuristic (model+server+proximity) for legacy decisions
    // whose ids are the SQLite row-derived "row-N" format.
    const goodBreakdowns: Array<Record<TunableDim, number>> = [];
    const badBreakdowns: Array<Record<TunableDim, number>> = [];

    for (const decision of decisions) {
      const selectedCandidate = decision.candidates.find(
        c => c.serverId === decision.selectedServerId
      );
      if (!selectedCandidate) {
        continue;
      }

      const isLegacyDecision = !decision.id || decision.id.startsWith('row-');
      let outcome: 'good' | 'bad' | 'unknown' = 'unknown';

      if (!isLegacyDecision) {
        const requests = this.getMetricsStore().getRequestsByDecisionId(decision.id);
        if (requests.length > 0) {
          const allSuccess = requests.every(r => r.success === 1);
          const anyFailure = requests.some(r => r.success === 0);
          outcome = anyFailure ? 'bad' : allSuccess ? 'good' : 'unknown';
        }
      }

      if (outcome === 'unknown') {
        const matchingFailover = findMatchingFailover(decision, failovers, CORRELATION_WINDOW_MS);
        if (!matchingFailover) {
          outcome = 'good';
        } else if (matchingFailover.result === 'failure') {
          outcome = 'bad';
        } else {
          outcome = 'good';
        }
      }

      if (outcome === 'bad') {
        badBreakdowns.push(breakdownToRecord(selectedCandidate.breakdown));
      } else if (outcome === 'good') {
        goodBreakdowns.push(breakdownToRecord(selectedCandidate.breakdown));
      }
    }

    const totalSamples = goodBreakdowns.length + badBreakdowns.length;

    // Step 5: Compute per-dimension correlation signal
    // dimensionSignal = avg breakdown score for good decisions − avg for bad decisions
    const prevWeights = { ...this.currentTunableWeights };
    const adjustments: Record<string, number> = {};
    const updatedWeights = { ...this.currentTunableWeights };

    for (const dim of TUNABLE_DIMS) {
      const avgGood = average(goodBreakdowns.map(b => b[dim]));
      const avgBad = average(badBreakdowns.map(b => b[dim]));
      const signal = avgGood - avgBad;

      // Step 6: Compute clamped delta and apply
      const rawDelta = this.config.learningRate * signal;
      const clampedDelta = clamp(rawDelta, -this.config.maxWeightDelta, this.config.maxWeightDelta);
      adjustments[dim] = clampedDelta;
      updatedWeights[dim] = clamp(
        this.currentTunableWeights[dim] + clampedDelta,
        this.config.weightFloor,
        this.config.weightCeiling
      );
    }

    // Step 7: Normalize the 4 tunable dims so they sum to the same aggregate as before
    const prevSum = sumRecord(prevWeights);
    const newSum = sumRecord(updatedWeights);

    // Only normalize if newSum changed meaningfully
    if (newSum > 0 && Math.abs(newSum - prevSum) > 1e-9) {
      const scale = prevSum / newSum;
      for (const dim of TUNABLE_DIMS) {
        updatedWeights[dim] = clamp(
          updatedWeights[dim] * scale,
          this.config.weightFloor,
          this.config.weightCeiling
        );
      }
    }

    // Check if anything actually changed
    const anyChange = TUNABLE_DIMS.some(d => Math.abs(updatedWeights[d] - prevWeights[d]) > 1e-9);

    if (!anyChange) {
      this.lastTuningResult = {
        timestamp: now,
        samplesAnalyzed: totalSamples,
        previousWeights: prevWeights,
        newWeights: { ...prevWeights },
        adjustments: Object.fromEntries(TUNABLE_DIMS.map(d => [d, 0])),
        reason: 'no_change_needed',
      };
      return;
    }

    // Step 8: Apply via LoadBalancer.updateConfig()
    this.currentTunableWeights = updatedWeights;

    this.getLoadBalancer().updateConfig({
      weights: {
        latency: updatedWeights.latency,
        successRate: updatedWeights.successRate,
        load: updatedWeights.load,
        capacity: updatedWeights.capacity,
      } as LoadBalancerConfig['weights'],
    });

    // Step 9: Record and log result
    this.lastTuningResult = {
      timestamp: now,
      samplesAnalyzed: totalSamples,
      previousWeights: prevWeights,
      newWeights: { ...updatedWeights },
      adjustments,
      reason: 'weights_adjusted',
    };

    logger.info('[AdaptiveWeightTuner] Weights adjusted', {
      samplesAnalyzed: totalSamples,
      goodSamples: goodBreakdowns.length,
      badSamples: badBreakdowns.length,
      adjustments,
      newWeights: updatedWeights,
    });
  }
}

function findMatchingFailover(
  decision: DecisionEvent,
  failovers: FailoverAttempt[],
  windowMs: number
): FailoverAttempt | undefined {
  return failovers.find(
    f =>
      f.model === decision.model &&
      f.serverId === decision.selectedServerId &&
      Math.abs(f.timestamp - decision.timestamp) <= windowMs
  );
}

function breakdownToRecord(
  breakdown: DecisionEvent['candidates'][number]['breakdown']
): Record<TunableDim, number> {
  return {
    latency: breakdown.latencyScore,
    successRate: breakdown.successRateScore,
    load: breakdown.loadScore,
    capacity: breakdown.capacityScore,
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sumRecord(record: Record<TunableDim, number>): number {
  return TUNABLE_DIMS.reduce((acc, d) => acc + record[d], 0);
}

let instance: AdaptiveWeightTuner | null = null;

export function getAdaptiveWeightTuner(
  config?: Partial<AdaptiveWeightTunerConfig>,
  getDecisionHistory?: () => DecisionHistory,
  getLoadBalancer?: () => LoadBalancer,
  getMetricsStore?: () => MetricsStore
): AdaptiveWeightTuner {
  if (!instance) {
    if (!getDecisionHistory || !getLoadBalancer || !getMetricsStore) {
      throw new Error(
        'AdaptiveWeightTuner: getDecisionHistory, getLoadBalancer, and getMetricsStore are required on first call'
      );
    }
    instance = new AdaptiveWeightTuner(
      config ?? {},
      getDecisionHistory,
      getLoadBalancer,
      getMetricsStore
    );
  }
  return instance;
}

export function resetAdaptiveWeightTuner(): void {
  instance = null;
}
