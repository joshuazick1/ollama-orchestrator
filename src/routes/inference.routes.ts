/**
 * inference.routes.ts
 * Ollama-compatible inference endpoints mounted at /api/*.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';

import {
  handleTags,
  handleGenerate,
  handleChat,
  handleEmbeddings,
  handlePs,
  handleVersion,
  handleShow,
  handleEmbed,
  handleUnsupported,
  handleGenerateToServer,
  handleChatToServer,
  handleEmbeddingsToServer,
} from '../controllers/ollama-controller.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { createInferenceRateLimiter } from '../middleware/rate-limiter.js';
import {
  validateRequest,
  generateRequestSchema,
  chatRequestSchema,
  embeddingsRequestSchema,
  embedRequestSchema,
} from '../middleware/validation.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => void | Promise<void>) =>
  (req: any, res: any, next: any) => {
    void Promise.resolve(fn(req as Request, res as Response, next as NextFunction)).catch(
      next as (err: unknown) => void
    );
  };

const inferenceRateLimit = createInferenceRateLimiter();

export const inferenceRouter = Router();

inferenceRouter.get('/tags', inferenceRateLimit, optionalAuth(), asyncHandler(handleTags));
inferenceRouter.post(
  '/generate',
  inferenceRateLimit,
  requireAuth(),
  validateRequest(generateRequestSchema),
  asyncHandler(handleGenerate)
);
inferenceRouter.post(
  '/chat',
  inferenceRateLimit,
  requireAuth(),
  validateRequest(chatRequestSchema),
  asyncHandler(handleChat)
);
inferenceRouter.post(
  '/embeddings',
  inferenceRateLimit,
  requireAuth(),
  validateRequest(embeddingsRequestSchema),
  asyncHandler(handleEmbeddings)
);
inferenceRouter.get('/ps', inferenceRateLimit, optionalAuth(), asyncHandler(handlePs));
inferenceRouter.get('/version', inferenceRateLimit, optionalAuth(), handleVersion);

inferenceRouter.post('/show', inferenceRateLimit, requireAuth(), asyncHandler(handleShow));
inferenceRouter.post(
  '/embed',
  inferenceRateLimit,
  requireAuth(),
  validateRequest(embedRequestSchema),
  asyncHandler(handleEmbed)
);

// Multi-node incompatible endpoints - always reject with helpful message
inferenceRouter.post('/pull', handleUnsupported);
inferenceRouter.delete('/delete', handleUnsupported);
inferenceRouter.post('/copy', handleUnsupported);
inferenceRouter.post('/create', handleUnsupported);
inferenceRouter.head('/blobs/:digest', handleUnsupported);
inferenceRouter.post('/blobs/:digest', handleUnsupported);
inferenceRouter.post('/push', handleUnsupported);

// Server-specific routes (/:endpoint--$serverid) for testing/debugging
inferenceRouter.post(
  '/generate--:serverId',
  inferenceRateLimit,
  requireAuth(),
  asyncHandler(handleGenerateToServer)
);
inferenceRouter.post(
  '/chat--:serverId',
  inferenceRateLimit,
  requireAuth(),
  asyncHandler(handleChatToServer)
);
inferenceRouter.post(
  '/embeddings--:serverId',
  inferenceRateLimit,
  requireAuth(),
  asyncHandler(handleEmbeddingsToServer)
);
