/**
 * openai-controller.test.ts
 * Tests for OpenAI-compatible API controllers
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

import {
  handleChatCompletions,
  handleCompletions,
  handleOpenAIEmbeddings,
  handleListModels,
  handleGetModel,
  handleChatCompletionsToServer,
  handleCompletionsToServer,
  handleOpenAIEmbeddingsToServer,
} from '../../src/controllers/openaiController.js';
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import { getConfigManager } from '../../src/config/config.js';
import { fetchWithTimeout, fetchWithActivityTimeout } from '../../src/utils/fetchWithTimeout.js';
import { logger } from '../../src/utils/logger.js';
import { parseOllamaErrorGlobal as parseOllamaError } from '../../src/utils/ollamaError.js';

// Mock dependencies
vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/config/config.js');
vi.mock('../../src/utils/fetchWithTimeout.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock('../../src/utils/ollamaError.js');

// Mock crypto for UUID generation
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: vi.fn().mockReturnValue('test-uuid-123'),
  },
  writable: true,
  configurable: true,
});

describe('OpenAI Controller', () => {
  let mockOrchestrator: any;
  let mockConfigManager: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock orchestrator
    mockOrchestrator = {
      getAggregatedOpenAIModels: vi.fn(),
      tryRequestWithFailover: vi.fn(),
      requestToServer: vi.fn(),
      getTimeout: vi.fn().mockImplementation((serverId: string, model: string) => {
        return 60000; // Return expected timeout for tests
      }),
    };

    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);

    // Setup mock config manager
    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        streaming: {
          activityTimeoutMs: 30000,
        },
      }),
    };

    (getConfigManager as any).mockReturnValue(mockConfigManager);

    // Setup mock request and response
    mockReq = {
      body: {},
      params: {},
      query: {},
      headers: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      writableEnded: false,
      headersSent: false,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleListModels', () => {
    it('should return list of models in OpenAI format', async () => {
      const mockModels = {
        object: 'list',
        data: [
          {
            id: 'llama3:latest',
            object: 'model',
            created: 1704067200,
            owned_by: 'ollama',
          },
          {
            id: 'mistral:latest',
            object: 'model',
            created: 1704067200,
            owned_by: 'ollama',
          },
        ],
      };
      mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue(mockModels);

      await handleListModels(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getAggregatedOpenAIModels).toHaveBeenCalledTimes(1);
      expect(mockRes.json).toHaveBeenCalledWith(mockModels);
    });

    it('should handle errors when listing models', async () => {
      const error = new Error('Failed to fetch models');
      mockOrchestrator.getAggregatedOpenAIModels.mockImplementation(() => {
        throw error;
      });

      await handleListModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Failed to fetch models',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockOrchestrator.getAggregatedOpenAIModels.mockImplementation(() => {
        throw 'Unknown error';
      });

      await handleListModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Failed to list models',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });
  });

  describe('handleGetModel', () => {
    it('should return specific model info when found', async () => {
      mockReq.params = { model: 'llama3:latest' };

      const mockModels = {
        object: 'list',
        data: [
          {
            id: 'llama3:latest',
            object: 'model',
            created: 1704067200,
            owned_by: 'ollama',
          },
          {
            id: 'mistral:latest',
            object: 'model',
            created: 1704067200,
            owned_by: 'ollama',
          },
        ],
      };
      mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue(mockModels);

      await handleGetModel(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getAggregatedOpenAIModels).toHaveBeenCalledTimes(1);
      expect(mockRes.json).toHaveBeenCalledWith({
        id: 'llama3:latest',
        object: 'model',
        created: 1704067200,
        owned_by: 'ollama',
      });
    });

    it('should return 404 when model is not found', async () => {
      mockReq.params = { model: 'nonexistent-model' };

      const mockModels = {
        object: 'list',
        data: [
          {
            id: 'llama3:latest',
            object: 'model',
            created: 1704067200,
            owned_by: 'ollama',
          },
        ],
      };
      mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue(mockModels);

      await handleGetModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: "Model 'nonexistent-model' not found",
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found',
        },
      });
    });

    it('should handle errors when getting model info', async () => {
      mockReq.params = { model: 'llama3:latest' };

      const error = new Error('Database connection failed');
      mockOrchestrator.getAggregatedOpenAIModels.mockImplementation(() => {
        throw error;
      });

      await handleGetModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Database connection failed',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });

    it('should handle non-Error exceptions when getting model', async () => {
      mockReq.params = { model: 'llama3:latest' };

      mockOrchestrator.getAggregatedOpenAIModels.mockImplementation(() => {
        throw 'Database error';
      });

      await handleGetModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Failed to get model',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });

    it('should handle model ID with special characters', async () => {
      mockReq.params = { model: 'model:with-special.chars/v1' };

      const mockModels = {
        object: 'list',
        data: [
          {
            id: 'model:with-special.chars/v1',
            object: 'model',
            created: 1704067200,
            owned_by: 'ollama',
          },
        ],
      };
      mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue(mockModels);

      await handleGetModel(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        id: 'model:with-special.chars/v1',
        object: 'model',
        created: 1704067200,
        owned_by: 'ollama',
      });
    });

    it('should return correct model from multiple matches', async () => {
      mockReq.params = { model: 'mistral:latest' };

      const mockModels = {
        object: 'list',
        data: [
          {
            id: 'llama3:latest',
            object: 'model',
            created: 1704067200,
            owned_by: 'ollama',
          },
          {
            id: 'mistral:latest',
            object: 'model',
            created: 1704067201,
            owned_by: 'ollama',
          },
          {
            id: 'codellama:7b',
            object: 'model',
            created: 1704067202,
            owned_by: 'ollama',
          },
        ],
      };
      mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue(mockModels);

      await handleGetModel(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        id: 'mistral:latest',
        object: 'model',
        created: 1704067201,
        owned_by: 'ollama',
      });
    });
  });

  describe('handleOpenAIEmbeddings', () => {
    beforeEach(() => {
      (fetchWithTimeout as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          object: 'list',
          data: [
            {
              object: 'embedding',
              embedding: [0.1, 0.2, 0.3],
              index: 0,
            },
          ],
          model: 'llama3:latest',
          usage: {
            prompt_tokens: 10,
            total_tokens: 10,
          },
        }),
      });

      (parseOllamaError as any).mockResolvedValue('Ollama error occurred');
    });

    it('should generate embeddings successfully with string input', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };

      const mockResult = {
        object: 'list',
        data: [
          {
            object: 'embedding',
            embedding: [0.1, 0.2, 0.3],
            index: 0,
          },
        ],
        model: 'llama3:latest',
        usage: {
          prompt_tokens: 10,
          total_tokens: 10,
        },
      };

      mockOrchestrator.tryRequestWithFailover.mockResolvedValue(mockResult);

      await handleOpenAIEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalledWith(
        'llama3:latest',
        expect.any(Function),
        false,
        'embeddings',
        'openai'
      );
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should generate embeddings successfully with array input', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: ['Hello world', 'Second text'],
        encoding_format: 'float',
        dimensions: 768,
      };

      const mockResult = {
        object: 'list',
        data: [
          {
            object: 'embedding',
            embedding: [0.1, 0.2, 0.3],
            index: 0,
          },
          {
            object: 'embedding',
            embedding: [0.4, 0.5, 0.6],
            index: 1,
          },
        ],
        model: 'llama3:latest',
        usage: {
          prompt_tokens: 20,
          total_tokens: 20,
        },
      };

      mockOrchestrator.tryRequestWithFailover.mockResolvedValue(mockResult);

      await handleOpenAIEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = {
        input: 'Hello world',
      };

      await handleOpenAIEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'model and input are required',
          type: 'invalid_request_error',
        },
      });
    });

    it('should return 400 when input is missing', async () => {
      mockReq.body = {
        model: 'llama3:latest',
      };

      await handleOpenAIEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'model and input are required',
          type: 'invalid_request_error',
        },
      });
    });

    it('should handle embeddings request errors', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };

      const error = new Error('Embeddings generation failed');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleOpenAIEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Embeddings generation failed',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };

      mockOrchestrator.tryRequestWithFailover.mockRejectedValue('Unknown error');

      await handleOpenAIEmbeddings(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Request failed',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });

    it('should pass encoding_format and dimensions to backend', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
        encoding_format: 'base64',
        dimensions: 512,
      };

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
        apiKey: undefined,
      };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, callback) => {
        return await callback(mockServer);
      });

      await handleOpenAIEmbeddings(mockReq as Request, mockRes as Response);

      expect(fetchWithTimeout).toHaveBeenCalledWith(
        'http://localhost:11434/v1/embeddings',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama3:latest',
            input: 'Hello world',
            encoding_format: 'base64',
            dimensions: 512,
          }),
          timeout: 60000,
        })
      );
    });
  });

  describe('handleOpenAIEmbeddingsToServer', () => {
    beforeEach(() => {
      (fetchWithTimeout as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          object: 'list',
          data: [
            {
              object: 'embedding',
              embedding: [0.1, 0.2, 0.3],
              index: 0,
            },
          ],
          model: 'llama3:latest',
          usage: {
            prompt_tokens: 10,
            total_tokens: 10,
          },
        }),
      });

      (parseOllamaError as any).mockResolvedValue('Ollama error occurred');
    });

    it('should route embeddings to specific server successfully', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const mockResult = {
        object: 'list',
        data: [
          {
            object: 'embedding',
            embedding: [0.1, 0.2, 0.3],
            index: 0,
          },
        ],
        model: 'llama3:latest',
        usage: {
          prompt_tokens: 10,
          total_tokens: 10,
        },
      };

      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleOpenAIEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { bypassCircuitBreaker: false }
      );
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should bypass circuit breaker when force query param is true', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { force: 'true' };

      const mockResult = {
        object: 'list',
        data: [],
        model: 'llama3:latest',
      };

      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleOpenAIEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { bypassCircuitBreaker: true }
      );
    });

    it('should bypass circuit breaker when bypass query param is true', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { bypass: 'true' };

      const mockResult = {
        object: 'list',
        data: [],
        model: 'llama3:latest',
      };

      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleOpenAIEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { bypassCircuitBreaker: true }
      );
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = {
        input: 'Hello world',
      };
      mockReq.params = { serverId: 'server-1' };

      await handleOpenAIEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
        },
      });
    });

    it('should return 400 when input is missing', async () => {
      mockReq.body = {
        model: 'llama3:latest',
      };
      mockReq.params = { serverId: 'server-1' };

      await handleOpenAIEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'input is required',
          type: 'invalid_request_error',
        },
      });
    });

    it('should handle request errors', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const error = new Error('Server connection failed');
      mockOrchestrator.requestToServer.mockRejectedValue(error);

      await handleOpenAIEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Server connection failed',
          type: 'server_error',
        },
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockRejectedValue('Connection error');

      await handleOpenAIEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Connection error',
          type: 'server_error',
        },
      });
    });

    it('should handle array serverId parameter', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        input: 'Hello world',
      };
      mockReq.params = { serverId: ['server-1', 'server-2'] };
      mockReq.query = {};

      const mockResult = {
        object: 'list',
        data: [],
        model: 'llama3:latest',
      };

      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleOpenAIEmbeddingsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { bypassCircuitBreaker: false }
      );
    });
  });

  describe('handleChatCompletions', () => {
    beforeEach(() => {
      (parseOllamaError as any).mockResolvedValue('Ollama error occurred');
    });

    it('should handle non-streaming chat completions successfully', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };

      const mockResult = {
        id: 'chatcmpl-test123',
        object: 'chat.completion',
        created: 1704067200,
        model: 'llama3:latest',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you today?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      mockOrchestrator.tryRequestWithFailover.mockResolvedValue(mockResult);

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalledWith(
        'llama3:latest',
        expect.any(Function),
        false,
        'generate',
        'openai',
        {}
      );
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'model and messages array are required',
          type: 'invalid_request_error',
          param: 'model',
          code: 'missing_required_parameter',
        },
      });
    });

    it('should return 400 when messages is missing', async () => {
      mockReq.body = {
        model: 'llama3:latest',
      };

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'model and messages array are required',
          type: 'invalid_request_error',
          param: 'messages',
          code: 'missing_required_parameter',
        },
      });
    });

    it('should return 400 when messages is not an array', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: 'not an array',
      };

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'model and messages array are required',
          type: 'invalid_request_error',
          param: 'messages',
          code: 'missing_required_parameter',
        },
      });
    });

    it('should handle chat completions errors', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const error = new Error('Chat completion failed');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Chat completion failed',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      mockOrchestrator.tryRequestWithFailover.mockRejectedValue('Unknown error');

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Request failed',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });

    it('should handle client disconnection gracefully', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      (mockRes as any).writableEnded = true;

      const error = new Error('Connection closed');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should handle headers already sent', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      (mockRes as any).headersSent = true;

      const error = new Error('Headers sent');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should pass options correctly to backend', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 100,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
        seed: 42,
        stop: ['stop1', 'stop2'],
        response_format: { type: 'json_object' },
      };

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
        apiKey: undefined,
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'chatcmpl-test',
          choices: [],
        }),
      };

      (fetchWithTimeout as any).mockResolvedValue(mockResponse);

      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, callback) => {
        return await callback(mockServer);
      });

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(fetchWithTimeout).toHaveBeenCalledWith(
        'http://localhost:11434/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"temperature":0.7'),
        })
      );
    });

    it('should add debug headers when X-Include-Debug-Info header is true', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
      };
      mockReq.headers = { 'x-include-debug-info': 'true' };

      const mockResult = { id: 'test', choices: [] };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (model, callback, stream, operation, format, context) => {
          context.selectedServerId = 'server-1';
          context.serverCircuitState = 'closed';
          context.modelCircuitState = 'closed';
          context.availableServerCount = 3;
          context.retryCount = 1;
          return mockResult;
        }
      );

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Selected-Server', 'server-1');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Server-Circuit-State', 'closed');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Model-Circuit-State', 'closed');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Available-Servers', '3');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Retry-Count', '1');
    });
  });

  describe('handleCompletions', () => {
    beforeEach(() => {
      (parseOllamaError as any).mockResolvedValue('Ollama error occurred');
    });

    it('should handle non-streaming completions successfully', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: false,
      };

      const mockResult = {
        id: 'cmpl-test123',
        object: 'text_completion',
        created: 1704067200,
        model: 'llama3:latest',
        choices: [
          {
            index: 0,
            text: ' This is a test completion.',
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      mockOrchestrator.tryRequestWithFailover.mockResolvedValue(mockResult);

      await handleCompletions(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalledWith(
        'llama3:latest',
        expect.any(Function),
        false,
        'generate',
        'openai',
        {}
      );
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = {
        prompt: 'Hello world',
      };

      await handleCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
        },
      });
    });

    it('should return 400 when prompt is missing', async () => {
      mockReq.body = {
        model: 'llama3:latest',
      };

      const mockResult = {
        id: 'cmpl-123',
        object: 'text_completion',
        created: 1234567890,
        model: 'llama3:latest',
        choices: [
          {
            text: 'Hello!',
            index: 0,
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockOrchestrator.tryRequestWithFailover.mockResolvedValue(mockResult);

      await handleCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should handle completions errors', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };

      const error = new Error('Completion failed');
      mockOrchestrator.tryRequestWithFailover.mockRejectedValue(error);

      await handleCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Completion failed',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
      };

      mockOrchestrator.tryRequestWithFailover.mockRejectedValue('Unknown error');

      await handleCompletions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Request failed',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    });

    it('should handle array prompt input', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: ['Hello ', 'world'],
        stream: false,
      };

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
        apiKey: undefined,
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'cmpl-test',
          choices: [],
        }),
      };

      (fetchWithTimeout as any).mockResolvedValue(mockResponse);

      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, callback) => {
        return await callback(mockServer);
      });

      await handleCompletions(mockReq as Request, mockRes as Response);

      expect(fetchWithTimeout).toHaveBeenCalledWith(
        'http://localhost:11434/v1/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"prompt":["Hello ","world"]'),
        })
      );
    });

    it('should pass suffix parameter when provided', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'def hello():',
        suffix: 'return "world"',
        stream: false,
      };

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
        apiKey: undefined,
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'cmpl-test',
          choices: [],
        }),
      };

      (fetchWithTimeout as any).mockResolvedValue(mockResponse);

      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, callback) => {
        return await callback(mockServer);
      });

      await handleCompletions(mockReq as Request, mockRes as Response);

      expect(fetchWithTimeout).toHaveBeenCalledWith(
        'http://localhost:11434/v1/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"suffix":"return \\"world\\""'),
        })
      );
    });
  });

  describe('handleChatCompletionsToServer', () => {
    beforeEach(() => {
      (parseOllamaError as any).mockResolvedValue('Ollama error occurred');
    });

    it('should route chat completions to specific server successfully (non-streaming)', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const mockResult = {
        id: 'chatcmpl-test123',
        object: 'chat.completion',
        created: 1704067200,
        model: 'llama3:latest',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you today?',
            },
            finish_reason: 'stop',
          },
        ],
      };

      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleChatCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: false, bypassCircuitBreaker: false }
      );
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = {
        messages: [{ role: 'user', content: 'Hello' }],
      };
      mockReq.params = { serverId: 'server-1' };

      await handleChatCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
        },
      });
    });

    it('should handle request errors', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const error = new Error('Server request failed');
      mockOrchestrator.requestToServer.mockRejectedValue(error);

      await handleChatCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Server request failed',
          type: 'server_error',
        },
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockRejectedValue('Connection error');

      await handleChatCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Connection error',
          type: 'server_error',
        },
      });
    });

    it('should bypass circuit breaker with force query param', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { force: 'true' };

      const mockResult = { id: 'test', choices: [] };
      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleChatCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: false, bypassCircuitBreaker: true }
      );
    });

    it('should bypass circuit breaker with bypass query param', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { bypass: 'true' };

      const mockResult = { id: 'test', choices: [] };
      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleChatCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: false, bypassCircuitBreaker: true }
      );
    });

    it('should handle array serverId parameter', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      };
      mockReq.params = { serverId: ['server-1', 'server-2'] };
      mockReq.query = {};

      const mockResult = { id: 'test', choices: [] };
      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleChatCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: false, bypassCircuitBreaker: false }
      );
    });

    it('should pass additional request body parameters to backend', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
        temperature: 0.7,
        max_tokens: 100,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ id: 'test' }),
      };

      (fetchWithTimeout as any).mockResolvedValue(mockResponse);

      mockOrchestrator.requestToServer.mockImplementation(async (serverId, model, callback) => {
        return await callback(mockServer);
      });

      await handleChatCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(fetchWithTimeout).toHaveBeenCalledWith(
        'http://localhost:11434/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('temperature'),
        })
      );
    });
  });

  describe('handleCompletionsToServer', () => {
    beforeEach(() => {
      (parseOllamaError as any).mockResolvedValue('Ollama error occurred');
    });

    it('should route completions to specific server successfully (non-streaming)', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const mockResult = {
        id: 'cmpl-test123',
        object: 'text_completion',
        created: 1704067200,
        model: 'llama3:latest',
        choices: [
          {
            index: 0,
            text: ' This is a completion.',
            finish_reason: 'stop',
          },
        ],
      };

      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: false, bypassCircuitBreaker: false }
      );
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should return 400 when model is missing', async () => {
      mockReq.body = {
        prompt: 'Hello world',
      };
      mockReq.params = { serverId: 'server-1' };

      await handleCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
        },
      });
    });

    it('should handle request errors', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const error = new Error('Server request failed');
      mockOrchestrator.requestToServer.mockRejectedValue(error);

      await handleCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Server request failed',
          type: 'server_error',
        },
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      mockOrchestrator.requestToServer.mockRejectedValue('Connection error');

      await handleCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          message: 'Connection error',
          type: 'server_error',
        },
      });
    });

    it('should bypass circuit breaker with force query param', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { force: 'true' };

      const mockResult = { id: 'test', choices: [] };
      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: false, bypassCircuitBreaker: true }
      );
    });

    it('should handle _streamed response from orchestrator', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: false,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const mockResult = { _streamed: true };
      mockOrchestrator.requestToServer.mockResolvedValue(mockResult);

      await handleCompletionsToServer(mockReq as Request, mockRes as Response);

      // Should not call res.json when _streamed is true
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });

  describe('Streaming scenarios', () => {
    beforeEach(() => {
      (parseOllamaError as any).mockResolvedValue('Ollama error occurred');

      // Mock fetchWithActivityTimeout for streaming
      const mockActivityController = {
        clearTimeout: vi.fn(),
        resetTimeout: vi.fn(),
      };

      (fetchWithActivityTimeout as any).mockResolvedValue({
        response: {
          ok: true,
          body: {
            getReader: vi.fn().mockReturnValue({
              read: vi
                .fn()
                .mockResolvedValueOnce({
                  done: false,
                  value: new TextEncoder().encode('{"message":{"content":"Hello"}}\n'),
                })
                .mockResolvedValueOnce({
                  done: false,
                  value: new TextEncoder().encode(
                    '{"done":true,"prompt_eval_count":10,"eval_count":20}\n'
                  ),
                })
                .mockResolvedValueOnce({ done: true }),
              cancel: vi.fn(),
            }),
          },
        },
        activityController: mockActivityController,
      });
    });

    it('should handle streaming chat completions', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
        apiKey: undefined,
      };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (model, callback, stream) => {
          expect(stream).toBe(true);
          return await callback(mockServer);
        }
      );

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      expect(fetchWithActivityTimeout).toHaveBeenCalledWith(
        'http://localhost:11434/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"stream":true'),
        })
      );
    });

    it('should handle streaming completions', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: true,
      };

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
        apiKey: undefined,
      };

      mockOrchestrator.tryRequestWithFailover.mockImplementation(
        async (model, callback, stream) => {
          expect(stream).toBe(true);
          return await callback(mockServer);
        }
      );

      await handleCompletions(mockReq as Request, mockRes as Response);

      expect(fetchWithActivityTimeout).toHaveBeenCalledWith(
        'http://localhost:11434/v1/completions',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"stream":true'),
        })
      );
    });

    it('should handle streaming error responses', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
        apiKey: undefined,
      };

      const mockActivityController = {
        clearTimeout: vi.fn(),
        resetTimeout: vi.fn(),
      };

      (fetchWithActivityTimeout as any).mockResolvedValue({
        response: {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        },
        activityController: mockActivityController,
      });

      mockOrchestrator.tryRequestWithFailover.mockImplementation(async (model, callback) => {
        return await callback(mockServer);
      });

      await handleChatCompletions(mockReq as Request, mockRes as Response);

      // Error should be thrown and caught by tryRequestWithFailover
      expect(mockOrchestrator.tryRequestWithFailover).toHaveBeenCalled();
    });

    it('should handle streaming request to specific server', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
      };

      mockOrchestrator.requestToServer.mockImplementation(async (serverId, model, callback) => {
        return await callback(mockServer);
      });

      await handleChatCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: true, bypassCircuitBreaker: false }
      );
    });

    it('should handle streaming completions request to specific server', async () => {
      mockReq.body = {
        model: 'llama3:latest',
        prompt: 'Hello world',
        stream: true,
      };
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      const mockServer = {
        id: 'server-1',
        url: 'http://localhost:11434',
      };

      mockOrchestrator.requestToServer.mockImplementation(async (serverId, model, callback) => {
        return await callback(mockServer);
      });

      await handleCompletionsToServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest',
        expect.any(Function),
        { isStreaming: true, bypassCircuitBreaker: false }
      );
    });
  });
});
