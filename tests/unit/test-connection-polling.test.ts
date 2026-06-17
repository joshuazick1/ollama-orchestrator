import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/orchestrator/test-store-instance.js', () => ({
  getTestStore: vi.fn(),
}));

import { getTestResult } from '../../../src/controllers/servers-controller.js';
import { getTestStore } from '../../src/orchestrator/test-store-instance.js';

describe('getTestResult', () => {
  let mockTestStore: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockTestStore = {
      get: vi.fn(),
    };
    (getTestStore as any).mockReturnValue(mockTestStore);

    mockReq = {
      params: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  it('returns 400 when testId is missing', () => {
    mockReq.params = {};

    getTestResult(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'testId is required',
    });
  });

  it('returns 404 when testId not found in store', () => {
    mockTestStore.get.mockReturnValue(undefined);
    mockReq.params = { testId: 'non-existent-id' };

    getTestResult(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'Test not found or expired',
    });
  });

  it('returns 404 for expired testId', () => {
    mockTestStore.get.mockReturnValue(undefined);
    mockReq.params = { testId: 'expired-test-id' };

    getTestResult(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'Test not found or expired',
    });
  });

  it('returns running test with progress', () => {
    const runningEntry = {
      testId: 'test-123',
      status: 'running' as const,
      progress: 50,
      startedAt: Date.now() - 5000,
      expiresAt: Date.now() + 5 * 60 * 1000,
      result: undefined,
      error: undefined,
    };
    mockTestStore.get.mockReturnValue(runningEntry);
    mockReq.params = { testId: 'test-123' };

    getTestResult(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: true,
      testId: 'test-123',
      status: 'running',
      progress: 50,
      startedAt: runningEntry.startedAt,
      result: undefined,
      error: undefined,
    });
  });

  it('returns completed test with result', () => {
    const completedEntry = {
      testId: 'test-456',
      status: 'completed' as const,
      progress: 100,
      startedAt: Date.now() - 10000,
      expiresAt: Date.now() + 5 * 60 * 1000,
      result: {
        reachable: true,
        status: 'success' as const,
        progress: 100,
        capabilities: {
          supportsOllama: true,
          supportsV1: true,
          supportsAnthropic: true,
          canListModels: true,
        },
        models: {
          ollama: ['llama3:8b'],
          openai: [],
          merged: ['llama3:8b'],
        },
        needsCustomModelList: false,
        suggestedConfig: {
          maxConcurrency: 4,
          requestTimeoutMs: 30000,
          supportsStreaming: true,
        },
        errors: [],
        durationMs: 500,
      },
      error: undefined,
    };
    mockTestStore.get.mockReturnValue(completedEntry);
    mockReq.params = { testId: 'test-456' };

    getTestResult(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: true,
      testId: 'test-456',
      status: 'completed',
      progress: 100,
      startedAt: completedEntry.startedAt,
      result: completedEntry.result,
      error: undefined,
    });
  });

  it('returns failed test with error', () => {
    const failedEntry = {
      testId: 'test-789',
      status: 'failed' as const,
      progress: 0,
      startedAt: Date.now() - 3000,
      expiresAt: Date.now() + 5 * 60 * 1000,
      result: undefined,
      error: 'Connection refused',
    };
    mockTestStore.get.mockReturnValue(failedEntry);
    mockReq.params = { testId: 'test-789' };

    getTestResult(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: true,
      testId: 'test-789',
      status: 'failed',
      progress: 0,
      startedAt: failedEntry.startedAt,
      result: undefined,
      error: 'Connection refused',
    });
  });
});
