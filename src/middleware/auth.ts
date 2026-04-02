/**
 * auth.ts
 * Authentication and authorization middleware
 */

import { timingSafeEqual } from 'crypto';

import type { Request, Response, NextFunction } from 'express';

import { logger } from '../utils/logger.js';

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface AuthConfig {
  enabled: boolean;
  apiKeys: string[];
  adminApiKeys: string[];
}

// In production, these should come from environment variables
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  enabled: process.env.ENABLE_AUTH !== 'false',
  apiKeys: process.env.API_KEYS?.split(',').filter(Boolean) ?? [],
  adminApiKeys: process.env.ADMIN_API_KEYS?.split(',').filter(Boolean) ?? [],
};

/**
 * Re-read API keys from environment variables.
 * Called by the config hot-reload cycle to pick up rotated secrets
 * without restarting the process.
 */
export function refreshAuthConfig(): AuthConfig {
  DEFAULT_AUTH_CONFIG.enabled = process.env.ENABLE_AUTH !== 'false';
  DEFAULT_AUTH_CONFIG.apiKeys = process.env.API_KEYS?.split(',').filter(Boolean) ?? [];
  DEFAULT_AUTH_CONFIG.adminApiKeys = process.env.ADMIN_API_KEYS?.split(',').filter(Boolean) ?? [];
  logger.info('Auth configuration refreshed from environment');
  return DEFAULT_AUTH_CONFIG;
}

// Extend Express Request type to include auth info
declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      apiKey: string;
      isAdmin: boolean;
    };
  }
}

/**
 * Extract API key from request
 * Checks Authorization header (Bearer token) and X-API-Key header
 */
function extractApiKey(req: Request): string | null {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check X-API-Key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string') {
    return apiKeyHeader;
  }

  return null;
}

/**
 * Middleware to check if request is authenticated
 * Protects sensitive endpoints (admin routes)
 */
export function requireAuth(
  config: AuthConfig = DEFAULT_AUTH_CONFIG
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If auth is disabled, allow all requests
    if (!config.enabled) {
      next();
      return;
    }

    const apiKey = extractApiKey(req);

    if (!apiKey) {
      logger.warn(`Authentication failed: No API key provided`, {
        path: req.path,
        ip: req.ip,
      });
      res.status(401).json({
        error: 'Authentication required',
        message:
          'Please provide a valid API key via Authorization header (Bearer token) or X-API-Key header',
      });
      return;
    }

    // Check if it's an admin key (using constant-time comparison)
    const isAdmin = config.adminApiKeys.some(key => safeCompare(apiKey, key));

    // Check if it's a valid regular key or admin key (using constant-time comparison)
    if (!isAdmin && !config.apiKeys.some(key => safeCompare(apiKey, key))) {
      logger.warn(`Authentication failed: Invalid API key`, {
        path: req.path,
        ip: req.ip,
      });
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid API key',
      });
      return;
    }

    // Attach auth info to request
    req.auth = {
      apiKey,
      isAdmin,
    };

    next();
  };
}

/**
 * Middleware to require admin privileges
 * Use after requireAuth middleware
 */
export function requireAdmin(
  _config: AuthConfig = DEFAULT_AUTH_CONFIG
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const config = _config ?? DEFAULT_AUTH_CONFIG;
    // If auth is disabled, allow all requests
    if (!config.enabled) {
      next();
      return;
    }

    // Check if user is authenticated (requireAuth should have run first)
    if (!req.auth) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate before accessing admin endpoints',
      });
      return;
    }

    // Check if user is admin
    if (!req.auth.isAdmin) {
      logger.warn(`Authorization failed: Admin access required`, {
        path: req.path,
        apiKey: req.auth.apiKey.substring(0, 8) + '...',
      });
      res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required',
      });
      return;
    }

    next();
  };
}

/**
 * Middleware for optional authentication
 * Allows both authenticated and unauthenticated requests
 * Useful for public endpoints that can benefit from authentication
 */
export function optionalAuth(
  config: AuthConfig = DEFAULT_AUTH_CONFIG
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If auth is disabled, continue without auth
    if (!config.enabled) {
      next();
      return;
    }

    const apiKey = extractApiKey(req);

    if (apiKey) {
      const isAdmin = config.adminApiKeys.some(key => safeCompare(apiKey, key));
      const isValid = isAdmin || config.apiKeys.some(key => safeCompare(apiKey, key));

      if (isValid) {
        req.auth = {
          apiKey,
          isAdmin,
        };
      }
    }

    next();
  };
}

/**
 * Create authentication middleware with custom config
 */
export function createAuthMiddleware(config: Partial<AuthConfig> = {}): {
  requireAuth: ReturnType<typeof requireAuth>;
  requireAdmin: ReturnType<typeof requireAdmin>;
  optionalAuth: ReturnType<typeof optionalAuth>;
} {
  const finalConfig = { ...DEFAULT_AUTH_CONFIG, ...config };
  return {
    requireAuth: requireAuth(finalConfig),
    requireAdmin: requireAdmin(finalConfig),
    optionalAuth: optionalAuth(finalConfig),
  };
}
