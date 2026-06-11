import { Router } from 'express';

import { adminRouter } from './admin.routes.js';
import { anthropicRouter } from './anthropic.routes.js';
import { authRouter } from './auth.routes.js';
import { inferenceRouter } from './inference.routes.js';
import { monitoringRouter } from './monitoring.routes.js';
import { userRouter } from './user.routes.js';
import { v1Router } from './v1.routes.js';

export {
  monitoringRouter,
  adminRouter,
  inferenceRouter,
  v1Router,
  anthropicRouter,
  authRouter,
  userRouter,
};

const router = Router();
router.use('/', monitoringRouter);
router.use('/', adminRouter);
router.use('/', inferenceRouter);
router.use('/', v1Router);
router.use('/', anthropicRouter);
router.use('/', authRouter);
router.use('/', userRouter);

export default router;
