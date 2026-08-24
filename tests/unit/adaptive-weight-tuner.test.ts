/**
 * adaptive-weight-tuner.test.ts
 * Tests for the AdaptiveWeightTuner class — verifies weight adjustment logic,
 * correlation of decisions with failover outcomes, normalization, and edge cases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import type { DecisionEvent, FailoverAttempt } from '../../src/decision-history.js';
import {
  AdaptiveWeightTuner,
  getAdaptiveWeightTuner,
  resetAdaptiveWeightTuner,
} from '../../src/load-balancer/adaptive-weight-tuner.js';
import type { AdaptiveWeightTunerConfig } from '../../src/load-balancer/adaptive-weight-tuner.js';

/* ---------- helpers ---------- */

function makeDecision(
  overrides: Partial<DecisionEvent> & {
    breakdown?: Partial<DecisionEvent['candidates'][number]['breakdown']>;
  } = {}
): DecisionEvent {
  const { breakdown, ...rest } = overrides;
  return {
    timestamp: Date.now(),
    model: 'llama3',
    selectedServerId: 'server-1',
    algorithm: 'weighted',
    candidates: [
      {
        serverId: 'server-1',
        totalScore: 0.8,
        breakdown: {
          latencyScore: 0.8,
          successRateScore: 0.9,
          loadScore: 0.7,
          capacityScore: 0.6,
          ...breakdown,
        },
      },
    ],
    selectionReason: 'highest_score',
    ...rest,
  };
}

function makeFailover(overrides: Partial<FailoverAttempt> = {}): FailoverAttempt {
  return {
    timestamp: Date.now(),
    model: 'llama3',
    phase: 1,
    serverId: 'server-1',
    result: 'success',
    latencyMs: 200,
    ...overrides,
  };
}

interface MockDecisionHistory {
  getRecentEvents: ReturnType<typeof vi.fn>;
  getRecentFailoverAttempts: ReturnType<typeof vi.fn>;
}

interface MockLoadBalancer {
  updateConfig: ReturnType<typeof vi.fn>;
}

interface MockMetricsStore {
  getRequestsByDecisionId: ReturnType<typeof vi.fn>;
}

function createMocks(): {
  history: MockDecisionHistory;
  lb: MockLoadBalancer;
  metricsStore: MockMetricsStore;
} {
  return {
    history: {
      getRecentEvents: vi.fn().mockReturnValue([]),
      getRecentFailoverAttempts: vi.fn().mockReturnValue([]),
    },
    lb: {
      updateConfig: vi.fn(),
    },
    metricsStore: {
      getRequestsByDecisionId: vi.fn().mockReturnValue([]),
    },
  };
}

const BASE_CONFIG: Partial<AdaptiveWeightTunerConfig> = {
  enabled: true,
  tuningIntervalMs: 1000,
  analysisWindowMs: 60_000,
  learningRate: 0.05,
  minSamplesForTuning: 3, // low threshold for testing
  maxWeightDelta: 0.03,
  weightFloor: 0.02,
  weightCeiling: 0.35,
};

/* ---------- tests ---------- */

describe('AdaptiveWeightTuner', () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    vi.useFakeTimers();
    resetAdaptiveWeightTuner();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAdaptiveWeightTuner();
  });

  function createTuner(configOverride?: Partial<AdaptiveWeightTunerConfig>): AdaptiveWeightTuner {
    return new AdaptiveWeightTuner(
      { ...BASE_CONFIG, ...configOverride },
      () => mocks.history as unknown as import('../../src/decision-history.js').DecisionHistory,
      () => mocks.lb as unknown as import('../../src/load-balancer/load-balancer.js').LoadBalancer,
      () =>
        mocks.metricsStore as unknown as import('../../src/storage/metrics-store.js').MetricsStore
    );
  }

  describe('tune() — insufficient samples', () => {
    it('skips tuning when decisions are below minSamplesForTuning', () => {
      const tuner = createTuner({ minSamplesForTuning: 10 });

      mocks.history.getRecentEvents.mockReturnValue([makeDecision(), makeDecision()]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      tuner.tune();

      const result = tuner.getLastTuningResult();
      expect(result).toBeDefined();
      expect(result!.reason).toBe('insufficient_samples');
      expect(result!.samplesAnalyzed).toBe(2);
      expect(mocks.lb.updateConfig).not.toHaveBeenCalled();
    });

    it('records zero adjustments when skipping', () => {
      const tuner = createTuner({ minSamplesForTuning: 10 });
      mocks.history.getRecentEvents.mockReturnValue([]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      expect(result.adjustments).toEqual({
        latency: 0,
        successRate: 0,
        load: 0,
        capacity: 0,
      });
    });
  });

  describe('tune() — decision-failover correlation', () => {
    it('classifies decisions with matching failure failovers as bad', () => {
      const now = Date.now();
      const decisions = Array.from({ length: 5 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          breakdown: {
            latencyScore: 0.3,
            successRateScore: 0.3,
            loadScore: 0.3,
            capacityScore: 0.3,
          },
        })
      );
      const failovers = decisions.map(d =>
        makeFailover({
          timestamp: d.timestamp + 100, // within 5s window
          model: d.model,
          serverId: d.selectedServerId,
          result: 'failure',
        })
      );

      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue(failovers);

      const tuner = createTuner();
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      // All decisions are "bad" — no "good" to compare against,
      // so signal = avgGood (0) - avgBad (0.3) = -0.3 for each dim
      // rawDelta = 0.05 * -0.3 = -0.015
      expect(result.reason).toBe('weights_adjusted');
      expect(result.adjustments.latency).toBeLessThan(0);
    });

    it('classifies decisions without matching failover as good (success assumed)', () => {
      const now = Date.now();
      const decisions = Array.from({ length: 5 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          breakdown: {
            latencyScore: 0.9,
            successRateScore: 0.9,
            loadScore: 0.9,
            capacityScore: 0.9,
          },
        })
      );

      // No matching failovers — all decisions assumed successful
      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      const tuner = createTuner();
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      // All good, no bad → signal = avgGood(0.9) - avgBad(0) = 0.9
      // rawDelta = 0.05 * 0.9 = 0.045, clamped to 0.03
      expect(result.reason).toBe('weights_adjusted');
      for (const dim of ['latency', 'successRate', 'load', 'capacity'] as const) {
        expect(result.adjustments[dim]).toBeGreaterThan(0);
      }
    });

    it('does not correlate failovers outside the 5s window', () => {
      const now = Date.now();
      const decisions = Array.from({ length: 5 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          breakdown: {
            latencyScore: 0.5,
            successRateScore: 0.5,
            loadScore: 0.5,
            capacityScore: 0.5,
          },
        })
      );
      // Failovers are 10s away — outside the 5s correlation window
      const failovers = decisions.map(d =>
        makeFailover({
          timestamp: d.timestamp + 10_000,
          model: d.model,
          serverId: d.selectedServerId,
          result: 'failure',
        })
      );

      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue(failovers);

      const tuner = createTuner();
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      // No matching failover → all decisions treated as good
      // signal = avgGood(0.5) - avgBad(0) = 0.5 → positive adjustments
      for (const dim of ['latency', 'successRate', 'load', 'capacity'] as const) {
        expect(result.adjustments[dim]).toBeGreaterThan(0);
      }
    });
  });

  describe('tune() — weight adjustment mechanics', () => {
    it('clamps adjustments to maxWeightDelta', () => {
      const now = Date.now();
      // Create strongly differentiated good vs bad decisions
      const goodDecisions = Array.from({ length: 3 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          breakdown: {
            latencyScore: 1.0,
            successRateScore: 1.0,
            loadScore: 1.0,
            capacityScore: 1.0,
          },
        })
      );
      const badDecisions = Array.from({ length: 3 }, (_, i) =>
        makeDecision({
          timestamp: now - (i + 10) * 1000,
          selectedServerId: 'server-bad',
          breakdown: {
            latencyScore: 0.0,
            successRateScore: 0.0,
            loadScore: 0.0,
            capacityScore: 0.0,
          },
          candidates: [
            {
              serverId: 'server-bad',
              totalScore: 0.1,
              breakdown: {
                latencyScore: 0.0,
                successRateScore: 0.0,
                loadScore: 0.0,
                capacityScore: 0.0,
              },
            },
          ],
        })
      );
      const badFailovers = badDecisions.map(d =>
        makeFailover({
          timestamp: d.timestamp + 100,
          model: d.model,
          serverId: 'server-bad',
          result: 'failure',
        })
      );

      mocks.history.getRecentEvents.mockReturnValue([...goodDecisions, ...badDecisions]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue(badFailovers);

      const tuner = createTuner({ maxWeightDelta: 0.03, learningRate: 0.5 });
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      // signal = 1.0 - 0.0 = 1.0, rawDelta = 0.5 * 1.0 = 0.5 → clamped to 0.03
      for (const dim of ['latency', 'successRate', 'load', 'capacity'] as const) {
        expect(Math.abs(result.adjustments[dim])).toBeLessThanOrEqual(0.03 + 1e-9);
      }
    });

    it('enforces weightFloor and weightCeiling', () => {
      const now = Date.now();
      // Create decisions that would push weights very low
      const decisions = Array.from({ length: 5 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          breakdown: {
            latencyScore: 0.0,
            successRateScore: 0.0,
            loadScore: 0.0,
            capacityScore: 0.0,
          },
        })
      );
      // All are failures
      const failovers = decisions.map(d =>
        makeFailover({
          timestamp: d.timestamp + 100,
          model: d.model,
          serverId: d.selectedServerId,
          result: 'failure',
        })
      );

      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue(failovers);

      const tuner = createTuner({ weightFloor: 0.02, weightCeiling: 0.35 });

      // Run many tuning cycles to push weights down repeatedly
      for (let cycle = 0; cycle < 50; cycle++) {
        tuner.tune();
      }

      const result = tuner.getLastTuningResult()!;
      for (const dim of ['latency', 'successRate', 'load', 'capacity'] as const) {
        expect(result.newWeights[dim]).toBeGreaterThanOrEqual(0.02 - 1e-9);
        expect(result.newWeights[dim]).toBeLessThanOrEqual(0.35 + 1e-9);
      }
    });

    it('normalizes tunable weights to preserve aggregate sum', () => {
      const now = Date.now();
      // Mix of good and bad to create asymmetric adjustments
      const goodDecisions = Array.from({ length: 3 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          breakdown: {
            latencyScore: 0.9,
            successRateScore: 0.2,
            loadScore: 0.8,
            capacityScore: 0.3,
          },
        })
      );
      const badDecisions = Array.from({ length: 3 }, (_, i) =>
        makeDecision({
          timestamp: now - (i + 10) * 1000,
          selectedServerId: 'server-bad',
          breakdown: {
            latencyScore: 0.2,
            successRateScore: 0.9,
            loadScore: 0.3,
            capacityScore: 0.8,
          },
          candidates: [
            {
              serverId: 'server-bad',
              totalScore: 0.5,
              breakdown: {
                latencyScore: 0.2,
                successRateScore: 0.9,
                loadScore: 0.3,
                capacityScore: 0.8,
              },
            },
          ],
        })
      );
      const badFailovers = badDecisions.map(d =>
        makeFailover({
          timestamp: d.timestamp + 100,
          model: d.model,
          serverId: 'server-bad',
          result: 'failure',
        })
      );

      mocks.history.getRecentEvents.mockReturnValue([...goodDecisions, ...badDecisions]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue(badFailovers);

      const tuner = createTuner();
      // Record the initial weight sum
      const initialSum = 0.17 + 0.17 + 0.17 + 0.05; // 0.56
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      const newSum =
        result.newWeights.latency +
        result.newWeights.successRate +
        result.newWeights.load +
        result.newWeights.capacity;

      // The normalization should keep the sum approximately equal
      // (floor/ceiling clamping may cause minor deviations)
      expect(newSum).toBeCloseTo(initialSum, 1);
    });

    it('reports no_change_needed when signal is zero', () => {
      const now = Date.now();
      // All decisions are identical and all succeed — signal = avg - 0 for each dim,
      // but if we have equal good/bad with identical scores, signal = 0
      const decisions = Array.from({ length: 6 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          selectedServerId: i < 3 ? 'server-1' : 'server-bad',
          breakdown: {
            latencyScore: 0.5,
            successRateScore: 0.5,
            loadScore: 0.5,
            capacityScore: 0.5,
          },
          candidates: [
            {
              serverId: i < 3 ? 'server-1' : 'server-bad',
              totalScore: 0.5,
              breakdown: {
                latencyScore: 0.5,
                successRateScore: 0.5,
                loadScore: 0.5,
                capacityScore: 0.5,
              },
            },
          ],
        })
      );
      // First 3 succeed, last 3 fail — but all have same breakdown scores
      const failovers = decisions.slice(3).map(d =>
        makeFailover({
          timestamp: d.timestamp + 100,
          model: d.model,
          serverId: 'server-bad',
          result: 'failure',
        })
      );

      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue(failovers);

      const tuner = createTuner();
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      // signal = 0.5 - 0.5 = 0 → no change
      expect(result.reason).toBe('no_change_needed');
      expect(mocks.lb.updateConfig).not.toHaveBeenCalled();
    });
  });

  describe('tune() — LoadBalancer.updateConfig integration', () => {
    it('calls updateConfig with adjusted weights on change', () => {
      const now = Date.now();
      const decisions = Array.from({ length: 5 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          breakdown: {
            latencyScore: 0.9,
            successRateScore: 0.9,
            loadScore: 0.9,
            capacityScore: 0.9,
          },
        })
      );

      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      const tuner = createTuner();
      tuner.tune();

      expect(mocks.lb.updateConfig).toHaveBeenCalledTimes(1);
      const call = mocks.lb.updateConfig.mock.calls[0][0];
      expect(call).toHaveProperty('weights');
      expect(call.weights).toHaveProperty('latency');
      expect(call.weights).toHaveProperty('successRate');
      expect(call.weights).toHaveProperty('load');
      expect(call.weights).toHaveProperty('capacity');
    });

    it('does not call updateConfig when reason is no_change_needed', () => {
      const now = Date.now();
      const decisions = Array.from({ length: 6 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          selectedServerId: i < 3 ? 'server-1' : 'server-bad',
          breakdown: {
            latencyScore: 0.5,
            successRateScore: 0.5,
            loadScore: 0.5,
            capacityScore: 0.5,
          },
          candidates: [
            {
              serverId: i < 3 ? 'server-1' : 'server-bad',
              totalScore: 0.5,
              breakdown: {
                latencyScore: 0.5,
                successRateScore: 0.5,
                loadScore: 0.5,
                capacityScore: 0.5,
              },
            },
          ],
        })
      );
      const failovers = decisions.slice(3).map(d =>
        makeFailover({
          timestamp: d.timestamp + 100,
          model: d.model,
          serverId: 'server-bad',
          result: 'failure',
        })
      );

      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue(failovers);

      const tuner = createTuner();
      tuner.tune();

      expect(mocks.lb.updateConfig).not.toHaveBeenCalled();
    });
  });

  describe('tune() — analysis window filtering', () => {
    it('excludes decisions outside the analysis window', () => {
      const now = Date.now();
      // 3 decisions inside window, 5 outside
      const insideDecisions = Array.from({ length: 3 }, (_, i) =>
        makeDecision({ timestamp: now - i * 1000 })
      );
      const outsideDecisions = Array.from(
        { length: 5 },
        (_, i) => makeDecision({ timestamp: now - 120_000 - i * 1000 }) // well outside 60s window
      );

      mocks.history.getRecentEvents.mockReturnValue([...insideDecisions, ...outsideDecisions]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      const tuner = createTuner({ analysisWindowMs: 60_000, minSamplesForTuning: 3 });
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      // Should have analyzed exactly 3 samples (the ones inside the window)
      expect(result.samplesAnalyzed).toBe(3);
      expect(result.reason).toBe('weights_adjusted');
    });

    it('returns insufficient_samples when only old decisions exist', () => {
      const now = Date.now();
      const oldDecisions = Array.from({ length: 10 }, (_, i) =>
        makeDecision({ timestamp: now - 120_000 - i * 1000 })
      );

      mocks.history.getRecentEvents.mockReturnValue(oldDecisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      const tuner = createTuner({ analysisWindowMs: 60_000, minSamplesForTuning: 3 });
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      expect(result.reason).toBe('insufficient_samples');
    });
  });

  describe('start() / stop() lifecycle', () => {
    it('starts periodic tuning at the configured interval', () => {
      const tuner = createTuner({ tuningIntervalMs: 5000 });
      const tuneSpy = vi.spyOn(tuner, 'tune');

      mocks.history.getRecentEvents.mockReturnValue([]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      tuner.start();

      // Advance by one interval
      vi.advanceTimersByTime(5000);
      expect(tuneSpy).toHaveBeenCalledTimes(1);

      // Advance by another interval
      vi.advanceTimersByTime(5000);
      expect(tuneSpy).toHaveBeenCalledTimes(2);

      tuner.stop();
    });

    it('stop() prevents further tuning cycles', () => {
      const tuner = createTuner({ tuningIntervalMs: 1000 });
      const tuneSpy = vi.spyOn(tuner, 'tune');

      mocks.history.getRecentEvents.mockReturnValue([]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      tuner.start();
      vi.advanceTimersByTime(1000);
      expect(tuneSpy).toHaveBeenCalledTimes(1);

      tuner.stop();
      vi.advanceTimersByTime(5000);
      expect(tuneSpy).toHaveBeenCalledTimes(1); // no more calls
    });

    it('start() is idempotent (does not create duplicate intervals)', () => {
      const tuner = createTuner({ tuningIntervalMs: 1000 });
      const tuneSpy = vi.spyOn(tuner, 'tune');

      mocks.history.getRecentEvents.mockReturnValue([]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      tuner.start();
      tuner.start(); // second call should be no-op
      tuner.start(); // third call should be no-op

      vi.advanceTimersByTime(1000);
      expect(tuneSpy).toHaveBeenCalledTimes(1); // only one interval running

      tuner.stop();
    });
  });

  describe('singleton — getAdaptiveWeightTuner / resetAdaptiveWeightTuner', () => {
    it('returns the same instance on subsequent calls', () => {
      const t1 = getAdaptiveWeightTuner(
        BASE_CONFIG,
        () => mocks.history as unknown as import('../../src/decision-history.js').DecisionHistory,
        () =>
          mocks.lb as unknown as import('../../src/load-balancer/load-balancer.js').LoadBalancer,
        () =>
          mocks.metricsStore as unknown as import('../../src/storage/metrics-store.js').MetricsStore
      );
      const t2 = getAdaptiveWeightTuner();
      expect(t1).toBe(t2);
    });

    it('throws when first call lacks factory functions', () => {
      expect(() => getAdaptiveWeightTuner({})).toThrow(
        'getDecisionHistory, getLoadBalancer, and getMetricsStore are required on first call'
      );
    });

    it('creates a fresh instance after resetAdaptiveWeightTuner()', () => {
      const t1 = getAdaptiveWeightTuner(
        BASE_CONFIG,
        () => mocks.history as unknown as import('../../src/decision-history.js').DecisionHistory,
        () =>
          mocks.lb as unknown as import('../../src/load-balancer/load-balancer.js').LoadBalancer,
        () =>
          mocks.metricsStore as unknown as import('../../src/storage/metrics-store.js').MetricsStore
      );
      resetAdaptiveWeightTuner();
      const t2 = getAdaptiveWeightTuner(
        BASE_CONFIG,
        () => mocks.history as unknown as import('../../src/decision-history.js').DecisionHistory,
        () =>
          mocks.lb as unknown as import('../../src/load-balancer/load-balancer.js').LoadBalancer,
        () =>
          mocks.metricsStore as unknown as import('../../src/storage/metrics-store.js').MetricsStore
      );
      expect(t1).not.toBe(t2);
    });
  });

  describe('tune() — multi-cycle convergence', () => {
    it('weights converge towards effective dimensions over multiple cycles', () => {
      const now = Date.now();

      // Setup: latency strongly predicts success (high for good, low for bad)
      //        capacity is noise (same for both)
      const goodDecisions = Array.from({ length: 5 }, (_, i) =>
        makeDecision({
          timestamp: now - i * 1000,
          breakdown: {
            latencyScore: 0.95,
            successRateScore: 0.5,
            loadScore: 0.5,
            capacityScore: 0.5,
          },
        })
      );
      const badDecisions = Array.from({ length: 5 }, (_, i) =>
        makeDecision({
          timestamp: now - (i + 20) * 1000,
          selectedServerId: 'server-bad',
          breakdown: {
            latencyScore: 0.1,
            successRateScore: 0.5,
            loadScore: 0.5,
            capacityScore: 0.5,
          },
          candidates: [
            {
              serverId: 'server-bad',
              totalScore: 0.3,
              breakdown: {
                latencyScore: 0.1,
                successRateScore: 0.5,
                loadScore: 0.5,
                capacityScore: 0.5,
              },
            },
          ],
        })
      );
      const badFailovers = badDecisions.map(d =>
        makeFailover({
          timestamp: d.timestamp + 100,
          model: d.model,
          serverId: 'server-bad',
          result: 'failure',
        })
      );

      mocks.history.getRecentEvents.mockReturnValue([...goodDecisions, ...badDecisions]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue(badFailovers);

      const tuner = createTuner({ learningRate: 0.05, maxWeightDelta: 0.03 });
      const initialLatencyWeight = 0.17;

      // Run 10 tuning cycles
      for (let i = 0; i < 10; i++) {
        tuner.tune();
      }

      const result = tuner.getLastTuningResult()!;
      // Latency should have gained weight (strong positive signal)
      expect(result.newWeights.latency).toBeGreaterThan(initialLatencyWeight);
    });
  });

  describe('getLastTuningResult()', () => {
    it('returns undefined before any tuning', () => {
      const tuner = createTuner();
      expect(tuner.getLastTuningResult()).toBeUndefined();
    });

    it('returns the most recent result after tuning', () => {
      const tuner = createTuner();
      mocks.history.getRecentEvents.mockReturnValue([]);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      tuner.tune();

      const result = tuner.getLastTuningResult();
      expect(result).toBeDefined();
      expect(result!.timestamp).toBeDefined();
      expect(result!.reason).toBe('insufficient_samples');
    });
  });

  describe('tune() — getRequestsByDecisionId direct correlation', () => {
    it('prefers getRequestsByDecisionId over failover heuristic when decisionId is present', () => {
      const now = Date.now();
      const decId = 'dec-direct-001';
      // Decision with low scores — correlated via decisionId as failure (success: 0)
      const badDecision = makeDecision({
        id: decId,
        timestamp: now - 500,
        model: 'llama3',
        breakdown: { latencyScore: 0.2, successRateScore: 0.2, loadScore: 0.2, capacityScore: 0.2 },
      });
      // Legacy decision with high scores — no correlation data, no failover match → assumed good
      const goodDecision = makeDecision({
        id: 'dec-legacy',
        timestamp: now - 400,
        model: 'llama3',
        breakdown: { latencyScore: 0.9, successRateScore: 0.9, loadScore: 0.9, capacityScore: 0.9 },
      });
      const decisions = [badDecision, goodDecision];

      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);

      mocks.metricsStore.getRequestsByDecisionId.mockImplementation((id: string) => {
        if (id === decId) {
          return [
            { id: 'req-1', decision_id: decId, success: 0, timestamp: now - 300 },
          ] as unknown as import('../../src/storage/types.js').RequestRow[];
        }
        return [] as unknown as import('../../src/storage/types.js').RequestRow[];
      });

      const tuner = createTuner({ minSamplesForTuning: 1 });
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      expect(result.reason).toBe('weights_adjusted');
      // Bad: low latency (0.2), Good: high latency (0.9) → avgGood(0.9) - avgBad(0.2) = 0.7 → positive delta
      expect(result.adjustments.latency).toBeGreaterThan(0);
    });

    it('falls back to getRecentFailoverAttempts when getRequestsByDecisionId returns empty', () => {
      const now = Date.now();
      const decId = 'dec-no-correlation';
      // Decision with no matching correlation data and no matching failover (different model)
      const decisions = [
        makeDecision({
          id: decId,
          timestamp: now - 500,
          model: 'llama3',
          breakdown: {
            latencyScore: 0.1,
            successRateScore: 0.1,
            loadScore: 0.1,
            capacityScore: 0.1,
          },
        }),
      ];

      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([
        makeFailover({
          timestamp: now - 200,
          model: 'different-model',
          serverId: 'srv-1',
          result: 'failure',
        }),
      ]);
      mocks.metricsStore.getRequestsByDecisionId.mockReturnValue([]);

      const tuner = createTuner({ minSamplesForTuning: 1 });
      tuner.tune();

      const result = tuner.getLastTuningResult()!;
      expect(result.reason).toBe('weights_adjusted');
    });

    it('uses decisionId from DecisionEvent when available', () => {
      const now = Date.now();
      const decId = 'dec-id-abc';
      const decisions = [
        makeDecision({
          id: decId,
          timestamp: now,
          model: 'mistral',
          breakdown: {
            latencyScore: 0.5,
            successRateScore: 0.5,
            loadScore: 0.5,
            capacityScore: 0.5,
          },
        }),
      ];

      mocks.history.getRecentEvents.mockReturnValue(decisions);
      mocks.history.getRecentFailoverAttempts.mockReturnValue([]);
      mocks.metricsStore.getRequestsByDecisionId.mockReturnValue([
        { id: 'req-x', decision_id: decId, success: 1, timestamp: now + 100 },
      ] as unknown as import('../../src/storage/types.js').RequestRow[]);

      const tuner = createTuner({ minSamplesForTuning: 1 });
      tuner.tune();

      expect(mocks.metricsStore.getRequestsByDecisionId).toHaveBeenCalledWith(decId);
      const result = tuner.getLastTuningResult()!;
      expect(result.reason).toBe('weights_adjusted');
    });
  });
});
