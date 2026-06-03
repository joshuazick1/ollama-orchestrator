import type { Request, Response, NextFunction } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as auth from '../../src/middleware/auth.js';
import { generateCsrfToken, validateCsrfToken } from '../../src/middleware/csrf.js';

vi.mock('../../src/utils/logger.js');

describe('csrf middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let cookieSet: Record<string, string>;
  let cookieOptions: Record<string, any>;

  beforeEach(() => {
    cookieSet = {};
    cookieOptions = {};

    mockReq = {
      headers: {},
      cookies: {},
      path: '/test',
      method: 'POST',
      ip: '127.0.0.1',
      protocol: 'http',
    };

    mockRes = {
      cookie: vi.fn().mockImplementation((name: string, value: string, options: any) => {
        cookieSet[name] = value;
        cookieOptions[name] = options;
      }),
      status: vi.fn().mockReturnThis() as unknown as Response['status'],
      json: vi.fn().mockReturnThis() as unknown as Response['json'],
      end: vi.fn().mockReturnThis() as unknown as Response['end'],
    };

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateCsrfToken', () => {
    it('should set csrf-token cookie with 64-char hex token', () => {
      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'csrf-token',
        expect.any(String),
        expect.any(Object)
      );
      expect(cookieSet['csrf-token'].length).toBe(64);
      expect(/^[a-f0-9]+$/.test(cookieSet['csrf-token'])).toBe(true);
    });

    it('should set cookie with httpOnly: false', () => {
      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'csrf-token',
        expect.any(String),
        expect.objectContaining({ httpOnly: false })
      );
    });

    it('should set secure: true when protocol is https', () => {
      mockReq.protocol = 'https';

      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'csrf-token',
        expect.any(String),
        expect.objectContaining({ secure: true })
      );
    });

    it('should set secure: false when protocol is http', () => {
      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'csrf-token',
        expect.any(String),
        expect.objectContaining({ secure: false })
      );
    });

    it('should set sameSite: strict', () => {
      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'csrf-token',
        expect.any(String),
        expect.objectContaining({ sameSite: 'strict' })
      );
    });

    it('should set maxAge to 24 hours', () => {
      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'csrf-token',
        expect.any(String),
        expect.objectContaining({ maxAge: 24 * 60 * 60 * 1000 })
      );
    });

    it('should set path to /', () => {
      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'csrf-token',
        expect.any(String),
        expect.objectContaining({ path: '/' })
      );
    });

    it('should call next()', () => {
      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should generate unique tokens on each call', () => {
      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);
      const token1 = cookieSet['csrf-token'];

      mockRes.cookie = vi.fn().mockImplementation((name: string, value: string) => {
        cookieSet[name] = value;
      });

      generateCsrfToken(mockReq as Request, mockRes as Response, mockNext);
      const token2 = cookieSet['csrf-token'];

      expect(token1).not.toBe(token2);
    });
  });

  describe('validateCsrfToken', () => {
    describe('auth bypass', () => {
      it('should skip validation when auth is disabled', () => {
        vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(false);

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });

      it('should not skip when auth is enabled', () => {
        vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(true);

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('same-origin bypass', () => {
      beforeEach(() => {
        vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(true);
      });

      it('should bypass CSRF check when Origin matches host', () => {
        mockReq.headers = {
          origin: 'http://localhost:5100',
          host: 'localhost:5100',
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });

      it('should bypass CSRF check when Referer matches host', () => {
        mockReq.headers = {
          referer: 'http://localhost:5100/test',
          host: 'localhost:5100',
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });

      it('should NOT bypass when Origin host does not match', () => {
        mockReq.headers = {
          origin: 'http://evil.com',
          host: 'localhost:5100',
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should NOT bypass when Referer host does not match', () => {
        mockReq.headers = {
          referer: 'http://evil.com/test',
          host: 'localhost:5100',
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should fall through to token check on malformed Origin URL', () => {
        mockReq.headers = {
          origin: 'not-a-valid-url',
          host: 'localhost:5100',
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
      });

      it('should accept Referer when only Referer header is present', () => {
        mockReq.headers = {
          referer: 'http://localhost:5100/test',
          host: 'localhost:5100',
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });
    });

    describe('missing header token', () => {
      beforeEach(() => {
        vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(true);
        mockReq.cookies = { 'csrf-token': 'some-cookie-value' };
      });

      it('should return 403 when header token is missing', () => {
        mockReq.headers = {};

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'CSRF validation failed',
            message: 'Missing X-CSRF-Token header',
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should return 403 even if cookie token is present', () => {
        mockReq.headers = {};

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('missing cookie token', () => {
      beforeEach(() => {
        vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(true);
      });

      it('should return 403 when cookie token is missing', () => {
        mockReq.headers = {
          'x-csrf-token': 'header-token-value',
        };
        mockReq.cookies = {};

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'CSRF validation failed',
            message: 'CSRF cookie not found. Please refresh the page and try again.',
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should return 403 even if header token is present', () => {
        mockReq.headers = {
          'x-csrf-token': 'some-token',
        };
        mockReq.cookies = {};

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('token mismatch', () => {
      beforeEach(() => {
        vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(true);
      });

      it('should return 403 when tokens do not match', () => {
        mockReq.headers = {
          'x-csrf-token': 'header-token',
        };
        mockReq.cookies = {
          'csrf-token': 'cookie-token-different',
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'CSRF validation failed',
            message: 'Invalid CSRF token',
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should return 403 when header is shorter than cookie', () => {
        mockReq.headers = {
          'x-csrf-token': 'short',
        };
        mockReq.cookies = {
          'csrf-token': 'much-longer-cookie-token-value',
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
      });

      it('should return 403 when header is longer than cookie', () => {
        mockReq.headers = {
          'x-csrf-token': 'much-longer-header-token-value',
        };
        mockReq.cookies = {
          'csrf-token': 'short',
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
      });
    });

    describe('successful validation', () => {
      beforeEach(() => {
        vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(true);
      });

      it('should call next() when tokens match', () => {
        const token = 'a'.repeat(64);
        mockReq.headers = {
          'x-csrf-token': token,
        };
        mockReq.cookies = {
          'csrf-token': token,
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockRes.status).not.toHaveBeenCalled();
      });

      it('should allow POST with matching tokens', () => {
        const token = 'valid-token-123';
        mockReq.method = 'POST';
        mockReq.headers = {
          'x-csrf-token': token,
        };
        mockReq.cookies = {
          'csrf-token': token,
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should allow PUT with matching tokens', () => {
        const token = 'another-valid-token';
        mockReq.method = 'PUT';
        mockReq.headers = {
          'x-csrf-token': token,
        };
        mockReq.cookies = {
          'csrf-token': token,
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should allow DELETE with matching tokens', () => {
        const token = 'delete-token';
        mockReq.method = 'DELETE';
        mockReq.headers = {
          'x-csrf-token': token,
        };
        mockReq.cookies = {
          'csrf-token': token,
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });
    });

    describe('timing-safe comparison', () => {
      beforeEach(() => {
        vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(true);
      });

      it('should use timing-safe comparison', () => {
        const token = 'a'.repeat(64);
        mockReq.headers = {
          'x-csrf-token': token,
        };
        mockReq.cookies = {
          'csrf-token': token,
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should fail for tokens that differ in last byte', () => {
        const token1 = 'a'.repeat(63) + '01';
        const token2 = 'a'.repeat(63) + '02';
        mockReq.headers = {
          'x-csrf-token': token1,
        };
        mockReq.cookies = {
          'csrf-token': token2,
        };

        validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
      });
    });
  });

  describe('timingSafeEqual edge cases', () => {
    beforeEach(() => {
      vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(true);
    });

    it('should return false for strings of different lengths', () => {
      mockReq.headers = { 'x-csrf-token': 'short' };
      mockReq.cookies = { 'csrf-token': 'much-longer-token-value' };

      validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should succeed for equal strings', () => {
      mockReq.headers = { 'x-csrf-token': 'test' };
      mockReq.cookies = { 'csrf-token': 'test' };

      validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      vi.spyOn(auth, 'isAuthEnabled').mockReturnValue(true);
    });

    it('should handle unicode tokens', () => {
      const unicodeToken = 'unicode-token-日本語-emoji-🎉';
      mockReq.headers = { 'x-csrf-token': unicodeToken };
      mockReq.cookies = { 'csrf-token': unicodeToken };

      validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle mixed ASCII tokens', () => {
      const mixedToken = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
      mockReq.headers = { 'x-csrf-token': mixedToken };
      mockReq.cookies = { 'csrf-token': mixedToken };

      validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should include request metadata in failed response', () => {
      mockReq.path = '/api/test';
      mockReq.method = 'POST';
      mockReq.ip = '192.168.1.100';
      mockReq.headers = { 'x-csrf-token': 'token' };

      validateCsrfToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'CSRF validation failed',
        })
      );
    });
  });
});
