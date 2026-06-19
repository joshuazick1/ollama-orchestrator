import { Router } from 'express';
import { z } from 'zod';

import { createAdminRateLimiter } from '../middleware/rate-limiter.js';
import { getUserStore } from '../storage/user-store.js';

const setupSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email().optional(),
  password: z.string().min(16).max(128),
});

export const setupRouter = Router();
const rateLimiter = createAdminRateLimiter();

setupRouter.post('/setup', rateLimiter, async (req, res) => {
  const userStore = getUserStore();

  if (userStore.listUsersByRole('admin').length > 0) {
    return res.status(403).json({ error: 'Setup already completed' });
  }

  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }

  const { username, email, password } = parsed.data;
  try {
    await userStore.createUser(
      username.trim(),
      email || `${username.trim()}@local`,
      password,
      'admin'
    );
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create user' });
  }

  res.json({ success: true, message: 'Admin created. Please log in.' });
});
