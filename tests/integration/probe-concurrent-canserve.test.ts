import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ProbeOrchestrator } from '../../src/probe/probe-orchestrator.js';
import type { Tuple } from '../../src/probe/types.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const TUPLE: Tuple = { serverId: 'srv-1', model: 'test-model', endpoint: 'ollama_chat' };

describe('ProbeOrchestrator - concurrent canServe UNHEALTHY→RECOVERING', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('should only allow ONE transition when canServe is called 100 times concurrently', async () => {
    const o = new ProbeOrchestrator();

    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    const ts = o.getTupleState(TUPLE)!;
    ts.nextProbeAt = Date.now() - 1000;

    const results = await Promise.all(
      Array.from({ length: 100 }, () => o.canServe(TUPLE, 'routing'))
    );

    const trueCount = results.filter(r => r === true).length;
    expect(trueCount).toBe(0);
    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
  });

  it('should serialize transitions using markProbing with only ONE caller succeeding', async () => {
    const o = new ProbeOrchestrator();

    o.setStateForTesting(TUPLE, 'UNHEALTHY');
    const ts = o.getTupleState(TUPLE)!;
    ts.nextProbeAt = Date.now() - 1000;

    const results = await Promise.all(Array.from({ length: 50 }, () => o.markProbing(TUPLE)));

    const trueCount = results.filter(r => r === true).length;
    expect(trueCount).toBe(1);

    const state = o.getTupleState(TUPLE);
    expect(state?.recoveryAttempts).toBe(0);
    expect(o.getState(TUPLE)).toBe('UNHEALTHY');
  });
});
