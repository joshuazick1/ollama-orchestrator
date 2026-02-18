/**
 * queue-controller.test.ts
 * Tests for queueController.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

// Mock the orchestrator instance
vi.mock('../../src/orchestrator-instance.js');
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';

// Import the controller functions after mocking
import {
  getQueueStatus,
  pauseQueue,
  resumeQueue,
  drainServer,
} from '../../src/controllers/queueController.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);

describe('queueController', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock orchestrator instance
    mockOrchestrator = {
      getQueueStats: vi.fn(),
      getQueueItems: vi.fn().mockReturnValue([]),
      getInFlightByServer: vi.fn().mockReturnValue({}),
      pauseQueue: vi.fn(),
      resumeQueue: vi.fn(),
      drain: vi.fn(),
    };
    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);

    // Mock request and response
    mockReq = {
      query: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  describe('getQueueStatus', () => {
    it('should return queue stats successfully', () => {
      const mockStats = { pending: 5, processing: 2, completed: 10 };
      mockOrchestrator.getQueueStats.mockReturnValue(mockStats);
      mockOrchestrator.getQueueItems.mockReturnValue([]);
      mockOrchestrator.getInFlightByServer.mockReturnValue({});

      getQueueStatus(mockReq as Request, mockRes as Response);

      expect(mockGetOrchestratorInstance).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.getQueueStats).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          queue: expect.objectContaining(mockStats),
        })
      );
    });

    it('should handle errors when getting queue status', () => {
      const mockError = new Error('Database connection failed');
      mockOrchestrator.getQueueStats.mockImplementation(() => {
        throw mockError;
      });

      getQueueStatus(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get queue status',
        details: 'Database connection failed',
      });
    });

    it('should handle non-Error exceptions', () => {
      mockOrchestrator.getQueueStats.mockImplementation(() => {
        throw 'String error';
      });

      getQueueStatus(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to get queue status',
        details: 'String error',
      });
    });
  });

  describe('pauseQueue', () => {
    it('should pause queue successfully', () => {
      pauseQueue(mockReq as Request, mockRes as Response);

      expect(mockGetOrchestratorInstance).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.pauseQueue).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        paused: true,
      });
    });

    it('should handle errors when pausing queue', () => {
      const mockError = new Error('Queue pause failed');
      mockOrchestrator.pauseQueue.mockImplementation(() => {
        throw mockError;
      });

      pauseQueue(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to pause queue',
        details: 'Queue pause failed',
      });
    });
  });

  describe('resumeQueue', () => {
    it('should resume queue successfully', () => {
      resumeQueue(mockReq as Request, mockRes as Response);

      expect(mockGetOrchestratorInstance).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.resumeQueue).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        paused: false,
      });
    });

    it('should handle errors when resuming queue', () => {
      const mockError = new Error('Queue resume failed');
      mockOrchestrator.resumeQueue.mockImplementation(() => {
        throw mockError;
      });

      resumeQueue(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to resume queue',
        details: 'Queue resume failed',
      });
    });
  });

  describe('drainServer', () => {
    beforeEach(() => {
      // Mock setTimeout for async drain
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start drain successfully with default timeout', async () => {
      mockOrchestrator.drain.mockResolvedValue(true);

      await drainServer(mockReq as Request, mockRes as Response);

      // Should respond immediately
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Draining started',
        timeout: 30000,
      });

      // Wait for drain to complete
      expect(mockGetOrchestratorInstance).toHaveBeenCalledTimes(1);
      expect(mockOrchestrator.drain).toHaveBeenCalledWith(30000);
    });

    it('should start drain successfully with custom timeout', async () => {
      mockReq.query = { timeout: '45000' };
      mockOrchestrator.drain.mockResolvedValue(true);

      await drainServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: 'Draining started',
        timeout: 45000,
      });

      expect(mockOrchestrator.drain).toHaveBeenCalledWith(45000);
    });

    it('should handle drain timeout', async () => {
      mockOrchestrator.drain.mockResolvedValue(false);

      await drainServer(mockReq as Request, mockRes as Response);

      // Should still respond with success, but drain returns false (timeout)
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockOrchestrator.drain).toHaveBeenCalledWith(30000);
    });

    it('should handle errors when draining server', async () => {
      const mockError = new Error('Drain failed');
      mockOrchestrator.drain.mockRejectedValue(mockError);

      await drainServer(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to drain server',
        details: 'Drain failed',
      });
    });

    it('should parse timeout as integer', async () => {
      mockReq.query = { timeout: 'invalid' };
      mockOrchestrator.drain.mockResolvedValue(true);

      const drainPromise = drainServer(mockReq as Request, mockRes as Response);

      await drainPromise;

      // Should use default timeout when parsing fails
      expect(mockOrchestrator.drain).toHaveBeenCalledWith(30000);
    });
  });
});
