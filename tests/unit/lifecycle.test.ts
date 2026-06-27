import type { Request } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { lifecycle } from '../../src/utils/lifecycle.js';
import { logger } from '../../src/utils/logger.js';

describe('lifecycle', () => {
  let mockReq: Partial<Request>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockReq = {
      requestId: 'test-req-id',
      path: '/api/generate',
      method: 'POST',
    };
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.LOG_LEVEL = 'debug';
    process.env.DISABLE_FILE_LOGGING = 'true';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_LEVEL;
    delete process.env.DEBUG;
    delete process.env.DISABLE_FILE_LOGGING;
  });

  it('lifecycle.received emits LIFECYCLE_RECEIVED at info with requestId', () => {
    lifecycle.received(mockReq as Request, {
      endpoint: '/api/generate',
      method: 'POST',
      model: 'llama2',
      stream: true,
    });
    expect(infoSpy).toHaveBeenCalledWith(
      'LIFECYCLE_RECEIVED',
      expect.objectContaining({
        requestId: 'test-req-id',
        endpoint: '/api/generate',
        model: 'llama2',
        stream: true,
      })
    );
  });

  it('lifecycle.validated emits LIFECYCLE_VALIDATED at info with requestId', () => {
    lifecycle.validated(mockReq as Request, { schemaFields: ['model', 'prompt'] });
    expect(infoSpy).toHaveBeenCalledWith(
      'LIFECYCLE_VALIDATED',
      expect.objectContaining({
        requestId: 'test-req-id',
        schemaFields: ['model', 'prompt'],
      })
    );
  });

  it('lifecycle.validationFailed emits LIFECYCLE_VALIDATION_FAILED at warn', () => {
    lifecycle.validationFailed(mockReq as Request, {
      field: 'model',
      reason: 'required',
      value: undefined,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'LIFECYCLE_VALIDATION_FAILED',
      expect.objectContaining({
        requestId: 'test-req-id',
        field: 'model',
        reason: 'required',
      })
    );
  });

  it('lifecycle.serverSelected emits LIFECYCLE_SERVER_SELECTED at info', () => {
    const meta = {
      algorithm: 'weighted',
      selectedServer: 'server-1',
      candidates: ['server-1', 'server-2'],
      excludedServers: ['server-3'],
      serverScores: { 'server-1': 95, 'server-2': 80 },
      circuitBreakerState: 'closed',
      timeoutMs: 5000,
    };
    lifecycle.serverSelected(mockReq as Request, meta);
    expect(infoSpy).toHaveBeenCalledWith(
      'LIFECYCLE_SERVER_SELECTED',
      expect.objectContaining({
        requestId: 'test-req-id',
        ...meta,
      })
    );
  });

  it('lifecycle.started emits LIFECYCLE_UPSTREAM_STARTED at info', () => {
    lifecycle.started(mockReq as Request, {
      serverId: 'server-1',
      model: 'llama2',
      attempt: 1,
      phase: 'primary',
    });
    expect(infoSpy).toHaveBeenCalledWith(
      'LIFECYCLE_UPSTREAM_STARTED',
      expect.objectContaining({
        requestId: 'test-req-id',
        serverId: 'server-1',
        model: 'llama2',
        attempt: 1,
        phase: 'primary',
      })
    );
  });

  it('lifecycle.finished emits LIFECYCLE_UPSTREAM_FINISHED at info', () => {
    lifecycle.finished(mockReq as Request, {
      serverId: 'server-1',
      model: 'llama2',
      durationMs: 1500,
      status: 'success',
      promptTokens: 50,
      generatedTokens: 100,
    });
    expect(infoSpy).toHaveBeenCalledWith(
      'LIFECYCLE_UPSTREAM_FINISHED',
      expect.objectContaining({
        requestId: 'test-req-id',
        serverId: 'server-1',
        model: 'llama2',
        durationMs: 1500,
        status: 'success',
        promptTokens: 50,
        generatedTokens: 100,
      })
    );
  });

  it('lifecycle.error emits LIFECYCLE_ERROR at error level', () => {
    lifecycle.error(mockReq as Request, {
      errorType: 'timeout',
      errorMessage: 'Request timed out',
      retryable: true,
      status: 503,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'LIFECYCLE_ERROR',
      expect.objectContaining({
        requestId: 'test-req-id',
        errorType: 'timeout',
        errorMessage: 'Request timed out',
        retryable: true,
        status: 503,
      })
    );
  });

  it('lifecycle.streamAborted emits LIFECYCLE_STREAM_ABORTED at warn', () => {
    lifecycle.streamAborted(mockReq as Request, {
      serverId: 'server-1',
      model: 'llama2',
      chunkCount: 42,
      reason: 'client disconnected',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'LIFECYCLE_STREAM_ABORTED',
      expect.objectContaining({
        requestId: 'test-req-id',
        serverId: 'server-1',
        model: 'llama2',
        chunkCount: 42,
        reason: 'client disconnected',
      })
    );
  });

  it('defaults requestId to <no-request-id> when req.requestId is missing', () => {
    const reqWithoutId = { path: '/api/generate' } as Request;
    lifecycle.received(reqWithoutId, { endpoint: '/api/generate', method: 'POST' });
    expect(infoSpy).toHaveBeenCalledWith(
      'LIFECYCLE_RECEIVED',
      expect.objectContaining({
        requestId: '<no-request-id>',
      })
    );
  });

  it('does not introduce console.log calls', () => {
    lifecycle.received(mockReq as Request, { endpoint: '/api/generate', method: 'POST' });
    lifecycle.validated(mockReq as Request, { schemaFields: [] });
    lifecycle.validationFailed(mockReq as Request, { field: 'x', reason: 'y' });
    lifecycle.serverSelected(mockReq as Request, {
      algorithm: 'rr',
      selectedServer: 's1',
      candidates: ['s1'],
    });
    lifecycle.started(mockReq as Request, { serverId: 's1', model: 'm', attempt: 0, phase: 'p' });
    lifecycle.finished(mockReq as Request, {
      serverId: 's1',
      model: 'm',
      durationMs: 0,
      status: 'ok',
    });
    lifecycle.error(mockReq as Request, { errorType: 'e', errorMessage: 'm', retryable: false });
    lifecycle.streamAborted(mockReq as Request, {
      serverId: 's1',
      model: 'm',
      chunkCount: 0,
      reason: 'r',
    });
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
