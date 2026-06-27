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

  describe('HEALTHY transitions', () => {
    it('HEALTHY + success → HEALTHY (increments consecutiveSuccesses)', async () => {
      const o = new ProbeOrchestrator();
      await o.recordProbeResult(TUPLE, true);
      await o.recordProbeResult(TUPLE, true);
      expect(o.getState(TUPLE)).toBe('HEALTHY');
      expect(o.getTupleState(TUPLE)?.consecutiveSuccesses).toBe(2);
    });

    it('HEALTHY + failure → SUSPECT (consecutiveFailures=1, lastErrorKind set)', async () => {
      const o = new ProbeOrchestrator();
      const result = await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');
      expect(o.getState(TUPLE)).toBe('SUSPECT');
      const ts = o.getTupleState(TUPLE)!;
      expect(ts.consecutiveFailures).toBe(1);
      expect(ts.consecutiveSuccesses).toBe(0);
      expect(ts.lastErrorKind).toBe('transient');
    });
  });

  describe('SUSPECT transitions', () => {
    it('SUSPECT + success → HEALTHY (consecutiveFailures=0)', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'SUSPECT');
      await o.recordProbeResult(TUPLE, true);
      expect(o.getState(TUPLE)).toBe('HEALTHY');
      expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBe(0);
    });

    it('SUSPECT + failure → stays SUSPECT until threshold', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'SUSPECT');
      o.getTupleState(TUPLE)!.consecutiveSuccesses = 10;

      vi.advanceTimersByTime(1000);
      let result = await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');
      expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBe(1);

      vi.advanceTimersByTime(1000);
      result = await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');
      expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBe(2);

      vi.advanceTimersByTime(1000);
      result = await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('UNHEALTHY');
    });
  });

  describe('UNHEALTHY transitions', () => {
    it('UNHEALTHY + success → RECOVERING (sets nextProbeAt)', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      const before = Date.now();
      const result = await o.recordProbeResult(TUPLE, true);
      expect(result).toBe('RECOVERING');
      const ts = o.getTupleState(TUPLE)!;
      expect(ts.nextProbeAt).toBeGreaterThanOrEqual(before + 10_000);
      expect(ts.consecutiveSuccesses).toBe(1);
    });

    it('UNHEALTHY + failure → stays UNHEALTHY (consecutiveFailures++)', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      const result = await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('UNHEALTHY');
      expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBeGreaterThanOrEqual(1);
    });
  });

  describe('RECOVERING transitions', () => {
    it('RECOVERING + success → stays RECOVERING until threshold', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');

      let result = await o.recordProbeResult(TUPLE, true);
      expect(result).toBe('RECOVERING');
      expect(o.getTupleState(TUPLE)?.consecutiveSuccesses).toBe(1);

      result = await o.recordProbeResult(TUPLE, true);
      expect(result).toBe('RECOVERING');
      expect(o.getTupleState(TUPLE)?.consecutiveSuccesses).toBe(2);
    });

    it('RECOVERING + success × 5 → HEALTHY (recoverySuccessThreshold=5)', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      for (let i = 0; i < 5; i++) {
        const result = await o.recordProbeResult(TUPLE, true);
        if (i < 4) {expect(result).toBe('RECOVERING');}
        else {expect(result).toBe('HEALTHY');}
      }
      expect(o.getState(TUPLE)).toBe('HEALTHY');
      expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(0);
    });

    it('RECOVERING + failure → UNHEALTHY (increments recoveryAttempts)', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      o.getTupleState(TUPLE)!.recoveryAttempts = 2;
      const result = await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('UNHEALTHY');
      expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(3);
      expect(o.getTupleState(TUPLE)?.consecutiveSuccesses).toBe(0);
    });
  });

  describe('error rate escalation from SUSPECT', () => {
    it('SUSPECT escalates to UNHEALTHY via error rate threshold', async () => {
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
      o.getTupleState(TUPLE)!.consecutiveSuccesses = 1;

      vi.advanceTimersByTime(1000);
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      vi.advanceTimersByTime(1000);
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      vi.advanceTimersByTime(1000);
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));

      expect(o.getState(TUPLE)).toBe('UNHEALTHY');
    });

    it('SUSPECT does NOT escalate when error rate is below threshold', async () => {
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
      o.getTupleState(TUPLE)!.consecutiveSuccesses = 10;

      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getState(TUPLE)).toBe('SUSPECT');
    });
  });

  describe('nextProbeAt set on UNHEALTHY → RECOVERING', () => {
    it('UNHEALTHY → RECOVERING sets nextProbeAt', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      const before = Date.now();
      await o.recordProbeResult(TUPLE, true);
      const ts = o.getTupleState(TUPLE)!;
      expect(ts.state).toBe('RECOVERING');
      expect(ts.nextProbeAt).toBeGreaterThanOrEqual(before + 10_000);
    });
  });

  describe('recoveryAttempts counter behavior', () => {
    it('recoveryAttempts increments on RECOVERING → UNHEALTHY', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      o.getTupleState(TUPLE)!.recoveryAttempts = 0;
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(1);

      o.setStateForTesting(TUPLE, 'RECOVERING');
      o.getTupleState(TUPLE)!.recoveryAttempts = 4;
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(5);
    });

    it('recoveryAttempts resets to 0 on RECOVERING → HEALTHY', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      o.getTupleState(TUPLE)!.recoveryAttempts = 3;
      for (let i = 0; i < 5; i++) {
        await o.recordProbeResult(TUPLE, true);
      }
      expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(0);
    });
  });

  describe('lastErrorKind set on failure', () => {
    it('lastErrorKind is set on failure with classification', async () => {
      const o = new ProbeOrchestrator();
      await o.recordProbeResult(TUPLE, false, makeClassification('rate_limited'));
      expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('rate_limited');

      await o.recordProbeResult(TUPLE, false, makeClassification('permanent'));
      expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('permanent');

      await o.recordProbeResult(TUPLE, false, makeClassification('non_retryable'));
      expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('non_retryable');
    });

    it('lastErrorKind is undefined for unknown classification', async () => {
      const o = new ProbeOrchestrator();
      await o.recordProbeResult(TUPLE, false);
      expect(o.getTupleState(TUPLE)?.lastErrorKind).toBeUndefined();
    });
  });

  describe('onStateChange callback fires', () => {
    it('onStateChange fires on state transition', async () => {
      const o = new ProbeOrchestrator();
      const calls: Array<[Tuple, ProbeState, ProbeState, string]> = [];
      o.onStateChange((tuple, from, to, reason) => calls.push([tuple, from, to, reason]));

      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toBe('HEALTHY');
      expect(calls[0][2]).toBe('SUSPECT');
      expect(calls[0][3]).toContain('failure');
    });

    it('onStateChange does NOT fire when state does not change', async () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'SUSPECT');
      o.getTupleState(TUPLE)!.consecutiveSuccesses = 10;

      const calls: Array<[Tuple, ProbeState, ProbeState, string]> = [];
      o.onStateChange((tuple, from, to, reason) => calls.push([tuple, from, to, reason]));

      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(calls).toHaveLength(0);
    });
  });

  describe('onStateChange unsubscribe works', () => {
    it('onStateChange unsubscribe removes callback', async () => {
      const o = new ProbeOrchestrator();
      const calls: Array<[Tuple, ProbeState, ProbeState, string]> = [];
      const unsub = o.onStateChange((tuple, from, to, reason) =>
        calls.push([tuple, from, to, reason])
      );

      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(calls).toHaveLength(1);

      unsub();

      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(calls).toHaveLength(1);
    });
  });

  describe('multiple subscribers', () => {
    it('multiple subscribers all receive state change events', async () => {
      const o = new ProbeOrchestrator();
      const calls1: Array<[Tuple, ProbeState, ProbeState, string]> = [];
      const calls2: Array<[Tuple, ProbeState, ProbeState, string]> = [];
      o.onStateChange((tuple, from, to, reason) => calls1.push([tuple, from, to, reason]));
      o.onStateChange((tuple, from, to, reason) => calls2.push([tuple, from, to, reason]));

      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(calls1).toHaveLength(1);
      expect(calls2).toHaveLength(1);
    });
  });

  describe('setStateForTesting', () => {
    it('setStateForTesting does NOT fire onStateChange', () => {
      const o = new ProbeOrchestrator();
      const calls: Array<[Tuple, ProbeState, ProbeState, string]> = [];
      o.onStateChange((tuple, from, to, reason) => calls.push([tuple, from, to, reason]));

      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      expect(calls).toHaveLength(0);
      expect(o.getState(TUPLE)).toBe('UNHEALTHY');
    });
  });

  describe('resetTuple works', () => {
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
  });

  describe('evictTuple works', () => {
    it('evictTuple removes tuple from getAllStates', async () => {
      const o = new ProbeOrchestrator();
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getAllStates().has('srv1:llama3:ollama_chat')).toBe(true);

      await o.evictTuple(TUPLE);
      expect(o.getAllStates().has('srv1:llama3:ollama_chat')).toBe(false);
      expect(o.getState(TUPLE)).toBe('HEALTHY');
    });
  });

  describe('concurrent recordProbeResult calls', () => {
    it('concurrent recordProbeResult calls are safe (sequential execution)', async () => {
      const o = new ProbeOrchestrator();
      const results: ProbeState[] = [];
      for (let i = 0; i < 10; i++) {
        results.push(
          await o.recordProbeResult(TUPLE, i % 3 !== 0, makeClassification('transient'))
        );
      }
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
      expect(results).toHaveLength(3);
      expect(o.getState(TUPLE)).toBe('UNHEALTHY');
      expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBeGreaterThanOrEqual(3);
    });
  });

  describe('initial state of unknown tuple', () => {
    it('unknown tuple auto-initializes to HEALTHY', () => {
      const o = new ProbeOrchestrator();
      expect(o.getState(TUPLE)).toBe('HEALTHY');
      expect(o.getTupleState(TUPLE)).toBeUndefined();
    });

    it('unknown tuple auto-initialization does not appear in getAllStates until first probe', async () => {
      const o = new ProbeOrchestrator();
      expect(o.getAllStates().has('srv1:llama3:ollama_chat')).toBe(false);
      await o.recordProbeResult(TUPLE, true);
      expect(o.getAllStates().has('srv1:llama3:ollama_chat')).toBe(true);
    });
  });

  describe('additional edge cases', () => {
    it('lastProbeAt is updated on every probe', async () => {
      const o = new ProbeOrchestrator();
      vi.advanceTimersByTime(5000);
      await o.recordProbeResult(TUPLE, true);
      expect(o.getTupleState(TUPLE)?.lastProbeAt).toBe(5000);

      vi.advanceTimersByTime(3000);
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getTupleState(TUPLE)?.lastProbeAt).toBe(8000);
    });

    it('lastTransition updates on every state change', async () => {
      const o = new ProbeOrchestrator();
      vi.advanceTimersByTime(1000);
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getTupleState(TUPLE)?.lastTransition).toBe(1000);

      vi.advanceTimersByTime(2000);
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getTupleState(TUPLE)?.lastTransition).toBe(3000);

      vi.advanceTimersByTime(4000);
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getTupleState(TUPLE)?.lastTransition).toBe(3000);
    });

    it('different tuples have independent state', async () => {
      const o = new ProbeOrchestrator();
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getState(TUPLE)).toBe('SUSPECT');
      expect(o.getState(TUPLE2)).toBe('HEALTHY');

      await o.recordProbeResult(TUPLE2, false, makeClassification('transient'));
      expect(o.getState(TUPLE)).toBe('SUSPECT');
      expect(o.getState(TUPLE2)).toBe('SUSPECT');
    });

    it('errorWindow is pruned on success', async () => {
      const o = new ProbeOrchestrator();
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      vi.advanceTimersByTime(1000);
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(o.getTupleState(TUPLE)?.errorWindow.length).toBe(2);

      vi.advanceTimersByTime(65000);
      await o.recordProbeResult(TUPLE, true);
      expect(o.getTupleState(TUPLE)?.errorWindow.length).toBe(0);
    });

    it('returns correct state from recordProbeResult', async () => {
      const o = new ProbeOrchestrator();
      expect(await o.recordProbeResult(TUPLE, false, makeClassification('transient'))).toBe(
        'SUSPECT'
      );

      o.setStateForTesting(TUPLE, 'SUSPECT');
      expect(await o.recordProbeResult(TUPLE, true)).toBe('HEALTHY');

      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      expect(await o.recordProbeResult(TUPLE, true)).toBe('RECOVERING');
    });
  });
});
