/**
 * rateLimiter.ts
 * Rate limiting middleware with configurable strategies
 */

import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

import { logger } from '../utils/logger.js';

/**
 * IMPORTANT: This middleware uses the default in-memory store for express-rate-limit.
 * In multi-process deployments (PM2 cluster mode, Kubernetes replicas, multiple Node.js
 * processes), each process has its own independent counter. A client hitting 3 different
 * pods gets 3 × maxRequests rather than the intended maxRequests total.
 *
 * For multi-process deployments, configure a shared store (e.g., rate-limit-redis).
 * See docs/OPERATIONS.md for setup instructions.
 */

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests: boolean;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  enabled: true,
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100, // 100 requests per window
  skipSuccessfulRequests: false,
};

/**
 * Default key generator - uses API key or IP address
 */
export function defaultKeyGenerator(req: Request): string {
  // Use API key if available
  const apiKey = req.headers['x-api-key'] as string;
  if (apiKey) {
    return `api:${apiKey}`;
  }

  // Use Authorization header bearer token if available
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return `token:${token}`;
  }

  // Fall back to IP address
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  return `ip:${ip}`;
}

/**
 * Create rate limiter middleware
 * More restrictive for admin endpoints, less for inference
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createRateLimiter(config: Partial<RateLimitConfig> = {}): any {
  const finalConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };

  if (!finalConfig.enabled) {
    // Return no-op middleware if disabled
    return (_req: Request, _res: Response, next: () => void) => next();
  }

  return rateLimit({
    windowMs: finalConfig.windowMs,
    max: finalConfig.maxRequests,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skipSuccessfulRequests: finalConfig.skipSuccessfulRequests,
    keyGenerator: finalConfig.keyGenerator ?? defaultKeyGenerator,
    handler: (req: Request, res: Response) => {
      logger.warn(`Rate limit exceeded for ${req.ip}`, {
        path: req.path,
        method: req.method,
      });

      res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(finalConfig.windowMs / 1000),
      });
    },
    skip: (req: Request) => {
      if (req.path === '/health' || req.path === '/metrics') {
        return true;
      }
      return false;
    },
  });
}

/**
 * Monitoring endpoint rate limiter - very permissive for dashboard polling
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMonitoringRateLimiter(): any {
  return createRateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 631, // 631 requests per 5 minutes (30% above expected 485 from models page)
  });
}

/**
 * Admin endpoint rate limiter - more restrictive
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAdminRateLimiter(): any {
  return createRateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 50, // 50 requests per 5 minutes
  });
}

/**
 * Authentication endpoint rate limiter - very restrictive to prevent brute force
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAuthRateLimiter(): any {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10, // 10 attempts per 15 minutes
  });
}

/**
 * Inference endpoint rate limiter - protects /api and /v1 inference routes
 * from abuse while allowing reasonable throughput for legitimate usage
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createInferenceRateLimiter(): any {
  return createRateLimiter({
    enabled: true,
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
    skipSuccessfulRequests: false,
    keyGenerator: defaultKeyGenerator,
    skip: (req: Request) => {
      if (req.path === '/health' || req.path === '/metrics') {
        return true;
      }
      return false;
    },
  });
}
