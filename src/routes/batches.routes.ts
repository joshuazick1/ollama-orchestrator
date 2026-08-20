import { Router } from 'express';

import {
  handleCreateBatch,
  handleListBatches,
  handleGetBatch,
  handleCancelBatch,
  handleGetBatchResults,
} from '../controllers/batches-controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';

export const batchesRouter = Router();

batchesRouter.post('/messages/batches', requireAuth(), asyncHandler(handleCreateBatch));
batchesRouter.get('/messages/batches', asyncHandler(handleListBatches));
batchesRouter.get('/messages/batches/:id', asyncHandler(handleGetBatch));
batchesRouter.post('/messages/batches/:id/cancel', requireAuth(), asyncHandler(handleCancelBatch));
batchesRouter.get('/messages/batches/:id/results', asyncHandler(handleGetBatchResults));
