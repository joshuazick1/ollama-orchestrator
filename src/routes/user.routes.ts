import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';

import { DEFAULT_AUTH_CONFIG } from '../middleware/auth.js';
import { validateCsrfToken } from '../middleware/csrf.js';
import { getUserStore, type User } from '../storage/user-store.js';
import { verifyAccessToken, getTokenFromCookie } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

function safeUserResponseNoApiKey(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

const createUserSchema = z.object({
  username: z.string().min(1, 'Username is required').max(50, 'Username too long'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['user', 'admin']).optional().default('user'),
});

const updateUserSchema = z.object({
  username: z.string().min(1).max(50).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(['user', 'admin']).optional(),
});

const grantServerAccessSchema = z.object({
  serverId: z.string().min(1, 'Server ID is required'),
});

const grantModelAccessSchema = z.object({
  serverId: z.string().min(1, 'Server ID is required'),
  model: z.string().min(1, 'Model name is required'),
});

export const userRouter = Router();

userRouter.use(
  asyncHandler((req: Request, res: Response, next: NextFunction) => {
    // If auth is disabled, bypass token requirement
    if (!DEFAULT_AUTH_CONFIG.enabled) {
      req.currentUser = {
        id: 'default',
        username: 'admin',
        email: 'admin@local',
        role: 'admin',
        isActive: true,
      } as User;
      next();
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

    const userStore = getUserStore();
    const currentUser = userStore.getUserById(payload.userId);
    if (!currentUser) {
      res.status(401).json({
        error: 'User not found',
        message: 'User no longer exists',
      });
      return;
    }

    req.currentUser = currentUser;
    next();
  })
);

userRouter.get(
  '/users',
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    if (currentUser.role !== 'admin') {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required',
      });
      return;
    }

    const userStore = getUserStore();
    const users = userStore.listUsers();

    res.status(200).json({
      users: users.map(u => safeUserResponseNoApiKey(u)),
    });
  })
);

userRouter.post(
  '/users',
  validateCsrfToken,
  asyncHandler(async (req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    if (currentUser.role !== 'admin') {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required',
      });
      return;
    }

    const parsed = createUserSchema.safeParse(req.body);
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

    const { username, email, password, role } = parsed.data;

    if (role === 'admin') {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Non-admin users cannot create admin users',
      });
      return;
    }

    const userStore = getUserStore();

    const existing = userStore.getUserByUsername(username);
    if (existing) {
      res.status(400).json({
        error: 'Username already exists',
        message: 'A user with this username already exists',
      });
      return;
    }

    const existingEmail = userStore.getUserByEmail(email);
    if (existingEmail) {
      res.status(400).json({
        error: 'Email already exists',
        message: 'A user with this email already exists',
      });
      return;
    }

    const user = await userStore.createUser(username, email, password, role);

    logger.info(`User created by admin ${currentUser.username}: ${username}`);

    res.status(201).json({
      user: safeUserResponseNoApiKey(user),
    });
  })
);

userRouter.get(
  '/users/:id',
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const targetUserId = req.params.id as string;

    if (currentUser.role !== 'admin' && currentUser.id !== targetUserId) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only view your own user info',
      });
      return;
    }

    const userStore = getUserStore();
    const user = userStore.getUserById(targetUserId);

    if (!user) {
      res.status(404).json({
        error: 'Not found',
        message: 'User not found',
      });
      return;
    }

    res.status(200).json({
      user: safeUserResponseNoApiKey(user),
    });
  })
);

userRouter.put(
  '/users/:id',
  validateCsrfToken,
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const targetUserId = req.params.id as string;

    const isSelf = currentUser.id === targetUserId;
    const isAdmin = currentUser.role === 'admin';

    if (!isSelf && !isAdmin) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only update your own user info',
      });
      return;
    }

    const parsed = updateUserSchema.safeParse(req.body);
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

    const { role, ...otherUpdates } = parsed.data;

    if (role !== undefined && !isAdmin) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Non-admin users cannot modify roles',
      });
      return;
    }

    if (role === 'admin' && !isAdmin) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Non-admin users cannot grant admin role',
      });
      return;
    }

    const userStore = getUserStore();
    const existing = userStore.getUserById(targetUserId);

    if (!existing) {
      res.status(404).json({
        error: 'Not found',
        message: 'User not found',
      });
      return;
    }

    if (parsed.data.username && parsed.data.username !== existing.username) {
      const usernameExists = userStore.getUserByUsername(parsed.data.username);
      if (usernameExists) {
        res.status(400).json({
          error: 'Username already exists',
          message: 'A user with this username already exists',
        });
        return;
      }
    }

    if (parsed.data.email && parsed.data.email !== existing.email) {
      const emailExists = userStore.getUserByEmail(parsed.data.email);
      if (emailExists) {
        res.status(400).json({
          error: 'Email already exists',
          message: 'A user with this email already exists',
        });
        return;
      }
    }

    const updates: { username?: string; email?: string; role?: string } = {};
    if (otherUpdates.username) {
      updates.username = otherUpdates.username;
    }
    if (otherUpdates.email) {
      updates.email = otherUpdates.email;
    }
    if (role) {
      updates.role = role;
    }

    if (Object.keys(updates).length === 0 && !parsed.data.password) {
      res.status(400).json({
        error: 'No updates provided',
        message: 'At least one field must be updated',
      });
      return;
    }

    if (updates.username || updates.email || updates.role) {
      userStore.updateUser(targetUserId, updates);
    }

    logger.info(`User updated by ${currentUser.username}: ${targetUserId}`);

    const updatedUser = userStore.getUserById(targetUserId);

    res.status(200).json({
      user: safeUserResponseNoApiKey(updatedUser!),
    });
  })
);

userRouter.delete(
  '/users/:id',
  validateCsrfToken,
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const targetUserId = req.params.id as string;

    if (currentUser.role !== 'admin') {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required',
      });
      return;
    }

    if (currentUser.id === targetUserId) {
      res.status(400).json({
        error: 'Cannot delete yourself',
        message: 'Admins cannot delete their own account',
      });
      return;
    }

    const userStore = getUserStore();
    const user = userStore.getUserById(targetUserId);

    if (!user) {
      res.status(404).json({
        error: 'Not found',
        message: 'User not found',
      });
      return;
    }

    userStore.deleteUser(targetUserId);

    logger.info(`User deleted by admin ${currentUser.username}: ${targetUserId}`);

    res.status(200).json({
      message: 'User deactivated successfully',
    });
  })
);

userRouter.post(
  '/users/:id/access/server',
  validateCsrfToken,
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const targetUserId = req.params.id as string;

    const isSelf = currentUser.id === targetUserId;
    const isAdmin = currentUser.role === 'admin';

    if (!isSelf && !isAdmin) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only grant access to yourself',
      });
      return;
    }

    const parsed = grantServerAccessSchema.safeParse(req.body);
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

    const { serverId } = parsed.data;

    if (!isAdmin && currentUser.role !== 'admin') {
      const userStore = getUserStore();
      const currentHasAccess = userStore.hasServerAccess(currentUser.id, serverId);
      if (!currentHasAccess) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You cannot grant access to servers you do not have access to',
        });
        return;
      }
    }

    const userStore = getUserStore();
    const targetUser = userStore.getUserById(targetUserId);
    if (!targetUser) {
      res.status(404).json({
        error: 'Not found',
        message: 'Target user not found',
      });
      return;
    }

    userStore.grantServerAccess(targetUserId, serverId);

    logger.info(
      `Server access ${serverId} granted to user ${targetUserId} by ${currentUser.username}`
    );

    res.status(201).json({
      message: 'Server access granted',
    });
  })
);

userRouter.delete(
  '/users/:id/access/server/:serverId',
  validateCsrfToken,
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const targetUserId = req.params.id as string;
    const serverId = req.params.serverId as string;

    const isSelf = currentUser.id === targetUserId;
    const isAdmin = currentUser.role === 'admin';

    if (!isSelf && !isAdmin) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only revoke access for yourself',
      });
      return;
    }

    const userStore = getUserStore();
    const targetUser = userStore.getUserById(targetUserId);
    if (!targetUser) {
      res.status(404).json({
        error: 'Not found',
        message: 'Target user not found',
      });
      return;
    }

    const revoked = userStore.revokeServerAccess(targetUserId, serverId);
    if (!revoked) {
      res.status(404).json({
        error: 'Not found',
        message: 'Server access not found',
      });
      return;
    }

    logger.info(
      `Server access ${serverId} revoked for user ${targetUserId} by ${currentUser.username}`
    );

    res.status(200).json({
      message: 'Server access revoked',
    });
  })
);

userRouter.post(
  '/users/:id/access/model',
  validateCsrfToken,
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const targetUserId = req.params.id as string;

    const isSelf = currentUser.id === targetUserId;
    const isAdmin = currentUser.role === 'admin';

    if (!isSelf && !isAdmin) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only grant access to yourself',
      });
      return;
    }

    const parsed = grantModelAccessSchema.safeParse(req.body);
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

    const { serverId, model } = parsed.data;

    if (!isAdmin) {
      const userStore = getUserStore();
      const currentHasAccess = userStore.hasModelAccess(currentUser.id, serverId, model);
      if (!currentHasAccess) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You cannot grant access to models you do not have access to',
        });
        return;
      }
    }

    const userStore = getUserStore();
    const targetUser = userStore.getUserById(targetUserId);
    if (!targetUser) {
      res.status(404).json({
        error: 'Not found',
        message: 'Target user not found',
      });
      return;
    }

    userStore.grantModelAccess(targetUserId, serverId, model);

    logger.info(
      `Model access ${serverId}/${model} granted to user ${targetUserId} by ${currentUser.username}`
    );

    res.status(201).json({
      message: 'Model access granted',
    });
  })
);

userRouter.delete(
  '/users/:id/access/model/:serverId/:model',
  validateCsrfToken,
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const targetUserId = req.params.id as string;
    const serverId = req.params.serverId as string;
    const model = req.params.model as string;

    const isSelf = currentUser.id === targetUserId;
    const isAdmin = currentUser.role === 'admin';

    if (!isSelf && !isAdmin) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only revoke access for yourself',
      });
      return;
    }

    const userStore = getUserStore();
    const targetUser = userStore.getUserById(targetUserId);
    if (!targetUser) {
      res.status(404).json({
        error: 'Not found',
        message: 'Target user not found',
      });
      return;
    }

    const revoked = userStore.revokeModelAccess(targetUserId, serverId, model);
    if (!revoked) {
      res.status(404).json({
        error: 'Not found',
        message: 'Model access not found',
      });
      return;
    }

    logger.info(
      `Model access ${serverId}/${model} revoked for user ${targetUserId} by ${currentUser.username}`
    );

    res.status(200).json({
      message: 'Model access revoked',
    });
  })
);

userRouter.get(
  '/users/:id/access',
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const targetUserId = req.params.id as string;

    if (currentUser.role !== 'admin' && currentUser.id !== targetUserId) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only view your own access',
      });
      return;
    }

    const userStore = getUserStore();
    const targetUser = userStore.getUserById(targetUserId);
    if (!targetUser) {
      res.status(404).json({
        error: 'Not found',
        message: 'User not found',
      });
      return;
    }

    const serverAccess = userStore.listServerAccess(targetUserId);
    const modelAccess = userStore.listModelAccess(targetUserId);

    res.status(200).json({
      serverAccess,
      modelAccess,
    });
  })
);

userRouter.post(
  '/users/:id/rotate-api-key',
  validateCsrfToken,
  asyncHandler((req: Request, res: Response) => {
    const currentUser = req.currentUser!;
    const targetUserId = req.params.id as string;

    const isSelf = currentUser.id === targetUserId;
    const isAdmin = currentUser.role === 'admin';

    if (!isSelf && !isAdmin) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You can only rotate your own API key',
      });
      return;
    }

    const userStore = getUserStore();
    const targetUser = userStore.getUserById(targetUserId);
    if (!targetUser) {
      res.status(404).json({
        error: 'Not found',
        message: 'User not found',
      });
      return;
    }

    const newApiKey = userStore.generateApiKey(targetUserId);
    if (!newApiKey) {
      res.status(500).json({
        error: 'Failed to generate API key',
        message: 'Could not generate new API key',
      });
      return;
    }

    logger.info(`API key rotated for user ${targetUserId} by ${currentUser.username}`);

    res.status(200).json({
      apiKey: newApiKey,
      message:
        'API key rotated successfully. Store this key securely - it will not be shown again.',
    });
  })
);
