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
  });
});
