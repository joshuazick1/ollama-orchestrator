import type { Request, Response, NextFunction } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { requestIdMiddleware } from '../../src/middleware/request-id.js';

describe('requestIdMiddleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      setHeader: vi.fn(),
    };
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('assigns a UUID v4 when no X-Request-Id header is present', () => {
    requestIdMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockReq.requestId).toBeDefined();
    expect(mockReq.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(mockNext).toHaveBeenCalled();
  });

  it('uses the X-Request-Id header when provided', () => {
    mockReq.headers = { 'x-request-id': 'my-custom-id' };
    requestIdMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockReq.requestId).toBe('my-custom-id');
    expect(mockNext).toHaveBeenCalled();
  });

  it('echoes request ID in X-Request-Id response header', () => {
    mockReq.headers = { 'x-request-id': 'echo-this-id' };
    requestIdMiddleware(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-Id', 'echo-this-id');
  });
});
