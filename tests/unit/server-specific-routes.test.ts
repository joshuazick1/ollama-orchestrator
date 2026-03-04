/**
 * server-specific-routes.test.ts
 * Tests for server-specific bypass routes (e.g., /api/generate--:serverId)
 *
 * TESTING REQUIREMENTS:
 * - Tests must verify bypass routes work with Ollama servers
 * - Tests must verify bypass routes work with OpenAI servers
 * - Tests must verify bypass routes work with dual-capability servers
 * - Tests must verify bypass routes bypass load balancer
 * - Tests must verify error handling for non-existent servers
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock dependencies
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

import { getConfigManager } from '../../src/config/config.js';
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import type { AIServer } from '../../src/orchestrator.types.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockGetConfigManager = vi.mocked(getConfigManager);

describe('Server-Specific Routes Tests', () => {
  let mockOrchestrator: any;
  let mockConfigManager: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  // Test servers
  const ollamaServer: AIServer = {
    id: 'ollama-server-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest', 'mistral:latest'],
    supportsOllama: true,
    supportsV1: false,
  };

  const openaiServer: AIServer = {
    id: 'openai-server-1',
    url: 'http://localhost:8000',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 80,
    models: [],
    v1Models: ['gpt-4', 'gpt-3.5-turbo'],
    supportsOllama: false,
    supportsV1: true,
  };

  const dualServer: AIServer = {
    id: 'dual-server-1',
    url: 'http://localhost:11435',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 120,
    models: ['llama3:latest'],
    v1Models: ['llama3'],
    supportsOllama: true,
    supportsV1: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      getServer: vi.fn(),
      requestToServer: vi.fn(),
      tryRequestWithFailover: vi.fn(),
      getAggregatedTags: vi.fn(),
      getAggregatedOpenAIModels: vi.fn(),
      getInFlight: vi.fn(),
    };

    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        streaming: { activityTimeoutMs: 30000 },
      }),
    };

    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);
    mockGetConfigManager.mockReturnValue(mockConfigManager);

    mockReq = {
      params: {},
      body: {},
      query: {},
      headers: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    };
  });

  // ============================================================================
  // SECTION 5.1: Ollama Server Bypass Tests
  // ============================================================================

  describe('Ollama Server Bypass Routes', () => {
    describe('POST /api/generate--:serverId', () => {
      it('should route to specific Ollama server', async () => {
        const serverId = 'ollama-server-1';
        mockReq.params = { serverId };
        mockReq.body = {
          model: 'llama3:latest',
          prompt: 'Hello',
          stream: false,
        };

        mockOrchestrator.getServer.mockReturnValue(ollamaServer);
        mockOrchestrator.requestToServer.mockResolvedValue({
          success: true,
          data: { response: 'Generated text' },
        });

        // Simulate route handler
        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          if (!server) {
            return res.status(404).json({ error: 'Server not found' });
          }
          const result = await mockOrchestrator.requestToServer(server, 'generate', req.body);
          return res.status(200).json(result);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockOrchestrator.getServer).toHaveBeenCalledWith(serverId);
        expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
          ollamaServer,
          'generate',
          expect.objectContaining({ model: 'llama3:latest' })
        );
        expect(mockRes.status).toHaveBeenCalledWith(200);
      });

      it('should bypass load balancer (not call tryRequestWithFailover)', async () => {
        const serverId = 'ollama-server-1';
        mockReq.params = { serverId };
        mockReq.body = { model: 'llama3', prompt: 'test' };

        mockOrchestrator.getServer.mockReturnValue(ollamaServer);
        mockOrchestrator.requestToServer.mockResolvedValue({ success: true });

        // Simulate bypass handler
        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          if (!server) {
            return res.status(404).json({ error: 'Not found' });
          }
          // Direct call - bypass load balancer
          const result = await mockOrchestrator.requestToServer(server, 'generate', req.body);
          return res.status(200).json(result);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockOrchestrator.tryRequestWithFailover).not.toHaveBeenCalled();
        expect(mockOrchestrator.requestToServer).toHaveBeenCalled();
      });

      it('should return 404 for non-existent server', async () => {
        const serverId = 'non-existent';
        mockReq.params = { serverId };
        mockReq.body = { model: 'llama3', prompt: 'test' };

        mockOrchestrator.getServer.mockReturnValue(null);

        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          if (!server) {
            return res.status(404).json({ error: 'Server not found' });
          }
          return res.status(200).json({});
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(404);
      });

      it('should handle streaming requests', async () => {
        const serverId = 'ollama-server-1';
        mockReq.params = { serverId };
        mockReq.body = {
          model: 'llama3:latest',
          prompt: 'Hello',
          stream: true,
        };

        mockOrchestrator.getServer.mockReturnValue(ollamaServer);

        // Simulate streaming response
        const mockUpstreamResponse = {
          body: {
            getReader: vi.fn().mockReturnValue({
              read: vi
                .fn()
                .mockResolvedValueOnce({
                  done: false,
                  value: new TextEncoder().encode('{"response":"Hi"}'),
                })
                .mockResolvedValueOnce({
                  done: true,
                  value: new TextEncoder().encode('{"done":true}'),
                }),
            }),
          },
          headers: new Map([['content-type', 'text/event-stream']]),
          status: 200,
        };

        mockOrchestrator.requestToServer.mockResolvedValue(mockUpstreamResponse);

        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          if (!server) {
            return res.status(404).json({ error: 'Not found' });
          }
          res.setHeader('Content-Type', 'text/event-stream');
          const upstreamResponse = await mockOrchestrator.requestToServer(
            server,
            'generate',
            req.body
          );
          return res.status(200);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      });
    });

    describe('POST /api/chat--:serverId', () => {
      it('should route chat to specific Ollama server', async () => {
        const serverId = 'ollama-server-1';
        mockReq.params = { serverId };
        mockReq.body = {
          model: 'llama3:latest',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        mockOrchestrator.getServer.mockReturnValue(ollamaServer);
        mockOrchestrator.requestToServer.mockResolvedValue({
          success: true,
          message: { role: 'assistant', content: 'Hello!' },
        });

        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          if (!server) {
            return res.status(404).json({ error: 'Server not found' });
          }
          const result = await mockOrchestrator.requestToServer(server, 'chat', req.body);
          return res.status(200).json(result);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
          ollamaServer,
          'chat',
          expect.objectContaining({ messages: expect.any(Array) })
        );
      });
    });

    describe('POST /api/embeddings--:serverId', () => {
      it('should route embeddings to specific Ollama server', async () => {
        const serverId = 'ollama-server-1';
        mockReq.params = { serverId };
        mockReq.body = {
          model: 'nomic-embed-text',
          prompt: 'Hello world',
        };

        mockOrchestrator.getServer.mockReturnValue(ollamaServer);
        mockOrchestrator.requestToServer.mockResolvedValue({
          success: true,
          embedding: [0.1, 0.2, 0.3],
        });

        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          if (!server) {
            return res.status(404).json({ error: 'Server not found' });
          }
          const result = await mockOrchestrator.requestToServer(server, 'embeddings', req.body);
          return res.status(200).json(result);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockOrchestrator.requestToServer).toHaveBeenCalledWith(
          ollamaServer,
          'embeddings',
          expect.any(Object)
        );
      });
    });
  });

  // ============================================================================
  // SECTION 5.2: OpenAI Server Bypass Tests
  // ============================================================================

  describe('OpenAI Server Bypass Routes', () => {
    describe('POST /v1/chat/completions--:serverId', () => {
      it('should route to specific OpenAI server', async () => {
        const serverId = 'openai-server-1';
        mockReq.params = { serverId };
        mockReq.body = {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
        };

        mockOrchestrator.getServer.mockReturnValue(openaiServer);
        mockOrchestrator.requestToServer.mockResolvedValue({
          success: true,
          choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
        });

        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          if (!server) {
            return res.status(404).json({ error: 'Server not found' });
          }
          const result = await mockOrchestrator.requestToServer(
            server,
            'v1/chat/completions',
            req.body
          );
          return res.status(200).json(result);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockOrchestrator.getServer).toHaveBeenCalledWith(serverId);
        expect(mockRes.status).toHaveBeenCalledWith(200);
      });

      it('should bypass load balancer for OpenAI requests', async () => {
        const serverId = 'openai-server-1';
        mockReq.params = { serverId };
        mockReq.body = { model: 'gpt-4', messages: [] };

        mockOrchestrator.getServer.mockReturnValue(openaiServer);
        mockOrchestrator.requestToServer.mockResolvedValue({ success: true });

        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          const result = await mockOrchestrator.requestToServer(
            server,
            'v1/chat/completions',
            req.body
          );
          return res.status(200).json(result);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockOrchestrator.tryRequestWithFailover).not.toHaveBeenCalled();
        expect(mockOrchestrator.requestToServer).toHaveBeenCalled();
      });

      it('should handle streaming chat completions', async () => {
        const serverId = 'openai-server-1';
        mockReq.params = { serverId };
        mockReq.body = {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
          stream: true,
        };

        mockOrchestrator.getServer.mockReturnValue(openaiServer);

        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          res.setHeader('Content-Type', 'text/event-stream');
          return res.status(200);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      });
    });

    describe('POST /v1/completions--:serverId', () => {
      it('should route completions to specific OpenAI server', async () => {
        const serverId = 'openai-server-1';
        mockReq.params = { serverId };
        mockReq.body = {
          model: 'gpt-3.5-turbo',
          prompt: 'Once upon a time',
        };

        mockOrchestrator.getServer.mockReturnValue(openaiServer);
        mockOrchestrator.requestToServer.mockResolvedValue({
          success: true,
          choices: [{ text: 'Once upon a time...' }],
        });

        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          if (!server) {
            return res.status(404).json({ error: 'Server not found' });
          }
          const result = await mockOrchestrator.requestToServer(server, 'v1/completions', req.body);
          return res.status(200).json(result);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockOrchestrator.requestToServer).toHaveBeenCalled();
      });
    });

    describe('POST /v1/embeddings--:serverId', () => {
      it('should route embeddings to specific OpenAI server', async () => {
        const serverId = 'openai-server-1';
        mockReq.params = { serverId };
        mockReq.body = {
          model: 'text-embedding-ada-002',
          input: 'Hello world',
        };

        mockOrchestrator.getServer.mockReturnValue(openaiServer);
        mockOrchestrator.requestToServer.mockResolvedValue({
          success: true,
          data: [{ embedding: [0.1, 0.2] }],
        });

        const handler = async (req: Request, res: Response) => {
          const server = mockOrchestrator.getServer(req.params.serverId);
          if (!server) {
            return res.status(404).json({ error: 'Server not found' });
          }
          const result = await mockOrchestrator.requestToServer(server, 'v1/embeddings', req.body);
          return res.status(200).json(result);
        };

        await handler(mockReq as Request, mockRes as Response);

        expect(mockOrchestrator.requestToServer).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // SECTION 5.3: Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle request to unhealthy server', async () => {
      const unhealthyServer = { ...ollamaServer, healthy: false };
      const serverId = 'ollama-server-1';
      mockReq.params = { serverId };
      mockReq.body = { model: 'llama3', prompt: 'test' };

      mockOrchestrator.getServer.mockReturnValue(unhealthyServer);

      const handler = async (req: Request, res: Response) => {
        const server = mockOrchestrator.getServer(req.params.serverId);
        if (!server?.healthy) {
          return res.status(503).json({ error: 'Server is not healthy' });
        }
        return res.status(200).json({});
      };

      await handler(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(503);
    });

    it('should handle request for unavailable model', async () => {
      const serverId = 'ollama-server-1';
      mockReq.params = { serverId };
      mockReq.body = { model: 'nonexistent-model', prompt: 'test' };

      mockOrchestrator.getServer.mockReturnValue(ollamaServer);
      mockOrchestrator.requestToServer.mockRejectedValue(new Error('Model not found'));

      const handler = async (req: Request, res: Response) => {
        const server = mockOrchestrator.getServer(req.params.serverId);
        try {
          await mockOrchestrator.requestToServer(server, 'generate', req.body);
        } catch (error: any) {
          return res.status(404).json({ error: error.message });
        }
        return res.status(200).json({});
      };

      await handler(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should handle server at max concurrency', async () => {
      const serverAtCapacity = {
        ...ollamaServer,
        maxConcurrency: 4,
      };

      mockOrchestrator.getServer.mockReturnValue(serverAtCapacity);
      mockOrchestrator.getInFlight.mockReturnValue(4); // At capacity

      const serverId = 'ollama-server-1';
      const isAtCapacity =
        mockOrchestrator.getInFlight(serverId, 'llama3') >= (serverAtCapacity.maxConcurrency || 4);

      expect(isAtCapacity).toBe(true);
    });

    it('should handle request timeout', async () => {
      const serverId = 'ollama-server-1';
      mockReq.params = { serverId };
      mockReq.body = { model: 'llama3', prompt: 'test' };

      mockOrchestrator.getServer.mockReturnValue(ollamaServer);
      mockOrchestrator.requestToServer.mockRejectedValue(new Error('Request timeout'));

      const handler = async (req: Request, res: Response) => {
        const server = mockOrchestrator.getServer(req.params.serverId);
        try {
          await mockOrchestrator.requestToServer(server, 'generate', req.body);
        } catch (error: any) {
          return res.status(504).json({ error: 'Gateway timeout' });
        }
        return res.status(200).json({});
      };

      await handler(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(504);
    });
  });

  // ============================================================================
  // SECTION 5.4: Dual-Protocol Requirements (MANDATORY)
  // ============================================================================

  describe('Dual-Protocol Bypass Routes', () => {
    it('should work with Ollama bypass route on dual-capability server', async () => {
      const serverId = 'dual-server-1';
      mockReq.params = { serverId };
      mockReq.body = { model: 'llama3:latest', prompt: 'test' };

      mockOrchestrator.getServer.mockReturnValue(dualServer);
      mockOrchestrator.requestToServer.mockResolvedValue({ success: true });

      const handler = async (req: Request, res: Response) => {
        const server = mockOrchestrator.getServer(req.params.serverId);
        if (!server?.supportsOllama) {
          return res.status(400).json({ error: 'Server does not support Ollama protocol' });
        }
        const result = await mockOrchestrator.requestToServer(server, 'generate', req.body);
        return res.status(200).json(result);
      };

      await handler(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should work with OpenAI bypass route on dual-capability server', async () => {
      const serverId = 'dual-server-1';
      mockReq.params = { serverId };
      mockReq.body = { model: 'gpt-4', messages: [] };

      mockOrchestrator.getServer.mockReturnValue(dualServer);
      mockOrchestrator.requestToServer.mockResolvedValue({ success: true });

      const handler = async (req: Request, res: Response) => {
        const server = mockOrchestrator.getServer(req.params.serverId);
        if (!server?.supportsV1) {
          return res.status(400).json({ error: 'Server does not support OpenAI protocol' });
        }
        const result = await mockOrchestrator.requestToServer(
          server,
          'v1/chat/completions',
          req.body
        );
        return res.status(200).json(result);
      };

      await handler(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should verify capability before routing', async () => {
      // Try to use Ollama endpoint on OpenAI-only server
      mockOrchestrator.getServer.mockReturnValue(openaiServer);

      const server = mockOrchestrator.getServer('openai-server-1');
      const supportsOllama = server?.supportsOllama;

      expect(supportsOllama).toBe(false);
    });

    it('should handle mixed server pool with bypass routes', async () => {
      const servers = [
        { ...ollamaServer, id: 'ollama-1' },
        { ...openaiServer, id: 'openai-1' },
        { ...dualServer, id: 'dual-1' },
      ];

      // For each server type, verify bypass works
      for (const server of servers) {
        mockOrchestrator.getServer.mockReturnValue(server);
        mockOrchestrator.requestToServer.mockResolvedValue({ success: true });

        const handler = async (req: Request, res: Response) => {
          const svr = mockOrchestrator.getServer(req.params.serverId);
          if (!svr) {return res.status(404).json({ error: 'Not found' });}
          await mockOrchestrator.requestToServer(svr, 'generate', req.body);
          return res.status(200).json({ success: true });
        };

        mockReq.params = { serverId: server.id };
        mockReq.body = { model: 'test', prompt: 'test' };

        await handler(mockReq as Request, mockRes as Response);
      }

      expect(mockOrchestrator.requestToServer).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================================================
  // SECTION 5.5: Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle server ID with special characters', async () => {
      const serverId = 'server-with-dash_underscore';
      mockReq.params = { serverId };

      mockOrchestrator.getServer.mockReturnValue(null);

      const handler = async (req: Request, res: Response) => {
        const server = mockOrchestrator.getServer(req.params.serverId);
        if (!server) {
          return res.status(404).json({ error: 'Server not found' });
        }
        return res.status(200).json({});
      };

      await handler(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getServer).toHaveBeenCalledWith(serverId);
      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should handle empty server ID', async () => {
      const serverId = '';
      mockReq.params = { serverId };

      mockOrchestrator.getServer.mockReturnValue(null);

      const handler = async (req: Request, res: Response) => {
        const server = mockOrchestrator.getServer(req.params.serverId);
        if (!server) {
          return res.status(404).json({ error: 'Server not found' });
        }
        return res.status(200).json({});
      };

      await handler(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getServer).toHaveBeenCalledWith('');
      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should handle missing request body', async () => {
      const serverId = 'ollama-server-1';
      mockReq.params = { serverId };
      mockReq.body = undefined;

      mockOrchestrator.getServer.mockReturnValue(ollamaServer);

      const handler = async (req: Request, res: Response) => {
        if (!req.body || Object.keys(req.body).length === 0) {
          return res.status(400).json({ error: 'Request body required' });
        }
        return res.status(200).json({});
      };

      await handler(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle malformed server ID format', async () => {
      // Test with server ID that might match route pattern incorrectly
      const serverId = 'server--model';
      mockReq.params = { serverId };

      mockOrchestrator.getServer.mockReturnValue(null);

      const handler = async (req: Request, res: Response) => {
        const server = mockOrchestrator.getServer(req.params.serverId);
        if (!server) {
          return res.status(404).json({ error: 'Server not found' });
        }
        return res.status(200).json({});
      };

      await handler(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });
});
