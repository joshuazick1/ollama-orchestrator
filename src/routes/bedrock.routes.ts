import { Router, type Request, type Response, type NextFunction } from 'express';

import {
  handleBedrockInvoke,
  handleBedrockInvokeStream,
} from '../controllers/bedrock-controller.js';

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

export const bedrockRouter = Router();

bedrockRouter.post('/model/:modelId/invoke', asyncHandler(handleBedrockInvoke));
bedrockRouter.post(
  '/model/:modelId/invoke-with-response-stream',
  asyncHandler(handleBedrockInvokeStream)
);
