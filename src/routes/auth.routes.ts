/**
 * auth.routes.ts
 * Authentication endpoints: login, logout, refresh, me
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';

import { requireAuth, isAuthEnabled, DEFAULT_AUTH_CONFIG } from '../middleware/auth.js';
import { generateCsrfToken, validateCsrfToken } from '../middleware/csrf.js';
import { getUserStore } from '../storage/user-store.js';
import {
  signToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  setTokenCookie,
  setRefreshTokenCookie,
  clearTokenCookie,
  clearRefreshTokenCookie,
  getTokenFromCookie,
  getRefreshTokenFromCookie,
} from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

function safeUserResponse(user: { id: string; username: string; email: string; role: string }) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

export const authRouter = Router();

authRouter.get(
  '/csrf-token',
  (req, res, next) => {
    generateCsrfToken(req, res, next);
  },
  (req: Request, res: Response) => {
    res.status(200).json({ message: 'CSRF token set' });
  }
);

authRouter.post(
  '/login',
  validateCsrfToken,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.issues.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      });
      return;
    }

    const { username, password } = parsed.data;
    const userStore = getUserStore();

    const user = await userStore.validatePassword(username, password);
    if (!user) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid username or password',
      });
      return;
    }

    const accessToken = signToken(user.id, user.role as 'admin' | 'user');
    const { token: refreshToken } = generateRefreshToken(user.id);

    setTokenCookie(res, accessToken);
    setRefreshTokenCookie(res, refreshToken);

    logger.info(`User logged in: ${username}`);

    res.status(200).json({
      user: safeUserResponse(user),
    });
  })
);

authRouter.post(
  '/logout',
  validateCsrfToken,
  asyncHandler((_req: Request, res: Response) => {
    clearTokenCookie(res);
    clearRefreshTokenCookie(res);

    res.status(200).json({ message: 'Logged out successfully' });
  })
);

authRouter.post(
  '/refresh',
  validateCsrfToken,
  asyncHandler((req: Request, res: Response) => {
    const refreshToken = getRefreshTokenFromCookie(req);
    if (!refreshToken) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No refresh token provided',
      });
      return;
    }

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      res.status(401).json({
        error: 'Invalid refresh token',
        message: 'Refresh token is invalid or expired',
      });
      return;
    }

    const userStore = getUserStore();
    const user = userStore.getUserById(payload.userId);
    if (!user) {
      res.status(401).json({
        error: 'User not found',
        message: 'User associated with refresh token no longer exists',
      });
      return;
    }

    const accessToken = signToken(user.id, user.role as 'admin' | 'user');
    setTokenCookie(res, accessToken);

    logger.info(`Access token refreshed for user: ${user.username}`);

    res.status(200).json({
      user: safeUserResponse(user),
    });
  })
);

authRouter.get('/status', (req: Request, res: Response) => {
  const userStore = getUserStore();
  const adminCount = userStore.listUsersByRole('admin').length;
  const enabled = isAuthEnabled();
  const response: { enabled: boolean; setupRequired?: boolean } = { enabled };
  if (enabled && adminCount === 0) {
    response.setupRequired = true;
  }
  res.json(response);
});

authRouter.get(
  '/me',
  requireAuth(),
  asyncHandler((req: Request, res: Response) => {
    const userStore = getUserStore();
    const needsSetup =
      userStore.listUsersByRole('admin').length === 0 && DEFAULT_AUTH_CONFIG.enabled;

    // When auth is disabled, return a default admin user so frontend doesn't redirect to login
    if (!DEFAULT_AUTH_CONFIG.enabled) {
      res.status(200).json({
        user: {
          id: 'default',
          username: 'admin',
          email: 'admin@local',
          role: 'admin',
        },
        needsSetup,
      });
      return;
    }

    const token = getTokenFromCookie(req);
    if (!token) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No access token provided',
      });
      return;
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      res.status(401).json({
        error: 'Invalid access token',
        message: 'Access token is invalid or expired',
      });
      return;
    }

    const user = userStore.getUserById(payload.userId);
    if (!user) {
      res.status(401).json({
        error: 'User not found',
        message: 'User no longer exists',
      });
      return;
    }

    res.status(200).json({
      user: safeUserResponse(user),
      needsSetup,
    });
  })
);
