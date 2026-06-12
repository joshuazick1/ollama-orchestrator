/**
 * recovery-failure-controller.test.ts
 * Tests for recoveryFailureController.ts
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/orchestrator/orchestrator-instance.js');
vi.mock('../../src/analytics/recovery-failure-tracker.js');
vi.mock('../../src/recovery-test-coordinator.js');

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
} from '../../src/controllers/recovery-failure-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { getRecoveryTestCoordinator } from '../../src/recovery-test-coordinator.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockGetRecoveryFailureTracker = vi.mocked(getRecoveryFailureTracker);
const mockGetRecoveryTestCoordinator = vi.mocked(getRecoveryTestCoordinator);

describe('recoveryFailureController', () => {
  let mockOrchestrator: any;
  let mockTracker: any;
  let mockCoordinator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      getServerCircuitBreaker: vi.fn(),
      resetServerCircuitBreaker: vi.fn(),
    };
    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);

    mockCoordinator = {
      cancelTest: vi.fn().mockReturnValue(false),
    };
    mockGetRecoveryTestCoordinator.mockReturnValue(mockCoordinator);

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

    it('should handle invalid windowMs by using default', () => {
      mockTracker.getGlobalSummary.mockReturnValue({});
      mockReq.query = { windowMs: 'invalid' };

      getRecoveryFailuresSummary(mockReq as Request, mockRes as Response);

      expect(mockTracker.getGlobalSummary).toHaveBeenCalledWith(86400000);
    });

    it('should handle zero windowMs by using default', () => {
      mockTracker.getGlobalSummary.mockReturnValue({});
      mockReq.query = { windowMs: '0' };

      getRecoveryFailuresSummary(mockReq as Request, mockRes as Response);

      expect(mockTracker.getGlobalSummary).toHaveBeenCalledWith(86400000);
    });

    it('should handle negative windowMs', () => {
      mockTracker.getGlobalSummary.mockReturnValue({});
      mockReq.query = { windowMs: '-1000' };

      getRecoveryFailuresSummary(mockReq as Request, mockRes as Response);

      expect(mockTracker.getGlobalSummary).toHaveBeenCalledWith(-1000);
    });

    it('should return 500 on error', () => {
      mockTracker.getGlobalSummary.mockImplementation(() => {
        throw new Error('Test error');
      });

      getRecoveryFailuresSummary(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
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
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'No recovery data found for server unknown',
      });
    });

    it('should return 404 when server not found (null)', () => {
      mockTracker.getServerRecoveryStats.mockReturnValue(null);
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
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
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

    it('should return 500 on error', () => {
      mockTracker.getServerFailureHistory.mockImplementation(() => {
        throw new Error('History error');
      });
      mockReq.params = { serverId: 'server-1' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
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

    it('should use default windowMs when not provided', () => {
      const mockAnalysis = { pattern: 'none' };
      mockTracker.analyzeFailurePattern.mockReturnValue(mockAnalysis);
      mockReq.params = { serverId: 'server-1' };

      analyzeServerFailures(mockReq as Request, mockRes as Response);

      expect(mockTracker.analyzeFailurePattern).toHaveBeenCalledWith('server-1', 3600000);
    });

    it('should return 500 on error', () => {
      mockTracker.analyzeFailurePattern.mockImplementation(() => {
        throw new Error('Analysis error');
      });
      mockReq.params = { serverId: 'server-1' };

      analyzeServerFailures(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('analyzeCircuitBreakerImpact', () => {
    it('should return circuit breaker impact analysis', async () => {
      const mockAnalysis = { openCount: 3, totalDowntime: 60000, isImpacted: false };
      mockTracker.analyzeCircuitBreakerImpact.mockResolvedValue(mockAnalysis);
      mockReq.params = { serverId: 'server-1' };

      await analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockTracker.analyzeCircuitBreakerImpact).toHaveBeenCalledWith('server-1');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        ...mockAnalysis,
      });
    });

    it('should return 500 on error', async () => {
      mockTracker.analyzeCircuitBreakerImpact.mockRejectedValue(new Error('Impact analysis error'));
      mockReq.params = { serverId: 'server-1' };

      await analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    it('should handle missing serverId', async () => {
      mockTracker.analyzeCircuitBreakerImpact.mockResolvedValue({});
      mockReq.params = {};

      await analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockTracker.analyzeCircuitBreakerImpact).toHaveBeenCalledWith(undefined);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: undefined,
      });
    });

    it('should handle empty impact analysis', async () => {
      mockTracker.analyzeCircuitBreakerImpact.mockResolvedValue({});
      mockReq.params = { serverId: 'server-1' };

      await analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
      });
    });
  });

  describe('getCircuitBreakerTransitions', () => {
    it('should return circuit breaker transitions', async () => {
      const mockTransitions = [
        {
          timestamp: 1000,
          serverId: 'server-1',
          model: 'llama3',
          previousState: 'closed',
          newState: 'open',
          reason: 'failure',
        },
        {
          timestamp: 2000,
          serverId: 'server-1',
          model: 'llama3',
          previousState: 'open',
          newState: 'half-open',
          reason: 'retry',
        },
      ];
      mockTracker.getCircuitBreakerTransitions.mockResolvedValue(mockTransitions);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: '50', model: 'llama3' };

      await getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        'llama3',
        50
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: 'llama3',
        count: 2,
        transitions: mockTransitions,
      });
    });

    it('should return transitions in chronological order', async () => {
      const chronologicalTransitions = [
        {
          timestamp: 1000,
          serverId: 'server-1',
          model: 'llama3',
          previousState: 'closed',
          newState: 'open',
          reason: 'failure',
        },
        {
          timestamp: 2000,
          serverId: 'server-1',
          model: 'llama3',
          previousState: 'open',
          newState: 'half-open',
          reason: 'retry',
        },
        {
          timestamp: 3000,
          serverId: 'server-1',
          model: 'llama3',
          previousState: 'half-open',
          newState: 'closed',
          reason: 'success',
        },
      ];
      mockTracker.getCircuitBreakerTransitions.mockResolvedValue(chronologicalTransitions);
      mockReq.params = { serverId: 'server-1' };

      await getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      const result = mockRes.json.mock.calls[0][0];
      expect(result.transitions[0].timestamp).toBe(1000);
      expect(result.transitions[1].timestamp).toBe(2000);
      expect(result.transitions[2].timestamp).toBe(3000);
    });

    it('should filter by model when provided', async () => {
      const mockTransitions = [
        {
          timestamp: 1000,
          serverId: 'server-1',
          model: 'mistral',
          previousState: 'closed',
          newState: 'open',
          reason: 'failure',
        },
      ];
      mockTracker.getCircuitBreakerTransitions.mockResolvedValue(mockTransitions);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { model: 'mistral' };

      await getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        'mistral',
        100
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: 'mistral',
        count: 1,
        transitions: mockTransitions,
      });
    });

    it('should use default limit when not provided', async () => {
      mockTracker.getCircuitBreakerTransitions.mockResolvedValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      await getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        undefined,
        100
      );
    });

    it('should return 500 on error', async () => {
      mockTracker.getCircuitBreakerTransitions.mockRejectedValue(new Error('Transitions error'));
      mockReq.params = { serverId: 'server-1' };

      await getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    it('should handle empty transitions array', async () => {
      mockTracker.getCircuitBreakerTransitions.mockResolvedValue([]);
      mockReq.params = { serverId: 'server-1' };

      await getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: undefined,
        count: 0,
        transitions: [],
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

    it('should handle empty stats array', () => {
      mockTracker.getAllServerStats.mockReturnValue([]);

      getAllServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 0,
        servers: [],
      });
    });

    it('should return 500 on error', () => {
      mockTracker.getAllServerStats.mockImplementation(() => {
        throw new Error('Stats error');
      });

      getAllServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
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

    it('should use default limit when not provided', () => {
      mockTracker.getRecentRecords.mockReturnValue([]);
      mockReq.query = {};

      getRecentFailureRecords(mockReq as Request, mockRes as Response);

      expect(mockTracker.getRecentRecords).toHaveBeenCalledWith(100);
    });

    it('should return 500 on error', () => {
      mockTracker.getRecentRecords.mockImplementation(() => {
        throw new Error('Records error');
      });

      getRecentFailureRecords(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
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

    it('should return 500 on error', () => {
      mockTracker.resetServerStats.mockImplementation(() => {
        throw new Error('Reset error');
      });
      mockReq.params = { serverId: 'server-1' };

      resetServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('resetServerCircuitBreaker', () => {
    it('should reset server circuit breaker', () => {
      mockOrchestrator.resetServerCircuitBreaker.mockReturnValue(true);
      mockReq.params = { serverId: 'server-1' };

      resetServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.resetServerCircuitBreaker).toHaveBeenCalledWith('server-1');
      expect(mockCoordinator.cancelTest).toHaveBeenCalledWith('server-1');
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Circuit breaker reset for server server-1',
        currentState: 'closed',
        testCancelled: false,
      });
    });

    it('should return 404 when breaker not found', () => {
      mockOrchestrator.resetServerCircuitBreaker.mockReturnValue(false);
      mockReq.params = { serverId: 'unknown' };

      resetServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Circuit breaker not found for server unknown',
      });
    });

    it('should return 500 on error', () => {
      mockOrchestrator.resetServerCircuitBreaker.mockImplementation(() => {
        throw new Error('Reset error');
      });
      mockReq.params = { serverId: 'server-1' };

      resetServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
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
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Circuit breaker not found for server unknown',
      });
    });

    it('should return 500 on error', () => {
      mockOrchestrator.getServerCircuitBreaker.mockImplementation(() => {
        throw new Error('Breaker error');
      });
      mockReq.params = { serverId: 'server-1' };

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });
});
