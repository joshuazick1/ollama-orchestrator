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

import {
  getCircuitBreakers,
  getBans,
  removeBan,
  removeBansByServer,
  removeBansByModel,
  clearAllBans,
  manualRecoveryTest,
  getCircuitBreakerDetails,
  forceOpenBreaker,
  forceCloseBreaker,
  forceHalfOpenBreaker,
} from '../../src/controllers/serversController.js';

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
      getCircuitBreakerStats: vi.fn(),
      getBanDetails: vi.fn(),
      unban: vi.fn(),
      unbanServer: vi.fn(),
      unbanModel: vi.fn(),
      clearAllBans: vi.fn(),
      manualTriggerRecoveryTest: vi.fn(),
      getModelCircuitBreakerPublic: vi.fn(),
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

  describe('getCircuitBreakers', () => {
    it('should return circuit breaker stats', () => {
      const mockCircuitBreakers = {
        'server-1:model-a': {
          state: 'closed',
          failureCount: 0,
          successCount: 10,
          totalRequestCount: 15,
          blockedRequestCount: 0,
          lastFailure: null,
          lastSuccess: '2024-01-01',
          nextRetryAt: null,
          errorRate: 0,
          errorCounts: {},
          consecutiveSuccesses: 5,
          modelType: 'ollama',
          lastFailureReason: null,
          halfOpenStartedAt: null,
          halfOpenAttempts: 0,
          lastErrorType: null,
          activeTestsInProgress: 0,
        },
      };
      mockOrchestrator.getCircuitBreakerStats.mockReturnValue(mockCircuitBreakers);

      getCircuitBreakers(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.success).toBe(true);
      expect(jsonCall.circuitBreakers).toHaveLength(1);
      expect(jsonCall.circuitBreakers[0].serverId).toBe('server-1:model-a');
      expect(jsonCall.circuitBreakers[0].state).toBe('CLOSED');
    });

    it('should handle empty circuit breaker stats', () => {
      mockOrchestrator.getCircuitBreakerStats.mockReturnValue({});

      getCircuitBreakers(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        circuitBreakers: [],
      });
    });

    it('should return 500 when getCircuitBreakerStats throws', () => {
      mockOrchestrator.getCircuitBreakerStats.mockImplementation(() => {
        throw new Error('Stats error');
      });

      getCircuitBreakers(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get circuit breaker status',
        details: 'Stats error',
      });
    });

    it('should handle circuit breaker with undefined stats fields', () => {
      const mockCircuitBreakers = {
        'server-1:model-a': {
          state: 'open',
          failureCount: 5,
          successCount: 2,
          // Missing optional fields
        },
      };
      mockOrchestrator.getCircuitBreakerStats.mockReturnValue(mockCircuitBreakers);

      getCircuitBreakers(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.circuitBreakers[0].totalRequestCount).toBe(0);
      expect(jsonCall.circuitBreakers[0].blockedRequestCount).toBe(0);
    });
  });

  describe('getBans', () => {
    it('should return all bans', () => {
      const mockBans = [
        { serverId: 'server-1', model: 'model-a', reason: 'unhealthy' },
        { serverId: 'server-2', model: 'model-b', reason: 'timeout' },
      ];
      mockOrchestrator.getBanDetails.mockReturnValue(mockBans);

      getBans(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 2,
        bans: mockBans,
      });
    });

    it('should handle empty bans list', () => {
      mockOrchestrator.getBanDetails.mockReturnValue([]);

      getBans(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 0,
        bans: [],
      });
    });
  });

  describe('removeBan', () => {
    it('should remove a specific ban successfully', () => {
      mockOrchestrator.unban.mockReturnValue(true);
      mockReq.params = { serverId: 'server-1', model: 'model-a' };

      removeBan(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.unban).toHaveBeenCalledWith('server-1', 'model-a');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Ban removed for server-1:model-a',
      });
    });

    it('should return 404 when ban not found', () => {
      mockOrchestrator.unban.mockReturnValue(false);
      mockReq.params = { serverId: 'server-1', model: 'unknown-model' };

      removeBan(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'No ban found for server-1:unknown-model',
      });
    });

    it('should return 400 when serverId is missing', () => {
      mockReq.params = { model: 'model-a' };

      removeBan(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'serverId and model are required',
      });
    });

    it('should return 400 when model is missing', () => {
      mockReq.params = { serverId: 'server-1' };

      removeBan(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'serverId and model are required',
      });
    });

    it('should decode URL-encoded model names', () => {
      mockOrchestrator.unban.mockReturnValue(true);
      mockReq.params = { serverId: 'server-1', model: 'model%2Fname%2Ftest' };

      removeBan(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.unban).toHaveBeenCalledWith('server-1', 'model/name/test');
    });
  });

  describe('removeBansByServer', () => {
    it('should remove all bans for a server', () => {
      mockOrchestrator.unbanServer.mockReturnValue(3);
      mockReq.params = { serverId: 'server-1' };

      removeBansByServer(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.unbanServer).toHaveBeenCalledWith('server-1');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        removed: 3,
        message: 'Removed 3 bans for server server-1',
      });
    });

    it('should handle server with no bans', () => {
      mockOrchestrator.unbanServer.mockReturnValue(0);
      mockReq.params = { serverId: 'server-1' };

      removeBansByServer(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        removed: 0,
        message: 'No bans found for server',
      });
    });

    it('should return 400 when serverId is missing', () => {
      mockReq.params = {};

      removeBansByServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'serverId is required',
      });
    });
  });

  describe('removeBansByModel', () => {
    it('should remove all bans for a model', () => {
      mockOrchestrator.unbanModel.mockReturnValue(2);
      mockReq.params = { model: 'model-a' };

      removeBansByModel(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.unbanModel).toHaveBeenCalledWith('model-a');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        removed: 2,
        message: 'Removed 2 bans for model model-a',
      });
    });

    it('should handle model with no bans', () => {
      mockOrchestrator.unbanModel.mockReturnValue(0);
      mockReq.params = { model: 'unknown-model' };

      removeBansByModel(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        removed: 0,
        message: 'No bans found for model',
      });
    });

    it('should return 400 when model is missing', () => {
      mockReq.params = {};

      removeBansByModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'model is required',
      });
    });

    it('should decode URL-encoded model names', () => {
      mockOrchestrator.unbanModel.mockReturnValue(1);
      mockReq.params = { model: 'model%2Fname' };

      removeBansByModel(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.unbanModel).toHaveBeenCalledWith('model/name');
    });
  });

  describe('clearAllBans', () => {
    it('should clear all bans', () => {
      mockOrchestrator.clearAllBans.mockReturnValue(5);

      clearAllBans(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        removed: 5,
        message: 'Cleared 5 bans',
      });
    });

    it('should handle no bans to clear', () => {
      mockOrchestrator.clearAllBans.mockReturnValue(0);

      clearAllBans(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        removed: 0,
        message: 'No bans to clear',
      });
    });
  });

  describe('manualRecoveryTest', () => {
    it('should trigger recovery test successfully', async () => {
      mockOrchestrator.manualTriggerRecoveryTest.mockResolvedValue({
        success: true,
        breakerState: 'half-open',
      });
      mockReq.params = { serverId: 'server-1', model: 'model-a' };

      await manualRecoveryTest(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.manualTriggerRecoveryTest).toHaveBeenCalledWith(
        'server-1',
        'model-a'
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Recovery test passed for server-1:model-a',
        breakerState: 'half-open',
      });
    });

    it('should handle failed recovery test', async () => {
      mockOrchestrator.manualTriggerRecoveryTest.mockResolvedValue({
        success: false,
        error: 'Server still unhealthy',
        breakerState: 'open',
      });
      mockReq.params = { serverId: 'server-1', model: 'model-a' };

      await manualRecoveryTest(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Server still unhealthy',
        breakerState: 'open',
        message: 'Recovery test failed for server-1:model-a',
      });
    });

    it('should return 400 when serverId is missing', async () => {
      mockReq.params = { model: 'model-a' };

      await manualRecoveryTest(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'serverId and model are required',
      });
    });

    it('should return 400 when model is missing', async () => {
      mockReq.params = { serverId: 'server-1' };

      await manualRecoveryTest(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'serverId and model are required',
      });
    });

    it('should decode URL-encoded model names', async () => {
      mockOrchestrator.manualTriggerRecoveryTest.mockResolvedValue({
        success: true,
        breakerState: 'closed',
      });
      mockReq.params = { serverId: 'server-1', model: 'model%2Fname' };

      await manualRecoveryTest(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.manualTriggerRecoveryTest).toHaveBeenCalledWith(
        'server-1',
        'model/name'
      );
    });

    it('should return 500 on error', async () => {
      mockOrchestrator.manualTriggerRecoveryTest.mockRejectedValue(new Error('Test error'));
      mockReq.params = { serverId: 'server-1', model: 'model-a' };

      await manualRecoveryTest(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Manual recovery test failed',
        details: 'Test error',
      });
    });
  });

  describe('getCircuitBreakerDetails', () => {
    it('should return circuit breaker details', () => {
      const mockBreaker = {
        getStats: vi.fn().mockReturnValue({
          state: 'closed',
          failureCount: 0,
          successCount: 10,
          errorRate: 0,
        }),
      };
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(mockBreaker);
      mockReq.params = { serverId: 'server-1', model: 'model-a' };

      getCircuitBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.success).toBe(true);
      expect(jsonCall.serverId).toBe('server-1');
      expect(jsonCall.model).toBe('model-a');
      expect(jsonCall.circuitBreaker.state).toBe('CLOSED');
    });

    it('should return 404 when circuit breaker not found', () => {
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(undefined);
      mockReq.params = { serverId: 'server-1', model: 'unknown-model' };

      getCircuitBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Circuit breaker not found for server-1:unknown-model',
      });
    });

    it('should return 400 when serverId is missing', () => {
      mockReq.params = { model: 'model-a' };

      getCircuitBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'serverId and model are required',
      });
    });

    it('should return 400 when model is missing', () => {
      mockReq.params = { serverId: 'server-1' };

      getCircuitBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'serverId and model are required',
      });
    });

    it('should decode URL-encoded model names', () => {
      const mockBreaker = {
        getStats: vi.fn().mockReturnValue({
          state: 'open',
          failureCount: 5,
          successCount: 2,
          errorRate: 0.71,
        }),
      };
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(mockBreaker);
      mockReq.params = { serverId: 'server-1', model: 'model%2Fname' };

      getCircuitBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getModelCircuitBreakerPublic).toHaveBeenCalledWith(
        'server-1',
        'model/name'
      );
    });
  });

  describe('forceOpenBreaker', () => {
    it('should force open a circuit breaker', () => {
      const mockBreaker = {
        forceOpen: vi.fn(),
        getStats: vi.fn().mockReturnValue({
          state: 'open',
          failureCount: 5,
        }),
      };
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(mockBreaker);
      mockReq.params = { serverId: 'server-1', model: 'model-a' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockBreaker.forceOpen).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.success).toBe(true);
      expect(jsonCall.circuitBreaker.state).toBe('OPEN');
    });

    it('should return 404 when circuit breaker not found', () => {
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(undefined);
      mockReq.params = { serverId: 'server-1', model: 'unknown-model' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when serverId is missing', () => {
      mockReq.params = { model: 'model-a' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when model is missing', () => {
      mockReq.params = { serverId: 'server-1' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('forceCloseBreaker', () => {
    it('should force close a circuit breaker', () => {
      const mockBreaker = {
        forceClose: vi.fn(),
        getStats: vi.fn().mockReturnValue({
          state: 'closed',
          failureCount: 0,
        }),
      };
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(mockBreaker);
      mockReq.params = { serverId: 'server-1', model: 'model-a' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockBreaker.forceClose).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.success).toBe(true);
      expect(jsonCall.circuitBreaker.state).toBe('CLOSED');
    });

    it('should return 404 when circuit breaker not found', () => {
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(undefined);
      mockReq.params = { serverId: 'server-1', model: 'unknown-model' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when serverId is missing', () => {
      mockReq.params = { model: 'model-a' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when model is missing', () => {
      mockReq.params = { serverId: 'server-1' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('forceHalfOpenBreaker', () => {
    it('should force half-open a circuit breaker', () => {
      const mockBreaker = {
        forceHalfOpen: vi.fn(),
        getStats: vi.fn().mockReturnValue({
          state: 'half-open',
          failureCount: 2,
        }),
      };
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(mockBreaker);
      mockReq.params = { serverId: 'server-1', model: 'model-a' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockBreaker.forceHalfOpen).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.success).toBe(true);
      expect(jsonCall.circuitBreaker.state).toBe('HALF-OPEN');
    });

    it('should return 404 when circuit breaker not found', () => {
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(undefined);
      mockReq.params = { serverId: 'server-1', model: 'unknown-model' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when serverId is missing', () => {
      mockReq.params = { model: 'model-a' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when model is missing', () => {
      mockReq.params = { serverId: 'server-1' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });
});
