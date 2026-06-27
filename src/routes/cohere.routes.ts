import { Router, type Request, type Response, type NextFunction } from 'express';

import { handleChat, handleChatToServer } from '../controllers/cohere-controller.js';
import { requireAuth } from '../middleware/auth.js';

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

export const cohereRouter = Router();

cohereRouter.post('/chat', requireAuth(), asyncHandler(handleChat));
cohereRouter.post('/chat--:serverId', requireAuth(), asyncHandler(handleChatToServer));
