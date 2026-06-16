import { describe, it, expect, beforeEach } from 'vitest';

import { ProbeOrchestrator } from '../../../src/probe/probe-orchestrator.js';
import type { Tuple, ProbeState } from '../../../src/probe/types.js';

const TUPLE: Tuple = { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' };
const TUPLE2: Tuple = { serverId: 'srv2', model: 'llama3', endpoint: 'ollama_chat' };

type Caller = 'routing' | 'probe' | 'admin';

function states(): ProbeState[] {
  return ['HEALTHY', 'SUSPECT', 'UNHEALTHY', 'RECOVERING'];
}

function callers(): Caller[] {
  return ['routing', 'probe', 'admin'];
}

describe('ProbeOrchestrator canServe', () => {
  beforeEach(() => {
    // vi.useFakeTimers() is already set by the existing test file's beforeEach
    // Each test uses setStateForTesting directly
  });

  // -------------------------------------------------------------------------
  // canServe: all 4 states × 3 callers = 12 combinations
  // -------------------------------------------------------------------------

  describe('routing caller', () => {
    it('HEALTHY → true', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'HEALTHY');
      expect(o.canServe(TUPLE, 'routing')).toBe(true);
    });

    it('SUSPECT → true', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'SUSPECT');
      expect(o.canServe(TUPLE, 'routing')).toBe(true);
    });

    it('UNHEALTHY → false', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      expect(o.canServe(TUPLE, 'routing')).toBe(false);
    });

    it('RECOVERING → false', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      expect(o.canServe(TUPLE, 'routing')).toBe(false);
    });
  });

  describe('probe caller', () => {
    it('HEALTHY → false', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'HEALTHY');
      expect(o.canServe(TUPLE, 'probe')).toBe(false);
    });

    it('SUSPECT → false', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'SUSPECT');
      expect(o.canServe(TUPLE, 'probe')).toBe(false);
    });

    it('UNHEALTHY → false', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      expect(o.canServe(TUPLE, 'probe')).toBe(false);
    });

    it('RECOVERING → true', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      expect(o.canServe(TUPLE, 'probe')).toBe(true);
    });
  });

  describe('admin caller', () => {
    it('HEALTHY → true', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'HEALTHY');
      expect(o.canServe(TUPLE, 'admin')).toBe(true);
    });

    it('SUSPECT → true', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'SUSPECT');
      expect(o.canServe(TUPLE, 'admin')).toBe(true);
    });

    it('UNHEALTHY → true', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      expect(o.canServe(TUPLE, 'admin')).toBe(true);
    });

    it('RECOVERING → true', () => {
      const o = new ProbeOrchestrator();
      o.setStateForTesting(TUPLE, 'RECOVERING');
      expect(o.canServe(TUPLE, 'admin')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // canServe: unknown tuple (never probed)
  // -------------------------------------------------------------------------

  it('unknown tuple: admin=true, routing=true, probe=false', () => {
    const o = new ProbeOrchestrator();
    expect(o.canServe(TUPLE, 'admin')).toBe(true);
    expect(o.canServe(TUPLE, 'routing')).toBe(true);
    expect(o.canServe(TUPLE, 'probe')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // canServe: different tuples are independent
  // -------------------------------------------------------------------------

  it('two different tuples have independent canServe results', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'HEALTHY');
    o.setStateForTesting(TUPLE2, 'UNHEALTHY');
    expect(o.canServe(TUPLE, 'routing')).toBe(true);
    expect(o.canServe(TUPLE2, 'routing')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // canServe: does NOT mutate state
  // -------------------------------------------------------------------------

  it('canServe does not mutate state (pure read)', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'HEALTHY');
    o.canServe(TUPLE, 'routing');
    o.canServe(TUPLE, 'probe');
    o.canServe(TUPLE, 'admin');
    expect(o.getState(TUPLE)).toBe('HEALTHY');
    const ts = o.getTupleState(TUPLE)!;
    expect(ts.consecutiveSuccesses).toBe(0);
    expect(ts.consecutiveFailures).toBe(0);
  });
});

// -------------------------------------------------------------------------
// canProbe
// -------------------------------------------------------------------------

describe('ProbeOrchestrator canProbe', () => {
  beforeEach(() => {
    // use vi.useFakeTimers / vi.setSystemTime in individual tests
  });

  it('UNHEALTHY with nextProbeAt in past → true', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = Date.now() - 1; // 1ms in past
    expect(o.canProbe(TUPLE)).toBe(true);
  });

  it('UNHEALTHY with nextProbeAt in future → false', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = Date.now() + 60_000;
    expect(o.canProbe(TUPLE)).toBe(false);
  });

  it('UNHEALTHY with nextProbeAt === now → true (equal counts)', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = Date.now();
    expect(o.canProbe(TUPLE)).toBe(true);
  });

  it('HEALTHY → false (not UNHEALTHY)', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'HEALTHY');
    expect(o.canProbe(TUPLE)).toBe(false);
  });

  it('SUSPECT → false (not UNHEALTHY)', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'SUSPECT');
    expect(o.canProbe(TUPLE)).toBe(false);
  });

  it('RECOVERING → false (not UNHEALTHY)', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'RECOVERING');
    expect(o.canProbe(TUPLE)).toBe(false);
  });

  it('unknown tuple → false', () => {
    const o = new ProbeOrchestrator();
    expect(o.canProbe(TUPLE)).toBe(false);
  });
});

// -------------------------------------------------------------------------
// markProbing
// -------------------------------------------------------------------------

describe('ProbeOrchestrator markProbing', () => {
  it('UNHEALTHY with past nextProbeAt → returns true, sets nextProbeAt to MAX_SAFE_INTEGER', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = Date.now() - 1;
    const result = o.markProbing(TUPLE);
    expect(result).toBe(true);
    expect(o.getTupleState(TUPLE)!.nextProbeAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('UNHEALTHY with future nextProbeAt → returns false, does not mutate nextProbeAt', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    const future = Date.now() + 60_000;
    o.getTupleState(TUPLE)!.nextProbeAt = future;
    const result = o.markProbing(TUPLE);
    expect(result).toBe(false);
    expect(o.getTupleState(TUPLE)!.nextProbeAt).toBe(future);
  });

  it('HEALTHY → false (not UNHEALTHY)', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'HEALTHY');
    expect(o.markProbing(TUPLE)).toBe(false);
  });

  it('SUSPECT → false (not UNHEALTHY)', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'SUSPECT');
    expect(o.markProbing(TUPLE)).toBe(false);
  });

  it('RECOVERING → false (not UNHEALTHY)', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'RECOVERING');
    expect(o.markProbing(TUPLE)).toBe(false);
  });

  it('unknown tuple → false', () => {
    const o = new ProbeOrchestrator();
    expect(o.markProbing(TUPLE)).toBe(false);
  });

  it('after markProbing, canProbe returns false (nextProbeAt = MAX_SAFE_INTEGER)', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = Date.now() - 1;
    o.markProbing(TUPLE);
    expect(o.canProbe(TUPLE)).toBe(false);
  });

  it('markProbing is atomic: exactly one of three concurrent calls returns true', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = Date.now() - 1;

    const results = await Promise.all([
      o.markProbing(TUPLE),
      o.markProbing(TUPLE),
      o.markProbing(TUPLE),
    ]);

    const trueCount = results.filter(r => r === true).length;
    expect(trueCount).toBe(1);

    // All subsequent calls must return false
    expect(o.markProbing(TUPLE)).toBe(false);
    expect(o.markProbing(TUPLE)).toBe(false);
  });

  it('markProbing does not change state', () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = Date.now() - 1;
    o.markProbing(TUPLE);
    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
  });
});
