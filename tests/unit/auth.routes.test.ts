import type { Request, Response } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/csrf.js');
vi.mock('../../src/middleware/auth.js', () => ({
  isAuthEnabled: vi.fn().mockReturnValue(true),
  DEFAULT_AUTH_CONFIG: { enabled: true, apiKeys: [], adminApiKeys: [] },
  requireAuth: vi.fn(() => (_req: Request, _res: Response, next: Function) => next()),
  requireAdmin: vi.fn(),
  optionalAuth: vi.fn(),
  createAuthMiddleware: vi.fn(),
}));
vi.mock('../../src/utils/jwt.js');
vi.mock('../../src/storage/user-store.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import * as authModule from '../../src/middleware/auth.js';
import * as csrfModule from '../../src/middleware/csrf.js';
import { authRouter } from '../../src/routes/auth.routes.js';
import * as userStoreModule from '../../src/storage/user-store.js';
import * as jwtModule from '../../src/utils/jwt.js';
import { createMockReq, createMockRes } from '../utils/mock-express.js';

const mockJwt = vi.mocked(jwtModule);
const mockUserStore = vi.mocked(userStoreModule);
const mockCsrf = vi.mocked(csrfModule);

function findRouteHandler(router: any, method: string, path: string) {
  const methodLower = method.toLowerCase();
  const segments = path.split('/').filter(Boolean);

  for (const layer of router.stack) {
    if (!layer.route) {
      continue;
    }

    const routePath = layer.route.path;
    const routeMethod = Object.keys(layer.route.methods)[0];

    if (routeMethod !== methodLower) {
      continue;
    }

    const routeSegments = routePath.split('/').filter(Boolean);
    if (routeSegments.length !== segments.length) {
      continue;
    }

    let match = true;
    const params: Record<string, string> = {};

    for (let i = 0; i < routeSegments.length; i++) {
      if (routeSegments[i].startsWith(':')) {
        params[routeSegments[i].slice(1)] = segments[i];
      } else if (routeSegments[i] !== segments[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      return { layer, params };
    }
  }
  return null;
}

function runHandlerSync(
  router: any,
  method: string,
  path: string,
  req: Request,
  res: Response
): void {
  const route = findRouteHandler(router, method, path);
  if (!route) {
    throw new Error(`Route ${method} ${path} not found`);
  }

  const handlers = route.layer.route.stack;
  let idx = 0;

  const next = () => {
    if (idx < handlers.length) {
      const handler = handlers[idx++];
      if (typeof handler.handle === 'function') {
        handler.handle(req, res, next);
      }
    }
  };

  next();
}

describe('auth.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCsrf.validateCsrfToken.mockImplementation((_req: Request, _res: Response, next: Function) =>
      next()
    );
    mockCsrf.generateCsrfToken.mockImplementation((_req: Request, _res: Response, next: Function) =>
      next()
    );
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should export authRouter', () => {
    expect(authRouter).toBeDefined();
    expect(typeof authRouter).toBe('function');
  });

  it('should have GET /csrf-token route', () => {
    const route = findRouteHandler(authRouter, 'GET', '/csrf-token');
    expect(route).toBeDefined();
  });

  it('should have POST /login route', () => {
    const route = findRouteHandler(authRouter, 'POST', '/login');
    expect(route).toBeDefined();
  });

  it('should have POST /logout route', () => {
    const route = findRouteHandler(authRouter, 'POST', '/logout');
    expect(route).toBeDefined();
  });

  it('should have POST /refresh route', () => {
    const route = findRouteHandler(authRouter, 'POST', '/refresh');
    expect(route).toBeDefined();
  });

  it('should have GET /me route', () => {
    const route = findRouteHandler(authRouter, 'GET', '/me');
    expect(route).toBeDefined();
  });

  it('should handle GET /csrf-token', () => {
    const mockReq = createMockReq({ method: 'GET', path: '/csrf-token' });
    const mockRes = createMockRes();

    runHandlerSync(authRouter, 'GET', '/csrf-token', mockReq, mockRes);

    expect(mockCsrf.generateCsrfToken).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'CSRF token set' });
  });

  it('should handle POST /logout', () => {
    const mockReq = createMockReq({
      method: 'POST',
      path: '/logout',
      cookies: { 'csrf-token': 'valid' },
      headers: { 'x-csrf-token': 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(authRouter, 'POST', '/logout', mockReq, mockRes);

    expect(mockJwt.clearTokenCookie).toHaveBeenCalledWith(mockRes);
    expect(mockJwt.clearRefreshTokenCookie).toHaveBeenCalledWith(mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ message: 'Logged out successfully' });
  });

  it('should return 401 for /me when no token', () => {
    (authModule as any).isAuthEnabled = vi.fn().mockReturnValue(true);
    (authModule as any).DEFAULT_AUTH_CONFIG = { enabled: true, apiKeys: [], adminApiKeys: [] };

    mockJwt.getTokenFromCookie.mockReturnValue(null);

    const mockReq = createMockReq({ method: 'GET', path: '/me', cookies: {} });
    const mockRes = createMockRes();

    runHandlerSync(authRouter, 'GET', '/me', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Authentication required',
      message: 'No access token provided',
    });
  });

  it('should return 401 for /refresh when no refresh token', () => {
    mockJwt.getRefreshTokenFromCookie.mockReturnValue(null);

    const mockReq = createMockReq({
      method: 'POST',
      path: '/refresh',
      cookies: { 'csrf-token': 'valid' },
      headers: { 'x-csrf-token': 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(authRouter, 'POST', '/refresh', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Authentication required',
      message: 'No refresh token provided',
    });
  });

  it('should return 401 for /refresh when token invalid', () => {
    mockJwt.getRefreshTokenFromCookie.mockReturnValue('invalid-token');
    mockJwt.verifyRefreshToken.mockImplementation(() => {
      throw new Error('Invalid token');
    });

    const mockReq = createMockReq({
      method: 'POST',
      path: '/refresh',
      cookies: { 'csrf-token': 'valid', refresh_token: 'invalid-token' },
      headers: { 'x-csrf-token': 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(authRouter, 'POST', '/refresh', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Invalid refresh token',
      message: 'Refresh token is invalid or expired',
    });
  });

  it('should return 401 for /me when user not found', () => {
    const mockUserStoreInstance = { getUserById: vi.fn().mockReturnValue(undefined) };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid-token');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'user-123',
      role: 'user',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'GET',
      path: '/me',
      cookies: { auth_token: 'valid-token' },
    });
    const mockRes = createMockRes();

    runHandlerSync(authRouter, 'GET', '/me', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should return user for /me when token valid', () => {
    const mockUser = {
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      role: 'user',
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const mockUserStoreInstance = { getUserById: vi.fn().mockReturnValue(mockUser) };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid-token');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'user-123',
      role: 'user',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'GET',
      path: '/me',
      cookies: { auth_token: 'valid-token' },
    });
    const mockRes = createMockRes();

    runHandlerSync(authRouter, 'GET', '/me', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      user: { id: 'user-123', username: 'testuser', email: 'test@example.com', role: 'user' },
    });
  });

  it('should refresh token successfully', () => {
    const mockUser = {
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      role: 'user',
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const mockUserStoreInstance = { getUserById: vi.fn().mockReturnValue(mockUser) };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getRefreshTokenFromCookie.mockReturnValue('valid-refresh-token');
    mockJwt.verifyRefreshToken.mockReturnValue({
      userId: 'user-123',
      type: 'refresh',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);
    mockJwt.signToken.mockReturnValue('new-access-token');
    mockJwt.setTokenCookie.mockReturnThis();

    const mockReq = createMockReq({
      method: 'POST',
      path: '/refresh',
      cookies: { 'csrf-token': 'valid', refresh_token: 'valid-refresh-token' },
      headers: { 'x-csrf-token': 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(authRouter, 'POST', '/refresh', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it('should handle POST /login route structure', () => {
    const route = findRouteHandler(authRouter, 'POST', '/login');
    expect(route).toBeDefined();
  });
});
