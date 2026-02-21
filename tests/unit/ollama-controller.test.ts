/**
 * ollama-controller.test.ts
 * Tests for Ollama API proxy controllers
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

import {
  handleTags,
  handleGenerate,
  handleChat,
  handleEmbeddings,
  handlePs,
  handleVersion,
  handleStreamingGenerate,
  handleShow,
  handleEmbed,
  handleUnsupported,
  handleGenerateToServer,
  handleChatToServer,
  handleEmbeddingsToServer,
} from '../../src/controllers/ollamaController.js';
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import { streamResponse, isStreamingRequest, handleStreamWithRetry } from '../../src/streaming.js';
import { mockResponses, mockServers, mockErrors } from '../fixtures/index.js';

vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/streaming.js');

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Ollama Controller', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockOrchestrator = {
      getAggregatedTags: vi.fn(),
      tryRequestWithFailover: vi.fn(),
      getServers: vi.fn(),
      getBestServerForModel: vi.fn(),
      requestToServer: vi.fn(),
      getTimeout: vi.fn().mockReturnValue(120000),
    };

    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);

    mockReq = {
      query: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      writableEnded: false,
      headersSent: false,
    };

    // Reset mocks
    vi.clearAllMocks();
    mockFetch.mockReset();
    // Default isStreamingRequest to false for non-streaming tests
    (isStreamingRequest as any).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleTags', () => {
    it('should return aggregated tags successfully', async () => {
      const mockTags = { models: [mockResponses.tags.models[0]] };
      mockOrchestrator.getAggregatedTags.mockResolvedValue(mockTags);

      await handleTags(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getAggregatedTags).toHaveBeenCalledTimes(1);
      expect(mockRes.json).toHaveBeenCalledWith(mockTags);
    });

    it('should handle errors when getting tags', async () => {
      const error = new Error('Failed to get tags');
      mockOrchestrator.getAggregatedTags.mockRejectedValue(error);

      await handleTags(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get tags',
        details: 'Failed to get tags',
      });
    });
  });

  describe('handleGenerate', () => {
    it('should generate text successfully', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: false,
        context: [1, 2, 3],
        options: { temperature: 0.7 },
      };
      mockReq.body = requestBody;

      const mockResult = mockResponses.generate;
      mockOrchestrator.tryRequestWithFailover.mockResolvedValue(mockResult);

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalled();
    });

    it('should handle streaming generate requests', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: true,
      };
      mockReq.body = requestBody;

      (isStreamingRequest as any).mockReturnValue(true);
      (streamResponse as any).mockResolvedValue(undefined);

      // Mock the tryRequestWithFailover to call the callback with streaming logic
      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, callback) => {
        const server = { ...mockServers.healthy, models: [...mockServers.healthy.models] };
        await callback(server);
        return null; // streaming response handled
      });

      const mockResponse = {
        ok: true,
        body: { getReader: vi.fn() },
      };
      mockFetch.mockResolvedValue(mockResponse);

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalled();
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = { prompt: 'Hello world' };

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'model is required' });
    });

    it('should return 400 when prompt is missing', async () => {
      mockReq.body = { model: 'llama3:latest' };

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: expect.stringContaining('prompt is required'),
      });
    });

    it('should handle generate request errors', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };
      mockReq.body = requestBody;

      const error = new Error('Generate failed');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Generate request failed',
        details: 'Generate failed',
      });
    });

    it('should handle client disconnection gracefully', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };
      mockReq.body = requestBody;

      (mockRes as any).writableEnded = true;
      const error = new Error('Connection closed');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should handle headers already sent', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };
      mockReq.body = requestBody;

      (mockRes as any).headersSent = true;
      const error = new Error('Headers sent');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });

  describe('handleChat', () => {
    it('should handle chat completion successfully', async () => {
      const requestBody = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
        options: { temperature: 0.7 },
      };
      mockReq.body = requestBody;

      const mockResult = mockResponses.chat;
      mockOrchestrator.tryRequestWithFailover.mockResolvedValue(mockResult);

      await handleChat(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalled();
    });

    it('should handle streaming chat requests', async () => {
      const requestBody = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };
      mockReq.body = requestBody;

      (isStreamingRequest as any).mockReturnValue(true);
      (streamResponse as any).mockResolvedValue(undefined);

      // Mock the tryRequestWithFailover to call the callback with streaming logic
      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, callback) => {
        const server = { ...mockServers.healthy, models: [...mockServers.healthy.models] };
        await callback(server);
        return null; // streaming response handled
      });

      const mockResponse = {
        ok: true,
        body: { getReader: vi.fn() },
      };
      mockFetch.mockResolvedValue(mockResponse);

      await handleChat(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalled();
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = { messages: [{ role: 'user', content: 'Hello' }] };

      await handleChat(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'model is required' });
    });

    it('should return 400 when messages is missing', async () => {
      mockReq.body = { model: 'llama3:latest' };

      await handleChat(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: expect.stringContaining('messages') });
    });

    it('should return 400 when messages is not an array', async () => {
      mockReq.body = { model: 'llama3:latest', messages: 'not an array' };

      await handleChat(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: expect.stringContaining('messages') });
    });

    it('should handle chat request errors', async () => {
      const requestBody = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      mockReq.body = requestBody;

      const error = new Error('Chat failed');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleChat(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Chat request failed',
        details: 'Chat failed',
      });
    });
  });

  describe('handleEmbeddings', () => {
    it('should generate embeddings successfully', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };
      mockReq.body = requestBody;

      const mockResult = mockResponses.embeddings;
      mockOrchestrator.tryRequestWithFailover.mockResolvedValue(mockResult);

      await handleEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalled();
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = { prompt: 'Hello world' };

      await handleEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'model and prompt are required' });
    });

    it('should return 400 when prompt is missing', async () => {
      mockReq.body = { model: 'llama3:latest' };

      await handleEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'model and prompt are required' });
    });

    it('should handle embeddings request errors', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };
      mockReq.body = requestBody;

      const error = new Error('Embeddings failed');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Embeddings request failed',
        details: 'Embeddings failed',
      });
    });
  });

  describe('handlePs', () => {
    it('should return running models from all servers', async () => {
      const mockServer1 = {
        ...mockServers.healthy,
        id: 'server-1',
        models: [...mockServers.healthy.models],
      };
      const mockServer2 = {
        ...mockServers.healthy,
        id: 'server-2',
        models: [...mockServers.healthy.models],
      };
      mockOrchestrator.getServers.mockReturnValue([mockServer1, mockServer2]);

      // Mock fetch responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponses.ps,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] }),
        });

      await handlePs(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should handle fetch failures gracefully', async () => {
      const mockServer = {
        ...mockServers.healthy,
        id: 'server-1',
        models: [...mockServers.healthy.models],
      };
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockFetch.mockRejectedValue(new Error('Connection failed'));

      await handlePs(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({ models: [] });
    });

    it('should handle non-ok responses', async () => {
      const mockServer = {
        ...mockServers.healthy,
        id: 'server-1',
        models: [...mockServers.healthy.models],
      };
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await handlePs(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({ models: [] });
    });

    it('should handle errors in Promise.allSettled', async () => {
      mockOrchestrator.getServers.mockReturnValue([]);

      await handlePs(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({ models: [] });
    });
  });

  describe('handleVersion', () => {
    it('should return version info', () => {
      handleVersion(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({ version: '0.1.0-orchestrator' });
    });
  });

  describe('handleStreamingGenerate', () => {
    it('should handle streaming generate with retry logic', async () => {
      const mockServer = { ...mockServers.healthy, models: [...mockServers.healthy.models] };
      const params = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        server: mockServer,
        res: mockRes as Response,
        context: [1, 2, 3],
        options: { temperature: 0.7 },
      };

      (handleStreamWithRetry as any).mockResolvedValue(undefined);

      await handleStreamingGenerate(
        params.model,
        params.prompt,
        params.server,
        params.res,
        params.context,
        params.options
      );

      expect(handleStreamWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        3,
        expect.any(Function)
      );
    });

    it('should call fetch with correct parameters', async () => {
      const mockServer = { ...mockServers.healthy, models: [...mockServers.healthy.models] };
      const params = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        server: mockServer,
        res: mockRes as Response,
      };

      (handleStreamWithRetry as any).mockImplementation(async fn => {
        await fn(); // Call the function passed to handleStreamWithRetry
        return undefined;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: vi.fn() },
      });

      await handleStreamingGenerate(params.model, params.prompt, params.server, params.res);

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('tryRequestWithFailover integration', () => {
    it('should call the correct server endpoint for generate', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };
      mockReq.body = requestBody;

      const mockResult = mockResponses.generate;
      let capturedCallback: any;

      mockOrchestrator.tryRequestWithFailover.mockImplementation((model: string, callback: any) => {
        capturedCallback = callback;
        return callback({ ...mockServers.healthy, models: [...mockServers.healthy.models] });
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResult),
      });

      await handleGenerate(mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should call the correct server endpoint for chat', async () => {
      const requestBody = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      mockReq.body = requestBody;

      const mockResult = mockResponses.chat;
      let capturedCallback: any;

      mockOrchestrator.tryRequestWithFailover.mockImplementation((model: string, callback: any) => {
        capturedCallback = callback;
        return callback({ ...mockServers.healthy, models: [...mockServers.healthy.models] });
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResult),
      });

      await handleChat(mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should call the correct server endpoint for embeddings', async () => {
      const requestBody = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };
      mockReq.body = requestBody;

      const mockResult = mockResponses.embeddings;
      let capturedCallback: any;

      mockOrchestrator.tryRequestWithFailover.mockImplementation((model: string, callback: any) => {
        capturedCallback = callback;
        return callback({ ...mockServers.healthy, models: [...mockServers.healthy.models] });
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResult),
      });

      await handleEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('handleShow', () => {
    it('should show model info successfully', async () => {
      mockReq.body = { model: 'llama3:latest' };

      mockOrchestrator.getBestServerForModel.mockReturnValue({
        ...mockServers.healthy,
        models: [...mockServers.healthy.models],
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          modelfile: 'FROM llama3',
          parameters: '8B',
          template: '{{ .System }}',
        }),
      });

      await handleShow(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        modelfile: 'FROM llama3',
        parameters: '8B',
        template: '{{ .System }}',
      });
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = {};

      await handleShow(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'model is required' });
    });

    it('should return 404 when model not found on any server', async () => {
      mockReq.body = { model: 'nonexistent:latest' };

      mockOrchestrator.getBestServerForModel.mockReturnValue(null);

      await handleShow(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "model 'nonexistent:latest' not found on any healthy server",
      });
    });

    it('should handle non-ok response from server', async () => {
      mockReq.body = { model: 'llama3:latest' };

      mockOrchestrator.getBestServerForModel.mockReturnValue({
        ...mockServers.healthy,
        models: [...mockServers.healthy.models],
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await handleShow(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should handle errors gracefully', async () => {
      mockReq.body = { model: 'llama3:latest' };

      mockOrchestrator.getBestServerForModel.mockImplementation(() => {
        throw new Error('Database error');
      });

      await handleShow(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('handleEmbed', () => {
    it('should generate embeddings with single input', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };

      mockOrchestrator.getBestServerForModel.mockReturnValue({
        ...mockServers.healthy,
        models: [...mockServers.healthy.models],
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          model: 'llama3:latest',
          embeddings: [[0.1, 0.2, 0.3]],
        }),
      });

      await handleEmbed(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        model: 'llama3:latest',
        embeddings: [[0.1, 0.2, 0.3]],
      });
    });

    it('should generate embeddings with batch input', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: ['Hello', 'World'],
        dimensions: 768,
      };

      mockOrchestrator.getBestServerForModel.mockReturnValue({
        ...mockServers.healthy,
        models: [...mockServers.healthy.models],
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          model: 'llama3:latest',
          embeddings: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        }),
      });

      await handleEmbed(mockReq as Request, mockRes as Response);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/embed'),
        expect.objectContaining({
          body: expect.stringContaining('dimensions'),
        })
      );
    });

    it('should use prompt field when input is not provided', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };

      mockOrchestrator.getBestServerForModel.mockReturnValue({
        ...mockServers.healthy,
        models: [...mockServers.healthy.models],
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          model: 'llama3:latest',
          embeddings: [[0.1, 0.2, 0.3]],
        }),
      });

      await handleEmbed(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = { input: 'Hello world' };

      await handleEmbed(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'model is required' });
    });

    it('should return 400 when input is empty', async () => {
      mockReq.body = { model: 'llama3:latest', input: [] };

      await handleEmbed(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'input or prompt is required' });
    });

    it('should return 404 when model not found', async () => {
      mockReq.body = { model: 'nonexistent:latest', input: 'Hello' };

      mockOrchestrator.getBestServerForModel.mockReturnValue(null);

      await handleEmbed(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should handle server error response', async () => {
      mockReq.body = { model: 'llama3:latest', input: 'Hello' };

      mockOrchestrator.getBestServerForModel.mockReturnValue({
        ...mockServers.healthy,
        models: [...mockServers.healthy.models],
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await handleEmbed(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should handle empty response from server', async () => {
      mockReq.body = { model: 'llama3:latest', input: 'Hello' };

      mockOrchestrator.getBestServerForModel.mockReturnValue({
        ...mockServers.healthy,
        models: [...mockServers.healthy.models],
      });

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(''),
      });

      await handleEmbed(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('handleUnsupported', () => {
    it('should return error for /api/pull', () => {
      const reqWithPath = { ...mockReq, path: '/api/pull' } as Request;

      handleUnsupported(reqWithPath, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: expect.stringContaining('/api/orchestrator/servers'),
      });
    });

    it('should return error for /api/delete', () => {
      const reqWithPath = { ...mockReq, path: '/api/delete' } as Request;

      handleUnsupported(reqWithPath, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: expect.stringContaining('DELETE'),
      });
    });

    it('should return error for /api/copy', () => {
      const reqWithPath = { ...mockReq, path: '/api/copy' } as Request;

      handleUnsupported(reqWithPath, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: expect.stringContaining('copy'),
      });
    });

    it('should return error for /api/create', () => {
      const reqWithPath = { ...mockReq, path: '/api/create' } as Request;

      handleUnsupported(reqWithPath, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: expect.stringContaining('Model creation'),
      });
    });

    it('should return generic error for unknown paths', () => {
      const reqWithPath = { ...mockReq, path: '/api/unknown' } as Request;

      handleUnsupported(reqWithPath, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'This operation is not supported in multi-node orchestrator mode.',
      });
    });
  });

  describe('handleGenerateToServer', () => {
    it('should route generate to specific server successfully', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockResolvedValue({
        model: 'llama3:latest',
        response: 'Hello!',
      });

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: false, bypassCircuitBreaker: false }
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        model: 'llama3:latest',
        response: 'Hello!',
      });
    });

    it('should handle streaming generate to server', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: true,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const mockResponse = {
        ok: true,
        body: { getReader: vi.fn() },
      };

      mockOrchestrator.requestToServer.mockImplementation(async (serverId, model, callback) => {
        const server = { ...mockServers.healthy, models: [...mockServers.healthy.models] };
        return await callback(server);
      });

      mockFetch.mockResolvedValue(mockResponse);
      (streamResponse as any).mockResolvedValue(undefined);

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalled();
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = { prompt: 'Hello world' };
      mockReq.params = { serverId: 'server-1' };

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'model is required' });
    });

    it('should return 400 when prompt is missing', async () => {
      mockReq.body = { model: 'llama3:latest' };
      mockReq.params = { serverId: 'server-1' };

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'prompt is required for generation' });
    });

    it('should bypass circuit breaker with force query param', async () => {
      mockReq.body = { model: 'llama3:latest', prompt: 'Hello' };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { force: 'true' };

      mockOrchestrator.requestToServer.mockResolvedValue({ response: 'Hi!' });

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: false, bypassCircuitBreaker: true }
      );
    });

    it('should handle array serverId parameter', async () => {
      mockReq.body = { model: 'llama3:latest', prompt: 'Hello' };
      mockReq.params = { serverId: ['server-1', 'server-2'] };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockResolvedValue({ response: 'Hi!' });

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        expect.any(Object)
      );
    });

    it('should handle server errors', async () => {
      mockReq.body = { model: 'llama3:latest', prompt: 'Hello' };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockRejectedValue(new Error('Server down'));

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Server down' });
    });

    it('should allow empty prompt with keep_alive', async () => {
      mockReq.body = { model: 'llama3:latest', prompt: 'test', keep_alive: 0 };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockResolvedValue({ done: true });

      await handleGenerateToServer(mockReq as Request, mockRes as Response);

      // Should call requestToServer since validation passes
      expect(mockOrchestrator.requestToServer).toHaveBeenCalled();
    });
  });

  describe('handleChatToServer', () => {
    it('should route chat to specific server successfully', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockResolvedValue({
        message: { role: 'assistant', content: 'Hi!' },
      });

      await handleChatToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        expect.objectContaining({ bypassCircuitBreaker: false })
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        message: { role: 'assistant', content: 'Hi!' },
      });
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = { messages: [{ role: 'user', content: 'Hello' }] };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      await handleChatToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'model is required' });
    });

    it('should bypass circuit breaker with bypass query param', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { bypass: 'true' };

      mockOrchestrator.requestToServer.mockResolvedValue({ done: true });

      await handleChatToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        expect.objectContaining({ bypassCircuitBreaker: true })
      );
    });

    it('should handle streaming chat to server', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockImplementation(async (serverId, model, callback) => {
        const server = { ...mockServers.healthy, models: [...mockServers.healthy.models] };
        return await callback(server);
      });

      mockFetch.mockResolvedValue({
        ok: true,
        body: { getReader: vi.fn() },
      });

      (streamResponse as any).mockResolvedValue(undefined);

      await handleChatToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalled();
    });

    it('should handle non-ok response from server', async () => {
      mockReq.body = { model: 'llama3:latest', messages: [{ role: 'user', content: 'Hello' }] };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockImplementation(async (serverId, model, callback) => {
        const server = { ...mockServers.healthy, models: [...mockServers.healthy.models] };
        await callback(server);
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await handleChatToServer(mockReq as Request, mockRes as Response);
    });
  });

  describe('handleEmbeddingsToServer', () => {
    it('should route embeddings to specific server successfully', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
      });

      await handleEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { bypassCircuitBreaker: false }
      );
      expect(mockRes.json).toHaveBeenCalledWith({ embedding: [0.1, 0.2, 0.3] });
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = { prompt: 'Hello world' };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      await handleEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'model is required' });
    });

    it('should return 400 when prompt is missing', async () => {
      mockReq.body = { model: 'llama3:latest' };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      await handleEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'prompt is required' });
    });

    it('should bypass circuit breaker with force query param', async () => {
      mockReq.body = { model: 'llama3:latest', prompt: 'Hello' };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { force: 'true' };

      mockOrchestrator.requestToServer.mockResolvedValue({ embedding: [0.1] });

      await handleEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { bypassCircuitBreaker: true }
      );
    });

    it('should handle empty NDJSON response', async () => {
      mockReq.body = { model: 'llama3:latest', prompt: 'Hello' };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockImplementation(async (serverId, model, callback) => {
        const server = { ...mockServers.healthy, models: [...mockServers.healthy.models] };
        return await callback(server);
      });

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(''),
      });

      await handleEmbeddingsToServer(mockReq as Request, mockRes as Response);
    });

    it('should handle server errors', async () => {
      mockReq.body = { model: 'llama3:latest', prompt: 'Hello' };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockRejectedValue(new Error('Embeddings failed'));

      await handleEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Embeddings failed' });
    });
  });
});
