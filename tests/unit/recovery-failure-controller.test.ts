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

      // Zero is falsy so it falls back to default
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

    it('should return 500 with error message on tracker error', () => {
      mockTracker.getGlobalSummary.mockImplementation(() => {
        throw new Error('Tracker error');
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

    it('should handle missing serverId parameter', () => {
      mockReq.params = {};
      mockTracker.getServerRecoveryStats.mockReturnValue(undefined);

      getServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should handle empty serverId', () => {
      mockReq.params = { serverId: '' };
      mockTracker.getServerRecoveryStats.mockReturnValue(undefined);

      getServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
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

    it('should handle invalid limit by using default', () => {
      mockTracker.getServerFailureHistory.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: 'invalid', offset: '5' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith('server-1', 100, 5);
    });

    it('should handle invalid offset by using default', () => {
      mockTracker.getServerFailureHistory.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: '50', offset: 'invalid' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith('server-1', 50, 0);
    });

    it('should handle negative limit and offset', () => {
      mockTracker.getServerFailureHistory.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: '-10', offset: '-5' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith('server-1', -10, -5);
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

    it('should handle missing serverId', () => {
      mockTracker.getServerFailureHistory.mockReturnValue([]);
      mockReq.params = {};

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith(undefined, 100, 0);
    });

    it('should handle empty history array', () => {
      mockTracker.getServerFailureHistory.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        count: 0,
        limit: 100,
        offset: 0,
        history: [],
      });
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

    it('should handle invalid windowMs by using default', () => {
      const mockAnalysis = { pattern: 'none' };
      mockTracker.analyzeFailurePattern.mockReturnValue(mockAnalysis);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { windowMs: 'invalid' };

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

    it('should handle missing serverId', () => {
      mockTracker.analyzeFailurePattern.mockReturnValue({});
      mockReq.params = {};

      analyzeServerFailures(mockReq as Request, mockRes as Response);

      expect(mockTracker.analyzeFailurePattern).toHaveBeenCalledWith(undefined, 3600000);
    });

    it('should handle empty analysis result', () => {
      mockTracker.analyzeFailurePattern.mockReturnValue({});
      mockReq.params = { serverId: 'server-1' };

      analyzeServerFailures(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        windowMs: 3600000,
      });
    });

    it('should handle null analysis result', () => {
      mockTracker.analyzeFailurePattern.mockReturnValue(null);
      mockReq.params = { serverId: 'server-1' };

      analyzeServerFailures(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        windowMs: 3600000,
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

    it('should return 500 on error', () => {
      mockTracker.analyzeCircuitBreakerImpact.mockImplementation(() => {
        throw new Error('Impact analysis error');
      });
      mockReq.params = { serverId: 'server-1' };

      analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    it('should handle missing serverId', () => {
      mockTracker.analyzeCircuitBreakerImpact.mockReturnValue({});
      mockReq.params = {};

      analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockTracker.analyzeCircuitBreakerImpact).toHaveBeenCalledWith(undefined);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: undefined,
      });
    });

    it('should handle empty impact analysis', () => {
      mockTracker.analyzeCircuitBreakerImpact.mockReturnValue({});
      mockReq.params = { serverId: 'server-1' };

      analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
      });
    });

    it('should handle null impact analysis', () => {
      mockTracker.analyzeCircuitBreakerImpact.mockReturnValue(null);
      mockReq.params = { serverId: 'server-1' };

      analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
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

    it('should use default limit when not provided', () => {
      mockTracker.getCircuitBreakerTransitions.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { model: 'mistral' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        'mistral',
        100
      );
    });

    it('should handle undefined model', () => {
      mockTracker.getCircuitBreakerTransitions.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = {};

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        undefined,
        100
      );
    });

    it('should handle invalid limit by using default', () => {
      mockTracker.getCircuitBreakerTransitions.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: 'invalid' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        undefined,
        100
      );
    });

    it('should return 500 on error', () => {
      mockTracker.getCircuitBreakerTransitions.mockImplementation(() => {
        throw new Error('Transitions error');
      });
      mockReq.params = { serverId: 'server-1' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });

    it('should handle empty transitions array', () => {
      mockTracker.getCircuitBreakerTransitions.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: undefined,
        count: 0,
        transitions: [],
      });
    });

    it('should handle many transitions', () => {
      const manyTransitions = Array.from({ length: 200 }, (_, i) => ({
        from: 'closed',
        to: 'open',
        timestamp: `2024-01-${i + 1}`,
      }));
      mockTracker.getCircuitBreakerTransitions.mockReturnValue(manyTransitions);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: '200' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: undefined,
        count: 200,
        transitions: manyTransitions,
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

    it('should handle single server stats', () => {
      mockTracker.getAllServerStats.mockReturnValue([{ serverId: 'server-1' }]);

      getAllServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 1,
        servers: [{ serverId: 'server-1' }],
      });
    });

    it('should handle many servers', () => {
      const manyStats = Array.from({ length: 100 }, (_, i) => ({ serverId: `server-${i}` }));
      mockTracker.getAllServerStats.mockReturnValue(manyStats);

      getAllServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 100,
        servers: manyStats,
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

    it('should use default limit when not provided', () => {
      mockTracker.getRecentRecords.mockReturnValue([]);
      mockReq.query = {};

      getRecentFailureRecords(mockReq as Request, mockRes as Response);

      expect(mockTracker.getRecentRecords).toHaveBeenCalledWith(100);
    });

    it('should handle invalid limit by using default', () => {
      mockTracker.getRecentRecords.mockReturnValue([]);
      mockReq.query = { limit: 'invalid' };

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

    it('should handle zero limit', () => {
      mockTracker.getRecentRecords.mockReturnValue([]);
      mockReq.query = { limit: '0' };

      getRecentFailureRecords(mockReq as Request, mockRes as Response);

      // Zero is falsy so it falls back to default
      expect(mockTracker.getRecentRecords).toHaveBeenCalledWith(100);
    });

    it('should handle negative limit', () => {
      mockTracker.getRecentRecords.mockReturnValue([]);
      mockReq.query = { limit: '-10' };

      getRecentFailureRecords(mockReq as Request, mockRes as Response);

      expect(mockTracker.getRecentRecords).toHaveBeenCalledWith(-10);
    });

    it('should handle many records', () => {
      const manyRecords = Array.from({ length: 1000 }, (_, i) => ({ error: `error-${i}` }));
      mockTracker.getRecentRecords.mockReturnValue(manyRecords);
      mockReq.query = { limit: '1000' };

      getRecentFailureRecords(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 1000,
        records: manyRecords,
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

    it('should handle missing serverId', () => {
      mockReq.params = {};

      resetServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockTracker.resetServerStats).toHaveBeenCalledWith(undefined);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Recovery failure stats reset for server undefined',
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

    it('should handle empty serverId', () => {
      mockReq.params = { serverId: '' };

      resetServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockTracker.resetServerStats).toHaveBeenCalledWith('');
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

    it('should handle missing serverId', () => {
      mockOrchestrator.resetServerCircuitBreaker.mockReturnValue(false);
      mockReq.params = {};

      resetServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should handle empty serverId', () => {
      mockOrchestrator.resetServerCircuitBreaker.mockReturnValue(false);
      mockReq.params = { serverId: '' };

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
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Circuit breaker not found for server unknown',
      });
    });

    it('should return 404 when breaker is null', () => {
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(null);
      mockReq.params = { serverId: 'unknown' };

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
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

    it('should handle missing serverId', () => {
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(undefined);
      mockReq.params = {};

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should handle empty serverId', () => {
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(undefined);
      mockReq.params = { serverId: '' };

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('should handle breaker with detailed stats', () => {
      const detailedStats = {
        state: 'open',
        failureCount: 5,
        successCount: 10,
        lastFailureTime: '2024-01-01',
        lastFailureReason: 'timeout',
      };
      const mockBreaker = { getStats: vi.fn().mockReturnValue(detailedStats) };
      mockOrchestrator.getServerCircuitBreaker.mockReturnValue(mockBreaker);
      mockReq.params = { serverId: 'server-1' };

      getServerCircuitBreaker(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        serverId: 'server-1',
        stats: detailedStats,
      });
    });
  });

  describe('getServerFailureHistory', () => {
    it('should return failure history with pagination', () => {
      const mockHistory = [
        { timestamp: Date.now(), error: 'timeout', model: 'model-a' },
        { timestamp: Date.now(), error: 'connection refused', model: 'model-b' },
      ];
      mockTracker.getServerFailureHistory.mockReturnValue(mockHistory);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: '10', offset: '0' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith('server-1', 10, 0);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        count: 2,
        limit: 10,
        offset: 0,
        history: mockHistory,
      });
    });

    it('should use default limit and offset when not provided', () => {
      mockTracker.getServerFailureHistory.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith('server-1', 100, 0);
    });

    it('should handle invalid limit by using default', () => {
      mockTracker.getServerFailureHistory.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: 'invalid', offset: '5' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith('server-1', 100, 5);
    });

    it('should handle invalid offset by using default', () => {
      mockTracker.getServerFailureHistory.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: '50', offset: 'invalid' };

      getServerFailureHistory(mockReq as Request, mockRes as Response);

      expect(mockTracker.getServerFailureHistory).toHaveBeenCalledWith('server-1', 50, 0);
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
      const mockAnalysis = {
        totalFailures: 10,
        uniqueErrors: 3,
        mostCommonError: 'timeout',
        failureRate: 0.15,
      };
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
      mockTracker.analyzeFailurePattern.mockReturnValue({});
      mockReq.params = { serverId: 'server-1' };

      analyzeServerFailures(mockReq as Request, mockRes as Response);

      expect(mockTracker.analyzeFailurePattern).toHaveBeenCalledWith('server-1', 3600000);
    });

    it('should handle invalid windowMs by using default', () => {
      mockTracker.analyzeFailurePattern.mockReturnValue({});
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { windowMs: 'invalid' };

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
    it('should return circuit breaker impact analysis', () => {
      const mockAnalysis = {
        totalBlockedRequests: 50,
        downtimeMs: 300000,
        affectedModels: ['model-a', 'model-b'],
      };
      mockTracker.analyzeCircuitBreakerImpact.mockReturnValue(mockAnalysis);
      mockReq.params = { serverId: 'server-1' };

      analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockTracker.analyzeCircuitBreakerImpact).toHaveBeenCalledWith('server-1');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        ...mockAnalysis,
      });
    });

    it('should return 500 on error', () => {
      mockTracker.analyzeCircuitBreakerImpact.mockImplementation(() => {
        throw new Error('Impact analysis error');
      });
      mockReq.params = { serverId: 'server-1' };

      analyzeCircuitBreakerImpact(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('getCircuitBreakerTransitions', () => {
    it('should return circuit breaker transitions', () => {
      const mockTransitions = [
        { from: 'closed', to: 'open', timestamp: Date.now(), reason: 'failure threshold' },
        { from: 'open', to: 'half-open', timestamp: Date.now(), reason: 'timeout' },
      ];
      mockTracker.getCircuitBreakerTransitions.mockReturnValue(mockTransitions);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: '50', model: 'model-a' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        'model-a',
        50
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        model: 'model-a',
        count: 2,
        transitions: mockTransitions,
      });
    });

    it('should use default limit when not provided', () => {
      mockTracker.getCircuitBreakerTransitions.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        undefined,
        100
      );
    });

    it('should handle invalid limit by using default', () => {
      mockTracker.getCircuitBreakerTransitions.mockReturnValue([]);
      mockReq.params = { serverId: 'server-1' };
      mockReq.query = { limit: 'invalid' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockTracker.getCircuitBreakerTransitions).toHaveBeenCalledWith(
        'server-1',
        undefined,
        100
      );
    });

    it('should return 500 on error', () => {
      mockTracker.getCircuitBreakerTransitions.mockImplementation(() => {
        throw new Error('Transitions error');
      });
      mockReq.params = { serverId: 'server-1' };

      getCircuitBreakerTransitions(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    });
  });

  describe('getAllServerRecoveryStats', () => {
    it('should return all server recovery stats', () => {
      const mockStats = [
        { serverId: 'server-1', totalFailures: 10, recoveryAttempts: 5 },
        { serverId: 'server-2', totalFailures: 3, recoveryAttempts: 3 },
      ];
      mockTracker.getAllServerStats.mockReturnValue(mockStats);

      getAllServerRecoveryStats(mockReq as Request, mockRes as Response);

      expect(mockTracker.getAllServerStats).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 2,
        servers: mockStats,
      });
    });

    it('should handle empty stats', () => {
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
      const mockRecords = [
        { serverId: 'server-1', error: 'timeout', timestamp: Date.now() },
        { serverId: 'server-2', error: 'connection refused', timestamp: Date.now() },
      ];
      mockTracker.getRecentRecords.mockReturnValue(mockRecords);
      mockReq.query = { limit: '50' };

      getRecentFailureRecords(mockReq as Request, mockRes as Response);

      expect(mockTracker.getRecentRecords).toHaveBeenCalledWith(50);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 2,
        records: mockRecords,
      });
    });

    it('should use default limit when not provided', () => {
      mockTracker.getRecentRecords.mockReturnValue([]);

      getRecentFailureRecords(mockReq as Request, mockRes as Response);

      expect(mockTracker.getRecentRecords).toHaveBeenCalledWith(100);
    });

    it('should handle invalid limit by using default', () => {
      mockTracker.getRecentRecords.mockReturnValue([]);
      mockReq.query = { limit: 'invalid' };

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
      mockTracker.resetServerStats.mockReturnValue(undefined);
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
});
