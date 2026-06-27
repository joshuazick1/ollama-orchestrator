/**
 * circuit-breaker-controller.test.ts
 * Tests for circuitBreakerController.ts using the new probe system.
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  resetBreaker,
  getBreakerDetails,
  forceOpenBreaker,
  forceCloseBreaker,
  forceHalfOpenBreaker,
  getEndpointStates,
} from '../../src/controllers/circuit-breaker-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { ProbeOrchestrator } from '../../src/probe/probe-orchestrator.js';
import { DEFAULT_PROBE_CONFIG, KNOWN_PROBE_ENDPOINTS } from '../../src/probe/types.js';

vi.mock('../../src/orchestrator/orchestrator-instance.js');
vi.mock('../../src/utils/logger.js');

describe('circuitBreakerController', () => {
  let mockOrchestrator: any;
  let mockProbeOrchestrator: ProbeOrchestrator;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockProbeOrchestrator = new ProbeOrchestrator(DEFAULT_PROBE_CONFIG, null);

    mockOrchestrator = {
      getProbeOrchestrator: vi.fn().mockReturnValue(mockProbeOrchestrator),
      getLBScoreForServerModel: vi.fn().mockReturnValue(null),
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

  describe('getBreakerDetails', () => {
    it('should return details for a tuple in HEALTHY state (per-endpoint)', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.serverId).toBe('server-1');
      expect(response.model).toBe('llama3:latest');
      expect(response.endpoint).toBe('ollama_chat');
      expect(response.state).toBe('HEALTHY');
      expect(response.uiState).toBe('CLOSED');
    });

    it('should return details for a tuple in HEALTHY state (aggregated - no endpoint)', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.serverId).toBe('server-1');
      expect(response.model).toBe('llama3:latest');
      expect(response.endpoints).toBeDefined();
      expect(Array.isArray(response.endpoints)).toBe(true);
      expect(response.endpoints.length).toBe(7); // All 7 KNOWN_PROBE_ENDPOINTS
    });

    it('should return details for a tuple in UNHEALTHY state', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.state).toBe('UNHEALTHY');
      expect(response.uiState).toBe('OPEN');
    });

    it('should return details for a tuple in RECOVERING state', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'RECOVERING'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.state).toBe('RECOVERING');
      expect(response.uiState).toBe('HALF-OPEN');
    });

    it('should return details for a tuple in SUSPECT state', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'SUSPECT'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.state).toBe('SUSPECT');
      expect(response.uiState).toBe('CLOSED'); // SUSPECT maps to CLOSED
    });

    it('should handle server-level breaker (model=server)', () => {
      mockReq.params = { serverId: 'server-1', model: 'server', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.serverId).toBe('server-1');
      expect(response.model).toBe('server');
      expect(response.endpoint).toBe('ollama_chat');
    });

    it('should decode URI component in model name', () => {
      mockReq.params = {
        serverId: 'server-1',
        model: encodeURIComponent('llama3:latest'),
        endpoint: 'ollama_chat',
      };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.model).toBe('llama3:latest');
    });

    it('should handle errors and return 500', () => {
      mockOrchestrator.getProbeOrchestrator.mockImplementation(() => {
        throw new Error('Test error');
      });
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('resetBreaker', () => {
    it('should reset a tuple to HEALTHY (per-endpoint)', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.message).toContain('server-1:llama3:latest');
      expect(response.results).toHaveLength(1);
      expect(response.results[0].endpoint).toBe('ollama_chat');
      expect(response.results[0].previousState).toBe('UNHEALTHY');
      expect(response.previousStates).toContain('UNHEALTHY');
      expect(response.currentState).toBe('HEALTHY');
      expect(response.uiState).toBe('CLOSED');
    });

    it('should reset all 7 endpoints when no endpoint is provided', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.results).toHaveLength(7);
      expect(response.message).toContain('all 7 endpoints');
      expect(response.previousStates).toHaveLength(7);
      expect(response.currentState).toBe('HEALTHY');
      expect(response.uiState).toBe('CLOSED');
    });

    it('should handle server-level reset', () => {
      mockReq.params = { serverId: 'server-1', model: 'server', endpoint: 'ollama_chat' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.message).toContain('server-1:server');
    });

    it('should decode URI component in model name', () => {
      mockReq.params = {
        serverId: 'server-1',
        model: encodeURIComponent('llama3:latest'),
        endpoint: 'ollama_chat',
      };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should handle errors and return 500', () => {
      mockOrchestrator.getProbeOrchestrator.mockImplementation(() => {
        throw new Error('Test error');
      });
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('forceOpenBreaker', () => {
    it('should force tuple to UNHEALTHY (per-endpoint)', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.message).toContain('server-1:llama3:latest');
      expect(response.results).toHaveLength(1);
      expect(response.results[0].endpoint).toBe('ollama_chat');
      expect(response.results[0].previousState).toBe('HEALTHY');
      expect(response.currentState).toBe('UNHEALTHY');
      expect(response.uiState).toBe('OPEN');
    });

    it('should force all 7 endpoints when no endpoint is provided', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.results).toHaveLength(7);
      expect(response.message).toContain('all 7 endpoints');
      expect(response.currentState).toBe('UNHEALTHY');
      expect(response.uiState).toBe('OPEN');
    });

    it('should return 400 when serverId or model is missing', () => {
      mockReq.params = { serverId: '', model: 'llama3:latest', endpoint: 'ollama_chat' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid endpoint value', () => {
      mockReq.params = {
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'invalid_endpoint',
      };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Invalid endpoint') })
      );
    });

    it('should handle errors and return 500', () => {
      mockOrchestrator.getProbeOrchestrator.mockImplementation(() => {
        throw new Error('Test error');
      });
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('forceCloseBreaker', () => {
    it('should force tuple to HEALTHY (per-endpoint)', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.message).toContain('server-1:llama3:latest');
      expect(response.results).toHaveLength(1);
      expect(response.results[0].endpoint).toBe('ollama_chat');
      expect(response.results[0].previousState).toBe('UNHEALTHY');
      expect(response.currentState).toBe('HEALTHY');
      expect(response.uiState).toBe('CLOSED');
    });

    it('should force all 7 endpoints when no endpoint is provided', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.results).toHaveLength(7);
      expect(response.message).toContain('all 7 endpoints');
      expect(response.currentState).toBe('HEALTHY');
      expect(response.uiState).toBe('CLOSED');
    });

    it('should return 400 when serverId or model is missing', () => {
      mockReq.params = { serverId: 'server-1', model: '', endpoint: 'ollama_chat' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('forceHalfOpenBreaker', () => {
    it('should force tuple to RECOVERING (per-endpoint)', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.message).toContain('server-1:llama3:latest');
      expect(response.results).toHaveLength(1);
      expect(response.results[0].endpoint).toBe('ollama_chat');
      expect(response.results[0].previousState).toBe('HEALTHY');
      expect(response.currentState).toBe('RECOVERING');
      expect(response.uiState).toBe('HALF-OPEN');
    });

    it('should force all 7 endpoints when no endpoint is provided', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.results).toHaveLength(7);
      expect(response.message).toContain('all 7 endpoints');
      expect(response.currentState).toBe('RECOVERING');
      expect(response.uiState).toBe('HALF-OPEN');
    });

    it('should return 400 when serverId or model is missing', () => {
      mockReq.params = { serverId: '', model: 'llama3:latest', endpoint: 'ollama_chat' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('state mapping (4-state to 3-state)', () => {
    it('should map HEALTHY to CLOSED', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.state).toBe('HEALTHY');
      expect(response.uiState).toBe('CLOSED');
    });

    it('should map SUSPECT to CLOSED', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'SUSPECT'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.state).toBe('SUSPECT');
      expect(response.uiState).toBe('CLOSED');
    });

    it('should map UNHEALTHY to OPEN', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.state).toBe('UNHEALTHY');
      expect(response.uiState).toBe('OPEN');
    });

    it('should map RECOVERING to HALF-OPEN', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'RECOVERING'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.state).toBe('RECOVERING');
      expect(response.uiState).toBe('HALF-OPEN');
    });
  });

  describe('getEndpointStates', () => {
    it('should return 7 entries for all ProbeEndpoints', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      getEndpointStates(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.serverId).toBe('server-1');
      expect(response.model).toBe('llama3:latest');
      expect(response.endpoints).toBeDefined();
      expect(Array.isArray(response.endpoints)).toBe(true);
      expect(response.endpoints.length).toBe(7);
      expect(response.endpoints.map((e: any) => e.endpoint)).toEqual([...KNOWN_PROBE_ENDPOINTS]);
    });

    it('should return 7 entries even for server-level model', () => {
      mockReq.params = { serverId: 'server-1', model: 'server' };

      getEndpointStates(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.serverId).toBe('server-1');
      expect(response.model).toBe('server');
      expect(response.endpoints.length).toBe(7);
    });

    it('should handle errors and return 500', () => {
      mockOrchestrator.getProbeOrchestrator.mockImplementation(() => {
        throw new Error('Test error');
      });
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      getEndpointStates(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('validation', () => {
    it('should return 400 when serverId is missing in getBreakerDetails', () => {
      mockReq.params = { serverId: '', model: 'llama3:latest', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('serverId') })
      );
    });

    it('should return 400 when model is missing in getBreakerDetails', () => {
      mockReq.params = { serverId: 'server-1', model: '', endpoint: 'ollama_chat' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('model') })
      );
    });

    it('should return 400 for invalid endpoint value in getBreakerDetails', () => {
      mockReq.params = {
        serverId: 'server-1',
        model: 'llama3:latest',
        endpoint: 'invalid_endpoint',
      };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Invalid endpoint') })
      );
    });

    it('should return 400 when serverId is missing in getEndpointStates', () => {
      mockReq.params = { serverId: '', model: 'llama3:latest' };

      getEndpointStates(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 when model is missing in getEndpointStates', () => {
      mockReq.params = { serverId: 'server-1', model: '' };

      getEndpointStates(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for invalid endpoint in resetBreaker', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'bad_endpoint' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Invalid endpoint') })
      );
    });

    it('should return 400 for invalid endpoint in forceCloseBreaker', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'bad_endpoint' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Invalid endpoint') })
      );
    });

    it('should return 400 for invalid endpoint in forceHalfOpenBreaker', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest', endpoint: 'bad_endpoint' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Invalid endpoint') })
      );
    });
  });
});
