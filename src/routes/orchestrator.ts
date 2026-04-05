import { Router } from 'express';

import { adminRouter } from './admin.routes.js';
import { anthropicRouter } from './anthropic.routes.js';
import { inferenceRouter } from './inference.routes.js';
import { monitoringRouter } from './monitoring.routes.js';
import { v1Router } from './v1.routes.js';

export { monitoringRouter, adminRouter, inferenceRouter, v1Router, anthropicRouter };

const router = Router();
router.use('/', monitoringRouter);
router.use('/', adminRouter);
router.use('/', inferenceRouter);
router.use('/', v1Router);
router.use('/', anthropicRouter);

export default router;
