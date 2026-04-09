/**
 * csrf.ts
 * CSRF protection using Double Submit Cookie pattern
 */

import { randomBytes } from 'crypto';

import type { Request, Response, NextFunction } from 'express';

import { logger } from '../utils/logger.js';

const CSRF_COOKIE_NAME = 'csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate a cryptographically secure CSRF token
 */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate a CSRF token and set it as a cookie.
 * The cookie is httpOnly=false so JavaScript can read it (needed for Double Submit).
 * Secure flag is set based on environment.
 */
export function generateCsrfToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = generateToken();
  const isSecure = req.protocol === 'https';

  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Must be readable by JavaScript for Double Submit pattern
    secure: isSecure,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  });

  logger.debug('CSRF token generated', {
    path: req.path,
    ip: req.ip,
  });

  next();
}

/**
 * Validate the CSRF token using Double Submit Cookie pattern.
 * Compares the X-CSRF-Token header with the csrf-token cookie.
 * Returns 403 on mismatch or missing token.
 */
export function validateCsrfToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Extract token from header
  const headerToken = req.headers[CSRF_HEADER_NAME];
  const headerTokenValue = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  // Extract token from cookie
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];

  // Check if both are present
  if (!headerTokenValue) {
    logger.warn('CSRF validation failed: missing header token', {
      path: req.path,
      ip: req.ip,
      method: req.method,
    });
    res.status(403).json({
      error: 'CSRF validation failed',
      message: 'Missing X-CSRF-Token header',
    });
    return;
  }

  if (!cookieToken) {
    logger.warn('CSRF validation failed: missing cookie token', {
      path: req.path,
      ip: req.ip,
      method: req.method,
    });
    res.status(403).json({
      error: 'CSRF validation failed',
      message: 'CSRF cookie not found. Please refresh the page and try again.',
    });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(headerTokenValue, cookieToken)) {
    logger.warn('CSRF validation failed: token mismatch', {
      path: req.path,
      ip: req.ip,
      method: req.method,
    });
    res.status(403).json({
      error: 'CSRF validation failed',
      message: 'Invalid CSRF token',
    });
    return;
  }

  logger.debug('CSRF validation succeeded', {
    path: req.path,
    ip: req.ip,
    method: req.method,
  });

  next();
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqualImpl(a, b);
  } catch {
    return false;
  }
}

function timingSafeEqualImpl(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  // Use crypto's timingSafeEqual for byte comparison
  const { timingSafeEqual: tsEq } = require('crypto');
  return tsEq(bufA, bufB);
}
