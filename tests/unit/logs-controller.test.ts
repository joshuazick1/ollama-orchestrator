/**
 * logs-controller.test.ts
 * Tests for logsController.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

import { getLogs, clearLogs } from '../../src/controllers/logsController.js';
import { logger } from '../../src/utils/logger.js';

vi.mock('../../src/utils/logger.js');

describe('logsController', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockReq = {
      query: {},
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

  describe('getLogs', () => {
    it('should return all logs without filters', () => {
      const mockLogData = [
        { level: 'INFO', message: 'Test log 1', timestamp: '2024-01-01T00:00:00Z' },
        { level: 'ERROR', message: 'Test log 2', timestamp: '2024-01-01T00:01:00Z' },
      ];
      (logger.getLogs as any).mockReturnValue(mockLogData);

      getLogs(mockReq as Request, mockRes as Response);

      expect(logger.getLogs).toHaveBeenCalledWith(undefined);
      expect(mockRes.json).toHaveBeenCalledWith({
        logs: mockLogData,
        count: 2,
        total: 2,
      });
    });

    it('should filter logs by limit', () => {
      (logger.getLogs as any).mockReturnValue([]);
      mockReq.query = { limit: '1' };

      getLogs(mockReq as Request, mockRes as Response);

      expect(logger.getLogs).toHaveBeenCalledWith(1);
    });

    it('should filter logs by level', () => {
      const mockLogData = [
        { level: 'INFO', message: 'Test log 1', timestamp: '2024-01-01T00:00:00Z' },
      ];
      (logger.getLogs as any).mockReturnValue(mockLogData);
      mockReq.query = { level: 'INFO' };

      getLogs(mockReq as Request, mockRes as Response);

      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.logs.every((log: any) => log.level === 'INFO')).toBe(true);
    });

    it('should filter logs by since timestamp', () => {
      const mockLogData = [
        { level: 'INFO', message: 'Test log 1', timestamp: '2024-01-02T00:00:00Z' },
      ];
      (logger.getLogs as any).mockReturnValue(mockLogData);
      mockReq.query = { since: '2024-01-01T00:00:00Z' };

      getLogs(mockReq as Request, mockRes as Response);

      const jsonCall = (mockRes.json as any).mock.calls[0][0];
      expect(jsonCall.logs.length).toBe(1);
    });

    it('should combine multiple filters', () => {
      (logger.getLogs as any).mockReturnValue([]);
      mockReq.query = { limit: '10', level: 'INFO', since: '2024-01-01T00:00:00Z' };

      getLogs(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should return 500 on error', () => {
      (logger.getLogs as any).mockImplementation(() => {
        throw new Error('Test error');
      });

      getLogs(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to retrieve logs' });
    });
  });

  describe('clearLogs', () => {
    it('should clear all logs successfully', () => {
      clearLogs(mockReq as Request, mockRes as Response);

      expect(logger.clearLogs).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({ message: 'Logs cleared' });
    });

    it('should return 500 on error', () => {
      (logger.clearLogs as any).mockImplementation(() => {
        throw new Error('Test error');
      });

      clearLogs(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to clear logs' });
    });
  });
});
