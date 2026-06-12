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
} from '../../src/controllers/circuit-breaker-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { ProbeOrchestrator } from '../../src/probe/probe-orchestrator.js';
import { DEFAULT_PROBE_CONFIG } from '../../src/probe/types.js';

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
    it('should return details for a tuple in HEALTHY state', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.serverId).toBe('server-1');
      expect(response.model).toBe('llama3:latest');
      expect(response.state).toBe('HEALTHY');
      expect(response.uiState).toBe('CLOSED');
    });

    it('should return details for a tuple in UNHEALTHY state', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

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
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

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
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.state).toBe('SUSPECT');
      expect(response.uiState).toBe('CLOSED'); // SUSPECT maps to CLOSED
    });

    it('should handle server-level breaker (model=server)', () => {
      mockReq.params = { serverId: 'server-1', model: 'server' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.serverId).toBe('server-1');
      expect(response.model).toBe('server');
    });

    it('should decode URI component in model name', () => {
      mockReq.params = { serverId: 'server-1', model: encodeURIComponent('llama3:latest') };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.model).toBe('llama3:latest');
    });

    it('should handle errors and return 500', () => {
      mockOrchestrator.getProbeOrchestrator.mockImplementation(() => {
        throw new Error('Test error');
      });
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('resetBreaker', () => {
    it('should reset a tuple to HEALTHY', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Circuit breaker reset for server-1:llama3:latest',
        previousState: 'UNHEALTHY',
        currentState: 'HEALTHY',
        uiState: 'CLOSED',
      });
    });

    it('should handle server-level reset', () => {
      mockReq.params = { serverId: 'server-1', model: 'server' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.message).toContain('server-1:server');
    });

    it('should decode URI component in model name', () => {
      mockReq.params = { serverId: 'server-1', model: encodeURIComponent('llama3:latest') };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should handle errors and return 500', () => {
      mockOrchestrator.getProbeOrchestrator.mockImplementation(() => {
        throw new Error('Test error');
      });
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('forceOpenBreaker', () => {
    it('should force tuple to UNHEALTHY', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Circuit breaker force-opened for server-1:llama3:latest',
        previousState: 'HEALTHY',
        currentState: 'UNHEALTHY',
        uiState: 'OPEN',
      });
    });

    it('should return 400 when serverId or model is missing', () => {
      mockReq.params = { serverId: '', model: 'llama3:latest' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle errors and return 500', () => {
      mockOrchestrator.getProbeOrchestrator.mockImplementation(() => {
        throw new Error('Test error');
      });
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      forceOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('forceCloseBreaker', () => {
    it('should force tuple to HEALTHY', () => {
      mockProbeOrchestrator.setStateForTesting(
        { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
        'UNHEALTHY'
      );
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Circuit breaker force-closed for server-1:llama3:latest',
        previousState: 'UNHEALTHY',
        currentState: 'HEALTHY',
        uiState: 'CLOSED',
      });
    });

    it('should return 400 when serverId or model is missing', () => {
      mockReq.params = { serverId: 'server-1', model: '' };

      forceCloseBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('forceHalfOpenBreaker', () => {
    it('should force tuple to RECOVERING', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Circuit breaker force-half-open for server-1:llama3:latest',
        previousState: 'HEALTHY',
        currentState: 'RECOVERING',
        uiState: 'HALF-OPEN',
      });
    });

    it('should return 400 when serverId or model is missing', () => {
      mockReq.params = { serverId: '', model: 'llama3:latest' };

      forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('state mapping (4-state to 3-state)', () => {
    it('should map HEALTHY to CLOSED', () => {
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

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
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

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
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

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
      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      const response = (mockRes.json as any).mock.calls[0][0];
      expect(response.state).toBe('RECOVERING');
      expect(response.uiState).toBe('HALF-OPEN');
    });
  });
});
