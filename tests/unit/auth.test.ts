/**
 * auth.test.ts
 * Tests for authentication middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  requireAuth,
  requireAdmin,
  optionalAuth,
  createAuthMiddleware,
  DEFAULT_AUTH_CONFIG,
  AuthConfig,
} from '../../src/middleware/auth.js';

describe('auth middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: Mock;

  beforeEach(() => {
    mockReq = {
      headers: {},
      query: {},
      path: '/test',
      ip: '127.0.0.1',
    };
    mockRes = {
      status: vi.fn().mockReturnThis() as unknown as Response['status'],
      json: vi.fn().mockReturnThis() as unknown as Response['json'],
    };
    mockNext = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('requireAuth', () => {
    it('should allow request when auth is disabled', () => {
      const config: AuthConfig = { enabled: false, apiKeys: [], adminApiKeys: [] };
      const middleware = requireAuth(config);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should reject request without API key', () => {
      const config: AuthConfig = { enabled: true, apiKeys: ['valid-key'], adminApiKeys: [] };
      const middleware = requireAuth(config);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication required',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid API key', () => {
      const config: AuthConfig = { enabled: true, apiKeys: ['valid-key'], adminApiKeys: [] };
      const middleware = requireAuth(config);
      mockReq.headers = { 'x-api-key': 'invalid-key' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication failed',
        })
      );
    });

    it('should allow request with valid API key', () => {
      const config: AuthConfig = { enabled: true, apiKeys: ['valid-key'], adminApiKeys: [] };
      const middleware = requireAuth(config);
      mockReq.headers = { 'x-api-key': 'valid-key' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.auth).toEqual({ apiKey: 'valid-key', isAdmin: false });
    });

    it('should allow request with valid admin API key', () => {
      const config: AuthConfig = {
        enabled: true,
        apiKeys: ['user-key'],
        adminApiKeys: ['admin-key'],
      };
      const middleware = requireAuth(config);
      mockReq.headers = { 'x-api-key': 'admin-key' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.auth).toEqual({ apiKey: 'admin-key', isAdmin: true });
    });

    it('should extract API key from Authorization header', () => {
      const config: AuthConfig = { enabled: true, apiKeys: ['bearer-token'], adminApiKeys: [] };
      const middleware = requireAuth(config);
      mockReq.headers = { authorization: 'Bearer bearer-token' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.auth).toEqual({ apiKey: 'bearer-token', isAdmin: false });
    });

    it('should extract API key from query parameter', () => {
      const config: AuthConfig = { enabled: true, apiKeys: ['query-key'], adminApiKeys: [] };
      const middleware = requireAuth(config);
      mockReq.query = { apiKey: 'query-key' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requireAdmin', () => {
    beforeEach(() => {
      vi.spyOn(DEFAULT_AUTH_CONFIG, 'enabled', 'get').mockReturnValue(true);
    });

    it('should reject request without auth', () => {
      const config: AuthConfig = { enabled: true, apiKeys: [], adminApiKeys: [] };
      const middleware = requireAdmin(config);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should reject request without admin privileges', () => {
      const config: AuthConfig = { enabled: true, apiKeys: [], adminApiKeys: [] };
      const middleware = requireAdmin(config);
      mockReq.auth = { apiKey: 'user-key', isAdmin: false };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should allow request with admin privileges', () => {
      const config: AuthConfig = { enabled: true, apiKeys: [], adminApiKeys: [] };
      const middleware = requireAdmin(config);
      mockReq.auth = { apiKey: 'admin-key', isAdmin: true };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('optionalAuth', () => {
    it('should allow request when auth is disabled', () => {
      const config: AuthConfig = { enabled: false, apiKeys: [], adminApiKeys: [] };
      const middleware = optionalAuth(config);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should attach auth info for valid API key', () => {
      const config: AuthConfig = { enabled: true, apiKeys: ['valid-key'], adminApiKeys: [] };
      const middleware = optionalAuth(config);
      mockReq.headers = { 'x-api-key': 'valid-key' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.auth).toEqual({ apiKey: 'valid-key', isAdmin: false });
    });

    it('should not attach auth info for invalid API key', () => {
      const config: AuthConfig = { enabled: true, apiKeys: ['valid-key'], adminApiKeys: [] };
      const middleware = optionalAuth(config);
      mockReq.headers = { 'x-api-key': 'invalid-key' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.auth).toBeUndefined();
    });
  });

  describe('createAuthMiddleware', () => {
    it('should create middleware with custom config', () => {
      const config: AuthConfig = { enabled: false, apiKeys: ['key1'], adminApiKeys: ['admin1'] };
      const middleware = createAuthMiddleware(config);

      expect(middleware.requireAuth).toBeDefined();
      expect(middleware.requireAdmin).toBeDefined();
      expect(middleware.optionalAuth).toBeDefined();
    });
  });
});
