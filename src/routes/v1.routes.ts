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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

export const v1Router = Router();

v1Router.post('/chat/completions', asyncHandler(handleChatCompletions));
v1Router.post('/completions', asyncHandler(handleCompletions));
v1Router.post('/embeddings', asyncHandler(handleOpenAIEmbeddings));
v1Router.get('/models', asyncHandler(handleListModels));
v1Router.get('/models/:model', asyncHandler(handleGetModel));

// Server-specific routes (/v1/:endpoint--$serverid) for testing/debugging
v1Router.post('/chat/completions--:serverId', asyncHandler(handleChatCompletionsToServer));
v1Router.post('/completions--:serverId', asyncHandler(handleCompletionsToServer));
v1Router.post('/embeddings--:serverId', asyncHandler(handleOpenAIEmbeddingsToServer));
