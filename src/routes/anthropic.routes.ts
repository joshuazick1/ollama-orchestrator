import { Router, type Request, type Response, type NextFunction } from 'express';

import { handleMessages } from '../controllers/anthropic-controller.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

export const anthropicRouter = Router();

anthropicRouter.post('/messages', asyncHandler(handleMessages));
