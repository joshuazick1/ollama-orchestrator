/**
 * v1.routes.ts
 * OpenAI-compatible endpoints mounted at /v1/*.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import {
  handleChatCompletions,
  handleCompletions,
  handleOpenAIEmbeddings,
  handleListModels,
  handleGetModel,
  handleChatCompletionsToServer,
  handleCompletionsToServer,
  handleOpenAIEmbeddingsToServer,
} from '../controllers/openai-controller.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

export const v1Router = Router();

v1Router.post('/chat/completions', requireAuth(), asyncHandler(handleChatCompletions));
v1Router.post('/completions', requireAuth(), asyncHandler(handleCompletions));
v1Router.post('/embeddings', requireAuth(), asyncHandler(handleOpenAIEmbeddings));
v1Router.get('/models', optionalAuth(), asyncHandler(handleListModels));
v1Router.get('/models/:model', optionalAuth(), asyncHandler(handleGetModel));

// Server-specific routes (/v1/:endpoint--$serverid) for testing/debugging
v1Router.post(
  '/chat/completions--:serverId',
  requireAuth(),
  asyncHandler(handleChatCompletionsToServer)
);
v1Router.post('/completions--:serverId', requireAuth(), asyncHandler(handleCompletionsToServer));
v1Router.post(
  '/embeddings--:serverId',
  requireAuth(),
  asyncHandler(handleOpenAIEmbeddingsToServer)
);
