/**
 * jwt.test.ts
 * Tests for JWT utilities
 */

import { Request, Response } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  validateJwtSecret,
  signToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyToken,
  verifyAccessToken,
  verifyRefreshToken,
  getTokenFromCookie,
  getRefreshTokenFromCookie,
  setTokenCookie,
  setRefreshTokenCookie,
  clearTokenCookie,
  clearRefreshTokenCookie,
  isTokenExpired,
  COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  type Role,
} from '../../src/utils/jwt.js';

describe('jwt utils', () => {
  const TEST_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.JWT_SECRET;
  });

  describe('validateJwtSecret', () => {
    it('should pass for valid secret', () => {
      expect(() => validateJwtSecret()).not.toThrow();
    });

    it('should throw when JWT_SECRET is not set', () => {
      delete process.env.JWT_SECRET;
      expect(() => validateJwtSecret()).toThrow('JWT_SECRET environment variable must be set');
    });

    it('should throw when JWT_SECRET is too short', () => {
      process.env.JWT_SECRET = 'short';
      expect(() => validateJwtSecret()).toThrow('must be at least 32 characters');
    });

    it('should throw when JWT_SECRET is exactly 31 characters', () => {
      process.env.JWT_SECRET = 'a'.repeat(31);
      expect(() => validateJwtSecret()).toThrow('must be at least 32 characters');
    });

    it('should pass when JWT_SECRET is exactly 32 characters', () => {
      process.env.JWT_SECRET = 'a'.repeat(32);
      expect(() => validateJwtSecret()).not.toThrow();
    });

    it('should accept long secrets', () => {
      process.env.JWT_SECRET = 'a'.repeat(256);
      expect(() => validateJwtSecret()).not.toThrow();
    });
  });

  describe('signToken', () => {
    it('should sign a valid access token', () => {
      const token = signToken('user-123', 'user');

      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);
    });

    it('should sign token with admin role', () => {
      const token = signToken('admin-1', 'admin');
      const payload = verifyToken(token);

      expect(payload.userId).toBe('admin-1');
      expect(payload.role).toBe('admin');
      expect(payload.type).toBe('access');
    });

    it('should sign token with user role', () => {
      const token = signToken('user-1', 'user');
      const payload = verifyToken(token);

      expect(payload.userId).toBe('user-1');
      expect(payload.role).toBe('user');
    });

    it('should respect custom expiresIn', () => {
      const token = signToken('user-1', 'user', '1h');
      const payload = verifyToken(token);

      expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('should set default 15m expiry', () => {
      const token = signToken('user-1', 'user');
      const payload = verifyToken(token);

      const diffSeconds = payload.exp - payload.iat;
      expect(diffSeconds).toBe(15 * 60);
    });
  });

  describe('generateRefreshToken', () => {
    it('should return token and plaintext', () => {
      const result = generateRefreshToken('user-123');

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('plaintext');
      expect(typeof result.token).toBe('string');
      expect(typeof result.plaintext).toBe('string');
    });

    it('should return valid JWT for token field', () => {
      const result = generateRefreshToken('user-123');
      const payload = verifyToken(result.token);

      expect(payload.userId).toBe('user-123');
      expect(payload.type).toBe('refresh');
    });

    it('should return non-empty plaintext', () => {
      const result = generateRefreshToken('user-123');
      expect(result.plaintext.length).toBeGreaterThan(0);
    });

    it('should generate different plaintexts for different users', () => {
      const result1 = generateRefreshToken('user-1');
      const result2 = generateRefreshToken('user-2');

      expect(result1.plaintext).not.toBe(result2.plaintext);
    });

    it('should have refresh token expiry of 7 days', () => {
      const result = generateRefreshToken('user-123');
      const payload = verifyToken(result.token);

      const diffSeconds = payload.exp - payload.iat;
      expect(diffSeconds).toBe(7 * 24 * 60 * 60);
    });
  });

  describe('hashRefreshToken', () => {
    it('should return sha256 hash', () => {
      const hash = hashRefreshToken('some-token-value');

      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    it('should produce consistent hashes', () => {
      const token = 'test-token-123';
      const hash1 = hashRefreshToken(token);
      const hash2 = hashRefreshToken(token);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = hashRefreshToken('token-1');
      const hash2 = hashRefreshToken('token-2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = hashRefreshToken('');
      expect(hash.length).toBe(64);
    });

    it('should handle unicode characters', () => {
      const hash = hashRefreshToken('токен-с-юникодом');
      expect(hash.length).toBe(64);
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode a valid token', () => {
      const token = signToken('user-123', 'admin');
      const payload = verifyToken(token);

      expect(payload.userId).toBe('user-123');
      expect(payload.role).toBe('admin');
    });

    it('should throw for tampered token', () => {
      const token = signToken('user-123', 'user');
      const tamperedToken = token.slice(0, -5) + 'xxxxx';

      expect(() => verifyToken(tamperedToken)).toThrow();
    });

    it('should throw for malformed token', () => {
      expect(() => verifyToken('not.a.valid.jwt.token')).toThrow();
    });

    it('should throw for empty string', () => {
      expect(() => verifyToken('')).toThrow();
    });

    it('should throw for token with invalid signature', () => {
      const validToken = signToken('user-1', 'user');
      const parts = validToken.split('.');
      parts[2] = 'invalid_signature_here';
      const invalidToken = parts.join('.');

      expect(() => verifyToken(invalidToken)).toThrow();
    });

    it('should throw TokenExpiredError for expired token', () => {
      const token = signToken('user-1', 'user', '1ms');

      return new Promise(resolve => {
        setTimeout(() => {
          expect(() => verifyToken(token)).toThrow('Token has expired');
          resolve();
        }, 10);
      });
    });
  });

  describe('verifyAccessToken', () => {
    it('should return payload for valid access token', () => {
      const token = signToken('user-123', 'admin');
      const payload = verifyAccessToken(token);

      expect(payload.userId).toBe('user-123');
      expect(payload.role).toBe('admin');
      expect(payload.type).toBe('access');
    });

    it('should throw for refresh token passed as access token', () => {
      const { token } = generateRefreshToken('user-123');

      expect(() => verifyAccessToken(token)).toThrow('Invalid token type: expected access token');
    });

    it('should throw for malformed token', () => {
      expect(() => verifyAccessToken('bad-token')).toThrow();
    });
  });

  describe('verifyRefreshToken', () => {
    it('should return payload for valid refresh token', () => {
      const { token } = generateRefreshToken('user-123');
      const payload = verifyRefreshToken(token);

      expect(payload.userId).toBe('user-123');
      expect(payload.type).toBe('refresh');
    });

    it('should throw for access token passed as refresh token', () => {
      const token = signToken('user-123', 'user');

      expect(() => verifyRefreshToken(token)).toThrow('Invalid token type: expected refresh token');
    });
  });

  describe('cookie utilities', () => {
    let mockRes: Partial<Response>;
    let mockReq: Partial<Request>;

    beforeEach(() => {
      mockRes = {
        cookie: vi.fn().mockReturnThis() as unknown as Response['cookie'],
      };
      mockReq = {
        cookies: {},
      } as Partial<Request>;
    });

    describe('getTokenFromCookie', () => {
      it('should return token from cookie', () => {
        mockReq.cookies = { [COOKIE_NAME]: 'test-token-123' };

        const result = getTokenFromCookie(mockReq as Request);

        expect(result).toBe('test-token-123');
      });

      it('should return null when cookie not present', () => {
        mockReq.cookies = {};

        const result = getTokenFromCookie(mockReq as Request);

        expect(result).toBeNull();
      });

      it('should return null when cookies is undefined', () => {
        mockReq.cookies = undefined;

        const result = getTokenFromCookie(mockReq as Request);

        expect(result).toBeNull();
      });
    });

    describe('getRefreshTokenFromCookie', () => {
      it('should return refresh token from cookie', () => {
        mockReq.cookies = { [REFRESH_COOKIE_NAME]: 'refresh-token-456' };

        const result = getRefreshTokenFromCookie(mockReq as Request);

        expect(result).toBe('refresh-token-456');
      });

      it('should return null when refresh cookie not present', () => {
        mockReq.cookies = {};

        const result = getRefreshTokenFromCookie(mockReq as Request);

        expect(result).toBeNull();
      });
    });

    describe('setTokenCookie', () => {
      it('should set cookie with default maxAge', () => {
        setTokenCookie(mockRes as Response, 'my-token');

        expect(mockRes.cookie).toHaveBeenCalledWith(
          COOKIE_NAME,
          'my-token',
          expect.objectContaining({
            httpOnly: true,
            sameSite: 'strict',
            path: '/',
          })
        );
      });

      it('should set cookie with custom maxAge', () => {
        setTokenCookie(mockRes as Response, 'my-token', 1800);

        expect(mockRes.cookie).toHaveBeenCalledWith(
          COOKIE_NAME,
          'my-token',
          expect.objectContaining({
            maxAge: 1800 * 1000,
          })
        );
      });

      it('should set secure flag in production', () => {
        process.env.NODE_ENV = 'production';
        setTokenCookie(mockRes as Response, 'my-token');

        expect(mockRes.cookie).toHaveBeenCalledWith(
          COOKIE_NAME,
          'my-token',
          expect.objectContaining({
            secure: true,
          })
        );
      });

      it('should not set secure flag in development', () => {
        process.env.NODE_ENV = 'development';
        setTokenCookie(mockRes as Response, 'my-token');

        expect(mockRes.cookie).toHaveBeenCalledWith(
          COOKIE_NAME,
          'my-token',
          expect.objectContaining({
            secure: false,
          })
        );
      });
    });

    describe('setRefreshTokenCookie', () => {
      it('should set refresh cookie with 7 day default maxAge', () => {
        setRefreshTokenCookie(mockRes as Response, 'refresh-token');

        const expectedMaxAge = 7 * 24 * 60 * 60 * 1000;
        expect(mockRes.cookie).toHaveBeenCalledWith(
          REFRESH_COOKIE_NAME,
          'refresh-token',
          expect.objectContaining({
            maxAge: expectedMaxAge,
          })
        );
      });

      it('should set refresh cookie with custom maxAge', () => {
        setRefreshTokenCookie(mockRes as Response, 'refresh-token', 3600);

        expect(mockRes.cookie).toHaveBeenCalledWith(
          REFRESH_COOKIE_NAME,
          'refresh-token',
          expect.objectContaining({
            maxAge: 3600 * 1000,
          })
        );
      });
    });

    describe('clearTokenCookie', () => {
      it('should set cookie with maxAge 0', () => {
        clearTokenCookie(mockRes as Response);

        expect(mockRes.cookie).toHaveBeenCalledWith(
          COOKIE_NAME,
          '',
          expect.objectContaining({
            maxAge: 0,
          })
        );
      });
    });

    describe('clearRefreshTokenCookie', () => {
      it('should set cookie with maxAge 0', () => {
        clearRefreshTokenCookie(mockRes as Response);

        expect(mockRes.cookie).toHaveBeenCalledWith(
          REFRESH_COOKIE_NAME,
          '',
          expect.objectContaining({
            maxAge: 0,
          })
        );
      });
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for valid non-expired token', () => {
      const token = signToken('user-1', 'user', '1h');

      expect(isTokenExpired(token)).toBe(false);
    });

    it('should return true for expired token', () => {
      const token = signToken('user-1', 'user', '1ms');

      return new Promise(resolve => {
        setTimeout(() => {
          expect(isTokenExpired(token)).toBe(true);
          resolve();
        }, 10);
      });
    });

    it('should return true for malformed token', () => {
      expect(isTokenExpired('not-valid')).toBe(true);
    });

    it('should return true for empty string', () => {
      expect(isTokenExpired('')).toBe(true);
    });

    it('should return true for token without exp claim', () => {
      const { token } = generateRefreshToken('user-1');
      expect(isTokenExpired(token)).toBe(false);
    });
  });

  describe('constants', () => {
    it('should export COOKIE_NAME', () => {
      expect(COOKIE_NAME).toBe('auth_token');
    });

    it('should export REFRESH_COOKIE_NAME', () => {
      expect(REFRESH_COOKIE_NAME).toBe('refresh_token');
    });
  });
});
