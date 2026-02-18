/**
 * metrics-controller.test.ts
 * Tests for metricsController.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';

// Mock the orchestrator instance
vi.mock('../../src/orchestrator-instance.js');
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';

// Mock PrometheusExporter
vi.mock('../../src/metrics/prometheus-exporter.js');
import { PrometheusExporter } from '../../src/metrics/prometheus-exporter.js';

const mockPrometheusExporter = vi.mocked(PrometheusExporter);

// Import the controller functions after mocking
import {
  getMetrics,
  getServerModelMetrics,
  getPrometheusMetrics,
} from '../../src/controllers/metricsController.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);

describe('metricsController', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock orchestrator instance
    mockOrchestrator = {
      exportMetrics: vi.fn(),
      getDetailedMetrics: vi.fn(),
      getAllDetailedMetrics: vi.fn(),
      getGlobalMetrics: vi.fn(),
    };
    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);

    // Mock request and response
    mockReq = {
      params: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      send: vi.fn(),
    };
  });

  describe('getMetrics', () => {
    it('should return comprehensive metrics successfully', () => {
      const mockMetrics = {
        timestamp: 1234567890,
        global: { totalRequests: 100, totalErrors: 5 },
        servers: { server1: { models: {} } },
      };
      mockOrchestrator.exportMetrics.mockReturnValue(mockMetrics);

      getMetrics(mockReq as Request, mockRes as Response);

      expect(mockGetOrchestratorInstance).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.exportMetrics).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        timestamp: mockMetrics.timestamp,
        global: mockMetrics.global,
        servers: mockMetrics.servers,
      });
    });

    it('should handle errors when getting metrics', () => {
      const mockError = new Error('Metrics export failed');
      mockOrchestrator.exportMetrics.mockImplementation(() => {
        throw mockError;
      });

      getMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get metrics',
        details: 'Metrics export failed',
      });
    });

    it('should handle non-Error exceptions', () => {
      mockOrchestrator.exportMetrics.mockImplementation(() => {
        throw 'String error';
      });

      getMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get metrics',
        details: 'String error',
      });
    });
  });

  describe('getServerModelMetrics', () => {
    beforeEach(() => {
      mockReq.params = { serverId: 'server1', model: 'llama3:latest' };
    });

    it('should return detailed metrics for server:model successfully', () => {
      const mockDetailedMetrics = {
        inFlight: 2,
        queued: 1,
        windows: { '1m': { avgLatency: 150, count: 10 } },
        percentiles: { p50: 120, p95: 200, p99: 300 },
        successRate: 0.95,
        throughput: 5.2,
        avgTokensPerRequest: 150,
      };
      mockOrchestrator.getDetailedMetrics.mockReturnValue(mockDetailedMetrics);

      getServerModelMetrics(mockReq as Request, mockRes as Response);

      expect(mockGetOrchestratorInstance).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.getDetailedMetrics).toHaveBeenCalledWith('server1', 'llama3:latest');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server1',
        model: 'llama3:latest',
        metrics: {
          realtime: {
            inFlight: 2,
            queued: 1,
          },
          historical: mockDetailedMetrics.windows,
          percentiles: mockDetailedMetrics.percentiles,
          derived: {
            successRate: 0.95,
            throughput: 5.2,
            avgTokensPerRequest: 150,
          },
        },
      });
    });

    it('should return 404 when no metrics found for server:model', () => {
      mockOrchestrator.getDetailedMetrics.mockReturnValue(null);

      getServerModelMetrics(mockReq as Request, mockRes as Response);

      expect(mockOrchestrator.getDetailedMetrics).toHaveBeenCalledWith('server1', 'llama3:latest');
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "No metrics found for server 'server1' and model 'llama3:latest'",
      });
    });

    it('should handle errors when getting detailed metrics', () => {
      const mockError = new Error('Detailed metrics retrieval failed');
      mockOrchestrator.getDetailedMetrics.mockImplementation(() => {
        throw mockError;
      });

      getServerModelMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get metrics',
        details: 'Detailed metrics retrieval failed',
      });
    });
  });

  describe('getPrometheusMetrics', () => {
    it('should return Prometheus-formatted metrics successfully', () => {
      const mockAllMetrics = new Map([['server1:llama3:latest', {}]]);
      const mockGlobalMetrics = { totalRequests: 100, totalErrors: 5 };

      mockOrchestrator.getAllDetailedMetrics.mockReturnValue(mockAllMetrics);
      mockOrchestrator.getGlobalMetrics.mockReturnValue(mockGlobalMetrics);

      getPrometheusMetrics(mockReq as Request, mockRes as Response);

      expect(mockGetOrchestratorInstance).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.getAllDetailedMetrics).toHaveBeenCalledTimes(1);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalled();
    });

    it('should handle errors when exporting Prometheus metrics', () => {
      const mockError = new Error('Prometheus export failed');
      mockOrchestrator.getAllDetailedMetrics.mockImplementation(() => {
        throw mockError;
      });

      getPrometheusMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to export metrics',
        details: 'Prometheus export failed',
      });
    });
  });
});
