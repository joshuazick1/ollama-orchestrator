import type { Request, Response } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getErrors,
  getServerErrors,
  getCircuitErrors,
} from '../../src/controllers/error-events-controller.js';
import { getErrorEventStore } from '../../src/storage/error-event-store.js';

vi.mock('../../src/storage/error-event-store.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Error Events Controller', () => {
  let mockStore: any;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockStore = {
      queryErrors: vi.fn(),
    };
    (getErrorEventStore as any).mockReturnValue(mockStore);
    mockReq = { query: {}, params: {} };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getErrors', () => {
    it('should return errors with default limit', async () => {
      const mockErrors = [
        {
          id: 'err-1',
          serverId: 'server-1',
          circuitId: 'server-1:llama3',
          errorType: 'retryable' as const,
          errorMessage: 'timeout',
          timestamp: '2024-01-01T00:00:00Z',
          retryable: true,
          category: 'network' as const,
          severity: 'medium' as const,
          matchedPattern: null,
        },
      ];
      mockStore.queryErrors.mockResolvedValue(mockErrors);

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({});
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        count: 1,
        errors: mockErrors,
      });
    });

    it('should pass parsed query filters to store', async () => {
      mockReq.query = {
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-02T00:00:00Z',
        errorType: 'retryable',
        limit: '50',
      };
      mockStore.queryErrors.mockResolvedValue([]);

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-02T00:00:00Z',
        errorType: 'retryable',
        limit: 50,
      });
    });

    it('should cap limit at 1000', async () => {
      mockReq.query = { limit: '5000' };
      mockStore.queryErrors.mockResolvedValue([]);

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({ limit: 1000 });
    });

    it('should ignore invalid limit values', async () => {
      mockReq.query = { limit: 'not-a-number' };
      mockStore.queryErrors.mockResolvedValue([]);

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({});
    });

    it('should ignore limit of 0 or negative', async () => {
      mockReq.query = { limit: '0' };
      mockStore.queryErrors.mockResolvedValue([]);

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({});
    });

    it('should ignore invalid errorType values', async () => {
      mockReq.query = { errorType: 'invalid_type' };
      mockStore.queryErrors.mockResolvedValue([]);

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({});
    });

    it('should accept valid errorTypes', async () => {
      const validTypes = ['retryable', 'non_retryable', 'transient', 'permanent', 'rate_limited'];
      for (const errorType of validTypes) {
        mockReq.query = { errorType };
        mockStore.queryErrors.mockResolvedValue([]);

        await getErrors(mockReq as Request, mockRes as Response);

        expect(mockStore.queryErrors).toHaveBeenCalledWith({ errorType });
      }
    });

    it('should return 500 on store error', async () => {
      mockStore.queryErrors.mockRejectedValue(new Error('Failed to read file'));

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to retrieve error events',
      });
    });
  });

  describe('getServerErrors', () => {
    it('should return errors for specific server', async () => {
      mockReq.params.serverId = 'server-1';
      mockReq.query = {};

      const mockErrors = [
        {
          id: 'err-1',
          serverId: 'server-1',
          circuitId: 'server-1:llama3',
          errorType: 'retryable' as const,
          errorMessage: 'timeout',
          timestamp: '2024-01-01T00:00:00Z',
          retryable: true,
          category: 'network' as const,
          severity: 'medium' as const,
          matchedPattern: null,
        },
      ];
      mockStore.queryErrors.mockResolvedValue(mockErrors);

      await getServerErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({
        serverId: 'server-1',
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        count: 1,
        errors: mockErrors,
      });
    });

    it('should combine serverId with other filters', async () => {
      mockReq.params.serverId = 'server-1';
      mockReq.query = { errorType: 'permanent', limit: '25' };

      mockStore.queryErrors.mockResolvedValue([]);

      await getServerErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({
        serverId: 'server-1',
        errorType: 'permanent',
        limit: 25,
      });
    });

    it('should return 400 when serverId is missing', async () => {
      mockReq.params.serverId = '';

      await getServerErrors(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Server ID is required',
      });
      expect(mockStore.queryErrors).not.toHaveBeenCalled();
    });

    it('should return 500 on store error', async () => {
      mockReq.params.serverId = 'server-1';
      mockStore.queryErrors.mockRejectedValue(new Error('Disk I/O error'));

      await getServerErrors(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to retrieve server error events',
      });
    });

    it('should handle undefined serverId', async () => {
      mockReq.params.serverId = undefined;

      await getServerErrors(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('getCircuitErrors', () => {
    it('should return errors for specific circuit', async () => {
      mockReq.params.serverId = 'server-1';
      mockReq.params.circuitId = 'llama3';
      mockReq.query = {};

      const mockErrors = [
        {
          id: 'err-1',
          serverId: 'server-1',
          circuitId: 'server-1:llama3',
          errorType: 'permanent' as const,
          errorMessage: 'model not found',
          timestamp: '2024-01-01T00:00:00Z',
          retryable: false,
          category: 'compatibility' as const,
          severity: 'high' as const,
          matchedPattern: 'model.*not found',
        },
      ];
      mockStore.queryErrors.mockResolvedValue(mockErrors);

      await getCircuitErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({
        serverId: 'server-1',
        circuitId: 'llama3',
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        serverId: 'server-1',
        circuitId: 'llama3',
        count: 1,
        errors: mockErrors,
      });
    });

    it('should return 400 when serverId is missing', async () => {
      mockReq.params.serverId = '';
      mockReq.params.circuitId = 'llama3';

      await getCircuitErrors(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Server ID and Circuit ID are required',
      });
    });

    it('should return 400 when circuitId is missing', async () => {
      mockReq.params.serverId = 'server-1';
      mockReq.params.circuitId = '';

      await getCircuitErrors(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Server ID and Circuit ID are required',
      });
    });

    it('should return 400 when both serverId and circuitId are missing', async () => {
      mockReq.params.serverId = '';
      mockReq.params.circuitId = '';

      await getCircuitErrors(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should combine circuit filters with query params', async () => {
      mockReq.params.serverId = 'server-1';
      mockReq.params.circuitId = 'llama3';
      mockReq.query = { errorType: 'transient', startTime: '2024-01-01T00:00:00Z' };

      mockStore.queryErrors.mockResolvedValue([]);

      await getCircuitErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({
        serverId: 'server-1',
        circuitId: 'llama3',
        errorType: 'transient',
        startTime: '2024-01-01T00:00:00Z',
      });
    });

    it('should return 500 on store error', async () => {
      mockReq.params.serverId = 'server-1';
      mockReq.params.circuitId = 'llama3';
      mockStore.queryErrors.mockRejectedValue(new Error('Failed to read file'));

      await getCircuitErrors(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to retrieve circuit error events',
      });
    });

    it('should handle undefined serverId and circuitId', async () => {
      mockReq.params.serverId = undefined;
      mockReq.params.circuitId = undefined;

      await getCircuitErrors(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('parseErrorQueryParams integration', () => {
    it('should handle empty query object', async () => {
      mockReq.query = {};
      mockStore.queryErrors.mockResolvedValue([]);

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({});
    });

    it('should pass through only valid parameters', async () => {
      mockReq.query = {
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-02T00:00:00Z',
        errorType: 'rate_limited',
        limit: '100',
        unknownParam: 'should-be-ignored',
      };
      mockStore.queryErrors.mockResolvedValue([]);

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-02T00:00:00Z',
        errorType: 'rate_limited',
        limit: 100,
      });
    });

    it('should handle numeric strings in query params', async () => {
      mockReq.query = { limit: '1' };
      mockStore.queryErrors.mockResolvedValue([]);

      await getErrors(mockReq as Request, mockRes as Response);

      expect(mockStore.queryErrors).toHaveBeenCalledWith({ limit: 1 });
    });
  });
});
