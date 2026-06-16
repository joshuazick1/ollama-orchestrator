import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { RecoveryDriver, BackoffSchedule } from '../../../src/probe/recovery-driver.js';
import { ProbeOrchestrator } from '../../../src/probe/probe-orchestrator.js';
import { EndpointRegistry } from '../../../src/probe/endpoint-registry.js';
import { DEFAULT_PROBE_CONFIG, type Tuple, type Classification } from '../../../src/probe/types.js';

const TUPLE: Tuple = { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' };

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

describe('RecoveryDriver timeout handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('probeExecutor timeout returns timeout classification', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o, async () => {
      return { success: false, classification: { kind: 'timeout', retryable: true } };
    });

    await driver.tick();
    await Promise.resolve();

    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
  });

  it('probeExecutor timeout increments consecutiveFailures', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;
    o.getTupleState(TUPLE)!.consecutiveFailures = 0;

    const driver = makeDriver(o, async () => {
      return { success: false, classification: { kind: 'timeout', retryable: true } };
    });

    await driver.tick();
    await Promise.resolve();

    expect(o.getTupleState(TUPLE)?.consecutiveFailures).toBeGreaterThanOrEqual(1);
  });

  it('multiple consecutive timeouts keep tuple UNHEALTHY', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o, async () => {
      return { success: false, classification: { kind: 'timeout', retryable: true } };
    });

    await driver.tick();
    await Promise.resolve();
    expect(o.getState(TUPLE)).toBe('UNHEALTHY');

    o.getTupleState(TUPLE)!.nextProbeAt = 0;
    o.getTupleState(TUPLE)!.consecutiveFailures = 1;

    const driver2 = makeDriver(o, async () => {
      return { success: false, classification: { kind: 'timeout', retryable: true } };
    });

    await driver2.tick();
    await Promise.resolve();
    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
  });

  it('timeout classification is stored in lastErrorKind', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o, async () => {
      return { success: false, classification: { kind: 'timeout', retryable: true } };
    });

    await driver.tick();
    await Promise.resolve();

    expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('timeout');
  });

  it('successful probe after timeout resets to RECOVERING', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;
    o.getTupleState(TUPLE)!.consecutiveFailures = 3;

    const driver = makeDriver(o, async () => {
      return { success: true };
    });

    await driver.tick();
    await Promise.resolve();

    expect(o.getState(TUPLE)).toBe('RECOVERING');
  });

  it('executeProbe handles timeout error thrown by executor', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o, async () => {
      throw new Error('Request timeout after 5000ms');
    });

    await driver.tick();
    await Promise.resolve();

    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
  });

  it('timeout tuple can recover to HEALTHY after 5 successful probes', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'RECOVERING');
    o.getTupleState(TUPLE)!.consecutiveSuccesses = 0;
    o.getTupleState(TUPLE)!.recoveryAttempts = 1;

    const driver = makeDriver(o, async () => {
      return { success: true };
    });

    for (let i = 0; i < 5; i++) {
      await driver.executeProbe(TUPLE);
    }

    expect(o.getState(TUPLE)).toBe('HEALTHY');
    expect(o.getTupleState(TUPLE)?.recoveryAttempts).toBe(0);
  });

  it('non-timeout failure records correct classification kind', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o, async () => {
      return { success: false, classification: { kind: 'transient', retryable: true } };
    });

    await driver.tick();
    await Promise.resolve();

    expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('transient');
  });

  it('rate_limited error is stored correctly', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o, async () => {
      return {
        success: false,
        classification: { kind: 'rate_limited', retryable: true, retryAfterMs: 5000 },
      };
    });

    await driver.tick();
    await Promise.resolve();

    expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('rate_limited');
  });

  it('permanent error is stored correctly', async () => {
    const o = new ProbeOrchestrator();
    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    o.getTupleState(TUPLE)!.nextProbeAt = 0;

    const driver = makeDriver(o, async () => {
      return { success: false, classification: { kind: 'permanent', retryable: false } };
    });

    await driver.tick();
    await Promise.resolve();

    expect(o.getTupleState(TUPLE)?.lastErrorKind).toBe('permanent');
  });
});
