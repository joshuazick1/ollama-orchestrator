import type { Request, Response } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { handleMessages } from '../../src/controllers/anthropic-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { mockServers, mockResponses } from '../fixtures/index.js';

vi.mock('../../src/orchestrator/orchestrator-instance.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../src/utils/fetch-with-timeout.js', () => ({
  fetchWithTimeout: vi.fn(),
  fetchWithActivityTimeout: vi.fn(),
}));
vi.mock('../../src/utils/api-keys.js', () => ({
  resolveApiKey: vi.fn().mockReturnValue(null),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeActivityController() {
  const ac = new AbortController();
  return {
    clearTimeout: vi.fn(),
    resetTimeout: vi.fn(),
    controller: ac,
  };
}

function makeMockClientResponse(): any {
  const listeners: Record<string, Array<() => void>> = { drain: [], close: [], finish: [] };
  return {
    headersSent: false,
    writableEnded: false,
    setHeader: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    once(event: string, fn: () => void) {
      if (listeners[event]) {
        listeners[event].push(fn);
      }
    },
    removeListener: vi.fn(),
    off: vi.fn(),
    end: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    _triggerDrain() {
      listeners.drain.forEach(fn => fn());
    },
  };
}

function makeMockResponse(lines: string[]): globalThis.Response {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
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

describe('Anthropic Controller', () => {
  let mockOrchestrator: any;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockOrchestrator = {
      tryRequestWithFailover: vi.fn(),
      getTimeout: vi.fn().mockReturnValue(120000),
    };
    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);
    mockReq = { body: {}, headers: {}, query: {} };
    mockRes = makeMockClientResponse();
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // anthropic-version header validation
  // ========================================================================
  describe('handleMessages - header validation', () => {
    it('should return 400 when anthropic-version header is missing', async () => {
      mockReq.headers = {};

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'anthropic-version header is required',
        },
      });
    });

    it('should return 400 when anthropic-version header is not a string', async () => {
      mockReq.headers = { 'anthropic-version': 123 as any };

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'anthropic-version header is required',
        },
      });
    });

    it('should accept valid anthropic-version header', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      mockOrchestrator.tryRequestWithFailover.mockResolvedValue({ content: 'Hi' });

      await handleMessages(mockReq as Request, mockRes as Response);

      // Should not return early with 400
      expect(mockRes.status).not.toHaveBeenCalledWith(400);
    });
  });

  // ========================================================================
  // body validation (thinking, cache_control)
  // ========================================================================
  describe('handleMessages - body validation', () => {
    it('should return 400 when thinking field is present', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
        thinking: { type: 'enabled', budget_tokens: 1000 },
      };

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'thinking is not supported',
          param: 'thinking',
        },
      });
    });

    it('should return 400 when cache_control field is present', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
        cache_control: { type: 'ephemeral' },
      };

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'cache_control is not supported',
          param: 'cache_control',
        },
      });
    });
  });

  // ========================================================================
  // schema validation
  // ========================================================================
  describe('handleMessages - schema validation', () => {
    it('should return 400 when model is missing', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      const calledWith = mockRes.json.mock.calls[0][0];
      expect(calledWith.type).toBe('error');
      expect(calledWith.error.type).toBe('invalid_request_error');
      expect(calledWith.error.param).toBe('model');
    });

    it('should return 400 when messages is missing', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
      };

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when messages is empty', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [],
        max_tokens: 100,
      };

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when max_tokens is missing', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
      };

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when max_tokens is not positive', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 0,
      };

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when max_tokens is negative', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: -1,
      };

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should accept valid request body with stream=false', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
        stream: false,
      };

      mockOrchestrator.tryRequestWithFailover.mockResolvedValue({
        type: 'message',
        content: [{ type: 'text', text: 'Hello!' }],
      });

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        type: 'message',
        content: [{ type: 'text', text: 'Hello!' }],
      });
    });
  });

  // ========================================================================
  // non-streaming success
  // ========================================================================
  describe('handleMessages - non-streaming success', () => {
    it('should return message response on success', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      const expectedResponse = {
        type: 'message',
        id: 'msg_123',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there!' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
      };

      mockOrchestrator.tryRequestWithFailover.mockResolvedValue(expectedResponse);

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(expectedResponse);
    });

    it('should default stream to false when not provided', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      let capturedStream: boolean | undefined;
      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, fn, stream) => {
        capturedStream = stream;
        return { type: 'message' };
      });

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(capturedStream).toBe(false);
    });
  });

  // ========================================================================
  // streaming success
  // ========================================================================
  describe('handleMessages - streaming success', () => {
    it('should handle streaming response', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
        stream: true,
      };

      const activityController = makeActivityController();
      const mockUpstreamResponse = makeMockResponse([
        'data: {"type":"message_start","message":{"id":"msg_123"}}\n',
        '\n',
        'data: {"type":"content_block_start","content_block":{"type":"text"}}\n',
        '\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n',
        '\n',
        'data: {"type":"content_block_stop"}\n',
        '\n',
      ]);

      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, fn, stream) => {
        if (stream) {
          const server = {
            id: 'anthropic-server',
            url: 'http://localhost:11434',
            supportsAnthropic: true,
            models: ['claude-sonnet-4-20250514'],
          };
          return await fn(server);
        }
        return { type: 'message' };
      });

      const { fetchWithActivityTimeout } = await import('../../src/utils/fetch-with-timeout.js');
      (fetchWithActivityTimeout as any).mockResolvedValueOnce({
        response: mockUpstreamResponse,
        activityController,
      });

      await handleMessages(mockReq as Request, mockRes as Response);

      // Streaming sets headers
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    });
  });

  // ========================================================================
  // error paths
  // ========================================================================
  describe('handleMessages - error handling', () => {
    it('should return 500 on orchestrator failure', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(new Error('Upstream timeout'));

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'Upstream timeout',
        },
      });
    });

    it('should return 503 when no servers available (isNoServersError)', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      const error = new Error('No servers available for model');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({
        type: 'error',
        error: {
          type: 'overloaded_error',
          message: 'No servers available for model',
        },
      });
    });

    it('should not write response if writableEnded is true', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      mockRes.writableEnded = true;
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(new Error('Connection closed'));

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should not write response if headersSent is true', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      mockRes.headersSent = true;
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(new Error('Connection closed'));

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should handle server that does not support Anthropic API', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      const error = new Error('Server server-1 does not support Anthropic API');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({
        type: 'error',
        error: {
          type: 'overloaded_error',
          message: 'Server server-1 does not support Anthropic API',
        },
      });
    });
  });

  // ========================================================================
  // upstream error response (non-ok)
  // ========================================================================
  describe('handleMessages - upstream error responses', () => {
    it('should throw error when upstream returns non-ok status for non-streaming', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, fn, stream) => {
        const server = {
          id: 'anthropic-server',
          url: 'http://localhost:11434',
          supportsAnthropic: true,
          models: ['claude-sonnet-4-20250514'],
        };
        // Simulate the callback throwing due to non-ok response
        throw new Error('Upstream returned 500');
      });

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should handle generic non-Error thrown', async () => {
      mockReq.headers = { 'anthropic-version': '2023-06-01' };
      mockReq.body = {
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      };

      mockOrchestrator.tryRequestWithFailover.mockRejectedValue('string error' as any);

      await handleMessages(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'string error',
        },
      });
    });
  });
});
