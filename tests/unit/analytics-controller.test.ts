/**
 * analytics-controller.test.ts
 * Unit tests for analytics controller endpoints
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { Request, Response } from 'express';

// Mock the orchestrator instance
vi.mock('../../src/orchestrator-instance.js');
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';

// Mock analytics instance
vi.mock('../../src/analytics-instance.js');
import { getAnalyticsEngine } from '../../src/analytics-instance.js';

import {
  getTopModels,
  getServerPerformance,
  getErrorAnalysis,
  getCapacityAnalysis,
  getTrendAnalysis,
  getAnalyticsSummary,
} from '../../src/controllers/analyticsController.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockGetAnalyticsEngine = vi.mocked(getAnalyticsEngine);

describe('Analytics Controller', () => {
  let mockAnalytics: any;
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: Mock;
  let statusMock: Mock;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock analytics engine
    mockAnalytics = {
      getTopModels: vi.fn(),
      getServerPerformance: vi.fn(),
      getErrorAnalysis: vi.fn(),
      getCapacityAnalysis: vi.fn(),
      analyzeTrend: vi.fn(),
      getSummary: vi.fn(),
      updateMetrics: vi.fn(),
    };
    mockGetAnalyticsEngine.mockReturnValue(mockAnalytics);

    // Mock orchestrator instance
    mockOrchestrator = {
      getAllDetailedMetrics: vi.fn(),
      getGlobalMetrics: vi.fn(),
      getQueueStats: vi.fn(),
    };
    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);

    // Mock request and response
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnThis();

    mockReq = {
      params: {},
      body: {},
      query: {},
    };

    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
  });

  describe('getTopModels', () => {
    beforeEach(() => {
      mockReq.query = { limit: '10', timeRange: '24h' };
    });

    it('should return top models successfully with default params', () => {
      const mockTopModels = [
        {
          model: 'llama3:latest',
          requests: 100,
          percentage: 0.5,
          avgLatency: 150,
          errorRate: 0.02,
        },
        {
          model: 'mistral:latest',
          requests: 80,
          percentage: 0.4,
          avgLatency: 200,
          errorRate: 0.01,
        },
      ];
      mockAnalytics.getTopModels.mockReturnValue(mockTopModels);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTopModels(mockReq as Request, mockRes as Response);

      expect(mockGetAnalyticsEngine).toHaveBeenCalledTimes(1);
      expect(mockAnalytics.updateMetrics).toHaveBeenCalledWith(new Map());
      expect(mockAnalytics.getTopModels).toHaveBeenCalledWith(10, '24h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        timeRange: '24h',
        models: [
          {
            model: 'llama3:latest',
            requests: 100,
            percentage: 0.5,
            avgLatency: 150,
            errorRate: 0.02,
          },
          {
            model: 'mistral:latest',
            requests: 80,
            percentage: 0.4,
            avgLatency: 200,
            errorRate: 0.01,
          },
        ],
        count: 2,
      });
    });

    it('should handle custom limit and timeRange', () => {
      mockReq.query = { limit: '5', timeRange: '1h' };
      const mockTopModels = [
        { model: 'test', requests: 50, percentage: 1, avgLatency: 100, errorRate: 0 },
      ];
      mockAnalytics.getTopModels.mockReturnValue(mockTopModels);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTopModels(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.getTopModels).toHaveBeenCalledWith(5, '1h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle invalid limit gracefully', () => {
      mockReq.query = { limit: 'invalid', timeRange: '24h' };
      const mockTopModels = [];
      mockAnalytics.getTopModels.mockReturnValue(mockTopModels);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTopModels(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.getTopModels).toHaveBeenCalledWith(10, '24h'); // defaults to 10
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle errors when getting top models', () => {
      const mockError = new Error('Analytics failed');
      mockAnalytics.getTopModels.mockImplementation(() => {
        throw mockError;
      });
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTopModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get top models',
        details: 'Analytics failed',
      });
    });

    it('should handle non-Error exceptions', () => {
      mockAnalytics.getTopModels.mockImplementation(() => {
        throw 'String error';
      });
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTopModels(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get top models',
        details: 'String error',
      });
    });
  });

  describe('getServerPerformance', () => {
    beforeEach(() => {
      mockReq.query = { timeRange: '1h' };
    });

    it('should return server performance successfully', () => {
      const mockPerformance = [
        {
          id: 'server1',
          requests: 100,
          avgLatency: 150,
          p95Latency: 200,
          p99Latency: 300,
          errorRate: 0.02,
          throughput: 5.5,
          utilization: 0.75,
          score: 85,
        },
      ];
      mockAnalytics.getServerPerformance.mockReturnValue(mockPerformance);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getServerPerformance(mockReq as Request, mockRes as Response);

      expect(mockGetAnalyticsEngine).toHaveBeenCalledTimes(1);
      expect(mockAnalytics.updateMetrics).toHaveBeenCalledWith(new Map());
      expect(mockAnalytics.getServerPerformance).toHaveBeenCalledWith('1h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        timeRange: '1h',
        servers: [
          {
            id: 'server1',
            requests: 100,
            avgLatency: 150,
            p95Latency: 200,
            p99Latency: 300,
            errorRate: 0.02,
            throughput: 5.5,
            utilization: 0.75,
            score: 85,
          },
        ],
        count: 1,
      });
    });

    it('should use default time range when not provided', () => {
      mockReq.query = {};
      const mockPerformance = [];
      mockAnalytics.getServerPerformance.mockReturnValue(mockPerformance);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getServerPerformance(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.getServerPerformance).toHaveBeenCalledWith('1h'); // default
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle custom time range', () => {
      mockReq.query = { timeRange: '24h' };
      const mockPerformance = [];
      mockAnalytics.getServerPerformance.mockReturnValue(mockPerformance);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getServerPerformance(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.getServerPerformance).toHaveBeenCalledWith('24h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle errors when getting server performance', () => {
      const mockError = new Error('Server performance analysis failed');
      mockAnalytics.getServerPerformance.mockImplementation(() => {
        throw mockError;
      });
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getServerPerformance(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get server performance',
        details: 'Server performance analysis failed',
      });
    });

    it('should handle non-Error exceptions', () => {
      mockAnalytics.getServerPerformance.mockImplementation(() => {
        throw 'Performance error';
      });
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getServerPerformance(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get server performance',
        details: 'Performance error',
      });
    });
  });

  describe('getErrorAnalysis', () => {
    beforeEach(() => {
      mockReq.query = { timeRange: '24h', includeRecent: 'true' };
    });

    it('should return error analysis with recent errors included', () => {
      const mockAnalysis = {
        totalErrors: 25,
        byType: { timeout: 10, network: 15 },
        byServer: { server1: 20, server2: 5 },
        byModel: { llama3: 15, mistral: 10 },
        trend: [5, 10, 15, 25],
        recentErrors: [
          {
            timestamp: Date.now(),
            serverId: 'server1',
            model: 'llama3',
            errorType: 'timeout',
            message: 'Request timeout',
          },
        ],
      };
      mockAnalytics.getErrorAnalysis.mockReturnValue(mockAnalysis);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getErrorAnalysis(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.getErrorAnalysis).toHaveBeenCalledWith('24h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        timeRange: '24h',
        totalErrors: 25,
        byType: { timeout: 10, network: 15 },
        byServer: { server1: 20, server2: 5 },
        byModel: { llama3: 15, mistral: 10 },
        trend: [5, 10, 15, 25],
        recentErrors: [
          {
            timestamp: mockAnalysis.recentErrors[0].timestamp,
            serverId: 'server1',
            model: 'llama3',
            errorType: 'timeout',
            message: 'Request timeout',
          },
        ],
      });
    });

    it('should exclude recent errors when includeRecent is false', () => {
      mockReq.query = { timeRange: '24h', includeRecent: 'false' };
      const mockAnalysis = {
        totalErrors: 10,
        byType: {},
        byServer: {},
        byModel: {},
        trend: [],
        recentErrors: [],
      };
      mockAnalytics.getErrorAnalysis.mockReturnValue(mockAnalysis);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getErrorAnalysis(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const jsonCall = jsonMock.mock.calls[0][0];
      expect(jsonCall).not.toHaveProperty('recentErrors');
    });

    it('should use default values for missing query params', () => {
      mockReq.query = {};
      const mockAnalysis = {
        totalErrors: 0,
        byType: {},
        byServer: {},
        byModel: {},
        trend: [],
        recentErrors: [],
      };
      mockAnalytics.getErrorAnalysis.mockReturnValue(mockAnalysis);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getErrorAnalysis(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.getErrorAnalysis).toHaveBeenCalledWith('24h'); // default timeRange
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle errors when getting error analysis', () => {
      const mockError = new Error('Error analysis failed');
      mockAnalytics.getErrorAnalysis.mockImplementation(() => {
        throw mockError;
      });
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getErrorAnalysis(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get error analysis',
        details: 'Error analysis failed',
      });
    });
  });

  describe('getTrendAnalysis', () => {
    beforeEach(() => {
      mockReq.params = { metric: 'latency' };
      mockReq.query = { timeRange: '24h' };
    });

    it('should return trend analysis for latency successfully', () => {
      const mockTrend = {
        direction: 'increasing',
        slope: 0.5,
        confidence: 0.85,
      };
      mockAnalytics.analyzeTrend.mockReturnValue(mockTrend);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTrendAnalysis(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.analyzeTrend).toHaveBeenCalledWith(
        'latency',
        undefined,
        undefined,
        '24h'
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        metric: 'latency',
        analysis: {
          direction: 'increasing',
          slope: 0.5,
          confidence: 0.85,
        },
        timeRange: '24h',
      });
    });

    it('should include serverId and model when provided', () => {
      mockReq.params = { metric: 'errors' };
      mockReq.query = { serverId: 'server1', model: 'llama3', timeRange: '1h' };
      const mockTrend = {
        direction: 'stable',
        slope: 0.1,
        confidence: 0.6,
      };
      mockAnalytics.analyzeTrend.mockReturnValue(mockTrend);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTrendAnalysis(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.analyzeTrend).toHaveBeenCalledWith('errors', 'server1', 'llama3', '1h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        metric: 'errors',
        analysis: {
          direction: 'stable',
          slope: 0.1,
          confidence: 0.6,
        },
        timeRange: '1h',
        serverId: 'server1',
        model: 'llama3',
      });
    });

    it('should accept valid metrics: throughput', () => {
      mockReq.params = { metric: 'throughput' };
      const mockTrend = {
        direction: 'decreasing',
        slope: -0.2,
        confidence: 0.75,
      };
      mockAnalytics.analyzeTrend.mockReturnValue(mockTrend);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTrendAnalysis(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.analyzeTrend).toHaveBeenCalledWith(
        'throughput',
        undefined,
        undefined,
        '24h'
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 for invalid metric', () => {
      mockReq.params = { metric: 'invalid' };

      getTrendAnalysis(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid metric. Must be one of: latency, errors, throughput',
      });
    });

    it('should include only serverId when provided', () => {
      mockReq.params = { metric: 'latency' };
      mockReq.query = { serverId: 'server1', timeRange: '1h' };
      const mockTrend = {
        direction: 'stable',
        slope: 0,
        confidence: 0.8,
      };
      mockAnalytics.analyzeTrend.mockReturnValue(mockTrend);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTrendAnalysis(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.analyzeTrend).toHaveBeenCalledWith(
        'latency',
        'server1',
        undefined,
        '1h'
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        metric: 'latency',
        analysis: {
          direction: 'stable',
          slope: 0,
          confidence: 0.8,
        },
        timeRange: '1h',
        serverId: 'server1',
      });
    });

    it('should include only model when provided', () => {
      mockReq.params = { metric: 'errors' };
      mockReq.query = { model: 'llama3', timeRange: '24h' };
      const mockTrend = {
        direction: 'increasing',
        slope: 0.1,
        confidence: 0.9,
      };
      mockAnalytics.analyzeTrend.mockReturnValue(mockTrend);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTrendAnalysis(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.analyzeTrend).toHaveBeenCalledWith('errors', undefined, 'llama3', '24h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        metric: 'errors',
        analysis: {
          direction: 'increasing',
          slope: 0.1,
          confidence: 0.9,
        },
        timeRange: '24h',
        model: 'llama3',
      });
    });

    it('should handle empty serverId and model', () => {
      mockReq.params = { metric: 'latency' };
      mockReq.query = { serverId: '', model: '', timeRange: '24h' };
      const mockTrend = {
        direction: 'stable',
        slope: 0,
        confidence: 0.5,
      };
      mockAnalytics.analyzeTrend.mockReturnValue(mockTrend);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getTrendAnalysis(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.analyzeTrend).toHaveBeenCalledWith('latency', '', '', '24h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        metric: 'latency',
        analysis: {
          direction: 'stable',
          slope: 0,
          confidence: 0.5,
        },
        timeRange: '24h',
      });
    });
  });

  describe('getCapacityAnalysis', () => {
    beforeEach(() => {
      mockReq.query = { timeRange: '24h' };
    });

    it('should return capacity analysis successfully', () => {
      const mockQueueStats = { currentSize: 5 };
      const mockCapacity = {
        current: { utilization: 0.8, availableSlots: 2 },
        forecast: { nextHour: 0.9, nextDay: 0.7 },
        trends: {
          requestsPerHour: [10, 15, 20],
          saturationLevels: [0.5, 0.7, 0.8],
          timestamps: [1234567890, 1234567900, 1234567910],
        },
        recommendations: ['Scale up server1', 'Add more workers'],
      };
      mockOrchestrator.getQueueStats.mockReturnValue(mockQueueStats);
      mockAnalytics.getCapacityAnalysis.mockReturnValue(mockCapacity);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getCapacityAnalysis(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getQueueStats).toHaveBeenCalledTimes(1);
      expect(mockAnalytics.getCapacityAnalysis).toHaveBeenCalledWith(5, '24h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        current: { utilization: 0.8, availableSlots: 2 },
        forecast: { nextHour: 0.9, nextDay: 0.7 },
        trends: {
          requestsPerHour: [10, 15, 20],
          saturationLevels: [0.5, 0.7, 0.8],
          timestamps: [1234567890, 1234567900, 1234567910],
        },
        recommendations: ['Scale up server1', 'Add more workers'],
      });
    });

    it('should use default time range', () => {
      mockReq.query = {};
      const mockQueueStats = { currentSize: 0 };
      const mockCapacity = {
        current: {},
        forecast: {},
        trends: { requestsPerHour: [], saturationLevels: [], timestamps: [] },
        recommendations: [],
      };
      mockOrchestrator.getQueueStats.mockReturnValue(mockQueueStats);
      mockAnalytics.getCapacityAnalysis.mockReturnValue(mockCapacity);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getCapacityAnalysis(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.getCapacityAnalysis).toHaveBeenCalledWith(0, '24h');
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should handle errors when getting capacity analysis', () => {
      const mockError = new Error('Capacity analysis failed');
      mockAnalytics.getCapacityAnalysis.mockImplementation(() => {
        throw mockError;
      });
      mockOrchestrator.getQueueStats.mockReturnValue({ currentSize: 0 });
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getCapacityAnalysis(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get capacity analysis',
        details: 'Capacity analysis failed',
      });
    });
  });

  describe('getAnalyticsSummary', () => {
    it('should return analytics summary successfully', () => {
      const mockSummary = {
        totalRequests: 1000,
        totalErrors: 25,
        avgLatency: 150,
        topModels: ['llama3', 'mistral'],
      };
      const mockGlobalMetrics = {
        requestsPerSecond: 2.5,
        errorRate: 0.025,
      };
      mockAnalytics.getSummary.mockReturnValue(mockSummary);
      mockOrchestrator.getGlobalMetrics.mockReturnValue(mockGlobalMetrics);
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getAnalyticsSummary(mockReq as Request, mockRes as Response);

      expect(mockAnalytics.getSummary).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.getGlobalMetrics).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        summary: {
          ...mockSummary,
          requestsPerSecond: 2.5,
          errorRate: 0.025,
        },
      });
    });

    it('should handle errors when getting analytics summary', () => {
      const mockError = new Error('Summary retrieval failed');
      mockAnalytics.getSummary.mockImplementation(() => {
        throw mockError;
      });
      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(new Map());

      getAnalyticsSummary(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get analytics summary',
        details: 'Summary retrieval failed',
      });
    });
  });
});
