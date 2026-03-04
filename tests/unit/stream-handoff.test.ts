/**
 * stream-handoff.test.ts
 * Tests for stream handoff functionality
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import type { AIServer } from '../../src/orchestrator.types.js';
import type { StreamingRequestProgress } from '../../src/utils/in-flight-manager.js';
import { performStreamHandoff, type HandoffRequest } from '../../src/utils/stream-handoff.js';

// Mock dependencies
vi.mock('../../src/config/config.js', () => ({
  getConfigManager: vi.fn(() => ({
    getConfig: vi.fn(() => ({
      streaming: {
        maxHandoffAttempts: 2,
      },
    })),
  })),
}));

vi.mock('../../src/streaming.js', () => ({
  streamResponse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Stream Handoff', () => {
  let mockServer: AIServer;
  let mockClientResponse: any;
  let mockOriginalRequest: StreamingRequestProgress;

  beforeEach(() => {
    vi.clearAllMocks();

    mockServer = {
      id: 'server-2',
      url: 'http://localhost:11434',
      type: 'ollama',
      maxConcurrency: 4,
    } as AIServer;

    mockClientResponse = {
      setHeader: vi.fn(),
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
    };

    mockOriginalRequest = {
      id: 'req-1',
      serverId: 'server-1',
      model: 'llama3',
      startTime: Date.now() - 60000,
      chunkCount: 10,
      lastChunkTime: Date.now() - 400000, // 6+ minutes ago
      isStalled: true,
      accumulatedText: 'This is the accumulated response text.',
      lastContext: [1, 2, 3, 4, 5],
      protocol: 'ollama',
      endpoint: 'generate',
      handoffCount: 0,
      hasReceivedFirstChunk: true,
    };
  });

  describe('performStreamHandoff', () => {
    it('should fail when max handoff attempts reached', async () => {
      mockOriginalRequest.handoffCount = 2;

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: { model: 'llama3', prompt: 'test' },
      };

      const result = await performStreamHandoff(handoffRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Max handoff attempts reached');
      expect(result.finalChunkCount).toBe(10);
    });

    it('should fail gracefully for unsupported endpoints (OpenAI completions)', async () => {
      mockOriginalRequest.protocol = 'openai';
      mockOriginalRequest.endpoint = 'generate' as any; // Not supported

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: { model: 'gpt-4', prompt: 'test' },
      };

      const result = await performStreamHandoff(handoffRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Endpoint does not support continuation');
    });

    it('should succeed for Ollama generate endpoint with context', async () => {
      mockOriginalRequest.protocol = 'ollama';
      mockOriginalRequest.endpoint = 'generate';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: vi.fn().mockReturnValue({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('data: {"response":"continuation","done":false}\n'),
              })
              .mockResolvedValueOnce({
                done: true,
                value: new TextEncoder().encode('data: {"response":"","done":true}\n'),
              }),
          }),
        },
      });

      global.fetch = mockFetch;

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: { model: 'llama3', prompt: 'test', options: { temperature: 0.7 } },
      };

      const result = await performStreamHandoff(handoffRequest);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should succeed for Ollama chat endpoint', async () => {
      mockOriginalRequest.protocol = 'ollama';
      mockOriginalRequest.endpoint = 'chat';
      mockOriginalRequest.accumulatedText = 'Hello, how can I help you?';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: vi.fn().mockReturnValue({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  'data: {"message":{"role":"assistant","content":"Hi"},"done":false}\n'
                ),
              })
              .mockResolvedValueOnce({
                done: true,
                value: new TextEncoder().encode(
                  'data: {"message":{"role":"assistant","content":""},"done":true}\n'
                ),
              }),
          }),
        },
      });

      global.fetch = mockFetch;

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: {
          model: 'llama3',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      };

      const result = await performStreamHandoff(handoffRequest);

      expect(result.success).toBe(true);
    });

    it('should succeed for OpenAI chat endpoint (pseudo-continuation)', async () => {
      mockOriginalRequest.protocol = 'openai';
      mockOriginalRequest.endpoint = 'chat';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: vi.fn().mockReturnValue({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n'
                ),
              })
              .mockResolvedValueOnce({
                done: true,
                value: new TextEncoder().encode(
                  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n'
                ),
              }),
          }),
        },
      });

      global.fetch = mockFetch;

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      };

      const result = await performStreamHandoff(handoffRequest);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/chat/completions'),
        expect.objectContaining({
          body: expect.stringContaining('"role":"assistant"'),
        })
      );
    });

    it('should return error when upstream request fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue('Service unavailable'),
      });

      global.fetch = mockFetch;

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: { model: 'llama3', prompt: 'test' },
      };

      const result = await performStreamHandoff(handoffRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Continuation failed: 503');
    });

    it('should handle exceptions gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

      global.fetch = mockFetch;

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: { model: 'llama3', prompt: 'test' },
      };

      const result = await performStreamHandoff(handoffRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('Continuation Request Building', () => {
    it('should build continuation request with context for Ollama generate', async () => {
      mockOriginalRequest.protocol = 'ollama';
      mockOriginalRequest.endpoint = 'generate';
      mockOriginalRequest.accumulatedText = 'Previous response text.';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: vi.fn().mockReturnValue({
            read: vi.fn().mockResolvedValue({ done: true }),
          }),
        },
      });

      global.fetch = mockFetch;

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: { model: 'llama3', prompt: 'test' },
      };

      await performStreamHandoff(handoffRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Previous response text.'),
        })
      );
    });

    it('should include context in continuation request when available', async () => {
      // context is forwarded for ollama chat endpoint (not generate)
      mockOriginalRequest.protocol = 'ollama';
      mockOriginalRequest.endpoint = 'chat';
      mockOriginalRequest.lastContext = [1, 2, 3, 4, 5];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: vi.fn().mockReturnValue({
            read: vi.fn().mockResolvedValue({ done: true }),
          }),
        },
      });

      global.fetch = mockFetch;

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: {
          model: 'llama3',
          messages: [{ role: 'user', content: 'test' }],
        },
      };

      await performStreamHandoff(handoffRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('[1,2,3,4,5]'),
        })
      );
    });

    it('should append accumulated text as assistant message for chat endpoints', async () => {
      mockOriginalRequest.protocol = 'ollama';
      mockOriginalRequest.endpoint = 'chat';
      mockOriginalRequest.accumulatedText = 'This is my response.';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          getReader: vi.fn().mockReturnValue({
            read: vi.fn().mockResolvedValue({ done: true }),
          }),
        },
      });

      global.fetch = mockFetch;

      const handoffRequest: HandoffRequest = {
        originalRequest: mockOriginalRequest,
        newServer: mockServer,
        clientResponse: mockClientResponse,
        originalRequestBody: {
          model: 'llama3',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      };

      await performStreamHandoff(handoffRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"role":"assistant"'),
        })
      );
    });
  });
});
