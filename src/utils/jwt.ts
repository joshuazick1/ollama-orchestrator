/**
 * jwt.ts
 * JWT utilities for user authentication with HMAC-SHA256 signing.
 */

import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';

import { logger } from './logger.js';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const JWT_ALGORITHM = 'HS256';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_LENGTH = 64;

export const COOKIE_NAME = 'auth_token';
export const REFRESH_COOKIE_NAME = 'refresh_token';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'user';
export type TokenType = 'access' | 'refresh';

export interface TokenPayload {
  userId: string;
  role: Role;
  type: TokenType;
  iat: number;
  exp: number;
}

export interface AccessTokenPayload {
  userId: string;
  role: Role;
  type: 'access';
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  userId: string;
  type: 'refresh';
  iat: number;
  exp: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Secret validation
// ──────────────────────────────────────────────────────────────────────────────

let secretValidated = false;

/**
 * Validates that JWT_SECRET environment variable is set and meets minimum length requirements.
 * Must be called at application startup before any token operations.
 * @throws Error if JWT_SECRET is missing or less than 32 characters
 */
export function validateJwtSecret(): void {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    logger.error('JWT_SECRET environment variable is not set');
    throw new Error(
      'JWT_SECRET environment variable must be set. Generate one with: openssl rand -base64 32'
    );
  }

  if (secret.length < 32) {
    logger.error('JWT_SECRET is too short', { length: secret.length });
    throw new Error(
      `JWT_SECRET must be at least 32 characters. Current length: ${secret.length}`
    );
  }

  secretValidated = true;
  logger.info('JWT secret validated successfully');
}

/**
 * Get the JWT secret, throwing if not validated or not set
 */
function getJwtSecret(): string {
  if (!secretValidated) {
    // Auto-validate on first use if not explicitly validated
    validateJwtSecret();
  }
  return process.env.JWT_SECRET!;
}

// ──────────────────────────────────────────────────────────────────────────────
// Token signing
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Signs a JWT access token with HMAC-SHA256.
 * @param userId - The user's unique identifier
 * @param role - The user's role ('admin' or 'user')
 * @param expiresIn - Token expiry time (default: '15m')
 * @returns Signed JWT string
 */
export function signToken(userId: string, role: Role, expiresIn: string = ACCESS_TOKEN_EXPIRY): string {
  const secret = getJwtSecret();

  const payload = {
    userId,
    role,
    type: 'access' as const,
  };

  return jwt.sign(payload, secret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Signs a refresh token (separate from access token).
 * @param userId - The user's unique identifier
 * @returns Object containing the signed refresh token and its plain text version (for hashing)
 */
export function generateRefreshToken(userId: string): { token: string; plaintext: string } {
  const secret = getJwtSecret();
  const plaintext = randomBytes(REFRESH_TOKEN_LENGTH).toString('base64url');

  const payload = {
    userId,
    type: 'refresh' as const,
  };

  const token = jwt.sign(payload, secret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });

  return { token, plaintext };
}

/**
 * Creates a SHA-256 hash of a refresh token for storage in DB.
 * @param plaintextToken - The plaintext refresh token
 * @returns Hashed token suitable for DB storage
 */
export function hashRefreshToken(plaintextToken: string): string {
  return createHash('sha256').update(plaintextToken).digest('hex');
}

// ──────────────────────────────────────────────────────────────────────────────
// Token verification
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Verifies and decodes a JWT token.
 * @param token - The JWT string to verify
 * @returns Decoded payload if valid
 * @throws Error if token is invalid, tampered, or expired
 */
export function verifyToken(token: string): TokenPayload {
  const secret = getJwtSecret();

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM],
    }) as TokenPayload;

    return payload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new Error(`Invalid token: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Verifies an access token and returns the payload.
 * @param token - The JWT access token
 * @returns Decoded access token payload
 * @throws Error if token is invalid or wrong type
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = verifyToken(token);

  if (payload.type !== 'access') {
    throw new Error('Invalid token type: expected access token');
  }

  return payload as AccessTokenPayload;
}

/**
 * Verifies a refresh token and returns the payload.
 * @param token - The JWT refresh token
 * @returns Decoded refresh token payload
 * @throws Error if token is invalid or wrong type
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = verifyToken(token);

  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type: expected refresh token');
  }

  return payload as RefreshTokenPayload;
}

// ──────────────────────────────────────────────────────────────────────────────
// Cookie utilities
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the auth token from request cookies.
 * @param req - Express Request object
 * @returns Token string or null if not found
 */
export function getTokenFromCookie(req: Request): string | null {
  return req.cookies?.[COOKIE_NAME] ?? null;
}

/**
 * Extracts the refresh token from request cookies.
 * @param req - Express Request object
 * @returns Refresh token string or null if not found
 */
export function getRefreshTokenFromCookie(req: Request): string | null {
  return req.cookies?.[REFRESH_COOKIE_NAME] ?? null;
}

/**
 * Sets the auth token cookie with secure defaults.
 * @param res - Express Response object
 * @param token - The JWT to set as cookie
 * @param maxAge - Cookie max-age in seconds (default: 15 minutes for access token)
 */
export function setTokenCookie(res: Response, token: string, maxAge: number = 900): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAge * 1000, // Convert to milliseconds
    path: '/',
  });
}

/**
 * Sets the refresh token cookie with secure defaults.
 * @param res - Express Response object
 * @param token - The refresh JWT to set as cookie
 * @param maxAge - Cookie max-age in seconds (default: 7 days for refresh token)
 */
export function setRefreshTokenCookie(
  res: Response,
  token: string,
  maxAge: number = 7 * 24 * 60 * 60
): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAge * 1000, // Convert to milliseconds
    path: '/',
  });
}

/**
 * Clears the auth token cookie by setting maxAge to 0.
 * @param res - Express Response object
 */
export function clearTokenCookie(res: Response): void {
  res.cookie(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
}

/**
 * Clears the refresh token cookie by setting maxAge to 0.
 * @param res - Express Response object
 */
export function clearRefreshTokenCookie(res: Response): void {
  res.cookie(REFRESH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Checks if a token is expired without full verification.
 * Useful for client-side expiry checks.
 * @param token - JWT string
 * @returns true if expired or invalid
 */
export function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwt.decode(token) as { exp?: number } | null;
    if (!decoded || !decoded.exp) {
      return true;
    }
    return Date.now() >= decoded.exp * 1000;
  } catch {
    return true;
  }
}
