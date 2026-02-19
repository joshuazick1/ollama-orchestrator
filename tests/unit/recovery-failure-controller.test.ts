/**
 * recovery-failure-controller.test.ts
 * Tests for recoveryFailureController.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/analytics/recovery-failure-tracker.js');

import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import { getRecoveryFailureTracker } from '../../src/analytics/recovery-failure-tracker.js';

import {
  getRecoveryFailuresSummary,
  getServerRecoveryStats,
  getServerFailureHistory,
  analyzeServerFailures,
  analyzeCircuitBreakerImpact,
  getCircuitBreakerTransitions,
  getAllServerRecoveryStats,
  getRecentFailureRecords,
  resetServerRecoveryStats,
  resetServerCircuitBreaker,
  getServerCircuitBreaker,
} from '../../src/controllers/recoveryFailureController.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockGetRecoveryFailureTracker = vi.mocked(getRecoveryFailureTracker);

describe('recoveryFailureController', () => {
  let mockOrchestrator: any;
  let mockTracker: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      getServerCircuitBreaker: vi.fn(),
      resetServerCircuitBreaker: vi.fn(),
    };
    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);

    mockTracker = {
      getGlobalSummary: vi.fn(),
      getServerRecoveryStats: vi.fn(),
      getServerFailureHistory: vi.fn(),
      analyzeFailurePattern: vi.fn(),
      analyzeCircuitBreakerImpact: vi.fn(),
      getCircuitBreakerTransitions: vi.fn(),
      getAllServerStats: vi.fn(),
      getRecentRecords: vi.fn(),
      resetServerStats: vi.fn(),
    };
    mockGetRecoveryFailureTracker.mockReturnValue(mockTracker);

    mockReq = {
      params: {},
      query: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  describe('getRecoveryFailuresSummary', () => {
    it('should return recovery failures summary', () => {
      const mockSummary = { totalFailures: 10, servers: 2 };
      mockTracker.getGlobalSummary.mockReturnValue(mockSummary);
      mockReq.query = { windowMs: '86400000' };

      getRecoveryFailuresSummary(mockReq as Request, mockRes as Response);

      expect(mockTracker.getGlobalSummary).toHaveBeenCalledWith(86400000);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, ...mockSummary });
    });

    it('should use default windowMs when not provided', () => {
      mockTracker.getGlobalSummary.mockReturnValue({});

      getRecoveryFailuresSummary(mockReq as Request, mockRes as Response);

      expect(mockTracker.getGlobalSummary).toHaveBeenCalledWith(86400000);
    });

    it('should return 500 on error', () => {
      mockTracker.getGlobalSummary.mockImplementation(() => {
        throw new Error('Test error');
      });

      getRecoveryFailuresSummary(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getServerRecoveryStats', () => {
    it('should return server recovery stats', () => {
      const mockStats = { serverId: 'server-1', failures: 5 };
      mockTracker.getServerRecoveryStats.mockReturnValue(mockStats);
      mockReq.params = { serverId: 'server-1' };

      getServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({ success: true, ...mockStats });
    });

    it('should return 404 when server not found', () => {
      mockTracker.getServerRecoveryStats.mockReturnValue(undefined);
      mockReq.params = { serverId: 'unknown' };

      getServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should return 500 on error', () => {
      mockTracker.getServerRecoveryStats.mockImplementation(() => {
        throw new Error('Test error');
      });

      getServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getServerFailureHistory', () => {
    it('should return failure history with pagination', () => {
      const mockHistory = [{ timestamp: '2024-01-01', error: 'timeout' }];
      mockTracker.getServerFailureHistory.mockReturnValue(mockHistory);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: '10', offset: '0' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith('server-1', 10, 0);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        count: 1,
        limit: 10,
        offset: 0,
        history: mockHistory,
      });
    });

    it('should use default pagination values', () => {
      mockTracker.getServerFailureHistory.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith('server-1', 100, 0);
    });
  });

  describe('analyzeServerFailures', () => {
    it('should return failure analysis', () => {
      const mockAnalysis = { pattern: 'recurring', interval: 60000 };
      mockTracker.analyzeFailurePattern.mockReturnValue(mockAnalysis);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { windowMs: '3600000' };

      analyzeServerFailures(mockReq as Request, mockRes as Response);

      expect(mockTracker.analyzeFailurePattern).toHaveBeenCalledWith('server-1', 3600000);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        windowMs: 3600000,
        ...mockAnalysis,
      });
    });
  });

  describe('analyzeCircuitBreakerImpact', () => {
    it('should return circuit breaker impact analysis', () => {
      const mockAnalysis = { openCount: 3, totalDowntime: 60000 };
      mockTracker.analyzeCircuitBreakerImpact.mockReturnValue(mockAnalysis);
      mockReq.params = { serverId: 'server-1' };

      analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        ...mockAnalysis,
      });
    });
  });

  describe('getCircuitBreakerTransitions', () => {
    it('should return circuit breaker transitions', () => {
      const mockTransitions = [{ from: 'closed', to: 'open', timestamp: '2024-01-01' }];
      mockTracker.getCircuitBreakerTransitions.mockReturnValue(mockTransitions);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: '50', model: 'llama3' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        'llama3',
        50
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: 'llama3',
        count: 1,
        transitions: mockTransitions,
      });
    });
  });

  describe('getAllServerRecoveryStats', () => {
    it('should return all server recovery stats', () => {
      const mockStats = [{ serverId: 'server-1' }, { serverId: 'server-2' }];
      mockTracker.getAllServerStats.mockReturnValue(mockStats);

      getAllServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 2,
        servers: mockStats,
      });
    });
  });

  describe('getRecentFailureRecords', () => {
    it('should return recent failure records', () => {
      const mockRecords = [{ error: 'timeout' }];
      mockTracker.getRecentRecords.mockReturnValue(mockRecords);
      mockReq.query = { limit: '50' };

      getRecentFailureRecords(mockReq as Request, mockRes as Response);

      expect(mockTracker.getRecentRecords).toHaveBeenCalledWith(50);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 1,
        records: mockRecords,
      });
    });
  });

  describe('resetServerRecoveryStats', () => {
    it('should reset server recovery stats', () => {
      mockReq.params = { serverId: 'server-1' };

      resetServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockTracker.resetServerStats).toHaveBeenCalledWith('server-1');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Recovery failure stats reset for server server-1',
      });
    });
  });

  describe('resetServerCircuitBreaker', () => {
    it('should reset server circuit breaker', () => {
      mockOrchestrator.resetServerCircuitBreaker.mockReturnValue(true);
      mockReq.params = { serverId: 'server-1' };

      resetServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.resetServerCircuitBreaker).toHaveBeenCalledWith('server-1');
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Circuit breaker reset for server server-1',
        currentState: 'closed',
      });
    });

    it('should return 404 when breaker not found', () => {
      mockOrchestrator.resetServerCircuitBreaker.mockReturnValue(false);
      mockReq.params = { serverId: 'unknown' };

      resetServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  describe('getServerCircuitBreaker', () => {
    it('should return server circuit breaker details', () => {
      const mockBreaker = { getStats: vi.fn().mockReturnValue({ state: 'closed' }) };
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(mockBreaker);
      mockReq.params = { serverId: 'server-1' };

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        serverId: 'server-1',
        stats: { state: 'closed' },
      });
    });

    it('should return 404 when breaker not found', () => {
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(undefined);
      mockReq.params = { serverId: 'unknown' };

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });
});
