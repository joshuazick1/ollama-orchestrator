/**
 * orchestrator.ts
 * Barrel – re-exports all sub-routers and provides a composite default export for tests.
 */
import { Router } from 'express';

import { adminRouter } from './admin.routes.js';
import { inferenceRouter } from './inference.routes.js';
import { monitoringRouter } from './monitoring.routes.js';
import { v1Router } from './v1.routes.js';

export { monitoringRouter, adminRouter, inferenceRouter, v1Router };

// Composite router for integration tests that mount everything at one base path
const router = Router();
router.use('/', monitoringRouter);
router.use('/', adminRouter);
router.use('/', inferenceRouter);
router.use('/', v1Router);

export default router;
