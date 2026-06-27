import type { Request, Response } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/csrf.js');
vi.mock('../../src/utils/jwt.js');
vi.mock('../../src/storage/user-store.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import * as csrfModule from '../../src/middleware/csrf.js';
import { userRouter } from '../../src/routes/user.routes.js';
import * as userStoreModule from '../../src/storage/user-store.js';
import * as jwtModule from '../../src/utils/jwt.js';
import { createMockReq, createMockRes } from '../utils/mock-express.js';

const mockJwt = vi.mocked(jwtModule);
const mockUserStore = vi.mocked(userStoreModule);
const mockCsrf = vi.mocked(csrfModule);

function findRouteIndex(router: any, method: string, path: string): number {
  const methodLower = method.toLowerCase();
  const segments = path.split('/').filter(Boolean);

  for (let i = 0; i < router.stack.length; i++) {
    const layer = router.stack[i];
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
    for (let j = 0; j < routeSegments.length; j++) {
      if (routeSegments[j].startsWith(':')) {
        continue;
      }
      if (routeSegments[j] !== segments[j]) {
        match = false;
        break;
      }
    }

    if (match) {
      return i;
    }
  }
  return -1;
}

function runHandlerSync(
  router: any,
  method: string,
  path: string,
  req: Request,
  res: Response
): void {
  const routeIndex = findRouteIndex(router, method, path);
  if (routeIndex < 0) {
    throw new Error(`Route ${method} ${path} not found`);
  }

  const routeLayer = router.stack[routeIndex];
  const routeSegments = routeLayer.route.path.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);

  for (let i = 0; i < routeSegments.length; i++) {
    if (routeSegments[i].startsWith(':')) {
      const paramName = routeSegments[i].slice(1);
      req.params[paramName] = pathSegments[i];
    }
  }

  // Run all layers from start up to and including the matched route.
  let layerIdx = 0;
  const runLayer = (): void => {
    while (layerIdx <= routeIndex) {
      const layer = router.stack[layerIdx++];
      if (typeof layer.handle !== 'function') {
        continue;
      }
      let nextCalled = false;
      const next = (): void => {
        if (!nextCalled) {
          nextCalled = true;
          runLayer();
        }
      };
      layer.handle(req, res, next);
      return;
    }
  };

  // Also iterate through route.stack handlers (per-route middlewares + handler).
  const runRouteHandlers = (): void => {
    const handlers = routeLayer.route.stack;
    let handlerIdx = 0;
    const next = (): void => {
      if (handlerIdx < handlers.length) {
        const handler = handlers[handlerIdx++].handle;
        let nextCalled = false;
        const onNext = (): void => {
          if (!nextCalled) {
            nextCalled = true;
            next();
          }
        };
        handler(req, res, onNext);
      }
    };
    next();
  };

  runLayer();
  // After all router.stack layers run, then run the per-route handlers
  // This simulates the actual Express request flow
  runRouteHandlers();
}

describe('user.routes', () => {
  const mockUser = {
    id: 'user-123',
    username: 'testuser',
    email: 'test@example.com',
    role: 'user',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const mockAdmin = {
    id: 'admin-123',
    username: 'admin',
    email: 'admin@example.com',
    role: 'admin',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockCsrf.validateCsrfToken.mockImplementation((_req: Request, _res: Response, next: Function) =>
      next()
    );
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should export userRouter', () => {
    expect(userRouter).toBeDefined();
    expect(typeof userRouter).toBe('function');
  });

  it('should have GET /users route', () => {
    const idx = findRouteIndex(userRouter, 'GET', '/users');
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it('should have POST /users route', () => {
    const idx = findRouteIndex(userRouter, 'POST', '/users');
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it('should have GET /users/:id route', () => {
    const idx = findRouteIndex(userRouter, 'GET', '/users/user-123');
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it('should have DELETE /users/:id route', () => {
    const idx = findRouteIndex(userRouter, 'DELETE', '/users/user-123');
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it('should return 401 when no token provided', () => {
    mockJwt.getTokenFromCookie.mockReturnValue(null);

    const mockReq = createMockReq({ method: 'GET', path: '/users', cookies: {} });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'GET', '/users', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 for invalid token', () => {
    mockJwt.getTokenFromCookie.mockReturnValue('invalid');
    mockJwt.verifyAccessToken.mockImplementation(() => {
      throw new Error('Invalid');
    });

    const mockReq = createMockReq({
      method: 'GET',
      path: '/users',
      cookies: { auth_token: 'invalid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'GET', '/users', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(401);
  });

  it('should return 403 for non-admin listing users', () => {
    const mockUserStoreInstance = { getUserById: vi.fn().mockReturnValue(mockUser) };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'user-123',
      role: 'user',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'GET',
      path: '/users',
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'GET', '/users', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  it('should list users for admin', () => {
    const mockUserStoreInstance = {
      getUserById: vi.fn().mockReturnValue(mockAdmin),
      listUsers: vi.fn().mockReturnValue([mockUser, mockAdmin]),
    };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'admin-123',
      role: 'admin',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'GET',
      path: '/users',
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'GET', '/users', mockReq, mockRes);

    expect(mockUserStoreInstance.listUsers).toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it('should return 404 when user not found for GET /users/:id', () => {
    // getUserById is called twice: once in middleware (for currentUser from token),
    // once in route handler (for target user). Use mockReturnValueOnce to handle
    // different return values based on call order.
    const mockUserStoreInstance = {
      getUserById: vi
        .fn()
        .mockReturnValueOnce(mockUser) // middleware: currentUser lookup -> valid user
        .mockReturnValueOnce(undefined), // handler: target user 'other' not found
    };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'user-123',
      role: 'user',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'GET',
      path: '/users/other',
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'GET', '/users/other', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
  });

  it('should return 400 when no updates provided for PUT', () => {
    const mockUserStoreInstance = { getUserById: vi.fn().mockReturnValue(mockUser) };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'user-123',
      role: 'user',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'PUT',
      path: '/users/user-123',
      body: {},
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'PUT', '/users/user-123', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('should delete user successfully for admin', () => {
    const mockUserStoreInstance = {
      getUserById: vi.fn().mockReturnValueOnce(mockAdmin).mockReturnValueOnce(mockUser),
      deleteUser: vi.fn().mockReturnValue(true),
    };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'admin-123',
      role: 'admin',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'DELETE',
      path: '/users/user-123',
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'DELETE', '/users/user-123', mockReq, mockRes);

    expect(mockUserStoreInstance.deleteUser).toHaveBeenCalledWith('user-123');
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it('should return 400 for admin self-delete', () => {
    const mockUserStoreInstance = { getUserById: vi.fn().mockReturnValue(mockAdmin) };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'admin-123',
      role: 'admin',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'DELETE',
      path: '/users/admin-123',
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'DELETE', '/users/admin-123', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('should grant server access successfully', () => {
    const mockUserStoreInstance = {
      getUserById: vi.fn().mockReturnValue(mockUser),
      hasServerAccess: vi.fn().mockReturnValue(true),
      grantServerAccess: vi.fn(),
    };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'user-123',
      role: 'user',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'POST',
      path: '/users/user-123/access/server',
      body: { serverId: 'server-1' },
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'POST', '/users/user-123/access/server', mockReq, mockRes);

    expect(mockUserStoreInstance.grantServerAccess).toHaveBeenCalledWith('user-123', 'server-1');
    expect(mockRes.status).toHaveBeenCalledWith(201);
  });

  it('should grant model access successfully', () => {
    const mockUserStoreInstance = {
      getUserById: vi.fn().mockReturnValue(mockUser),
      hasModelAccess: vi.fn().mockReturnValue(true),
      grantModelAccess: vi.fn(),
    };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'user-123',
      role: 'user',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'POST',
      path: '/users/user-123/access/model',
      body: { serverId: 'server-1', model: 'llama3' },
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'POST', '/users/user-123/access/model', mockReq, mockRes);

    expect(mockUserStoreInstance.grantModelAccess).toHaveBeenCalledWith(
      'user-123',
      'server-1',
      'llama3'
    );
    expect(mockRes.status).toHaveBeenCalledWith(201);
  });

  it('should return access list successfully', () => {
    const mockUserStoreInstance = {
      getUserById: vi.fn().mockReturnValue(mockUser),
      listServerAccess: vi.fn().mockReturnValue([{ serverId: 'server-1', grantedAt: Date.now() }]),
      listModelAccess: vi
        .fn()
        .mockReturnValue([{ serverId: 'server-1', model: 'llama3', grantedAt: Date.now() }]),
    };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'user-123',
      role: 'user',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'GET',
      path: '/users/user-123/access',
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'GET', '/users/user-123/access', mockReq, mockRes);

    expect(mockUserStoreInstance.listServerAccess).toHaveBeenCalledWith('user-123');
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it('should rotate API key successfully', () => {
    const mockUserStoreInstance = {
      getUserById: vi.fn().mockReturnValue(mockUser),
      generateApiKey: vi.fn().mockReturnValue('new-api-key'),
    };
    mockUserStore.getUserStore.mockReturnValue(mockUserStoreInstance as any);

    mockJwt.getTokenFromCookie.mockReturnValue('valid');
    mockJwt.verifyAccessToken.mockReturnValue({
      userId: 'user-123',
      role: 'user',
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + 3600000,
    } as any);

    const mockReq = createMockReq({
      method: 'POST',
      path: '/users/user-123/rotate-api-key',
      cookies: { auth_token: 'valid' },
    });
    const mockRes = createMockRes();

    runHandlerSync(userRouter, 'POST', '/users/user-123/rotate-api-key', mockReq, mockRes);

    expect(mockUserStoreInstance.generateApiKey).toHaveBeenCalledWith('user-123');
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });
});
