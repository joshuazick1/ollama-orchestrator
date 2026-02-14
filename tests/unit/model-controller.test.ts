/**
 * model-controller.test.ts
 * Unit tests for model controller endpoints
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { Request, Response } from 'express';

// Mock the model manager instance
vi.mock('../../src/model-manager-instance.js');
import { getModelManager } from '../../src/model-manager-instance.js';

// Mock the orchestrator instance
vi.mock('../../src/orchestrator-instance.js');
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';

import {
  warmupModel,
  getModelStatus,
  getAllModelsStatus,
  getWarmupRecommendations,
  unloadModel,
  getIdleModels,
} from '../../src/controllers/modelController.js';

const mockGetModelManager = vi.mocked(getModelManager);
const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);

describe('Model Controller', () => {
  let mockModelManager: any;
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock model manager
    mockModelManager = {
      registerServer: vi.fn(),
      warmupModel: vi.fn(),
      getModelWarmupStatus: vi.fn(),
      getSummary: vi.fn(),
      getRecommendedWarmupModels: vi.fn(),
      getServersWithModelLoaded: vi.fn(),
      unloadModel: vi.fn(),
      getIdleModels: vi.fn(),
    };
    mockGetModelManager.mockReturnValue(mockModelManager);

    // Mock orchestrator
    mockOrchestrator = {
      getServers: vi.fn(),
      getAllModels: vi.fn(),
    };
    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);

    mockReq = {
      params: {},
      body: {},
      query: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  describe('warmupModel', () => {
    beforeEach(() => {
      mockReq.params = { model: 'llama3:latest' };
      mockReq.body = { priority: 'high' };
      const mockServers = [{ id: 'server1' }, { id: 'server2' }];
      mockOrchestrator.getServers.mockReturnValue(mockServers);
    });

    it('should warmup model successfully on all servers', async () => {
      const mockResult = {
        jobs: [
          { serverId: 'server1', status: 'completed', estimatedTime: 5000, loadTime: 4500 },
          { serverId: 'server2', status: 'loading', estimatedTime: 6000, loadTime: 0 },
        ],
        totalServers: 2,
        loadedOn: 1,
        loadingOn: 1,
        failedOn: 0,
      };
      mockModelManager.warmupModel.mockResolvedValue(mockResult);

      await warmupModel(mockReq as Request, mockRes as Response);

      expect(mockGetModelManager).toHaveBeenCalledTimes(1);
      expect(mockGetOrchestratorInstance).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.getServers).toHaveBeenCalledTimes(2);
      expect(mockModelManager.registerServer).toHaveBeenCalledTimes(2);
      expect(mockModelManager.warmupModel).toHaveBeenCalledWith('llama3:latest', {
        serverIds: ['server1', 'server2'],
        priority: 'high',
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        model: 'llama3:latest',
        jobs: [
          { serverId: 'server1', status: 'completed', estimatedTime: 5000, loadTime: 4500 },
          { serverId: 'server2', status: 'loading', estimatedTime: 6000, loadTime: 0 },
        ],
        summary: {
          totalServers: 2,
          loadedOn: 1,
          loadingOn: 1,
          failedOn: 0,
        },
      });
    });

    it('should warmup model on specified servers', async () => {
      mockReq.body = { servers: ['server1'], priority: 'low' };
      const mockResult = {
        jobs: [{ serverId: 'server1', status: 'completed', estimatedTime: 3000, loadTime: 2800 }],
        totalServers: 1,
        loadedOn: 1,
        loadingOn: 0,
        failedOn: 0,
      };
      mockModelManager.warmupModel.mockResolvedValue(mockResult);

      await warmupModel(mockReq as Request, mockRes as Response);

      expect(mockModelManager.warmupModel).toHaveBeenCalledWith('llama3:latest', {
        serverIds: ['server1'],
        priority: 'low',
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 if model is missing', async () => {
      mockReq.params = {};

      await warmupModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Model name is required',
      });
    });

    it('should return 400 if no servers available', async () => {
      mockReq.params = { model: 'llama3:latest' };
      mockReq.body = { servers: [] };
      mockOrchestrator.getServers.mockReturnValue([]);

      await warmupModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'No servers available for warmup',
      });
    });

    it('should handle warmup errors', async () => {
      const mockError = new Error('Warmup failed');
      mockModelManager.warmupModel.mockRejectedValue(mockError);
      mockOrchestrator.getServers.mockReturnValue([{ id: 'server1' }]);

      await warmupModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to warmup model',
        details: 'Warmup failed',
      });
    });

    it('should handle non-Error exceptions', async () => {
      mockModelManager.warmupModel.mockRejectedValue('String error');
      mockOrchestrator.getServers.mockReturnValue([{ id: 'server1' }]);

      await warmupModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to warmup model',
        details: 'String error',
      });
    });
  });

  describe('getModelStatus', () => {
    beforeEach(() => {
      mockReq.params = { model: 'llama3:latest' };
      const mockServers = [{ id: 'server1' }];
      mockOrchestrator.getServers.mockReturnValue(mockServers);
    });

    it('should return model status successfully', () => {
      const mockStatus = {
        totalServers: 2,
        loadedOn: 1,
        loadingOn: 0,
        notLoadedOn: 1,
        failedOn: 0,
        servers: [
          { serverId: 'server1', status: 'loaded', loadTime: 5000 },
          { serverId: 'server2', status: 'not_loaded', loadTime: 0 },
        ],
      };
      mockModelManager.getModelWarmupStatus.mockReturnValue(mockStatus);

      getModelStatus(mockReq as Request, mockRes as Response);

      expect(mockModelManager.registerServer).toHaveBeenCalledTimes(1);
      expect(mockModelManager.getModelWarmupStatus).toHaveBeenCalledWith('llama3:latest');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        model: 'llama3:latest',
        status: {
          totalServers: 2,
          loadedOn: 1,
          loadingOn: 0,
          notLoadedOn: 1,
          failedOn: 0,
        },
        servers: [
          { serverId: 'server1', status: 'loaded', loadTime: 5000 },
          { serverId: 'server2', status: 'not_loaded', loadTime: 0 },
        ],
      });
    });

    it('should return 400 if model is missing', () => {
      mockReq.params = {};

      getModelStatus(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Model name is required',
      });
    });
  });

  describe('getAllModelsStatus', () => {
    beforeEach(() => {
      const mockServers = [{ id: 'server1' }];
      mockOrchestrator.getServers.mockReturnValue(mockServers);
      mockOrchestrator.getAllModels.mockReturnValue(['llama3:latest', 'mistral:latest']);
    });

    it('should return all models status successfully', () => {
      const mockSummary = {
        totalModels: 2,
        loadedModels: 1,
        loadingModels: 1,
      };
      const mockStatus1 = {
        totalServers: 1,
        loadedOn: 1,
        loadingOn: 0,
        notLoadedOn: 0,
        failedOn: 0,
        servers: [],
      };
      const mockStatus2 = {
        totalServers: 1,
        loadedOn: 0,
        loadingOn: 1,
        notLoadedOn: 0,
        failedOn: 0,
        servers: [],
      };

      mockModelManager.getSummary.mockReturnValue(mockSummary);
      mockModelManager.getModelWarmupStatus
        .mockReturnValueOnce(mockStatus1)
        .mockReturnValueOnce(mockStatus2);

      getAllModelsStatus(mockReq as Request, mockRes as Response);

      expect(mockModelManager.registerServer).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.getAllModels).toHaveBeenCalledTimes(1);
      expect(mockModelManager.getModelWarmupStatus).toHaveBeenCalledTimes(2);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        summary: mockSummary,
        models: {
          'llama3:latest': mockStatus1,
          'mistral:latest': mockStatus2,
        },
      });
    });
  });

  describe('getWarmupRecommendations', () => {
    beforeEach(() => {
      const mockServers = [{ id: 'server1' }];
      mockOrchestrator.getServers.mockReturnValue(mockServers);
    });

    it('should return warmup recommendations successfully', () => {
      const mockRecommendations = ['llama3:latest', 'mistral:latest'];
      mockModelManager.getRecommendedWarmupModels.mockReturnValue(mockRecommendations);

      getWarmupRecommendations(mockReq as Request, mockRes as Response);

      expect(mockModelManager.registerServer).toHaveBeenCalledTimes(1);
      expect(mockModelManager.getRecommendedWarmupModels).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        recommendations: [
          { model: 'llama3:latest', reason: 'High usage pattern detected' },
          { model: 'mistral:latest', reason: 'High usage pattern detected' },
        ],
        count: 2,
      });
    });
  });

  describe('unloadModel', () => {
    beforeEach(() => {
      mockReq.params = { model: 'llama3:latest' };
      const mockServers = [{ id: 'server1' }];
      mockOrchestrator.getServers.mockReturnValue(mockServers);
    });

    it('should unload model from specified server successfully', () => {
      mockReq.body = { serverId: 'server1' };
      mockModelManager.unloadModel.mockReturnValue(true);

      unloadModel(mockReq as Request, mockRes as Response);

      expect(mockModelManager.registerServer).toHaveBeenCalledTimes(1);
      expect(mockModelManager.unloadModel).toHaveBeenCalledWith('server1', 'llama3:latest');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        model: 'llama3:latest',
        results: [{ serverId: 'server1', success: true }],
        summary: {
          totalServers: 1,
          successfullyUnloaded: 1,
          failed: 0,
        },
      });
    });

    it('should unload model from all servers where loaded', () => {
      mockModelManager.getServersWithModelLoaded.mockReturnValue(['server1', 'server2']);
      mockModelManager.unloadModel.mockReturnValueOnce(true).mockReturnValueOnce(false);

      unloadModel(mockReq as Request, mockRes as Response);

      expect(mockModelManager.getServersWithModelLoaded).toHaveBeenCalledWith('llama3:latest');
      expect(mockModelManager.unloadModel).toHaveBeenCalledTimes(2);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        model: 'llama3:latest',
        results: [
          { serverId: 'server1', success: true },
          { serverId: 'server2', success: false },
        ],
        summary: {
          totalServers: 2,
          successfullyUnloaded: 1,
          failed: 1,
        },
      });
    });

    it('should return 400 if model is missing', () => {
      mockReq.params = {};

      unloadModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Model name is required',
      });
    });

    it('should return 404 if model is not loaded anywhere', () => {
      mockModelManager.getServersWithModelLoaded.mockReturnValue([]);

      unloadModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Model 'llama3:latest' is not loaded on any server",
      });
    });
  });

  describe('getIdleModels', () => {
    beforeEach(() => {
      const mockServers = [{ id: 'server1' }];
      mockOrchestrator.getServers.mockReturnValue(mockServers);
    });

    it('should return idle models successfully', () => {
      mockReq.query = { threshold: '3600000' };
      const mockIdleModels = [{ serverId: 'server1', model: 'llama3:latest', idleTime: 7200000 }];
      mockModelManager.getIdleModels.mockReturnValue(mockIdleModels);

      getIdleModels(mockReq as Request, mockRes as Response);

      expect(mockModelManager.registerServer).toHaveBeenCalledTimes(1);
      expect(mockModelManager.getIdleModels).toHaveBeenCalledWith(3600000);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        threshold: 3600000,
        models: [
          {
            serverId: 'server1',
            model: 'llama3:latest',
            idleTime: 7200000,
            idleTimeMinutes: 120,
          },
        ],
        count: 1,
      });
    });

    it('should use default threshold when not provided', () => {
      mockReq.query = {};
      const mockIdleModels = [];
      mockModelManager.getIdleModels.mockReturnValue(mockIdleModels);

      getIdleModels(mockReq as Request, mockRes as Response);

      expect(mockModelManager.getIdleModels).toHaveBeenCalledWith(1800000); // default 30 minutes
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle invalid threshold gracefully', () => {
      mockReq.query = { threshold: 'invalid' };
      const mockIdleModels = [];
      mockModelManager.getIdleModels.mockReturnValue(mockIdleModels);

      getIdleModels(mockReq as Request, mockRes as Response);

      expect(mockModelManager.getIdleModels).toHaveBeenCalledWith(1800000); // falls back to default
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });
});
