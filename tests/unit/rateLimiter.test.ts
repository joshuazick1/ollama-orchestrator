/**
 * rateLimiter.test.ts
 * Tests for rate limiting middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import {
  createRateLimiter,
  createMonitoringRateLimiter,
  createAdminRateLimiter,
  createInferenceRateLimiter,
  createAuthRateLimiter,
  defaultKeyGenerator,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '../../src/middleware/rateLimiter.js';

describe('rateLimiter middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: () => void;

  beforeEach(() => {
    mockReq = {
      headers: {},
      path: '/test',
      method: 'GET',
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' } as Request['socket'],
    };
    mockRes = {
      status: vi.fn().mockReturnThis() as unknown as Response['status'],
      json: vi.fn().mockReturnThis() as unknown as Response['json'],
    };
    mockNext = vi.fn();
  });

  describe('defaultKeyGenerator', () => {
    it('should use API key when available', () => {
      mockReq.headers = { 'x-api-key': 'test-api-key' };

      const key = defaultKeyGenerator(mockReq as Request);

      expect(key).toBe('api:test-api-key');
    });

    it('should use bearer token when available', () => {
      mockReq.headers = { authorization: 'Bearer test-token' };

      const key = defaultKeyGenerator(mockReq as Request);

      expect(key).toBe('token:test-token');
    });

    it('should use IP address as fallback', () => {
      mockReq.headers = {};

      const key = defaultKeyGenerator(mockReq as Request);

      expect(key).toBe('ip:127.0.0.1');
    });
  });

  describe('createRateLimiter', () => {
    it('should return no-op middleware when disabled', () => {
      const middleware = createRateLimiter({ enabled: false });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should create rate limiter with default config', () => {
      const middleware = createRateLimiter();

      expect(middleware).toBeDefined();
      expect(typeof middleware).toBe('function');
    });

    it('should create rate limiter with custom config', () => {
      const middleware = createRateLimiter({
        enabled: true,
        windowMs: 60000,
        maxRequests: 10,
      });

      expect(middleware).toBeDefined();
    });
  });

  describe('createMonitoringRateLimiter', () => {
    it('should create monitoring rate limiter', () => {
      const middleware = createMonitoringRateLimiter();

      expect(middleware).toBeDefined();
    });
  });

  describe('createAdminRateLimiter', () => {
    it('should create admin rate limiter', () => {
      const middleware = createAdminRateLimiter();

      expect(middleware).toBeDefined();
    });
  });

  describe('createInferenceRateLimiter', () => {
    it('should create inference rate limiter', () => {
      const middleware = createInferenceRateLimiter();

      expect(middleware).toBeDefined();
    });
  });

  describe('createAuthRateLimiter', () => {
    it('should create auth rate limiter', () => {
      const middleware = createAuthRateLimiter();

      expect(middleware).toBeDefined();
    });
  });

  describe('DEFAULT_RATE_LIMIT_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_RATE_LIMIT_CONFIG.enabled).toBe(true);
      expect(DEFAULT_RATE_LIMIT_CONFIG.windowMs).toBe(15 * 60 * 1000);
      expect(DEFAULT_RATE_LIMIT_CONFIG.maxRequests).toBe(100);
    });
  });
});
