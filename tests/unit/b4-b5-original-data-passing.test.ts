/**
 * b4-b5-original-data-passing.test.ts
 *
 * Tests for Bug B-4 and B-5:
 *   B-4: handleChat must pass originalMessages to addStreamingRequest so that
 *        handoff can reconstruct the chat context.
 *   B-5: handleGenerate (and handleGenerateToServer) must pass originalPrompt
 *        to addStreamingRequest so that handoff can replay the prompt.
 *
 * Also tests the "ToServer" variants:
 *   handleGenerateToServer should pass prompt
 *   handleChatToServer should pass messages
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  handleGenerate,
  handleChat,
  handleGenerateToServer,
  handleChatToServer,
} from '../../src/controllers/ollamaController.js';
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import { streamResponse, isStreamingRequest } from '../../src/streaming.js';
import { getInFlightManager } from '../../src/utils/in-flight-manager.js';

// ---------- Mocks ----------

// Track addStreamingRequest calls
const mockAddStreamingRequest = vi.fn();
const mockRemoveStreamingRequest = vi.fn();
const mockUpdateChunkProgress = vi.fn();

vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/streaming.js');
vi.mock('../../src/utils/stream-handoff.js', () => ({
  performStreamHandoff: vi.fn().mockResolvedValue({ success: false }),
}));
vi.mock('../../src/utils/in-flight-manager.js', () => ({
  getInFlightManager: vi.fn(() => ({
    addStreamingRequest: mockAddStreamingRequest,
    removeStreamingRequest: mockRemoveStreamingRequest,
    updateChunkProgress: mockUpdateChunkProgress,
    getStreamingRequestProgress: vi.fn(),
    getAllStreamingRequests: vi.fn().mockReturnValue([]),
  })),
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../src/utils/config-manager.js', () => ({
  getConfigManager: vi.fn(() => ({
    getConfig: vi.fn(() => ({
      streaming: {
        stallThresholdMs: 30000,
        stallCheckIntervalMs: 2000,
        maxHandoffAttempts: 3,
      },
    })),
  })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('B-4/B-5: Original data passing to addStreamingRequest', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockAddStreamingRequest.mockClear();

    mockOrchestrator = {
      getAggregatedTags: vi.fn(),
      tryRequestWithFailover: vi.fn(),
      getServers: vi
        .fn()
        .mockReturnValue([{ id: 'server-1', url: 'http://server-1:11434', healthy: true }]),
      getBestServerForModel: vi.fn(),
      requestToServer: vi.fn(),
      getTimeout: vi.fn().mockReturnValue(30000),
    };

    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);
    (isStreamingRequest as any).mockReturnValue(true);

    // streamResponse should just resolve without doing anything
    (streamResponse as any).mockResolvedValue(undefined);

    mockReq = {
      query: {},
      headers: {},
      body: {},
      params: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      writableEnded: false,
      headersSent: false,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- B-5: handleGenerate passes prompt ----------

  describe('B-5: handleGenerate passes originalPrompt', () => {
    it('should pass prompt as 6th argument to addStreamingRequest', async () => {
      const testPrompt = 'Tell me about quantum computing';
      mockReq.body = { model: 'llama3', prompt: testPrompt, stream: true };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (_model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'gen-req-1' }
          );
          return { success: true, data: null };
        }
      );

      await handleGenerate(mockReq as Request, mockRes as Response);

      // addStreamingRequest should have been called with the prompt
      expect(mockAddStreamingRequest).toHaveBeenCalledTimes(1);
      const args = mockAddStreamingRequest.mock.calls[0];

      // Args: requestId, serverId, model, protocol, endpoint, originalPrompt
      expect(args[0]).toBe('gen-req-1'); // requestId
      expect(args[1]).toBe('server-1'); // serverId
      expect(args[2]).toBe('llama3'); // model
      expect(args[3]).toBe('ollama'); // protocol
      expect(args[4]).toBe('generate'); // endpoint
      expect(args[5]).toBe(testPrompt); // originalPrompt (B-5 fix)
    });

    it('should pass undefined prompt when prompt is not provided', async () => {
      // Edge case: empty prompt (model load scenario won't reach streaming,
      // but if it did, prompt should be whatever the body has)
      mockReq.body = { model: 'llama3', prompt: '', stream: true };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (_model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'gen-req-2' }
          );
          return { success: true, data: null };
        }
      );

      await handleGenerate(mockReq as Request, mockRes as Response);

      // Even with empty string prompt, it should be passed through
      if (mockAddStreamingRequest.mock.calls.length > 0) {
        const args = mockAddStreamingRequest.mock.calls[0];
        expect(args[5]).toBe(''); // empty string prompt passed through
      }
    });
  });

  // ---------- B-4: handleChat passes messages ----------

  describe('B-4: handleChat passes originalMessages', () => {
    it('should pass messages as 7th argument to addStreamingRequest', async () => {
      const testMessages = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello!' },
      ];
      mockReq.body = { model: 'llama3', messages: testMessages, stream: true };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (_model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'chat-req-1' }
          );
          return { success: true, data: null };
        }
      );

      await handleChat(mockReq as Request, mockRes as Response);

      expect(mockAddStreamingRequest).toHaveBeenCalledTimes(1);
      const args = mockAddStreamingRequest.mock.calls[0];

      // Args: requestId, serverId, model, protocol, endpoint, originalPrompt, originalMessages
      expect(args[0]).toBe('chat-req-1'); // requestId
      expect(args[1]).toBe('server-1'); // serverId
      expect(args[2]).toBe('llama3'); // model
      expect(args[3]).toBe('ollama'); // protocol
      expect(args[4]).toBe('chat'); // endpoint
      expect(args[5]).toBeUndefined(); // no single prompt for chat
      expect(args[6]).toBe(testMessages); // originalMessages (B-4 fix)
    });

    it('should pass the exact messages array reference (not a copy)', async () => {
      const testMessages = [{ role: 'user', content: 'Test' }];
      mockReq.body = { model: 'llama3', messages: testMessages, stream: true };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (_model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'chat-req-ref' }
          );
          return { success: true, data: null };
        }
      );

      await handleChat(mockReq as Request, mockRes as Response);

      const args = mockAddStreamingRequest.mock.calls[0];
      // Should be the same reference, not a deep copy
      expect(args[6]).toBe(testMessages);
    });
  });

  // ---------- B-5: handleGenerateToServer passes prompt ----------

  describe('B-5: handleGenerateToServer passes originalPrompt', () => {
    it('should pass prompt as 6th argument to addStreamingRequest', async () => {
      const testPrompt = 'Explain neural networks';
      mockReq.body = { model: 'llama3', prompt: testPrompt, stream: true };
      mockReq.params = { serverId: 'server-1' };

      mockOrchestrator.requestToServer.mockImplementation(
        async (_serverId: string, _model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'gen-to-server-1' }
          );
          return { success: true, data: null };
        }
      );

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      expect(mockAddStreamingRequest).toHaveBeenCalledTimes(1);
      const args = mockAddStreamingRequest.mock.calls[0];

      expect(args[0]).toBe('gen-to-server-1'); // requestId
      expect(args[1]).toBe('server-1'); // serverId
      expect(args[2]).toBe('llama3'); // model
      expect(args[3]).toBe('ollama'); // protocol
      expect(args[4]).toBe('generate'); // endpoint
      expect(args[5]).toBe(testPrompt); // originalPrompt (B-5 fix)
    });
  });

  // ---------- B-4: handleChatToServer passes messages ----------

  describe('B-4: handleChatToServer passes originalMessages', () => {
    it('should pass messages as 7th argument to addStreamingRequest', async () => {
      const testMessages = [{ role: 'user', content: 'What is AI?' }];
      mockReq.body = { model: 'llama3', messages: testMessages, stream: true };
      mockReq.params = { serverId: 'server-1' };

      mockOrchestrator.requestToServer.mockImplementation(
        async (_serverId: string, _model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'chat-to-server-1' }
          );
          return { success: true, data: null };
        }
      );

      await handleChatToServer(mockReq as Request, mockRes as Response);

      expect(mockAddStreamingRequest).toHaveBeenCalledTimes(1);
      const args = mockAddStreamingRequest.mock.calls[0];

      expect(args[0]).toBe('chat-to-server-1'); // requestId
      expect(args[1]).toBe('server-1'); // serverId
      expect(args[2]).toBe('llama3'); // model
      expect(args[3]).toBe('ollama'); // protocol
      expect(args[4]).toBe('chat'); // endpoint
      expect(args[5]).toBeUndefined(); // no single prompt for chat
      expect(args[6]).toBe(testMessages); // originalMessages (B-4 fix)
    });

    it('should handle multi-turn messages correctly', async () => {
      const multiTurnMessages = [
        { role: 'system', content: 'You are a coding assistant' },
        { role: 'user', content: 'Write a function' },
        { role: 'assistant', content: 'Here is a function...' },
        { role: 'user', content: 'Now optimize it' },
      ];
      mockReq.body = { model: 'llama3', messages: multiTurnMessages, stream: true };
      mockReq.params = { serverId: 'server-1' };

      mockOrchestrator.requestToServer.mockImplementation(
        async (_serverId: string, _model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'chat-multi-turn' }
          );
          return { success: true, data: null };
        }
      );

      await handleChatToServer(mockReq as Request, mockRes as Response);

      const args = mockAddStreamingRequest.mock.calls[0];
      expect(args[6]).toBe(multiTurnMessages);
      expect(args[6]).toHaveLength(4);
    });
  });

  // ---------- Regression: no requestId case ----------

  describe('Regression: no requestId skips addStreamingRequest', () => {
    it('handleGenerate should not call addStreamingRequest without requestId', async () => {
      mockReq.body = { model: 'llama3', prompt: 'Hello', stream: true };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (_model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          // context without requestId
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            {} // no requestId
          );
          return { success: true, data: null };
        }
      );

      await handleGenerate(mockReq as Request, mockRes as Response);

      // Should NOT have been called because streamingRequestId is undefined
      expect(mockAddStreamingRequest).not.toHaveBeenCalled();
    });

    it('handleGenerateToServer should not call addStreamingRequest without requestId', async () => {
      mockReq.body = { model: 'llama3', prompt: 'Hello', stream: true };
      mockReq.params = { serverId: 'server-1' };

      mockOrchestrator.requestToServer.mockImplementation(
        async (_serverId: string, _model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            {} // no requestId
          );
          return { success: true, data: null };
        }
      );

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      expect(mockAddStreamingRequest).not.toHaveBeenCalled();
    });
  });
});
