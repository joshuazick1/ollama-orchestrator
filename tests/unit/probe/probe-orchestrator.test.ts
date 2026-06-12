import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ProbeOrchestrator } from '../../../src/probe/probe-orchestrator.js';
import type { Tuple, ProbeState, Classification } from '../../../src/probe/types.js';

const TUPLE: Tuple = { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' };
const TUPLE2: Tuple = { serverId: 'srv2', model: 'llama3', endpoint: 'ollama_chat' };

function makeClassification(kind: Classification['kind']): Classification {
  return { kind, retryable: true };
}

describe('ProbeOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  // -------------------------------------------------------------------------
  // 1. All 7 transition rules
  // -------------------------------------------------------------------------

  describe('HEALTHY transitions', () => {
    it('HEALTHY + success → HEALTHY (increments consecutiveSuccesses)', () => {
      const o = new ProbeOrchestrator();
      o.recordProbeResult(TUPLE, true);
      o.recordProbeResult(TUPLE, true);
      expect(o.getState(TUPLE)).toBe('HEALTHY');
      expect(o.getTupleState(TUPLE)?.consecutiveSuccesses).toBe(2);
    });

    it('HEALTHY + failure → SUSPECT (consecutiveFailures=1, lastErrorKind set)', () => {
      const o = new ProbeOrchestrator();
      const result = o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');
      expect(o.getState(TUPLE)).toBe('SUSPECT');
      const ts = o.getTupleState(TUPLE)!;
      expect(ts.consecutiveFailures).toBe(1);
      expect(ts.consecutiveSuccesses).toBe(0);
      expect(ts.lastErrorKind).toBe('transient');
    });
  });

  describe('SUSPECT transitions', () => {
    it('SUSPECT + success → HEALTHY (consecutiveFailures=0)', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'SUSPECT');
      o.recordProbeResult(TUPLE, true);
      expect(o.getState(TUPLE)).toBe('HEALTHY');
      expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBe(0);
    });

    it('SUSPECT + failure → stays SUSPECT until threshold', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'SUSPECT');
      // Set high consecutiveSuccesses to suppress error rate path
      // so we test the consecutiveFailures path only
      o.getTupleState(TUPLE)!.consecutiveSuccesses = 10;

      // First failure in SUSPECT
      vi.advanceTimersByTime(1000);
      let result = o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');
      expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBe(1);
      // Second failure in SUSPECT
      vi.advanceTimersByTime(1000);
      result = o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');
      expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBe(2);
      // Third failure → UNHEALTHY (unhealthyAfterFailures=3)
      vi.advanceTimersByTime(1000);
      result = o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('UNHEALTHY');
    });
  });

  describe('UNHEALTHY transitions', () => {
    it('UNHEALTHY + success → RECOVERING (sets nextProbeAt)', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      const before = Date.now();
      const result = o.recordProbeResult(TUPLE, true);
      expect(result).toBe('RECOVERING');
      const ts = o.getTupleState(TUPLE)!;
      expect(ts.nextProbeAt).toBeGreaterThanOrEqual(before + 10_000);
      expect(ts.consecutiveSuccesses).toBe(1);
    });

    it('UNHEALTHY + failure → stays UNHEALTHY (consecutiveFailures++)', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      const result = o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('UNHEALTHY');
      expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBeGreaterThanOrEqual(1);
    });
  });

  describe('RECOVERING transitions', () => {
    it('RECOVERING + success → stays RECOVERING until threshold', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      // First success in RECOVERING
      let result = o.recordProbeResult(TUPLE, true);
      expect(result).toBe('RECOVERING');
      expect(o.getTupleState(TUPLE)?.consecutiveSuccesses).toBe(1);
      // Second success
      result = o.recordProbeResult(TUPLE, true);
      expect(result).toBe('RECOVERING');
      expect(o.getTupleState(TUPLE)?.consecutiveSuccesses).toBe(2);
    });

    it('RECOVERING + success × 5 → HEALTHY (recoverySuccessThreshold=5)', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      for (let i = 0; i < 5; i++) {
        const result = o.recordProbeResult(TUPLE, true);
        if (i < 4) expect(result).toBe('RECOVERING');
        else expect(result).toBe('HEALTHY');
      }
      expect(o.getState(TUPLE)).toBe('HEALTHY');
      expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(0);
    });

    it('RECOVERING + failure → UNHEALTHY (increments recoveryAttempts)', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      o.getTupleState(TUPLE)!.recoveryAttempts = 2;
      const result = o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('UNHEALTHY');
      expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(3);
      expect(o.getTupleState(TUPLE)?.consecutiveSuccesses).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Error rate escalation from SUSPECT
  // -------------------------------------------------------------------------

  it('SUSPECT escalates to UNHEALTHY via error rate threshold', () => {
    const config = {
      intervalMs: 30_000,
      suspectAfterFailures: 1,
      unhealthyAfterFailures: 3,
      errorRateSuspectThreshold: 0.3,
      errorRateUnhealthyThreshold: 0.7,
      suspectWindowMs: 60_000,
      recoveryBackoffMs: [10_000, 30_000, 60_000, 300_000, 900_000],
      recoverySuccessThreshold: 5,
      probeTimeoutMs: 5_000,
      maxConcurrentProbes: 10,
      snapshotIntervalMs: 300_000,
      walTruncateThreshold: 10_000,
    };
    const o = new ProbeOrchestrator(config);

    // Alternate success/failure to build up error rate
    // After 2 failures and 1 success in window, errorRate = 2/3 > 0.7
    o.setStateForTesting(TUPLE, 'SUSPECT');
    o.getTupleState(TUPLE)!.consecutiveSuccesses = 1; // 1 success in window

    // Push 2 failure timestamps into window
    vi.advanceTimersByTime(1000);
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    vi.advanceTimersByTime(1000);
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));

    // errorRate = 2 failures / (1 success + 2 failures) = 0.667
    // This exceeds errorRateUnhealthyThreshold of 0.7... actually it's just under
    // Let me push more failures
    vi.advanceTimersByTime(1000);
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));

    // Now errorRate = 3/4 = 0.75 > 0.7, should escalate
    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
  });

  it('SUSPECT does NOT escalate when error rate is below threshold', () => {
    const config = {
      intervalMs: 30_000,
      suspectAfterFailures: 1,
      unhealthyAfterFailures: 3,
      errorRateSuspectThreshold: 0.3,
      errorRateUnhealthyThreshold: 0.7,
      suspectWindowMs: 60_000,
      recoveryBackoffMs: [10_000, 30_000, 60_000, 300_000, 900_000],
      recoverySuccessThreshold: 5,
      probeTimeoutMs: 5_000,
      maxConcurrentProbes: 10,
      snapshotIntervalMs: 300_000,
      walTruncateThreshold: 10_000,
    };
    const o = new ProbeOrchestrator(config);

    o.setStateForTesting(TUPLE, 'SUSPECT');
    // High consecutiveSuccesses keeps error rate low
    o.getTupleState(TUPLE)!.consecutiveSuccesses = 10;

    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    // errorRate = 1 / (10 + 1) = 0.09 < 0.7, should stay SUSPECT
    expect(o.getState(TUPLE)).toBe('SUSPECT');
  });

  // -------------------------------------------------------------------------
  // 3. nextProbeAt set on UNHEALTHY → RECOVERING
  // -------------------------------------------------------------------------

  it('UNHEALTHY → RECOVERING sets nextProbeAt', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    const before = Date.now();
    o.recordProbeResult(TUPLE, true);
    const ts = o.getTupleState(TUPLE)!;
    expect(ts.state).toBe('RECOVERING');
    expect(ts.nextProbeAt).toBeGreaterThanOrEqual(before + 10_000);
  });

  // -------------------------------------------------------------------------
  // 4. recoveryAttempts counter behavior
  // -------------------------------------------------------------------------

  it('recoveryAttempts increments on RECOVERING → UNHEALTHY', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'RECOVERING');
    o.getTupleState(TUPLE)!.recoveryAttempts = 0;
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(1);

    o.setStateForTesting(TUPLE, 'RECOVERING');
    o.getTupleState(TUPLE)!.recoveryAttempts = 4;
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(5);
  });

  it('recoveryAttempts resets to 0 on RECOVERING → HEALTHY', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'RECOVERING');
    o.getTupleState(TUPLE)!.recoveryAttempts = 3;
    for (let i = 0; i < 5; i++) {
      o.recordProbeResult(TUPLE, true);
    }
    expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 5. lastErrorKind set on failure
  // -------------------------------------------------------------------------

  it('lastErrorKind is set on failure with classification', () => {
    const o = new ProbeOrchestrator();
    o.recordProbeResult(TUPLE, false, makeClassification('rate_limited'));
    expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('rate_limited');

    o.recordProbeResult(TUPLE, false, makeClassification('permanent'));
    expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('permanent');

    o.recordProbeResult(TUPLE, false, makeClassification('non_retryable'));
    expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('non_retryable');
  });

  it('lastErrorKind is undefined for unknown classification', () => {
    const o = new ProbeOrchestrator();
    o.recordProbeResult(TUPLE, false);
    expect(o.getTupleState(TUPLE)?.lastErrorKind).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 6. onStateChange callback fires (and only on transition, not on no-op)
  // -------------------------------------------------------------------------

  it('onStateChange fires on state transition', () => {
    const o = new ProbeOrchestrator();
    const calls: Array<[Tuple, ProbeState, ProbeState, string]> = [];
    o.onStateChange((tuple, from, to, reason) => calls.push([tuple, from, to, reason]));

    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe('HEALTHY');
    expect(calls[0][2]).toBe('SUSPECT');
    expect(calls[0][3]).toContain('failure');
  });

  it('onStateChange does NOT fire when state does not change', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'SUSPECT');
    // Set high consecutiveSuccesses to ensure error rate stays below threshold
    o.getTupleState(TUPLE)!.consecutiveSuccesses = 10;

    const calls: Array<[Tuple, ProbeState, ProbeState, string]> = [];
    o.onStateChange((tuple, from, to, reason) => calls.push([tuple, from, to, reason]));

    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    // SUSPECT → SUSPECT (no transition, consecutiveFailures increments)
    expect(calls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 7. onStateChange unsubscribe works
  // -------------------------------------------------------------------------

  it('onStateChange unsubscribe removes callback', () => {
    const o = new ProbeOrchestrator();
    const calls: Array<[Tuple, ProbeState, ProbeState, string]> = [];
    const unsub = o.onStateChange((tuple, from, to, reason) =>
      calls.push([tuple, from, to, reason])
    );

    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(calls).toHaveLength(1);

    unsub();

    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(calls).toHaveLength(1); // no new calls after unsubscribe
  });

  // -------------------------------------------------------------------------
  // 8. Multiple subscribers
  // -------------------------------------------------------------------------

  it('multiple subscribers all receive state change events', () => {
    const o = new ProbeOrchestrator();
    const calls1: Array<[Tuple, ProbeState, ProbeState, string]> = [];
    const calls2: Array<[Tuple, ProbeState, ProbeState, string]> = [];
    o.onStateChange((tuple, from, to, reason) => calls1.push([tuple, from, to, reason]));
    o.onStateChange((tuple, from, to, reason) => calls2.push([tuple, from, to, reason]));

    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 9. setStateForTesting doesn't fire onStateChange
  // -------------------------------------------------------------------------

  it('setStateForTesting does NOT fire onStateChange', () => {
    const o = new ProbeOrchestrator();
    const calls: Array<[Tuple, ProbeState, ProbeState, string]> = [];
    o.onStateChange((tuple, from, to, reason) => calls.push([tuple, from, to, reason]));

    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    expect(calls).toHaveLength(0);
    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
  });

  // -------------------------------------------------------------------------
  // 10. resetTuple works
  // -------------------------------------------------------------------------

  it('resetTuple resets tuple to HEALTHY without firing callback', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.recoveryAttempts = 5;

    const calls: Array<[Tuple, ProbeState, ProbeState, string]> = [];
    o.onStateChange((tuple, from, to, reason) => calls.push([tuple, from, to, reason]));

    o.resetTuple(TUPLE);
    expect(o.getState(TUPLE)).toBe('HEALTHY');
    expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(0);
    expect(calls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 11. evictTuple works and removes from getAllStates
  // -------------------------------------------------------------------------

  it('evictTuple removes tuple from getAllStates', () => {
    const o = new ProbeOrchestrator();
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(o.getAllStates().has('srv1:llama3:ollama_chat')).toBe(true);

    o.evictTuple(TUPLE);
    expect(o.getAllStates().has('srv1:llama3:ollama_chat')).toBe(false);
    expect(o.getState(TUPLE)).toBe('HEALTHY'); // unknown = HEALTHY
  });

  // -------------------------------------------------------------------------
  // 12. Concurrent recordProbeResult calls are safe
  // -------------------------------------------------------------------------

  it('concurrent recordProbeResult calls are safe (sequential execution)', () => {
    const o = new ProbeOrchestrator();
    // Simulate concurrent calls by calling sequentially in tight loop
    const results: ProbeState[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(o.recordProbeResult(TUPLE, i % 3 !== 0, makeClassification('transient')));
    }
    // Should not throw, and final state should be consistent
    expect(o.getTupleState(TUPLE)).toBeDefined();
    expect(o.getState(TUPLE)).toBeDefined();
  });

  it('Promise.all concurrent recordProbeResult calls are safe', async () => {
    const o = new ProbeOrchestrator();
    const results = await Promise.all([
      o.recordProbeResult(TUPLE, false, makeClassification('transient')),
      o.recordProbeResult(TUPLE, false, makeClassification('transient')),
      o.recordProbeResult(TUPLE, false, makeClassification('transient')),
    ]);
    // All calls should complete without error
    expect(results).toHaveLength(3);
    // Final state should be UNHEALTHY (3 failures >= unhealthyAfterFailures=3)
    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
    expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // 13. Initial state of unknown tuple is HEALTHY (auto-initialized)
  // -------------------------------------------------------------------------

  it('unknown tuple auto-initializes to HEALTHY', () => {
    const o = new ProbeOrchestrator();
    expect(o.getState(TUPLE)).toBe('HEALTHY');
    expect(o.getTupleState(TUPLE)).toBeUndefined();
  });

  it('unknown tuple auto-initialization does not appear in getAllStates until first probe', () => {
    const o = new ProbeOrchestrator();
    expect(o.getAllStates().has('srv1:llama3:ollama_chat')).toBe(false);
    // After first probe, it should be in getAllStates
    o.recordProbeResult(TUPLE, true);
    expect(o.getAllStates().has('srv1:llama3:ollama_chat')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Additional edge cases
  // -------------------------------------------------------------------------

  it('lastProbeAt is updated on every probe', () => {
    const o = new ProbeOrchestrator();
    vi.advanceTimersByTime(5000);
    o.recordProbeResult(TUPLE, true);
    expect(o.getTupleState(TUPLE)?.lastProbeAt).toBe(5000);

    vi.advanceTimersByTime(3000);
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(o.getTupleState(TUPLE)?.lastProbeAt).toBe(8000);
  });

  it('lastTransition updates on every state change', () => {
    const o = new ProbeOrchestrator();
    vi.advanceTimersByTime(1000);
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(o.getTupleState(TUPLE)?.lastTransition).toBe(1000);

    vi.advanceTimersByTime(2000);
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    // Second failure triggers UNHEALTHY via error rate (state change at t=3000)
    expect(o.getTupleState(TUPLE)?.lastTransition).toBe(3000);

    vi.advanceTimersByTime(4000);
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    // Third failure: already UNHEALTHY, no state change, lastTransition stays 3000
    expect(o.getTupleState(TUPLE)?.lastTransition).toBe(3000);
  });

  it('different tuples have independent state', () => {
    const o = new ProbeOrchestrator();
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(o.getState(TUPLE)).toBe('SUSPECT');
    expect(o.getState(TUPLE2)).toBe('HEALTHY');

    o.recordProbeResult(TUPLE2, false, makeClassification('transient'));
    expect(o.getState(TUPLE)).toBe('SUSPECT');
    expect(o.getState(TUPLE2)).toBe('SUSPECT');
  });

  it('errorWindow is pruned on success (old entries removed)', () => {
    const o = new ProbeOrchestrator();
    // Add failures at t=1000 and t=2000
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    vi.advanceTimersByTime(1000);
    o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(o.getTupleState(TUPLE)?.errorWindow.length).toBe(2);

    // Advance time past the suspectWindowMs (60000) so old entries get pruned
    vi.advanceTimersByTime(65000);
    o.recordProbeResult(TUPLE, true);

    // After pruning (t=67000, cutoff=t=7000), entries at t=1000 and t=2000 are removed
    expect(o.getTupleState(TUPLE)?.errorWindow.length).toBe(0);
  });

  it('returns correct state from recordProbeResult', () => {
    const o = new ProbeOrchestrator();
    expect(o.recordProbeResult(TUPLE, false, makeClassification('transient'))).toBe('SUSPECT');

    o.setStateForTesting(TUPLE, 'SUSPECT');
    expect(o.recordProbeResult(TUPLE, true)).toBe('HEALTHY');

    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    expect(o.recordProbeResult(TUPLE, true)).toBe('RECOVERING');
  });
});
