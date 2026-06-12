import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecoveryDriver, BackoffSchedule } from '../../../src/probe/recovery-driver.js';
import { ProbeOrchestrator } from '../../../src/probe/probe-orchestrator.js';
import { EndpointRegistry } from '../../../src/probe/endpoint-registry.js';
import { DEFAULT_PROBE_CONFIG } from '../../../src/probe/types.js';
import type { Tuple, Classification } from '../../../src/probe/types.js';

const TUPLE: Tuple = { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' };
const TUPLE2: Tuple = { serverId: 'srv2', model: 'llama3', endpoint: 'ollama_chat' };
const TUPLE3: Tuple = { serverId: 'srv3', model: 'llama3', endpoint: 'ollama_chat' };

function makeDriver(
  orchestrator: ProbeOrchestrator,
  probeExecutor?: (t: Tuple) => Promise<{ success: boolean; classification?: Classification }>
) {
  const endpointRegistry = new EndpointRegistry();
  const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
  return new RecoveryDriver(
    orchestrator,
    endpointRegistry,
    backoff,
    DEFAULT_PROBE_CONFIG,
    probeExecutor
  );
}

describe('RecoveryDriver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  // -------------------------------------------------------------------------
  // Test 1: tick() finds UNHEALTHY tuples with nextProbeAt due
  // -------------------------------------------------------------------------
  it('tick() finds UNHEALTHY tuples with nextProbeAt due', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0; // due immediately

    const calls: Tuple[] = [];
    const driver = makeDriver(o, async t => {
      calls.push(t);
      return { success: true };
    });

    await driver.tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(TUPLE);
  });

  // -------------------------------------------------------------------------
  // Test 2: tick() skips tuples with nextProbeAt in the future
  // -------------------------------------------------------------------------
  it('tick() skips tuples with nextProbeAt in the future', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = Date.now() + 60_000; // 1 minute from now

    const calls: Tuple[] = [];
    const driver = makeDriver(o, async t => {
      calls.push(t);
      return { success: true };
    });

    await driver.tick();

    expect(calls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: tick() skips tuples not in UNHEALTHY state
  // -------------------------------------------------------------------------
  it('tick() skips tuples not in UNHEALTHY state', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'HEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const calls: Tuple[] = [];
    const driver = makeDriver(o, async t => {
      calls.push(t);
      return { success: true };
    });

    await driver.tick();

    expect(calls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 4: markProbing prevents concurrent probes on same tuple
  // -------------------------------------------------------------------------
  it('markProbing prevents concurrent probes on same tuple', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const calls: Tuple[] = [];
    const driver = makeDriver(o, async t => {
      calls.push(t);
      await Promise.resolve();
      return { success: true };
    });

    // tick() fires probe but doesn't await — manually call executeProbe for second probe
    await driver.tick();
    // Now manually try to execute again while first is still in-flight
    // markProbing should return false since nextProbeAt was set to MAX_SAFE_INTEGER
    const secondProbe = driver.isProbing(TUPLE);
    expect(secondProbe).toBe(true); // first probe is in-flight

    // Wait for first probe to complete
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Test 5: probeExecutor called with correct tuple
  // -------------------------------------------------------------------------
  it('probeExecutor called with correct tuple', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const calls: Tuple[] = [];
    const driver = makeDriver(o, async t => {
      calls.push(t);
      return { success: true };
    });

    await driver.tick();
    await Promise.resolve(); // wait for fire-and-forget probe to complete

    expect(calls).toHaveLength(1);
    expect(calls[0].serverId).toBe('srv1');
    expect(calls[0].model).toBe('llama3');
    expect(calls[0].endpoint).toBe('ollama_chat');
  });

  // -------------------------------------------------------------------------
  // Test 6: recordProbeResult called with executor's result
  // -------------------------------------------------------------------------
  it('recordProbeResult called with executor result', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o, async () => {
      return { success: true, classification: { kind: 'transient', retryable: true } };
    });

    await driver.tick();
    await Promise.resolve(); // wait for fire-and-forget probe

    expect(o.getState(TUPLE)).toBe('RECOVERING');
  });

  // -------------------------------------------------------------------------
  // Test 7: executeProbe handles probeExecutor throwing (catches error, records failure)
  // -------------------------------------------------------------------------
  it('executeProbe handles probeExecutor throwing and records failure', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o, async () => {
      throw new Error('Connection refused');
    });

    await driver.tick();
    await Promise.resolve(); // wait for fire-and-forget probe

    // Should still be UNHEALTHY since probe failed
    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
  });

  // -------------------------------------------------------------------------
  // Test 8: isProbing returns true during probe, false after
  // -------------------------------------------------------------------------
  it('isProbing returns true during probe, false after', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    let resolveProbe: (v: { success: boolean }) => void;
    const probePromise = new Promise<{ success: boolean }>(r => {
      resolveProbe = r;
    });

    const driver = makeDriver(o, async () => probePromise);

    await driver.tick();
    expect(driver.isProbing(TUPLE)).toBe(true);

    resolveProbe!({ success: true });
    // Wait for promise resolution AND the finally block to run
    await driver.executeProbe(TUPLE).catch(() => {});

    expect(driver.isProbing(TUPLE)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 9: start()/stop() manage timer correctly
  // -------------------------------------------------------------------------
  it('start()/stop() manage timer correctly', () => {
    const o = new ProbeOrchestrator();
    const driver = makeDriver(o);

    const spy = vi.spyOn(global, 'setInterval');
    driver.start();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 1000);

    const handle = spy.mock.results[spy.mock.results.length - 1]?.value as NodeJS.Timeout;
    const clearSpy = vi.spyOn(global, 'clearInterval');

    driver.stop();
    expect(clearSpy).toHaveBeenCalledWith(handle);
    expect(driver.isProbing(TUPLE)).toBe(false); // probing cleared

    spy.mockRestore();
    clearSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Test 10: setProbeExecutor overrides default
  // -------------------------------------------------------------------------
  it('setProbeExecutor overrides default', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o);
    const calls: Tuple[] = [];
    driver.setProbeExecutor(async t => {
      calls.push(t);
      return { success: true };
    });

    await driver.tick();
    await Promise.resolve();

    expect(calls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Test 11: After 3 failed recovery attempts, recoveryAttempts incremented
  // -------------------------------------------------------------------------
  it('After 3 failed recovery attempts, backoff recoveryAttempts incremented', async () => {
    const o = new ProbeOrchestrator();
    const endpointRegistry = new EndpointRegistry();
    const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const driver = new RecoveryDriver(o, endpointRegistry, backoff, DEFAULT_PROBE_CONFIG);

    // Simulate 3 failed probes
    for (let i = 0; i < 3; i++) {
      o.setStateForTesting(TUPLE, 'UNHEALTHY');
      o.getTupleState(TUPLE)!.nextProbeAt = 0;
      o.getTupleState(TUPLE)!.recoveryAttempts = i;

      const driver2 = new RecoveryDriver(
        o,
        endpointRegistry,
        backoff,
        DEFAULT_PROBE_CONFIG,
        async () => ({ success: false })
      );
      await driver2.tick();
      await Promise.resolve();
    }

    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test 12: Probe success in RECOVERING state resets recoveryAttempts
  // -------------------------------------------------------------------------
  it('Probe success in RECOVERING state resets recoveryAttempts', async () => {
    const o = new ProbeOrchestrator();
    const endpointRegistry = new EndpointRegistry();
    const backoff = new BackoffSchedule(DEFAULT_PROBE_CONFIG);

    // Pre-populate backoff with some attempts
    backoff.recordRecoveryAttempt(TUPLE);
    backoff.recordRecoveryAttempt(TUPLE);
    backoff.recordRecoveryAttempt(TUPLE);
    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(3);

    const driver = new RecoveryDriver(
      o,
      endpointRegistry,
      backoff,
      DEFAULT_PROBE_CONFIG,
      async () => ({ success: true })
    );

    // Execute probe directly (not via tick, which only fires on UNHEALTHY)
    await driver.executeProbe(TUPLE);

    expect(backoff.getRecoveryAttempts(TUPLE)).toBe(0);
  });
});
