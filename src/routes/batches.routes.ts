import { Router, type Request, type Response, type NextFunction } from 'express';

import {
  handleCreateBatch,
  handleListBatches,
  handleGetBatch,
  handleCancelBatch,
  handleGetBatchResults,
} from '../controllers/batches-controller.js';
import { requireAuth } from '../middleware/auth.js';

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

export const batchesRouter = Router();

batchesRouter.post('/messages/batches', requireAuth(), asyncHandler(handleCreateBatch));
batchesRouter.get('/messages/batches', asyncHandler(handleListBatches));
batchesRouter.get('/messages/batches/:id', asyncHandler(handleGetBatch));
batchesRouter.post('/messages/batches/:id/cancel', requireAuth(), asyncHandler(handleCancelBatch));
batchesRouter.get('/messages/batches/:id/results', asyncHandler(handleGetBatchResults));
