/**
 * server-models-controller.test.ts
 * Tests for serverModelsController.ts
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/utils/fetchWithTimeout.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout.js';

import {
  listServerModels,
  pullModelToServer,
  deleteModelFromServer,
  copyModelToServer,
  getFleetModelStats,
} from '../../src/controllers/serverModelsController.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockFetchWithTimeout = fetchWithTimeout as Mock;

describe('serverModelsController', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      getServers: vi.fn().mockReturnValue([]),
      updateServerStatus: vi.fn(),
      removeModelCircuitBreaker: vi.fn(),
    };
    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);

    mockReq = {
      params: {},
      query: {},
      body: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  const createMockServer = (overrides = {}) => ({
    id: 'server-1',
    url: 'http://localhost:11434',
    healthy: true,
    supportsOllama: true,
    models: ['llama3:latest', 'mistral:latest'],
    ...overrides,
  });

  describe('listServerModels', () => {
    it('should list models for a healthy server', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          models: [{ name: 'llama3:latest', size: 1000 }],
        }),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        serverUrl: mockServer.url,
        models: [{ name: 'llama3:latest', modified_at: undefined, size: 1000, digest: undefined }],
      });
    });

    it('should return 404 when server not found', async () => {
      mockOrchestrator.getServers.mockReturnValue([]);

      mockReq.params = { id: 'unknown' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 503 when server is unhealthy', async () => {
      const mockServer = createMockServer({ healthy: false });
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockReq.params = { id: 'server-1' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(503);
    });

    it('should return 400 when server does not support Ollama', async () => {
      const mockServer = createMockServer({ supportsOllama: false });
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockReq.params = { id: 'server-1' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 when fetch fails', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockFetchWithTimeout.mockRejectedValue(new Error('Network error'));

      mockReq.params = { id: 'server-1' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 when response is not ok', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: false,
        statusText: 'Internal Server Error',
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should handle empty models array', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ models: [] }),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        serverUrl: mockServer.url,
        models: [],
      });
    });

    it('should handle missing models field', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        serverUrl: mockServer.url,
        models: [],
      });
    });

    it('should handle model with all fields', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          models: [
            {
              name: 'llama3:latest',
              modified_at: '2024-01-15T10:30:00Z',
              size: 4000000000,
              digest: 'abc123def456',
            },
          ],
        }),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        serverUrl: mockServer.url,
        models: [
          {
            name: 'llama3:latest',
            modified_at: '2024-01-15T10:30:00Z',
            size: 4000000000,
            digest: 'abc123def456',
          },
        ],
      });
    });

    it('should handle missing server id', async () => {
      mockReq.params = {};

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('pullModelToServer', () => {
    it('should pull model successfully', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 'success' }),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockFetchWithTimeout).toHaveBeenCalled();
      expect(mockOrchestrator.updateServerStatus).toHaveBeenCalledWith(mockServer);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 when model is missing', async () => {
      mockReq.params = { id: 'server-1' };
      mockReq.body = {};

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should normalize model name', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: '  Llama3 / Latest  ' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      const callArg = mockFetchWithTimeout.mock.calls[0]?.[1];
      expect(callArg?.body).toContain('llama3/latest');
    });

    it('should return 404 when server not found', async () => {
      mockOrchestrator.getServers.mockReturnValue([]);

      mockReq.params = { id: 'unknown' };
      mockReq.body = { model: 'llama3:latest' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 503 when server is unhealthy', async () => {
      const mockServer = createMockServer({ healthy: false });
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(503);
    });

    it('should return 500 when pull fails', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockFetchWithTimeout.mockRejectedValue(new Error('Pull failed'));

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should return 400 when server does not support Ollama', async () => {
      const mockServer = createMockServer({ supportsOllama: false });
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 when response is not ok', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Model not found' }),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'unknown-model' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 when response is not ok without error message', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: false,
        statusText: 'Bad Request',
        json: vi.fn().mockRejectedValue(new Error('Parse error')),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'unknown-model' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should handle empty model string', async () => {
      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: '' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should normalize whitespace-only model string to empty', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: '   ' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      // Whitespace normalizes to empty string but the controller only checks for falsy
      const callArg = mockFetchWithTimeout.mock.calls[0]?.[1];
      expect(callArg?.body).toContain('"name":""');
    });

    it('should handle model with various special characters', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: '  Model / Name / Test  ' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      const callArg = mockFetchWithTimeout.mock.calls[0]?.[1];
      expect(callArg?.body).toContain('model/name/test');
    });

    it('should return detailed response with pull data', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'success',
          digest: 'abc123',
          total: 1000,
          completed: 1000,
        }),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: 'llama3:latest',
        message: "Model 'llama3:latest' pulled successfully",
        details: {
          status: 'success',
          digest: 'abc123',
          total: 1000,
          completed: 1000,
        },
      });
    });

    it('should handle missing server id', async () => {
      mockReq.params = {};
      mockReq.body = { model: 'llama3:latest' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('deleteModelFromServer', () => {
    it('should delete model successfully', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1', model: 'llama3:latest' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.removeModelCircuitBreaker).toHaveBeenCalledWith(
        'server-1',
        'llama3:latest'
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 when model is missing', async () => {
      mockReq.params = { id: 'server-1' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when server not found', async () => {
      mockOrchestrator.getServers.mockReturnValue([]);

      mockReq.params = { id: 'unknown', model: 'llama3:latest' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 503 when server is unhealthy', async () => {
      const mockServer = createMockServer({ healthy: false });
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockReq.params = { id: 'server-1', model: 'llama3:latest' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(503);
    });

    it('should return 400 when server does not support Ollama', async () => {
      const mockServer = createMockServer({ supportsOllama: false });
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockReq.params = { id: 'server-1', model: 'llama3:latest' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 when delete response is not ok', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Model not found' }),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1', model: 'unknown-model' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 when delete response is not ok without error message', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = {
        ok: false,
        statusText: 'Not Found',
        json: vi.fn().mockRejectedValue(new Error('Parse error')),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1', model: 'unknown-model' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 when delete request fails', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockFetchWithTimeout.mockRejectedValue(new Error('Network error'));

      mockReq.params = { id: 'server-1', model: 'llama3:latest' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should normalize model name', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1', model: '  Llama3 / Latest  ' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      const callArg = mockFetchWithTimeout.mock.calls[0]?.[1];
      expect(callArg?.body).toContain('llama3/latest');
      expect(mockOrchestrator.removeModelCircuitBreaker).toHaveBeenCalledWith(
        'server-1',
        'llama3/latest'
      );
    });

    it('should handle empty model param', async () => {
      mockReq.params = { id: 'server-1', model: '' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle missing server id', async () => {
      mockReq.params = { model: 'llama3:latest' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return success response with correct format', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1', model: 'llama3:latest' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: 'llama3:latest',
        message: "Model 'llama3:latest' deleted successfully",
      });
    });
  });

  describe('copyModelToServer', () => {
    it('should copy model successfully', async () => {
      const mockTargetServer = createMockServer();
      const mockSourceServer = createMockServer({ id: 'source-server' });
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer, mockSourceServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest', sourceServerId: 'source-server' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 when model is missing', async () => {
      mockReq.params = { id: 'server-1' };
      mockReq.body = {};

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when target server not found', async () => {
      mockOrchestrator.getServers.mockReturnValue([]);

      mockReq.params = { id: 'unknown' };
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 503 when target server is unhealthy', async () => {
      const mockServer = createMockServer({ healthy: false });
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(503);
    });

    it('should return 404 when source server not found', async () => {
      const mockTargetServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest', sourceServerId: 'unknown' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when model not on source server', async () => {
      const mockTargetServer = createMockServer();
      const mockSourceServer = createMockServer({ id: 'source-server', models: ['other-model'] });
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer, mockSourceServer]);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest', sourceServerId: 'source-server' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when target server does not support Ollama', async () => {
      const mockTargetServer = createMockServer({ supportsOllama: false });
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when source server does not support Ollama', async () => {
      const mockTargetServer = createMockServer();
      const mockSourceServer = createMockServer({
        id: 'source-server',
        supportsOllama: false,
        models: ['llama3:latest'],
      });
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer, mockSourceServer]);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest', sourceServerId: 'source-server' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 when copy request fails', async () => {
      const mockTargetServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      mockFetchWithTimeout.mockRejectedValue(new Error('Network error'));

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 when copy response is not ok', async () => {
      const mockTargetServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      const mockResponse = {
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Copy failed' }),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should return 500 when copy response is not ok without error message', async () => {
      const mockTargetServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      const mockResponse = {
        ok: false,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('Parse error')),
      } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should normalize model name', async () => {
      const mockTargetServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: '  Llama3 / Latest  ' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      const callArg = mockFetchWithTimeout.mock.calls[0]?.[1];
      expect(callArg?.body).toContain('llama3/latest');
    });

    it('should handle empty model string', async () => {
      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: '' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should normalize whitespace-only model string to empty', async () => {
      const mockTargetServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: '   ' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      // Whitespace normalizes to empty string but the controller only checks for falsy
      const callArg = mockFetchWithTimeout.mock.calls[0]?.[1];
      expect(callArg?.body).toContain('"name":""');
    });

    it('should handle missing server id', async () => {
      mockReq.params = {};
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return success response with correct format', async () => {
      const mockTargetServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: 'llama3:latest',
        message: "Model 'llama3:latest' copied successfully",
      });
    });

    it('should handle copy without source server', async () => {
      const mockTargetServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) } as any;
      mockFetchWithTimeout.mockResolvedValue(mockResponse);

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getFleetModelStats', () => {
    it('should return fleet model statistics', () => {
      const mockServers = [
        createMockServer({ id: 'server-1', models: ['llama3:latest', 'mistral:latest'] }),
        createMockServer({ id: 'server-2', models: ['llama3:latest'] }),
      ];
      mockOrchestrator.getServers.mockReturnValue(mockServers);

      getFleetModelStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.totalServers).toBe(2);
      expect(jsonCall.totalUniqueModels).toBe(2);
      expect(jsonCall.popularModels[0].name).toBe('llama3:latest');
    });

    it('should handle errors', () => {
      mockOrchestrator.getServers.mockImplementation(() => {
        throw new Error('Test error');
      });

      getFleetModelStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should handle empty servers array', () => {
      mockOrchestrator.getServers.mockReturnValue([]);

      getFleetModelStats(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        totalServers: 0,
        healthyServers: 0,
        totalUniqueModels: 0,
        popularModels: [],
      });
    });

    it('should handle servers with no healthy servers', () => {
      const mockServers = [
        createMockServer({ id: 'server-1', healthy: false }),
        createMockServer({ id: 'server-2', healthy: false }),
      ];
      mockOrchestrator.getServers.mockReturnValue(mockServers);

      getFleetModelStats(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        totalServers: 2,
        healthyServers: 0,
        totalUniqueModels: 0,
        popularModels: [],
      });
    });

    it('should handle servers with empty models array', () => {
      const mockServers = [
        createMockServer({ id: 'server-1', models: [] }),
        createMockServer({ id: 'server-2', models: [] }),
      ];
      mockOrchestrator.getServers.mockReturnValue(mockServers);

      getFleetModelStats(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        totalServers: 2,
        healthyServers: 2,
        totalUniqueModels: 0,
        popularModels: [],
      });
    });

    it('should limit popular models to top 15', () => {
      const mockServers = Array.from({ length: 20 }, (_, i) =>
        createMockServer({
          id: `server-${i}`,
          models: [`model-${i}`, 'common-model'],
        })
      );
      mockOrchestrator.getServers.mockReturnValue(mockServers);

      getFleetModelStats(mockReq as Request, mockRes as Response);

      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.popularModels.length).toBe(15);
      expect(jsonCall.popularModels[0].name).toBe('common-model');
      expect(jsonCall.popularModels[0].serverCount).toBe(20);
    });

    it('should calculate correct percentages', () => {
      const mockServers = [
        createMockServer({ id: 'server-1', models: ['model-a', 'model-b'] }),
        createMockServer({ id: 'server-2', models: ['model-a'] }),
        createMockServer({ id: 'server-3', models: ['model-a'] }),
        createMockServer({ id: 'server-4', healthy: false }),
      ];
      mockOrchestrator.getServers.mockReturnValue(mockServers);

      getFleetModelStats(mockReq as Request, mockRes as Response);

      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.totalServers).toBe(4);
      expect(jsonCall.healthyServers).toBe(3);
      expect(jsonCall.totalUniqueModels).toBe(2);

      const modelA = jsonCall.popularModels.find((m: any) => m.name === 'model-a');
      const modelB = jsonCall.popularModels.find((m: any) => m.name === 'model-b');

      expect(modelA.serverCount).toBe(3);
      expect(modelA.percentage).toBe(100);
      expect(modelB.serverCount).toBe(1);
      expect(modelB.percentage).toBe(33);
    });

    it('should handle many models with same popularity', () => {
      const mockServers = [
        createMockServer({
          id: 'server-1',
          models: ['model-a', 'model-b', 'model-c', 'model-d'],
        }),
        createMockServer({
          id: 'server-2',
          models: ['model-a', 'model-b', 'model-c', 'model-d'],
        }),
      ];
      mockOrchestrator.getServers.mockReturnValue(mockServers);

      getFleetModelStats(mockReq as Request, mockRes as Response);

      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.popularModels.length).toBe(4);
      expect(jsonCall.popularModels.every((m: any) => m.serverCount === 2)).toBe(true);
    });

    it('should handle error in getFleetModelStats', () => {
      mockOrchestrator.getServers.mockImplementation(() => {
        throw new Error('Test error');
      });

      getFleetModelStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get fleet model stats',
        details: 'Test error',
      });
    });
  });

  describe('listServerModels error handling', () => {
    it('should handle non-Error objects in catch block', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockFetchWithTimeout.mockRejectedValue('String error');

      mockReq.params = { id: 'server-1' };

      await listServerModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to list models',
        details: 'String error',
      });
    });
  });

  describe('pullModelToServer error handling', () => {
    it('should handle non-Error objects in catch block', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockFetchWithTimeout.mockRejectedValue('Network failure');

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await pullModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to pull model',
        details: 'Network failure',
      });
    });
  });

  describe('deleteModelFromServer error handling', () => {
    it('should handle non-Error objects in catch block', async () => {
      const mockServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockServer]);

      mockFetchWithTimeout.mockRejectedValue('Delete failed');

      mockReq.params = { id: 'server-1', model: 'llama3:latest' };

      await deleteModelFromServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to delete model',
        details: 'Delete failed',
      });
    });
  });

  describe('copyModelToServer error handling', () => {
    it('should handle non-Error objects in catch block', async () => {
      const mockTargetServer = createMockServer();
      mockOrchestrator.getServers.mockReturnValue([mockTargetServer]);

      mockFetchWithTimeout.mockRejectedValue('Copy failed');

      mockReq.params = { id: 'server-1' };
      mockReq.body = { model: 'llama3:latest' };

      await copyModelToServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to copy model',
        details: 'Copy failed',
      });
    });
  });
});
