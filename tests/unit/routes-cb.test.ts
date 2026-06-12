/**
 * routes-cb.test.ts
 * Tests for circuit-breaker routes - verifies CB controller methods return new StateProjection shape.
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  getBreakerDetails,
  resetBreaker,
  forceOpenBreaker,
  forceCloseBreaker,
  forceHalfOpenBreaker,
} from '../../src/controllers/circuit-breaker-controller.js';
import {
  getCircuitBreakers,
  getCircuitBreakerDetails,
  getServerCircuitBreaker,
  resetServerCircuitBreaker,
  getServersCircuitBreakers,
  getCircuitBreakersByModel,
} from '../../src/controllers/servers-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { ProbeOrchestrator } from '../../src/probe/probe-orchestrator.js';
import { DEFAULT_PROBE_CONFIG } from '../../src/probe/types.js';

vi.mock('../../src/orchestrator/orchestrator-instance.js');
vi.mock('../../src/utils/logger.js');

describe('Circuit Breaker Routes - Controller Methods', () => {
  let mockOrchestrator: any;
  let mockProbeOrchestrator: ProbeOrchestrator;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockProbeOrchestrator = new ProbeOrchestrator(DEFAULT_PROBE_CONFIG, null);

    mockOrchestrator = {
      getProbeOrchestrator: vi.fn().mockReturnValue(mockProbeOrchestrator),
      getLBScoreForServerModel: vi.fn().mockReturnValue(null),
      getEndpointRegistry: vi.fn().mockReturnValue({
        getActiveEndpoints: vi.fn().mockReturnValue(['ollama_chat']),
        isEmbeddingModel: vi.fn().mockReturnValue(false),
      }),
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

  describe('circuit-breaker-controller (admin CB routes)', () => {
    describe('getBreakerDetails', () => {
      it('returns StateProjection with 14+ fields', () => {
        mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

        getBreakerDetails(mockReq as Request, mockRes as Response);

        expect(mockRes.json).toHaveBeenCalled();
        const response = (mockRes.json as any).mock.calls[0][0];

        expect(response).toHaveProperty('serverId', 'server-1');
        expect(response).toHaveProperty('model', 'llama3:latest');
        expect(response).toHaveProperty('endpoint');
        expect(response).toHaveProperty('tupleKey');
        expect(response).toHaveProperty('state');
        expect(response).toHaveProperty('uiState');
        expect(response).toHaveProperty('failureCount');
        expect(response).toHaveProperty('successCount');
        expect(response).toHaveProperty('totalRequestCount');
        expect(response).toHaveProperty('blockedRequestCount');
        expect(response).toHaveProperty('consecutiveSuccesses');
        expect(response).toHaveProperty('lastFailure');
        expect(response).toHaveProperty('lastSuccess');
        expect(response).toHaveProperty('nextRetryAt');
        expect(response).toHaveProperty('errorRate');
        expect(response).toHaveProperty('errorCounts');
        expect(response).toHaveProperty('lbScore');
      });

      it('maps HEALTHY to CLOSED uiState', () => {
        mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

        getBreakerDetails(mockReq as Request, mockRes as Response);

        const response = (mockRes.json as any).mock.calls[0][0];
        expect(response.state).toBe('HEALTHY');
        expect(response.uiState).toBe('CLOSED');
      });

      it('maps UNHEALTHY to OPEN uiState', () => {
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

      it('maps RECOVERING to HALF-OPEN uiState', () => {
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

    describe('resetBreaker', () => {
      it('resets tuple and returns new shape', () => {
        mockProbeOrchestrator.setStateForTesting(
          { serverId: 'server-1', model: 'llama3:latest', endpoint: 'ollama_chat' },
          'UNHEALTHY'
        );
        mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

        resetBreaker(mockReq as Request, mockRes as Response);

        expect(mockRes.json).toHaveBeenCalled();
        const response = (mockRes.json as any).mock.calls[0][0];
        expect(response).toHaveProperty('message');
        expect(response).toHaveProperty('previousState', 'UNHEALTHY');
        expect(response).toHaveProperty('currentState', 'HEALTHY');
        expect(response).toHaveProperty('uiState', 'CLOSED');
      });
    });

    describe('forceOpenBreaker', () => {
      it('forces open and returns new shape', () => {
        mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

        forceOpenBreaker(mockReq as Request, mockRes as Response);

        expect(mockRes.json).toHaveBeenCalled();
        const response = (mockRes.json as any).mock.calls[0][0];
        expect(response).toHaveProperty('success', true);
        expect(response).toHaveProperty('message');
        expect(response).toHaveProperty('currentState', 'UNHEALTHY');
        expect(response).toHaveProperty('uiState', 'OPEN');
      });
    });

    describe('forceCloseBreaker', () => {
      it('forces close and returns new shape', () => {
        mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

        forceCloseBreaker(mockReq as Request, mockRes as Response);

        expect(mockRes.json).toHaveBeenCalled();
        const response = (mockRes.json as any).mock.calls[0][0];
        expect(response).toHaveProperty('success', true);
        expect(response).toHaveProperty('message');
        expect(response).toHaveProperty('currentState', 'HEALTHY');
        expect(response).toHaveProperty('uiState', 'CLOSED');
      });
    });

    describe('forceHalfOpenBreaker', () => {
      it('forces half-open and returns new shape', () => {
        mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

        forceHalfOpenBreaker(mockReq as Request, mockRes as Response);

        expect(mockRes.json).toHaveBeenCalled();
        const response = (mockRes.json as any).mock.calls[0][0];
        expect(response).toHaveProperty('success', true);
        expect(response).toHaveProperty('message');
        expect(response).toHaveProperty('currentState', 'RECOVERING');
        expect(response).toHaveProperty('uiState', 'HALF-OPEN');
      });
    });
  });

  describe('servers-controller CB methods (monitoring + admin CB routes)', () => {
    describe('getCircuitBreakers', () => {
      it('returns circuit breakers list with new shape', () => {
        mockReq.params = {};

        getCircuitBreakers(mockReq as Request, mockRes as Response);

        expect(mockRes.json).toHaveBeenCalled();
        const response = (mockRes.json as any).mock.calls[0][0];
        expect(response).toHaveProperty('success', true);
        expect(response).toHaveProperty('circuitBreakers');
        expect(Array.isArray(response.circuitBreakers)).toBe(true);
      });
    });

    describe('getCircuitBreakerDetails', () => {
      it('returns 404 when no matching tuple exists', () => {
        mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

        getCircuitBreakerDetails(mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(404);
      });
    });

    describe('getServerCircuitBreaker', () => {
      it('returns 404 when no tuples exist', () => {
        mockReq.params = { serverId: 'server-1' };

        getServerCircuitBreaker(mockReq as Request, mockRes as Response);

        expect(mockRes.status).toHaveBeenCalledWith(404);
      });
    });

    describe('resetServerCircuitBreaker', () => {
      it('returns success with reset count of 0 when no tuples exist', () => {
        mockReq.params = { serverId: 'server-1' };

        resetServerCircuitBreaker(mockReq as Request, mockRes as Response);

        expect(mockRes.json).toHaveBeenCalled();
        const response = (mockRes.json as any).mock.calls[0][0];
        expect(response).toHaveProperty('success', true);
        expect(response).toHaveProperty('resetCount', 0);
        expect(response).toHaveProperty('message');
      });
    });

    describe('getServersCircuitBreakers', () => {
      it('returns CBs by server with new shape', () => {
        getServersCircuitBreakers(mockReq as Request, mockRes as Response);

        expect(mockRes.json).toHaveBeenCalled();
        const response = (mockRes.json as any).mock.calls[0][0];
        expect(response).toHaveProperty('success', true);
        expect(response).toHaveProperty('circuitBreakers');
      });
    });

    describe('getCircuitBreakersByModel', () => {
      it('returns CBs by model with new shape', () => {
        getCircuitBreakersByModel(mockReq as Request, mockRes as Response);

        expect(mockRes.json).toHaveBeenCalled();
        const response = (mockRes.json as any).mock.calls[0][0];
        expect(response).toHaveProperty('success', true);
        expect(response).toHaveProperty('models');
      });
    });
  });
});
