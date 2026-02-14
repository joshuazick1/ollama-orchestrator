/**
 * serversController.test.ts
 * Tests for server management controllers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

import {
  addServer,
  removeServer,
  updateServer,
  getServers,
  getModelMap,
  getModels,
  getHealth,
  healthCheck,
  getStats,
} from '../../src/controllers/serversController.js';
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';

vi.mock('../../src/orchestrator-instance.js');

describe('Servers Controller', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockOrchestrator = {
      addServer: vi.fn(),
      removeServer: vi.fn(),
      updateServer: vi.fn(),
      getServers: vi.fn(),
      getModelMap: vi.fn(),
      getAllModels: vi.fn(),
      getGlobalMetrics: vi.fn(),
      updateAllStatus: vi.fn(),
      getStats: vi.fn(),
    };

    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);

    mockReq = {};
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  describe('addServer', () => {
    it('should add a server successfully', () => {
      mockReq.body = { id: 'server-1', url: 'http://localhost:11434' };
      mockOrchestrator.getServers.mockReturnValue([]);

      addServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.addServer).toHaveBeenCalledWith({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: undefined,
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        id: 'server-1',
        url: 'http://localhost:11434',
        maxConcurrency: 4,
      });
    });

    it('should add a server with maxConcurrency', () => {
      mockReq.body = { id: 'server-1', url: 'http://localhost:11434', maxConcurrency: 8 };
      mockOrchestrator.getServers.mockReturnValue([]);

      addServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.addServer).toHaveBeenCalledWith({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 8,
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        id: 'server-1',
        url: 'http://localhost:11434',
        maxConcurrency: 8,
      });
    });

    it('should return 400 if id is missing', () => {
      mockReq.body = { url: 'http://localhost:11434' };

      addServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'id and url are required' });
    });

    it('should return 400 if url is missing', () => {
      mockReq.body = { id: 'server-1' };

      addServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'id and url are required' });
    });

    it('should return 409 if server already exists', () => {
      mockReq.body = { id: 'server-1', url: 'http://localhost:11434' };
      mockOrchestrator.getServers.mockReturnValue([{ id: 'server-1' }]);

      addServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Server 'server-1' already exists" });
    });
  });

  describe('removeServer', () => {
    it('should remove a server successfully', () => {
      mockReq.params = { id: 'server-1' };
      mockOrchestrator.getServers.mockReturnValue([{ id: 'server-1' }]);

      removeServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.removeServer).toHaveBeenCalledWith('server-1');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, id: 'server-1' });
    });

    it('should return 404 if server not found', () => {
      mockReq.params = { id: 'server-1' };
      mockOrchestrator.getServers.mockReturnValue([]);

      removeServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Server 'server-1' not found" });
    });
  });

  describe('updateServer', () => {
    it('should update server successfully', () => {
      mockReq.params = { id: 'server-1' };
      mockReq.body = { maxConcurrency: 8 };
      mockOrchestrator.getServers.mockReturnValue([{ id: 'server-1', maxConcurrency: 4 }]);
      mockOrchestrator.updateServer.mockReturnValue(true);

      updateServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.updateServer).toHaveBeenCalledWith('server-1', { maxConcurrency: 8 });
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        id: 'server-1',
        maxConcurrency: 8,
      });
    });

    it('should return 404 if server not found', () => {
      mockReq.params = { id: 'server-1' };
      mockReq.body = { maxConcurrency: 8 };
      mockOrchestrator.getServers.mockReturnValue([]);

      updateServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Server 'server-1' not found" });
    });

    it('should return 500 if update fails', () => {
      mockReq.params = { id: 'server-1' };
      mockReq.body = { maxConcurrency: 8 };
      mockOrchestrator.getServers.mockReturnValue([{ id: 'server-1', maxConcurrency: 4 }]);
      mockOrchestrator.updateServer.mockReturnValue(false);

      updateServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to update server' });
    });
  });

  describe('getServers', () => {
    it('should return servers list', () => {
      const mockServers = [
        {
          id: 'server-1',
          url: 'http://localhost:11434',
          healthy: true,
          lastResponseTime: 100,
          models: ['llama2'],
          maxConcurrency: 4,
        },
      ];
      mockOrchestrator.getServers.mockReturnValue(mockServers);

      getServers(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 1,
        servers: [
          {
            id: 'server-1',
            url: 'http://localhost:11434',
            healthy: true,
            lastResponseTime: 100,
            models: ['llama2'],
            maxConcurrency: 4,
          },
        ],
      });
    });
  });

  describe('getModelMap', () => {
    it('should return model map', () => {
      const mockServers = [
        { id: 'server-1', models: new Set(['llama2', 'mistral']) },
        { id: 'server-2', models: new Set(['llama2']) },
      ];
      mockOrchestrator.getServers.mockReturnValue(mockServers);
      mockOrchestrator.getModelMap.mockReturnValue({
        llama2: ['server-1', 'server-2'],
        mistral: ['server-1'],
      });

      getModelMap(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        modelToServers: {
          llama2: ['server-1', 'server-2'],
          mistral: ['server-1'],
        },
        serverToModels: {
          'server-1': ['llama2', 'mistral'],
          'server-2': ['llama2'],
        },
        totalModels: 2,
        totalServers: 2,
      });
    });
  });

  describe('getModels', () => {
    it('should return all models', () => {
      mockOrchestrator.getAllModels.mockReturnValue(['mistral', 'llama2', 'codellama']);

      getModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 3,
        models: ['codellama', 'llama2', 'mistral'], // sorted
      });
    });
  });

  describe('getHealth', () => {
    it('should return health status', () => {
      mockOrchestrator.getServers.mockReturnValue([{ id: 'server-1' }]);
      mockOrchestrator.getGlobalMetrics.mockReturnValue({ requestsPerSecond: 10.5 });

      // Mock process.uptime
      const originalUptime = process.uptime;
      process.uptime = vi.fn().mockReturnValue(3600);

      getHealth(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        status: 'healthy',
        uptime: 3600,
        version: '1.0.0',
        servers: 1,
        requestsPerSecond: 10.5,
      });

      // Restore original uptime
      process.uptime = originalUptime;
    });
  });

  describe('healthCheck', () => {
    it('should trigger health check successfully', async () => {
      const mockServers = [
        { id: 'server-1', healthy: true, lastResponseTime: 100, models: ['llama2'] },
      ];
      mockOrchestrator.updateAllStatus.mockResolvedValue(undefined);
      mockOrchestrator.getServers.mockReturnValue(mockServers);

      await healthCheck(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.updateAllStatus).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        servers: [
          {
            id: 'server-1',
            healthy: true,
            lastResponseTime: 100,
            models: 1,
          },
        ],
      });
    });

    it('should handle health check errors', async () => {
      const error = new Error('Health check failed');
      mockOrchestrator.updateAllStatus.mockRejectedValue(error);

      await healthCheck(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Health check failed',
        details: 'Health check failed',
      });
    });
  });

  describe('getStats', () => {
    it('should return orchestrator stats', () => {
      const mockStats = { totalServers: 2, healthyServers: 2, inFlightRequests: 0 };
      mockOrchestrator.getStats.mockReturnValue(mockStats);

      getStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        stats: mockStats,
      });
    });
  });
});
