/**
 * auth.ts
 * Authentication and authorization middleware
 *
 * Auth Modes:
 * - Mode 1: ENABLE_AUTH=true (default) — JWT/API-key required. Use isInternalAdmin(req) for admin checks.
 * - Mode 2: ENABLE_AUTH=false (dev mode) — All requests treated as internal admin.
 *   req.auth is auto-set to { isAdmin: true, apiKey: 'internal' }.
 */

import { timingSafeEqual } from 'crypto';

import type { Request, Response, NextFunction } from 'express';

import { getConfigManager } from '../config/config.js';
import { verifyAccessToken } from '../utils/jwt.js';
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

/**
 * Check if auth is enabled based on environment variables.
 * Supports both ORCHESTRATOR_AUTH_ENABLED and ENABLE_AUTH for backwards compatibility.
 * Auth is enabled if ORCHESTRATOR_AUTH_ENABLED is not 'false' OR ENABLE_AUTH is not 'false'.
 *
 * Default behavior: auth is ENABLED if neither ORCHESTRATOR_AUTH_ENABLED nor ENABLE_AUTH
 * is set to 'false'. To disable, set ENABLE_AUTH=false.
 */
export function isAuthEnabled(): boolean {
  const orchestratorAuth = process.env.ORCHESTRATOR_AUTH_ENABLED;
  const enableAuth = process.env.ENABLE_AUTH;
  // Auth is enabled if either flag is set and not explicitly 'false'
  return (
    (orchestratorAuth !== 'false' && orchestratorAuth !== undefined) ||
    (enableAuth !== 'false' && enableAuth !== undefined)
  );
}

/**
 * Determines if the current request should be treated as an internal admin.
 * When auth is disabled (isAuthEnabled() === false), all requests are treated as internal admin.
 * Otherwise, checks if req.auth is set and isAdmin is true.
 * @param req - Express Request object
 * @returns true if request should have admin privileges
 */
export function isInternalAdmin(req: Request): boolean {
  if (!isAuthEnabled()) {
    return true;
  }
  return req.auth?.isAdmin === true;
}

/**
 * Determines if the current request should be treated as an internal user.
 * When auth is disabled (isAuthEnabled() === false), all requests are treated as internal users.
 * Otherwise, checks if req.user is set (valid JWT authentication).
 * @param req - Express Request object
 * @returns true if request should have user-level privileges
 */
export function isInternalUser(req: Request): boolean {
  if (!isAuthEnabled()) {
    return true;
  }
  return req.user !== undefined;
}

// In production, these should come from environment variables
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  enabled: isAuthEnabled(),
  apiKeys: process.env.API_KEYS?.split(',').filter(Boolean) ?? [],
  adminApiKeys: process.env.ADMIN_API_KEYS?.split(',').filter(Boolean) ?? [],
};

/**
 * Re-read API keys from environment variables.
 * Called by the config hot-reload cycle to pick up rotated secrets
 * without restarting the process.
 */
export function refreshAuthConfig(): AuthConfig {
  DEFAULT_AUTH_CONFIG.enabled = isAuthEnabled();
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
    user?: {
      id: string;
      role: 'admin' | 'user';
    };
    currentUser?: import('../storage/user-store.js').User;
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
 * Middleware to check if request is authenticated.
 * Protects sensitive endpoints (admin routes).
 *
 * Behavior:
 * - When auth is disabled (!config.enabled): Sets req.auth = { isAdmin: true, apiKey: 'internal' }
 *   and calls next() — treats the request as internal admin.
 * - When JWT is valid: Sets req.user = { id, role } and req.auth = { apiKey, isAdmin }, then calls next().
 * - On JWT failure: Falls through to API key check.
 */
export function requireAuth(
  config: AuthConfig = DEFAULT_AUTH_CONFIG
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // If auth is disabled, set req.auth to internal admin and allow request
    if (!DEFAULT_AUTH_CONFIG.enabled) {
      req.auth = { isAdmin: true, apiKey: 'internal' };
      next();
      return;
    }

    // Check for JWT token first (Bearer token in Authorization header)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = verifyAccessToken(token);
        // JWT is valid - set req.user with userId and role
        req.user = {
          id: payload.userId,
          role: payload.role,
        };
        // Also set req.auth for backward compatibility
        req.auth = {
          apiKey: token,
          isAdmin: payload.role === 'admin',
        };
        next();
        return;
      } catch (err) {
        logger.warn('JWT verification failed for Bearer token', {
          path: req.path,
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(401).json({
          error: 'Authentication failed',
          message: 'Invalid Bearer token',
        });
        return;
      }
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
 * Middleware to require admin privileges.
 * Use after requireAuth middleware.
 *
 * Behavior:
 * - When auth is disabled (!config.enabled): All requests pass through (dev mode).
 * - When req.auth.isAdmin === true: Pass through.
 * - Otherwise: Returns 403 Forbidden.
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

export function initAuthConfigSubscription(): void {
  getConfigManager().onChange(config => {
    if (config.security) {
      refreshAuthConfig();
    }
  });
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
