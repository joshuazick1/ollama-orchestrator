/**
 * circuit-breaker-controller.test.ts
 * Tests for circuitBreakerController.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

import {
  resetBreaker,
  getBreakerDetails,
} from '../../src/controllers/circuitBreakerController.js';
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';

vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/utils/logger.js');

describe('circuitBreakerController', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockOrchestrator = {
      getServerCircuitBreaker: vi.fn(),
      getModelCircuitBreakerPublic: vi.fn(),
    };

    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);

    mockReq = {
      params: {},
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

  describe('resetBreaker', () => {
    it('should reset a server-level circuit breaker', () => {
      const mockBreaker = {
        getStats: vi.fn().mockReturnValue({ state: 'open' }),
        forceClose: vi.fn(),
      };
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(mockBreaker);

      mockReq.params = { serverId: 'server-1', model: 'server' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getServerCircuitBreaker).toHaveBeenCalledWith('server-1');
      expect(mockBreaker.forceClose).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Circuit breaker manually reset'),
          previousState: 'open',
          currentState: 'closed',
        })
      );
    });

    it('should reset a model-level circuit breaker', () => {
      const mockBreaker = {
        getStats: vi.fn().mockReturnValue({ state: 'half-open' }),
        forceClose: vi.fn(),
      };
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(mockBreaker);

      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getModelCircuitBreakerPublic).toHaveBeenCalledWith('server-1', 'llama3:latest');
      expect(mockBreaker.forceClose).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Circuit breaker manually reset'),
        })
      );
    });

    it('should return 404 when server breaker not found', () => {
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(undefined);

      mockReq.params = { serverId: 'unknown-server', model: 'server' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Circuit breaker not found for unknown-server',
      });
    });

    it('should return 404 when model breaker not found', () => {
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(undefined);

      mockReq.params = { serverId: 'server-1', model: 'nonexistent-model' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Circuit breaker not found for server-1:nonexistent-model',
      });
    });

    it('should handle errors and return 500', () => {
      mockOrchestrator.getServerCircuitBreaker.mockImplementation(() => {
        throw new Error('Internal error');
      });

      mockReq.params = { serverId: 'server-1', model: 'server' };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    it('should decode URI component in model name', () => {
      const mockBreaker = {
        getStats: vi.fn().mockReturnValue({ state: 'open' }),
        forceClose: vi.fn(),
      };
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(mockBreaker);

      mockReq.params = { serverId: 'server-1', model: encodeURIComponent('llama3:latest') };

      resetBreaker(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getModelCircuitBreakerPublic).toHaveBeenCalledWith('server-1', 'llama3:latest');
    });
  });

  describe('getBreakerDetails', () => {
    it('should return details for server-level breaker', () => {
      const mockBreaker = {
        getStats: vi.fn().mockReturnValue({ state: 'closed', failures: 0 }),
      };
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(mockBreaker);

      mockReq.params = { serverId: 'server-1', model: 'server' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        key: 'server-1',
        serverId: 'server-1',
        model: 'server-level',
        stats: { state: 'closed', failures: 0 },
      });
    });

    it('should return details for model-level breaker', () => {
      const mockBreaker = {
        getStats: vi.fn().mockReturnValue({ state: 'open', failures: 5 }),
      };
      mockOrchestrator.getModelCircuitBreakerPublic.mockReturnValue(mockBreaker);

      mockReq.params = { serverId: 'server-1', model: 'llama3:latest' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        key: 'server-1:llama3:latest',
        serverId: 'server-1',
        model: 'llama3:latest',
        stats: { state: 'open', failures: 5 },
      });
    });

    it('should return 404 when breaker not found', () => {
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(undefined);

      mockReq.params = { serverId: 'unknown', model: 'server' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Circuit breaker not found for unknown',
      });
    });

    it('should handle errors and return 500', () => {
      mockOrchestrator.getServerCircuitBreaker.mockImplementation(() => {
        throw new Error('Test error');
      });

      mockReq.params = { serverId: 'server-1', model: 'server' };

      getBreakerDetails(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });
});
