/**
 * probe-forceclose.test.ts
 * Integration tests for probe force-close (reset) behavior.
 *
 * Rewritten from circuit-breaker-forceclose.test.ts to use the new probe API.
 * Tests that resetTuple clears all recovery state when force-closing a tuple.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ProbeOrchestrator } from '../../src/probe/probe-orchestrator.js';
import type { Tuple, Classification } from '../../src/probe/types.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const TUPLE: Tuple = { serverId: 'test-fc-1', model: 'llama3', endpoint: 'ollama_chat' };

function makeClassification(kind: Classification['kind']): Classification {
  return { kind, retryable: true };
}

describe('ProbeOrchestrator - forceClose resets all recovery state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('should reset consecutiveFailures via resetTuple when in SUSPECT', async () => {
    const o = new ProbeOrchestrator();

    // Transition to SUSPECT via failure
    await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(o.getState(TUPLE)).toBe('SUSPECT');
    expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBe(1);

    // Reset (force close)
    o.resetTuple(TUPLE);

    const ts = o.getTupleState(TUPLE);
    expect(ts?.consecutiveFailures).toBe(0);
    expect(ts?.state).toBe('HEALTHY');
  });

  it('should reset nextProbeAt via resetTuple when in UNHEALTHY state', async () => {
    const o = new ProbeOrchestrator();

    // Force to UNHEALTHY
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    const ts = o.getTupleState(TUPLE)!;
    ts.nextProbeAt = Date.now() + 10_000;
    ts.consecutiveFailures = 3;

    expect(o.getTupleState(TUPLE)?.nextProbeAt).toBeGreaterThan(0);

    // Reset (force close)
    o.resetTuple(TUPLE);

    expect(o.getTupleState(TUPLE)?.nextProbeAt).toBe(0);
  });

  it('should reset all failure tracking counters in resetTuple', async () => {
    const o = new ProbeOrchestrator();

    // Add some failures
    await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
    await o.recordProbeResult(TUPLE, false, makeClassification('transient'));

    o.resetTuple(TUPLE);

    const ts = o.getTupleState(TUPLE);
    expect(ts?.consecutiveFailures).toBe(0);
    expect(ts?.consecutiveSuccesses).toBe(0);
    expect(ts?.nextProbeAt).toBe(0);
    expect(ts?.recoveryAttempts).toBe(0);
  });

  it('should be idempotent - calling resetTuple twice works', async () => {
    const o = new ProbeOrchestrator();

    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.resetTuple(TUPLE);
    o.resetTuple(TUPLE);

    const ts = o.getTupleState(TUPLE);
    expect(ts?.state).toBe('HEALTHY');
    expect(ts?.consecutiveFailures).toBe(0);
    expect(ts?.consecutiveSuccesses).toBe(0);
    expect(ts?.nextProbeAt).toBe(0);
  });

  it('should reset recoveryAttempts when calling resetTuple from HEALTHY state', async () => {
    const o = new ProbeOrchestrator();

    // Set to RECOVERING with some recovery attempts
    o.setStateForTesting(TUPLE, 'RECOVERING');
    const ts = o.getTupleState(TUPLE)!;
    ts.recoveryAttempts = 3;
    ts.consecutiveSuccesses = 2;

    o.resetTuple(TUPLE);

    const state = o.getTupleState(TUPLE);
    expect(state?.recoveryAttempts).toBe(0);
    expect(state?.state).toBe('HEALTHY');
  });
});
