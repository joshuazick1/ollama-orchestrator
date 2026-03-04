/**
 * b3-handoff-stall-threshold.test.ts
 *
 * Tests for Bug B-3: performStreamHandoff calls in handleGenerate and handleChat
 * must propagate the dynamically computed stallThresholdMs and stallCheckIntervalMs
 * to the HandoffRequest, rather than falling through to the config defaults.
 *
 * The fix ensures both controller functions pass { stallThresholdMs, stallCheckIntervalMs }
 * when invoking performStreamHandoff inside the onStallCallback.
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { handleGenerate, handleChat } from '../../src/controllers/ollamaController.js';
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import { streamResponse, isStreamingRequest } from '../../src/streaming.js';
import { getInFlightManager } from '../../src/utils/in-flight-manager.js';
import { performStreamHandoff } from '../../src/utils/stream-handoff.js';

// ---------- Mocks ----------

vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/streaming.js');
vi.mock('../../src/utils/stream-handoff.js');
vi.mock('../../src/utils/in-flight-manager.js', () => ({
  getInFlightManager: vi.fn(() => ({
    addStreamingRequest: vi.fn(),
    removeStreamingRequest: vi.fn(),
    updateChunkProgress: vi.fn(),
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

describe('B-3: Handoff stall threshold inheritance', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();

    mockOrchestrator = {
      getAggregatedTags: vi.fn(),
      tryRequestWithFailover: vi.fn(),
      getServers: vi.fn().mockReturnValue([
        {
          id: 'server-1',
          url: 'http://server-1:11434',
          healthy: true,
          models: ['llama3'],
          supportsOllama: true,
        },
        {
          id: 'server-2',
          url: 'http://server-2:11434',
          healthy: true,
          models: ['llama3'],
          supportsOllama: true,
        },
      ]),
      getBestServerForModel: vi.fn(),
      requestToServer: vi.fn(),
      getTimeout: vi.fn().mockReturnValue(20000), // 20s dynamic timeout
      isCircuitAllowed: vi.fn().mockReturnValue(true),
    };

    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);
    (isStreamingRequest as any).mockReturnValue(true);

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

  describe('handleGenerate stall callback', () => {
    it('should pass stallThresholdMs and stallCheckIntervalMs to performStreamHandoff', async () => {
      // Setup: dynamic timeout = 20000ms
      // stallThreshold = Math.min(Math.max(20000 * 1.5, 10000), 60000) = 30000
      // stallCheckInterval = Math.min(20000 / 8, 3000) = 2500
      const expectedStallThreshold = 30000;
      const expectedStallCheckInterval = 2500;

      mockReq.body = { model: 'llama3', prompt: 'Hello', stream: true };

      // Mock InFlightManager to return progress when stall callback queries it
      const mockProgress = {
        id: 'req-123',
        serverId: 'server-1',
        model: 'llama3',
        startTime: Date.now(),
        chunkCount: 5,
        lastChunkTime: Date.now() - 35000,
        isStalled: true,
        accumulatedText: 'partial response',
        originalPrompt: 'Hello',
        protocol: 'ollama' as const,
        endpoint: 'generate' as const,
        handoffCount: 0,
        hasReceivedFirstChunk: true,
      };

      (getInFlightManager as any).mockReturnValue({
        addStreamingRequest: vi.fn(),
        removeStreamingRequest: vi.fn(),
        updateChunkProgress: vi.fn(),
        getStreamingRequestProgress: vi.fn().mockReturnValue(mockProgress),
        getAllStreamingRequests: vi.fn().mockReturnValue([mockProgress]),
      });

      // Capture the onStallCallback when streamResponse is called
      // streamResponse signature: (upstreamResponse, clientResponse, onFirstToken, onComplete,
      //   onChunk, ttftOptions, streamingRequestId, existingTtftTracker, onStall, ...)
      // onStall is at index 8
      let capturedOnStallCallback: Function | undefined;
      (streamResponse as any).mockImplementation(async (...args: any[]) => {
        capturedOnStallCallback = args[8]; // onStall is at index 8
      });

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (_model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler({ id: 'server-1', url: 'http://server-1:11434' }, { requestId: 'req-123' });
          return { success: true, data: null };
        }
      );

      (performStreamHandoff as any).mockResolvedValue({ success: true });

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(capturedOnStallCallback).toBeDefined();
      if (capturedOnStallCallback) {
        await capturedOnStallCallback(new AbortController(), 'req-123');

        const handoffRequest = (performStreamHandoff as any).mock.calls[0][0];
        expect(handoffRequest.stallThresholdMs).toBe(expectedStallThreshold);
        expect(handoffRequest.stallCheckIntervalMs).toBe(expectedStallCheckInterval);
      }
    });
  });

  describe('handleChat stall callback', () => {
    it('should pass stallThresholdMs and stallCheckIntervalMs to performStreamHandoff', async () => {
      // Dynamic timeout = 20000ms
      // stallThreshold = Math.min(Math.max(20000 * 1.5, 10000), 60000) = 30000
      // stallCheckInterval = Math.min(20000 / 8, 3000) = 2500
      const expectedStallThreshold = 30000;
      const expectedStallCheckInterval = 2500;

      mockReq.body = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };

      const mockProgress = {
        id: 'chat-req-123',
        serverId: 'server-1',
        model: 'llama3',
        startTime: Date.now(),
        chunkCount: 5,
        lastChunkTime: Date.now() - 35000,
        isStalled: true,
        accumulatedText: 'partial chat response',
        originalMessages: [{ role: 'user', content: 'Hello' }],
        protocol: 'ollama' as const,
        endpoint: 'chat' as const,
        handoffCount: 0,
        hasReceivedFirstChunk: true,
      };

      (getInFlightManager as any).mockReturnValue({
        addStreamingRequest: vi.fn(),
        removeStreamingRequest: vi.fn(),
        updateChunkProgress: vi.fn(),
        getStreamingRequestProgress: vi.fn().mockReturnValue(mockProgress),
        getAllStreamingRequests: vi.fn().mockReturnValue([mockProgress]),
      });

      let capturedOnStallCallback: Function | undefined;
      (streamResponse as any).mockImplementation(async (...args: any[]) => {
        capturedOnStallCallback = args[8]; // onStall is at index 8
      });

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (_model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'chat-req-123' }
          );
          return { success: true, data: null };
        }
      );

      (performStreamHandoff as any).mockResolvedValue({
        success: true,
        error: undefined,
      });

      await handleChat(mockReq as Request, mockRes as Response);

      expect(capturedOnStallCallback).toBeDefined();
      if (capturedOnStallCallback) {
        const abortController = new AbortController();
        await capturedOnStallCallback(abortController, 'chat-req-123');

        expect(performStreamHandoff).toHaveBeenCalledTimes(1);
        const handoffRequest = (performStreamHandoff as any).mock.calls[0][0];

        expect(handoffRequest).toHaveProperty('stallThresholdMs', expectedStallThreshold);
        expect(handoffRequest).toHaveProperty('stallCheckIntervalMs', expectedStallCheckInterval);
      }
    });

    it('should clamp stallThresholdMs at 60s ceiling for very large timeouts', async () => {
      // Test with timeout = 120000ms (very large)
      // stallThreshold = Math.min(Math.max(120000 * 1.5, 10000), 60000) = 60000 (clamped to ceiling)
      // stallCheckInterval = Math.min(120000 / 8, 3000) = 3000 (capped)
      mockOrchestrator.getTimeout.mockReturnValue(120000);

      mockReq.body = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'Long task' }],
        stream: true,
      };

      const mockProgress = {
        id: 'chat-large-timeout',
        serverId: 'server-1',
        model: 'llama3',
        startTime: Date.now(),
        chunkCount: 10,
        lastChunkTime: Date.now() - 65000,
        isStalled: true,
        accumulatedText: 'long response',
        originalMessages: [{ role: 'user', content: 'Long task' }],
        protocol: 'ollama' as const,
        endpoint: 'chat' as const,
        handoffCount: 0,
        hasReceivedFirstChunk: true,
      };

      (getInFlightManager as any).mockReturnValue({
        addStreamingRequest: vi.fn(),
        removeStreamingRequest: vi.fn(),
        updateChunkProgress: vi.fn(),
        getStreamingRequestProgress: vi.fn().mockReturnValue(mockProgress),
        getAllStreamingRequests: vi.fn().mockReturnValue([mockProgress]),
      });

      let capturedOnStallCallback: Function | undefined;
      (streamResponse as any).mockImplementation(async (...args: any[]) => {
        capturedOnStallCallback = args[8]; // onStall is at index 8
      });

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (_model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'chat-large-timeout' }
          );
          return { success: true, data: null };
        }
      );

      (performStreamHandoff as any).mockResolvedValue({ success: true });

      await handleChat(mockReq as Request, mockRes as Response);

      expect(capturedOnStallCallback).toBeDefined();
      if (capturedOnStallCallback) {
        await capturedOnStallCallback(new AbortController(), 'chat-large-timeout');

        const handoffRequest = (performStreamHandoff as any).mock.calls[0][0];
        expect(handoffRequest.stallThresholdMs).toBe(60000); // clamped to 60s ceiling
        expect(handoffRequest.stallCheckIntervalMs).toBe(3000); // capped at 3s
      }
    });
  });

  describe('HandoffRequest structure', () => {
    it('should include all required HandoffRequest fields', async () => {
      mockReq.body = { model: 'llama3', prompt: 'Test', stream: true };

      const mockProgress = {
        id: 'req-fields',
        serverId: 'server-1',
        model: 'llama3',
        startTime: Date.now(),
        chunkCount: 2,
        lastChunkTime: Date.now() - 35000,
        isStalled: true,
        accumulatedText: 'partial',
        originalPrompt: 'Test',
        protocol: 'ollama' as const,
        endpoint: 'generate' as const,
        handoffCount: 0,
        hasReceivedFirstChunk: true,
      };

      (getInFlightManager as any).mockReturnValue({
        addStreamingRequest: vi.fn(),
        removeStreamingRequest: vi.fn(),
        updateChunkProgress: vi.fn(),
        getStreamingRequestProgress: vi.fn().mockReturnValue(mockProgress),
        getAllStreamingRequests: vi.fn().mockReturnValue([mockProgress]),
      });

      let capturedOnStallCallback: Function | undefined;
      (streamResponse as any).mockImplementation(async (...args: any[]) => {
        capturedOnStallCallback = args[8]; // onStall is at index 8
      });

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (_model: string, handler: Function) => {
          mockFetch.mockResolvedValueOnce({
            ok: true,
            body: new ReadableStream(),
            headers: new Headers(),
          });
          await handler(
            { id: 'server-1', url: 'http://server-1:11434' },
            { requestId: 'req-fields' }
          );
          return { success: true, data: null };
        }
      );

      (performStreamHandoff as any).mockResolvedValue({ success: true });

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(capturedOnStallCallback).toBeDefined();
      if (capturedOnStallCallback) {
        await capturedOnStallCallback(new AbortController(), 'req-fields');

        const handoffRequest = (performStreamHandoff as any).mock.calls[0][0];

        // Verify all HandoffRequest fields are present
        expect(handoffRequest).toHaveProperty('originalRequest');
        expect(handoffRequest).toHaveProperty('newServer');
        expect(handoffRequest).toHaveProperty('clientResponse');
        expect(handoffRequest).toHaveProperty('originalRequestBody');
        expect(handoffRequest).toHaveProperty('stallThresholdMs');
        expect(handoffRequest).toHaveProperty('stallCheckIntervalMs');

        // Verify types
        expect(typeof handoffRequest.stallThresholdMs).toBe('number');
        expect(typeof handoffRequest.stallCheckIntervalMs).toBe('number');
        expect(handoffRequest.stallThresholdMs).toBeGreaterThan(0);
        expect(handoffRequest.stallCheckIntervalMs).toBeGreaterThan(0);
      }
    });
  });
});
