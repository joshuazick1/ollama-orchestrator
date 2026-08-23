/**
 * three-sink-feeder.test.ts
 * Tests for the probe-sink feeder. After Task 2, `feedThreeSinks` is a
 * single-dispatch wrapper around RequestTelemetry.recordRequest().
 *
 * These tests cover:
 *   - the export still exists
 *   - probe outcomes flow into all sinks exactly once
 *   - dryRun / skipped short-circuits do not invoke any sink
 *   - delegation goes through RequestTelemetry (not the manual triplet)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordRequestMock = vi.fn();
const buildProbeRequestContextMock = vi.fn();
const getOrchestratorInstanceMock = vi.fn();

vi.mock('../../../src/metrics/request-telemetry.js', () => ({
  RequestTelemetry: class {
    constructor() {
      this.recordRequest = recordRequestMock;
    }
  },
}));

vi.mock('../../../src/utils/probe-to-request-context.js', () => ({
  buildProbeRequestContext: (...args: unknown[]) => buildProbeRequestContextMock(...args),
}));

vi.mock('../../../src/orchestrator/orchestrator-instance.js', () => ({
  getOrchestratorInstance: () => getOrchestratorInstanceMock(),
}));

import { feedThreeSinks } from '../../../src/probe/three-sink-feeder.js';

describe('feedThreeSinks (Task 2 single-dispatch wrapper)', () => {
  beforeEach(() => {
    recordRequestMock.mockReset();
    buildProbeRequestContextMock.mockReset();
    getOrchestratorInstanceMock.mockReset();
    recordRequestMock.mockReturnValue(undefined);
    getOrchestratorInstanceMock.mockReturnValue({
      getMetricsAggregator: () => ({ recordRequest: vi.fn() }),
      getRequestHistory: () => ({ recordRequest: vi.fn() }),
      getMetricsStore: () => ({ recordRequest: vi.fn() }),
    });
    buildProbeRequestContextMock.mockReturnValue({
      id: 'probe-ctx-1',
      serverId: 'server-x',
      model: 'llama3',
      endpoint: 'ollama_generate',
      streaming: true,
      success: true,
      isProbe: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exports feedThreeSinks as a function', () => {
    expect(typeof feedThreeSinks).toBe('function');
  });

  it('returns void without throwing when invoked with a normal probe result', () => {
    const result = {
      serverId: 'server-x',
      model: 'llama3',
      success: true,
      totalDurationMs: 100,
    };
    expect(() => feedThreeSinks(result as never, 'task-1', false)).not.toThrow();
  });

  it('delegates to RequestTelemetry.recordRequest exactly once per probe', () => {
    const result = {
      serverId: 'server-x',
      model: 'llama3',
      success: true,
      totalDurationMs: 100,
    };
    feedThreeSinks(result as never, 'task-1', false);

    expect(recordRequestMock).toHaveBeenCalledTimes(1);
  });

  it('builds the request context from the probe result', () => {
    const result = {
      serverId: 'server-y',
      model: 'mistral',
      success: false,
      totalDurationMs: 250,
      error: 'probe failed',
      errorType: 'network',
    };
    feedThreeSinks(result as never, 'task-42', false);

    expect(buildProbeRequestContextMock).toHaveBeenCalledWith(result, 'task-42');
  });

  it('passes the RequestContext from buildProbeRequestContext into RequestTelemetry.recordRequest', () => {
    const ctx = {
      id: 'probe-ctx-99',
      serverId: 'server-z',
      model: 'gpt',
      endpoint: 'ollama_generate',
      streaming: true,
      success: true,
      isProbe: true,
    };
    buildProbeRequestContextMock.mockReturnValueOnce(ctx);

    const result = {
      serverId: 'server-z',
      model: 'gpt',
      success: true,
      totalDurationMs: 50,
    };
    feedThreeSinks(result as never, 'task-99', false);

    expect(recordRequestMock).toHaveBeenCalledWith(ctx);
  });

  it('does not invoke getOrchestratorInstance on the hot path (RequestTelemetry is the boundary)', () => {
    const result = {
      serverId: 'server-x',
      model: 'llama3',
      success: true,
      totalDurationMs: 100,
    };
    feedThreeSinks(result as never, 'task-1', false);

    expect(getOrchestratorInstanceMock).not.toHaveBeenCalled();
  });

  it('short-circuits on dryRun=true and does not dispatch', () => {
    const result = {
      serverId: 'server-x',
      model: 'llama3',
      success: true,
      totalDurationMs: 100,
    };
    feedThreeSinks(result as never, 'task-1', true);

    expect(recordRequestMock).not.toHaveBeenCalled();
    expect(buildProbeRequestContextMock).not.toHaveBeenCalled();
  });

  it('short-circuits when result.skipped=true and does not dispatch', () => {
    const result = {
      serverId: 'server-x',
      model: 'llama3',
      success: true,
      totalDurationMs: 100,
      skipped: true,
    };
    feedThreeSinks(result as never, 'task-1', false);

    expect(recordRequestMock).not.toHaveBeenCalled();
  });

  it('swallows a sink throw without bubbling the error', () => {
    recordRequestMock.mockImplementation(() => {
      throw new Error('sink failure');
    });

    const result = {
      serverId: 'server-x',
      model: 'llama3',
      success: true,
      totalDurationMs: 100,
    };

    expect(() => feedThreeSinks(result as never, 'task-1', false)).not.toThrow();
  });
});
