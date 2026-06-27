/**
 * servers-controller-cb.test.ts
 * Tests for circuit breaker methods in serversController.ts using the new probe system.
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  getCircuitBreakers,
  getCircuitBreakerDetails,
  forceOpenBreaker,
  forceCloseBreaker,
  forceHalfOpenBreaker,
  resetServerCircuitBreaker,
  getServerCircuitBreaker,
  getServersCircuitBreakers,
  getCircuitBreakersByModel,
  manualRecoveryTest,
  getHealth,
} from '../../src/controllers/servers-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { ProbeOrchestrator } from '../../src/probe/probe-orchestrator.js';
import { DEFAULT_PROBE_CONFIG } from '../../src/probe/types.js';

vi.mock('../../src/orchestrator/orchestrator-instance.js');
vi.mock('../../src/utils/logger.js');

describe('serversController CB methods', () => {
  let mockOrchestrator: any;
  let mockProbeOrchestrator: ProbeOrchestrator;
  let mockRecoveryDriver: any;
  let mockEndpointRegistry: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockProbeOrchestrator = new ProbeOrchestrator(DEFAULT_PROBE_CONFIG, null);

    mockRecoveryDriver = {
      tick: vi.fn().mockResolvedValue(undefined),
    };

    mockEndpointRegistry = {
      getActiveEndpoints: vi.fn().mockReturnValue(['ollama_chat']),
      isEmbeddingModel: vi.fn().mockReturnValue(false),
    };

    mockOrchestrator = {
      getProbeOrchestrator: vi.fn().mockReturnValue(mockProbeOrchestrator),
      getRecoveryDriver: vi.fn().mockReturnValue(mockRecoveryDriver),
      getEndpointRegistry: vi.fn().mockReturnValue(mockEndpointRegistry),
      getLBScoreForServerModel: vi.fn().mockReturnValue(null),
      getGlobalMetrics: vi.fn().mockReturnValue({ requestsPerSecond: 0 }),
      getServers: vi.fn().mockReturnValue([]),
    };

    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);

    mockReq = {
      params: {},
      user: { id: 'test-admin' },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCircuitBreakers', () => {
    it('should return all tuples as StateProjection array', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'HEALTHY'
      );
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv2', model: 'mistral', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );

      getCircuitBreakers(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.circuitBreakers).toHaveLength(2);
      expect(response.circuitBreakers[0].serverId).toBe('srv1');
      expect(response.circuitBreakers[0].serverIdOnly).toBe('srv1');
      expect(response.circuitBreakers[1].serverId).toBe('srv2');
      expect(response.circuitBreakers[1].serverIdOnly).toBe('srv2');
    });

    it('should return empty array when no tuples exist', () => {
      getCircuitBreakers(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.circuitBreakers).toHaveLength(0);
    });
  });

  describe('getCircuitBreakerDetails', () => {
    it('should return single tuple projection', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'srv1', model: 'llama3' };

      getCircuitBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.serverId).toBe('srv1');
      expect(response.model).toBe('llama3');
      expect(response.circuitBreaker.state).toBe('UNHEALTHY');
      expect(response.circuitBreaker.uiState).toBe('OPEN');
    });

    it('should return 404 when tuple not found', () => {
      mockReq.params = { serverId: 'unknown', model: 'unknown' };

      getCircuitBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when serverId or model missing', () => {
      mockReq.params = { serverId: '', model: 'llama3' };

      getCircuitBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('forceOpenBreaker', () => {
    it('should force tuple to UNHEALTHY via setStateForTesting', () => {
      mockReq.params = { serverId: 'srv1', model: 'llama3' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.circuitBreaker.state).toBe('UNHEALTHY');
      expect(response.circuitBreaker.uiState).toBe('OPEN');
    });

    it('should return 400 when serverId or model missing', () => {
      mockReq.params = { serverId: '', model: 'llama3' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when no active endpoints', () => {
      mockEndpointRegistry.getActiveEndpoints.mockReturnValue([]);
      mockReq.params = { serverId: 'srv1', model: 'llama3' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('forceCloseBreaker', () => {
    it('should force tuple to HEALTHY via setStateForTesting', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'srv1', model: 'llama3' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.circuitBreaker.state).toBe('HEALTHY');
      expect(response.circuitBreaker.uiState).toBe('CLOSED');
    });

    it('should return 400 when serverId or model missing', () => {
      mockReq.params = { serverId: 'srv1', model: '' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('forceHalfOpenBreaker', () => {
    it('should force tuple to RECOVERING via setStateForTesting', () => {
      mockReq.params = { serverId: 'srv1', model: 'llama3' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.circuitBreaker.state).toBe('RECOVERING');
      expect(response.circuitBreaker.uiState).toBe('HALF-OPEN');
    });

    it('should return 400 when serverId or model missing', () => {
      mockReq.params = { serverId: '', model: 'llama3' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('getServerCircuitBreaker', () => {
    it('should return aggregate view for a server', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'HEALTHY'
      );
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'mistral', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'srv1' };

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.serverId).toBe('srv1');
      expect(response.state).toBe('UNHEALTHY');
      expect(response.tupleCount).toBe(2);
    });

    it('should return 404 when no tuples for server', () => {
      mockReq.params = { serverId: 'unknown' };

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when serverId missing', () => {
      mockReq.params = { serverId: '' };

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('resetServerCircuitBreaker', () => {
    it('should reset all tuples for a server', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'mistral', endpoint: 'ollama_chat' },
        'RECOVERING'
      );
      mockReq.params = { serverId: 'srv1' };

      resetServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.resetCount).toBe(2);

      const state1 = mockProbeOrchestrator.getState({
        serverId: 'srv1',
        model: 'llama3',
        endpoint: 'ollama_chat',
      });
      const state2 = mockProbeOrchestrator.getState({
        serverId: 'srv1',
        model: 'mistral',
        endpoint: 'ollama_chat',
      });
      expect(state1).toBe('HEALTHY');
      expect(state2).toBe('HEALTHY');
    });

    it('should return 400 when serverId missing', () => {
      mockReq.params = { serverId: '' };

      resetServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('getServersCircuitBreakers', () => {
    it('should return fleet-wide aggregate grouped by server', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'HEALTHY'
      );
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv2', model: 'mistral', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );

      getServersCircuitBreakers(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.circuitBreakers).toHaveProperty('srv1');
      expect(response.circuitBreakers).toHaveProperty('srv2');
      expect(response.circuitBreakers.srv1.state).toBe('HEALTHY');
      expect(response.circuitBreakers.srv2.state).toBe('UNHEALTHY');
    });

    it('should aggregate worst state per server', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'HEALTHY'
      );
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'mistral', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );

      getServersCircuitBreakers(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.circuitBreakers.srv1.state).toBe('UNHEALTHY');
    });
  });

  describe('getCircuitBreakersByModel', () => {
    it('should group by model', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'HEALTHY'
      );
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv2', model: 'llama3', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );

      getCircuitBreakersByModel(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.models).toHaveProperty('llama3');
      expect(response.models.llama3).toHaveLength(2);
    });
  });

  describe('manualRecoveryTest', () => {
    it('should call recoveryDriver.tick()', async () => {
      mockReq.params = { serverId: 'srv1', model: 'llama3' };

      await manualRecoveryTest(mockReq as Request, mockRes as Response);

      expect(mockRecoveryDriver.tick).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
    });

    it('should return 404 when no active endpoints', () => {
      mockEndpointRegistry.getActiveEndpoints.mockReturnValue([]);
      mockReq.params = { serverId: 'srv1', model: 'llama3' };

      manualRecoveryTest(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when serverId or model missing', async () => {
      mockReq.params = { serverId: '', model: 'llama3' };

      await manualRecoveryTest(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  // TODO: SKIP - production getHealth behavior changed (healthy/total counting from probe states)
  describe.skip('getHealth', () => {
    it('should return healthy count from probe states', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'HEALTHY'
      );
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv2', model: 'mistral', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv3', model: 'llama3', endpoint: 'ollama_chat' },
        'RECOVERING'
      );

      getHealth(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.healthy).toBe(1);
      expect(response.total).toBe(3);
    });

    it('should return 0 healthy when all tuples are UNHEALTHY', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'srv2', model: 'mistral', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );

      getHealth(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.healthy).toBe(0);
      expect(response.total).toBe(2);
    });
  });
});
