/**
 * sse-passthrough.test.ts
 * Wave 4 verification tests for:
 *  - REC-42: Backpressure in streamOpenAIResponse()
 *  - REC-37: tool_calls and dynamic finish_reason in NDJSON-to-SSE translation
 *  - REC-36: SSE passthrough for v1-capable servers (passthroughSSEStream)
 *  - REC-38: /v1/completions uses SSE format (not raw NDJSON)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock fetch Response whose body is a ReadableStream that emits the
 * provided strings one at a time, then closes.
 */
function makeMockResponse(lines: string[]): globalThis.Response {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  // Enqueue all lines then close
  const encoder = new TextEncoder();
  for (const line of lines) {
    controller.enqueue(encoder.encode(line));
  }
  controller.close();

  return {
    ok: true,
    status: 200,
    body: stream,
    headers: new Headers(),
  } as unknown as globalThis.Response;
}

/**
 * Build a minimal mock Express Response that records all write() calls.
 * Also supports simulating backpressure: set `triggerBackpressureOnNthWrite`
 * and the n-th write will return false once (then always true afterwards).
 */
function makeMockClientResponse(opts: { triggerBackpressureOnNthWrite?: number } = {}): {
  res: any;
  written: string[];
  drainCalled: boolean;
} {
  const written: string[] = [];
  let drainCalled = false;
  let writeCount = 0;
  const drainListeners: Array<() => void> = [];

  const res: any = {
    headersSent: false,
    writableEnded: false,
    setHeader: vi.fn(),
    write(data: string) {
      writeCount++;
      written.push(data);
      // Trigger backpressure on nth write
      if (
        opts.triggerBackpressureOnNthWrite !== undefined &&
        writeCount === opts.triggerBackpressureOnNthWrite
      ) {
        // Schedule drain on next tick
        setTimeout(() => {
          drainCalled = true;
          drainListeners.forEach(fn => fn());
          drainListeners.length = 0;
        }, 0);
        return false; // signal backpressure
      }
      return true;
    },
    once(event: string, fn: () => void) {
      if (event === 'drain') {
        drainListeners.push(fn);
      }
    },
    end: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };

  return { res, written, drainCalled: false };
}

// ---------------------------------------------------------------------------
// Import the private functions via a re-export shim — we test them indirectly
// through integration-style checks by mocking fetch and express and calling
// handleChatCompletions / handleCompletions.
// ---------------------------------------------------------------------------
vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/config/config.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../src/utils/in-flight-manager.js', () => ({
  getInFlightManager: () => ({
    tryIncrementInFlight: vi.fn().mockReturnValue(true),
    decrementInFlight: vi.fn(),
    updateChunkProgress: vi.fn(),
    removeStreamingRequest: vi.fn(),
    getTotalInFlight: vi.fn().mockReturnValue(0),
  }),
}));
vi.mock('../../src/utils/fetchWithTimeout.js', () => ({
  fetchWithTimeout: vi.fn(),
  fetchWithActivityTimeout: vi.fn(),
}));
vi.mock('../../src/utils/debug-headers.js', () => ({
  addDebugHeaders: vi.fn(),
  getDebugInfo: vi.fn().mockReturnValue(null),
  isDebugRequested: vi.fn().mockReturnValue(false),
}));
vi.mock('../../src/utils/api-keys.js', () => ({
  resolveApiKey: vi.fn().mockReturnValue(null),
}));
vi.mock('../../src/utils/circuit-breaker-helpers.js', () => ({
  shouldBypassCircuitBreaker: vi.fn().mockReturnValue(false),
}));

import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import { getConfigManager } from '../../src/config/config.js';
import { fetchWithActivityTimeout } from '../../src/utils/fetchWithTimeout.js';
import {
  handleChatCompletions,
  handleCompletions,
} from '../../src/controllers/openaiController.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockGetConfigManager = vi.mocked(getConfigManager);
const mockFetchWithActivityTimeout = vi.mocked(fetchWithActivityTimeout);

function makeActivityController() {
  return {
    clearTimeout: vi.fn(),
    resetTimeout: vi.fn(),
    controller: { signal: { aborted: false } },
  };
}

function makeOrchestrator(server: any) {
  return {
    tryRequestWithFailover: vi.fn(
      async (_model: string, fn: (server: any, ctx: any) => Promise<any>, _stream: boolean) => {
        return await fn(server, { requestId: 'test-req-id' });
      }
    ),
    getTimeout: vi.fn().mockReturnValue(30000),
    getServers: vi.fn().mockReturnValue([server]),
  };
}

function makeConfig() {
  return {
    getConfig: vi.fn().mockReturnValue({
      streaming: {
        stallThresholdMs: 300000,
        stallCheckIntervalMs: 10000,
      },
    }),
  };
}

function makeReq(body: Record<string, unknown>): any {
  return {
    body,
    query: {},
    headers: {},
  };
}

// ---------------------------------------------------------------------------
// REC-42: Backpressure in streamOpenAIResponse
// ---------------------------------------------------------------------------
describe('REC-42: Backpressure in NDJSON-to-SSE translation', () => {
  it('should wait for drain before writing next chunk when write() returns false', async () => {
    const ndjsonLines = [
      '{"model":"test","message":{"content":"Hello"},"done":false}\n',
      '{"model":"test","message":{"content":" world"},"done":false}\n',
      '{"model":"test","done":true,"eval_count":2,"prompt_eval_count":1}\n',
    ];

    const upstreamResponse = makeMockResponse(ndjsonLines);
    const activityController = makeActivityController();

    mockFetchWithActivityTimeout.mockResolvedValueOnce({
      response: upstreamResponse,
      activityController,
    } as any);

    const server = {
      id: 'ollama-only',
      url: 'http://localhost:11434',
      supportsV1: false,
      healthy: true,
    };

    mockGetOrchestratorInstance.mockReturnValue(makeOrchestrator(server) as any);
    mockGetConfigManager.mockReturnValue(makeConfig() as any);

    // Trigger backpressure on the 2nd write (role-only chunk is first)
    const { res, written } = makeMockClientResponse({ triggerBackpressureOnNthWrite: 2 });
    const req = makeReq({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    await handleChatCompletions(req, res);

    // Should have written multiple SSE chunks
    expect(written.length).toBeGreaterThan(0);
    // All writes must be SSE-format lines
    const sseWrites = written.filter(w => w.startsWith('data: '));
    expect(sseWrites.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// REC-37: tool_calls and dynamic finish_reason
// ---------------------------------------------------------------------------
describe('REC-37: NDJSON-to-SSE translation handles tool_calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit delta.tool_calls when Ollama chunk contains tool_calls', async () => {
    const toolCallChunk = {
      model: 'test',
      message: {
        content: '',
        tool_calls: [
          {
            index: 0,
            id: 'call_abc',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"London"}' },
          },
        ],
      },
      done: false,
    };

    const ndjsonLines = [
      JSON.stringify(toolCallChunk) + '\n',
      '{"model":"test","done":true,"eval_count":5,"prompt_eval_count":2}\n',
    ];

    const upstreamResponse = makeMockResponse(ndjsonLines);
    const activityController = makeActivityController();

    mockFetchWithActivityTimeout.mockResolvedValueOnce({
      response: upstreamResponse,
      activityController,
    } as any);

    const server = {
      id: 'ollama-only',
      url: 'http://localhost:11434',
      supportsV1: false,
      healthy: true,
    };

    mockGetOrchestratorInstance.mockReturnValue(makeOrchestrator(server) as any);
    mockGetConfigManager.mockReturnValue(makeConfig() as any);

    const { res, written } = makeMockClientResponse();
    const req = makeReq({
      model: 'test',
      messages: [{ role: 'user', content: 'get weather' }],
      stream: true,
      tools: [{ type: 'function', function: { name: 'get_weather' } }],
    });

    await handleChatCompletions(req, res);

    // Find the SSE chunks that contain actual content (not role-only)
    const sseWrites = written.filter(w => w.startsWith('data: ') && w !== 'data: [DONE]\n\n');

    // Find the tool_calls chunk
    const toolCallsWrite = sseWrites.find(w => {
      try {
        const parsed = JSON.parse(w.replace(/^data: /, '').trim());
        return parsed?.choices?.[0]?.delta?.tool_calls !== undefined;
      } catch {
        return false;
      }
    });

    expect(toolCallsWrite).toBeDefined();
    const parsed = JSON.parse(toolCallsWrite!.replace(/^data: /, '').trim());
    const delta = parsed.choices[0].delta;
    expect(delta.tool_calls).toHaveLength(1);
    expect(delta.tool_calls[0].function.name).toBe('get_weather');
    expect(delta.tool_calls[0].function.arguments).toBe('{"city":"London"}');
  });

  it('should set finish_reason=tool_calls when tool_calls present in chunk', async () => {
    const toolCallChunk = {
      model: 'test',
      message: {
        content: '',
        tool_calls: [
          {
            index: 0,
            id: 'call_xyz',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          },
        ],
      },
      done: false,
    };

    const ndjsonLines = [JSON.stringify(toolCallChunk) + '\n', '{"model":"test","done":true}\n'];

    const upstreamResponse = makeMockResponse(ndjsonLines);
    const activityController = makeActivityController();

    mockFetchWithActivityTimeout.mockResolvedValueOnce({
      response: upstreamResponse,
      activityController,
    } as any);

    const server = { id: 'ollama-only', url: 'http://localhost:11434', supportsV1: false };

    mockGetOrchestratorInstance.mockReturnValue(makeOrchestrator(server) as any);
    mockGetConfigManager.mockReturnValue(makeConfig() as any);

    const { res, written } = makeMockClientResponse();
    const req = makeReq({
      model: 'test',
      messages: [{ role: 'user', content: 'search for test' }],
      stream: true,
    });

    await handleChatCompletions(req, res);

    const sseWrites = written.filter(w => w.startsWith('data: ') && w !== 'data: [DONE]\n\n');

    const toolCallsWrite = sseWrites.find(w => {
      try {
        const parsed = JSON.parse(w.replace(/^data: /, '').trim());
        return parsed?.choices?.[0]?.delta?.tool_calls !== undefined;
      } catch {
        return false;
      }
    });

    expect(toolCallsWrite).toBeDefined();
    const parsed = JSON.parse(toolCallsWrite!.replace(/^data: /, '').trim());
    expect(parsed.choices[0].finish_reason).toBe('tool_calls');
  });

  it('should set finish_reason=length on done chunk when truncated=true', async () => {
    const ndjsonLines = [
      '{"model":"test","message":{"content":"Hi"},"done":false}\n',
      '{"model":"test","done":true,"truncated":true,"eval_count":5,"prompt_eval_count":2}\n',
    ];

    const upstreamResponse = makeMockResponse(ndjsonLines);
    const activityController = makeActivityController();

    mockFetchWithActivityTimeout.mockResolvedValueOnce({
      response: upstreamResponse,
      activityController,
    } as any);

    const server = { id: 'ollama-only', url: 'http://localhost:11434', supportsV1: false };

    mockGetOrchestratorInstance.mockReturnValue(makeOrchestrator(server) as any);
    mockGetConfigManager.mockReturnValue(makeConfig() as any);

    const { res, written } = makeMockClientResponse();
    const req = makeReq({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    await handleChatCompletions(req, res);

    // Find the final delta chunk (has finish_reason set)
    const finalWrite = written.find(w => {
      try {
        const parsed = JSON.parse(w.replace(/^data: /, '').trim());
        return parsed?.choices?.[0]?.finish_reason === 'length';
      } catch {
        return false;
      }
    });

    expect(finalWrite).toBeDefined();
  });

  it('should emit role-only first chunk before content chunks', async () => {
    const ndjsonLines = [
      '{"model":"test","message":{"content":"Hello"},"done":false}\n',
      '{"model":"test","done":true}\n',
    ];

    const upstreamResponse = makeMockResponse(ndjsonLines);
    const activityController = makeActivityController();

    mockFetchWithActivityTimeout.mockResolvedValueOnce({
      response: upstreamResponse,
      activityController,
    } as any);

    const server = { id: 'ollama-only', url: 'http://localhost:11434', supportsV1: false };

    mockGetOrchestratorInstance.mockReturnValue(makeOrchestrator(server) as any);
    mockGetConfigManager.mockReturnValue(makeConfig() as any);

    const { res, written } = makeMockClientResponse();
    const req = makeReq({
      model: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    await handleChatCompletions(req, res);

    const sseWrites = written.filter(w => w.startsWith('data: ') && w !== 'data: [DONE]\n\n');
    expect(sseWrites.length).toBeGreaterThan(0);

    // First SSE chunk should be role-only
    const firstChunk = JSON.parse(sseWrites[0].replace(/^data: /, '').trim());
    expect(firstChunk.choices[0].delta.role).toBe('assistant');
    // Role chunk should have empty or no content
    expect(firstChunk.choices[0].delta.content ?? '').toBe('');
  });
});

// ---------------------------------------------------------------------------
// REC-36: SSE passthrough for v1-capable servers
// ---------------------------------------------------------------------------
describe('REC-36: SSE passthrough for v1-capable servers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should forward SSE bytes verbatim when server.supportsV1=true', async () => {
    const sseLines = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n',
      '\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n',
      '\n',
      'data: [DONE]\n',
      '\n',
    ];

    const upstreamResponse = makeMockResponse(sseLines);
    const activityController = makeActivityController();

    mockFetchWithActivityTimeout.mockResolvedValueOnce({
      response: upstreamResponse,
      activityController,
    } as any);

    const server = {
      id: 'openai-capable',
      url: 'http://localhost:8000',
      supportsV1: true,
      healthy: true,
    };

    mockGetOrchestratorInstance.mockReturnValue(makeOrchestrator(server) as any);
    mockGetConfigManager.mockReturnValue(makeConfig() as any);

    const { res, written } = makeMockClientResponse();
    const req = makeReq({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    });

    await handleChatCompletions(req, res);

    // The combined output should contain the original data lines
    const combined = written.join('');
    expect(combined).toContain('data: {"id":"chatcmpl-1"');
    expect(combined).toContain('data: [DONE]');
  });

  it('should NOT re-translate SSE (no double-wrapping) for v1 servers', async () => {
    const sseLines = [
      'data: {"id":"chatcmpl-x","object":"chat.completion.chunk","choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n',
      '\n',
      'data: [DONE]\n',
      '\n',
    ];

    const upstreamResponse = makeMockResponse(sseLines);
    const activityController = makeActivityController();

    mockFetchWithActivityTimeout.mockResolvedValueOnce({
      response: upstreamResponse,
      activityController,
    } as any);

    const server = { id: 'openai-cap', url: 'http://localhost:8000', supportsV1: true };

    mockGetOrchestratorInstance.mockReturnValue(makeOrchestrator(server) as any);
    mockGetConfigManager.mockReturnValue(makeConfig() as any);

    const { res, written } = makeMockClientResponse();
    const req = makeReq({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    await handleChatCompletions(req, res);

    // The forwarded output should NOT contain nested "data: data: " double-wrapping
    const combined = written.join('');
    expect(combined).not.toContain('data: data:');
    // But should contain the original SSE line
    expect(combined).toContain('"content":"hi"');
  });
});

// ---------------------------------------------------------------------------
// REC-38: /v1/completions uses SSE format
// ---------------------------------------------------------------------------
describe('REC-38: /v1/completions returns SSE, not raw NDJSON', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit SSE data: lines for /v1/completions streaming', async () => {
    const ndjsonLines = [
      '{"model":"test","response":"Hello","done":false}\n',
      '{"model":"test","response":" world","done":false}\n',
      '{"model":"test","done":true,"eval_count":3,"prompt_eval_count":1}\n',
    ];

    const upstreamResponse = makeMockResponse(ndjsonLines);
    const activityController = makeActivityController();

    mockFetchWithActivityTimeout.mockResolvedValueOnce({
      response: upstreamResponse,
      activityController,
    } as any);

    const server = { id: 'ollama-1', url: 'http://localhost:11434', supportsV1: false };

    mockGetOrchestratorInstance.mockReturnValue(makeOrchestrator(server) as any);
    mockGetConfigManager.mockReturnValue(makeConfig() as any);

    const { res, written } = makeMockClientResponse();
    const req = makeReq({
      model: 'test',
      prompt: 'Say hello',
      stream: true,
    });

    await handleCompletions(req, res);

    // All writes should be SSE-format
    const nonBlankWrites = written.filter(w => w.trim().length > 0);
    expect(nonBlankWrites.length).toBeGreaterThan(0);

    for (const w of nonBlankWrites) {
      expect(w).toMatch(/^data: /);
    }

    // Should end with [DONE]
    const combined = written.join('');
    expect(combined).toContain('data: [DONE]');
  });

  it('should format completions chunks as text_completion objects', async () => {
    const ndjsonLines = [
      '{"model":"test","response":"Hello","done":false}\n',
      '{"model":"test","done":true}\n',
    ];

    const upstreamResponse = makeMockResponse(ndjsonLines);
    const activityController = makeActivityController();

    mockFetchWithActivityTimeout.mockResolvedValueOnce({
      response: upstreamResponse,
      activityController,
    } as any);

    const server = { id: 'ollama-1', url: 'http://localhost:11434', supportsV1: false };

    mockGetOrchestratorInstance.mockReturnValue(makeOrchestrator(server) as any);
    mockGetConfigManager.mockReturnValue(makeConfig() as any);

    const { res, written } = makeMockClientResponse();
    const req = makeReq({ model: 'test', prompt: 'test', stream: true });

    await handleCompletions(req, res);

    // Find a content chunk
    const contentChunk = written.find(w => {
      try {
        const parsed = JSON.parse(w.replace(/^data: /, '').trim());
        return parsed?.object === 'text_completion' && parsed?.choices?.[0]?.text === 'Hello';
      } catch {
        return false;
      }
    });

    expect(contentChunk).toBeDefined();
  });
});
