import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ProbeOrchestrator } from '../../../src/probe/probe-orchestrator.js';
import { BackoffSchedule, RecoveryDriver } from '../../../src/probe/recovery-driver.js';
import { DEFAULT_PROBE_CONFIG } from '../../../src/probe/types.js';
import type { Tuple, Classification } from '../../../src/probe/types.js';

const TUPLE: Tuple = { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' };
const TUPLE2: Tuple = { serverId: 'srv2', model: 'llama3', endpoint: 'ollama_chat' };

function makeClassification(kind: Classification['kind']): Classification {
  return { kind, retryable: true };
}

describe('RecoveryDriver + ProbeOrchestrator integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  // -------------------------------------------------------------------------
  // Test 1: onStateChange is called on every state transition
  // -------------------------------------------------------------------------

  it('subscribes to onStateChange and records recoveryAttempts on UNHEALTHY', () => {
    const orchestrator = new ProbeOrchestrator();
    const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const driver = new RecoveryDriver(
      orchestrator,
      {} as never, // endpointRegistry not used in this test
      backoff,
      DEFAULT_PROBE_CONFIG
    );

    // HEALTHY + failure → SUSPECT (no UNHEALTHY transition)
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0);
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0);

    // SUSPECT + failure (2nd) → UNHEALTHY
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(1);

    driver.stop();
  });

  // -------------------------------------------------------------------------
  // Test 2: Full cycle HEALTHY → SUSPECT → UNHEALTHY → RECOVERING → HEALTHY
  // -------------------------------------------------------------------------

  it('full cycle: recoveryAttempts counter behaves correctly at each step', () => {
    const orchestrator = new ProbeOrchestrator();
    const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const driver = new RecoveryDriver(orchestrator, {} as never, backoff, DEFAULT_PROBE_CONFIG);

    // Step 1: HEALTHY (initial) — 0 recovery attempts
    expect(orchestrator.getState(TUPLE)).toBe('HEALTHY');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0);

    // Step 2: HEALTHY + failure → SUSPECT — still 0
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(orchestrator.getState(TUPLE)).toBe('SUSPECT');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0);

    // Step 3: SUSPECT + failure (2nd) → UNHEALTHY — counter increments to 1
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(orchestrator.getState(TUPLE)).toBe('UNHEALTHY');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(1);

    // Step 4: UNHEALTHY + success → RECOVERING — counter stays at 1
    // (onStateChange fires for UNHEALTHY→RECOVERING but we only record on UNHEALTHY, not RECOVERING)
    orchestrator.recordProbeResult(TUPLE, true);
    expect(orchestrator.getState(TUPLE)).toBe('RECOVERING');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(1);

    // Step 5: RECOVERING + failure → UNHEALTHY — counter increments to 2
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(orchestrator.getState(TUPLE)).toBe('UNHEALTHY');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(2);

    // Step 6: UNHEALTHY + success → RECOVERING — counter stays at 2
    orchestrator.recordProbeResult(TUPLE, true);
    expect(orchestrator.getState(TUPLE)).toBe('RECOVERING');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(2);

    // Step 7: RECOVERING + success × 5 → HEALTHY — counter resets to 0
    for (let i = 0; i < 5; i++) {
      orchestrator.recordProbeResult(TUPLE, true);
    }
    expect(orchestrator.getState(TUPLE)).toBe('HEALTHY');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0);

    driver.stop();
  });

  // -------------------------------------------------------------------------
  // Test 3: Multiple tuples have independent counters
  // -------------------------------------------------------------------------

  it('different tuples have independent recovery attempt counters', () => {
    const orchestrator = new ProbeOrchestrator();
    const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const driver = new RecoveryDriver(orchestrator, {} as never, backoff, DEFAULT_PROBE_CONFIG);

    // Drive tuple1 to UNHEALTHY
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(orchestrator.getState(TUPLE)).toBe('UNHEALTHY');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(1);

    // Drive tuple2 to UNHEALTHY
    orchestrator.recordProbeResult(TUPLE2, false, makeClassification('transient'));
    orchestrator.recordProbeResult(TUPLE2, false, makeClassification('transient'));
    expect(orchestrator.getState(TUPLE2)).toBe('UNHEALTHY');
    expect(backoff.getRecoveryAttempts(TUPLE2)).toBe(1);

    // tuple1 gets another UNHEALTHY transition (RECOVERING → UNHEALTHY)
    orchestrator.recordProbeResult(TUPLE, true); // → RECOVERING
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient')); // → UNHEALTHY
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(2);
    expect(backoff.getRecoveryAttempts(TUPLE2)).toBe(1); // unchanged

    // Recover tuple1 to HEALTHY
    orchestrator.recordProbeResult(TUPLE, true); // → RECOVERING
    for (let i = 0; i < 5; i++) {
      orchestrator.recordProbeResult(TUPLE, true);
    }
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0); // reset
    expect(backoff.getRecoveryAttempts(TUPLE2)).toBe(1); // unchanged

    driver.stop();
  });

  // -------------------------------------------------------------------------
  // Test 4: stop() calls unsubscribe
  // -------------------------------------------------------------------------

  it('stop() removes the onStateChange listener', () => {
    const orchestrator = new ProbeOrchestrator();
    const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const driver = new RecoveryDriver(orchestrator, {} as never, backoff, DEFAULT_PROBE_CONFIG);

    // Drive to UNHEALTHY
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(1);

    // Stop the driver and drive more transitions
    driver.stop();

    // After stop(), onStateChange no longer fires — counter should not change
    // Drive to UNHEALTHY again (SUSPECT → UNHEALTHY)
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    // counter should still be 1 because onStateChange was unsubscribed
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 5: RECOVERING → HEALTHY resets counter
  // -------------------------------------------------------------------------

  it('RECOVERING → HEALTHY transition resets recoveryAttempts to 0', () => {
    const orchestrator = new ProbeOrchestrator();
    const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const driver = new RecoveryDriver(orchestrator, {} as never, backoff, DEFAULT_PROBE_CONFIG);

    // Drive to RECOVERING with some recovery attempts accumulated
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient')); // UNHEALTHY
    orchestrator.recordProbeResult(TUPLE, true); // RECOVERING

    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient')); // UNHEALTHY again
    orchestrator.recordProbeResult(TUPLE, true); // RECOVERING
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(2);

    // Fail recovery → back to UNHEALTHY (counter = 3)
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(3);

    // Success → RECOVERING (counter stays 3)
    orchestrator.recordProbeResult(TUPLE, true);
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(3);

    // 5 consecutive successes → HEALTHY, counter resets
    for (let i = 0; i < 5; i++) {
      orchestrator.recordProbeResult(TUPLE, true);
    }
    expect(orchestrator.getState(TUPLE)).toBe('HEALTHY');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0);

    driver.stop();
  });

  // -------------------------------------------------------------------------
  // Test 6: getNextProbeTime uses the counter from BackoffSchedule
  // -------------------------------------------------------------------------

  it('getNextProbeTime reflects the current recoveryAttempts counter', () => {
    const orchestrator = new ProbeOrchestrator();
    const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const driver = new RecoveryDriver(orchestrator, {} as never, backoff, DEFAULT_PROBE_CONFIG);

    // Start fresh — counter = 0
    const t0 = backoff.getNextProbeTime(TUPLE, backoff.getRecoveryAttempts(TUPLE));
    expect(t0).toBe(10_000); // index 0 = 10s

    // Drive to UNHEALTHY (counter = 1)
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(1);

    const t1 = backoff.getNextProbeTime(TUPLE, backoff.getRecoveryAttempts(TUPLE));
    expect(t1).toBe(30_000); // index 1 = 30s

    // Fail again → UNHEALTHY (counter = 2), then success → RECOVERING
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    orchestrator.recordProbeResult(TUPLE, true);
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient')); // UNHEALTHY again
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(2);

    const t2 = backoff.getNextProbeTime(TUPLE, backoff.getRecoveryAttempts(TUPLE));
    expect(t2).toBe(60_000); // index 2 = 60s

    driver.stop();
  });

  // -------------------------------------------------------------------------
  // Test 7: counter does NOT increment on HEALTHY → SUSPECT
  // -------------------------------------------------------------------------

  it('HEALTHY → SUSPECT does NOT increment recoveryAttempts', () => {
    const orchestrator = new ProbeOrchestrator();
    const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const driver = new RecoveryDriver(orchestrator, {} as never, backoff, DEFAULT_PROBE_CONFIG);

    // HEALTHY → SUSPECT (single failure)
    orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
    expect(orchestrator.getState(TUPLE)).toBe('SUSPECT');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0);

    // SUSPECT → HEALTHY (success recovers)
    orchestrator.recordProbeResult(TUPLE, true);
    expect(orchestrator.getState(TUPLE)).toBe('HEALTHY');
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0);

    driver.stop();
  });
});
