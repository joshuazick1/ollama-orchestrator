/**
 * ollama-duration-fields.test.ts
 * Tests for REC-25 (Ollama duration field capture), REC-26 (token throughput),
 * and REC-27 (cold start detection via load_duration)
 */

import type { Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MetricsAggregator } from '../../src/metrics/metrics-aggregator.js';
import type { RequestContext } from '../../src/orchestrator.types.js';
import { streamResponse, type OllamaDurations } from '../../src/streaming.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock InFlightManager
vi.mock('../../src/utils/in-flight-manager.js', () => ({
  getInFlightManager: vi.fn(() => ({
    updateChunkProgress: vi.fn(),
    addStreamingRequest: vi.fn(),
    removeStreamingRequest: vi.fn(),
  })),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers (copied from streaming.test.ts pattern)
// ──────────────────────────────────────────────────────────────────────────────

function createMockBody(chunks: string[]): ReadableStream {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (index >= chunks.length) {
          return { done: true, value: undefined };
        }
        const chunk = new TextEncoder().encode(chunks[index]);
        index++;
        return { done: false, value: chunk };
      },
      cancel: vi.fn(),
    }),
  } as any;
}

function createMockUpstreamResponse(body: ReadableStream): any {
  return {
    body,
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  };
}

function createMockExpressResponse(): Partial<Response> {
  return {
    setHeader: vi.fn().mockReturnThis(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn().mockReturnThis(),
    writableEnded: false,
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// REC-25: OllamaStreamChunk and OllamaDurations interface
// ──────────────────────────────────────────────────────────────────────────────

describe('REC-25: OllamaDurations interface and duration field extraction', () => {
  it('OllamaDurations interface has all four nanosecond fields', () => {
    const durations: OllamaDurations = {
      evalDuration: 1_000_000_000,
      promptEvalDuration: 200_000_000,
      totalDuration: 1_500_000_000,
      loadDuration: 50_000_000,
    };
    expect(durations.evalDuration).toBe(1_000_000_000);
    expect(durations.promptEvalDuration).toBe(200_000_000);
    expect(durations.totalDuration).toBe(1_500_000_000);
    expect(durations.loadDuration).toBe(50_000_000);
  });

  it('OllamaDurations fields are all optional', () => {
    const durations: OllamaDurations = {};
    expect(durations.evalDuration).toBeUndefined();
    expect(durations.promptEvalDuration).toBeUndefined();
    expect(durations.totalDuration).toBeUndefined();
    expect(durations.loadDuration).toBeUndefined();
  });

  it('streamResponse extracts duration fields from done chunk and passes them via onComplete', async () => {
    const doneChunk = JSON.stringify({
      done: true,
      eval_count: 42,
      prompt_eval_count: 10,
      eval_duration: 2_000_000_000,
      prompt_eval_duration: 300_000_000,
      total_duration: 2_500_000_000,
      load_duration: 150_000_000,
    });

    const mockBody = createMockBody(['{"response":"hello","done":false}', doneChunk]);
    const mockUpstream = createMockUpstreamResponse(mockBody);
    const mockRes = createMockExpressResponse();

    let capturedDurations: OllamaDurations | undefined;
    const onComplete = vi.fn(
      (
        _duration: number,
        _tokens: number,
        _tokensPrompt: number,
        _chunkData: any,
        durations?: OllamaDurations
      ) => {
        capturedDurations = durations;
      }
    );

    await streamResponse(mockUpstream, mockRes as Response, undefined, onComplete);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(capturedDurations).toBeDefined();
    expect(capturedDurations?.evalDuration).toBe(2_000_000_000);
    expect(capturedDurations?.promptEvalDuration).toBe(300_000_000);
    expect(capturedDurations?.totalDuration).toBe(2_500_000_000);
    expect(capturedDurations?.loadDuration).toBe(150_000_000);
  });

  it('streamResponse passes undefined ollamaDurations when done chunk has no duration fields', async () => {
    const doneChunk = JSON.stringify({ done: true, eval_count: 10 });
    const mockBody = createMockBody(['{"response":"hi","done":false}', doneChunk]);
    const mockUpstream = createMockUpstreamResponse(mockBody);
    const mockRes = createMockExpressResponse();

    let capturedDurations: OllamaDurations | undefined = { evalDuration: 999 }; // non-undefined default

    const onComplete = vi.fn(
      (_d: number, _t: number, _tp: number, _c: any, durations?: OllamaDurations) => {
        capturedDurations = durations;
      }
    );

    await streamResponse(mockUpstream, mockRes as Response, undefined, onComplete);

    expect(capturedDurations).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// REC-26: Token throughput (tokens/sec) computation
// ──────────────────────────────────────────────────────────────────────────────

describe('REC-26: Token throughput computation in MetricsAggregator', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator();
  });

  it('computes tokensPerSecond on the RequestContext when both tokensGenerated and evalDuration are present', () => {
    const ctx: RequestContext = {
      id: 'req-1',
      startTime: Date.now() - 500,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: true,
      success: true,
      duration: 500,
      tokensGenerated: 30,
      evalDuration: 3_000_000_000, // 3 seconds → 10 t/s
    };

    aggregator.recordRequest(ctx);

    expect(ctx.tokensPerSecond).toBeCloseTo(10, 5);
  });

  it('seeds avgTokensPerSecond to first computed value when starting from zero', () => {
    const ctx: RequestContext = {
      id: 'req-1',
      startTime: Date.now() - 500,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: true,
      success: true,
      duration: 500,
      tokensGenerated: 50,
      evalDuration: 1_000_000_000, // 1 second → 50 t/s
    };

    aggregator.recordRequest(ctx);
    const metrics = aggregator.getMetrics('server-1', 'llama3:latest');

    expect(metrics?.avgTokensPerSecond).toBeCloseTo(50, 5);
  });

  it('updates avgTokensPerSecond using EMA (alpha=0.2) across multiple requests', () => {
    const base: Omit<RequestContext, 'id' | 'tokensGenerated' | 'evalDuration'> = {
      startTime: Date.now() - 200,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: true,
      success: true,
      duration: 200,
    };

    // First request: 40 t/s → seeds avgTokensPerSecond = 40
    aggregator.recordRequest({
      ...base,
      id: 'r1',
      tokensGenerated: 40,
      evalDuration: 1_000_000_000,
    });
    // Second request: 60 t/s → EMA: 40 * 0.8 + 60 * 0.2 = 44
    aggregator.recordRequest({
      ...base,
      id: 'r2',
      tokensGenerated: 60,
      evalDuration: 1_000_000_000,
    });

    const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
    expect(metrics?.avgTokensPerSecond).toBeCloseTo(44, 5);
  });

  it('does not compute tokensPerSecond when evalDuration is zero', () => {
    const ctx: RequestContext = {
      id: 'req-1',
      startTime: Date.now() - 100,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: true,
      success: true,
      duration: 100,
      tokensGenerated: 20,
      evalDuration: 0,
    };

    aggregator.recordRequest(ctx);

    expect(ctx.tokensPerSecond).toBeUndefined();
    const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
    expect(metrics?.avgTokensPerSecond).toBe(0); // unchanged from init
  });

  it('does not compute tokensPerSecond when tokensGenerated is absent', () => {
    const ctx: RequestContext = {
      id: 'req-1',
      startTime: Date.now() - 100,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 100,
      evalDuration: 1_000_000_000,
      // tokensGenerated intentionally omitted
    };

    aggregator.recordRequest(ctx);

    expect(ctx.tokensPerSecond).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// REC-27: Cold start detection via load_duration
// ──────────────────────────────────────────────────────────────────────────────

describe('REC-27: Cold start detection via load_duration', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator();
  });

  it('marks isColdStart=true and increments coldStartCount when load_duration > 100ms', () => {
    const ctx: RequestContext = {
      id: 'req-cold',
      startTime: Date.now() - 1000,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 1000,
      loadDuration: 500_000_000, // 500ms — clearly a cold start
    };

    aggregator.recordRequest(ctx);

    expect(ctx.isColdStart).toBe(true);
    const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
    expect(metrics?.coldStartCount).toBe(1);
  });

  it('does NOT mark isColdStart when load_duration is below threshold (< 100ms)', () => {
    const ctx: RequestContext = {
      id: 'req-warm',
      startTime: Date.now() - 200,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 200,
      loadDuration: 50_000_000, // 50ms — warm start
    };

    aggregator.recordRequest(ctx);

    expect(ctx.isColdStart).toBeUndefined();
    const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
    expect(metrics?.coldStartCount).toBe(0);
  });

  it('does NOT mark isColdStart when loadDuration is absent', () => {
    const ctx: RequestContext = {
      id: 'req-no-duration',
      startTime: Date.now() - 200,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 200,
      // loadDuration intentionally absent
    };

    aggregator.recordRequest(ctx);

    expect(ctx.isColdStart).toBeUndefined();
    const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
    expect(metrics?.coldStartCount).toBe(0);
  });

  it('accumulates coldStartCount across multiple cold starts', () => {
    const base: Omit<RequestContext, 'id'> = {
      startTime: Date.now() - 500,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 500,
      loadDuration: 200_000_000, // 200ms — cold start
    };

    aggregator.recordRequest({ ...base, id: 'r1' });
    aggregator.recordRequest({ ...base, id: 'r2' });
    aggregator.recordRequest({ ...base, id: 'r3' });

    const metrics = aggregator.getMetrics('server-1', 'llama3:latest');
    expect(metrics?.coldStartCount).toBe(3);
  });

  it('threshold boundary: exactly 100_000_000ns is NOT a cold start', () => {
    const ctx: RequestContext = {
      id: 'req-boundary',
      startTime: Date.now() - 300,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 300,
      loadDuration: 100_000_000, // exactly 100ms — not > threshold
    };

    aggregator.recordRequest(ctx);

    expect(ctx.isColdStart).toBeUndefined();
  });

  it('threshold boundary: 100_000_001ns IS a cold start', () => {
    const ctx: RequestContext = {
      id: 'req-boundary-plus',
      startTime: Date.now() - 300,
      serverId: 'server-1',
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 300,
      loadDuration: 100_000_001, // just over 100ms
    };

    aggregator.recordRequest(ctx);

    expect(ctx.isColdStart).toBe(true);
  });
});
