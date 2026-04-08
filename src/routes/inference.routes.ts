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

export const inferenceRouter = Router();

inferenceRouter.get('/tags', asyncHandler(handleTags));
inferenceRouter.post(
  '/generate',
  validateRequest(generateRequestSchema),
  asyncHandler(handleGenerate)
);
inferenceRouter.post('/chat', validateRequest(chatRequestSchema), asyncHandler(handleChat));
inferenceRouter.post(
  '/embeddings',
  validateRequest(embeddingsRequestSchema),
  asyncHandler(handleEmbeddings)
);
inferenceRouter.get('/ps', asyncHandler(handlePs));
inferenceRouter.get('/version', handleVersion);

inferenceRouter.post('/show', asyncHandler(handleShow));
inferenceRouter.post('/embed', validateRequest(embedRequestSchema), asyncHandler(handleEmbed));

// Multi-node incompatible endpoints - always reject with helpful message
inferenceRouter.post('/pull', handleUnsupported);
inferenceRouter.delete('/delete', handleUnsupported);
inferenceRouter.post('/copy', handleUnsupported);
inferenceRouter.post('/create', handleUnsupported);
inferenceRouter.head('/blobs/:digest', handleUnsupported);
inferenceRouter.post('/blobs/:digest', handleUnsupported);
inferenceRouter.post('/push', handleUnsupported);

// Server-specific routes (/:endpoint--$serverid) for testing/debugging
inferenceRouter.post('/generate--:serverId', asyncHandler(handleGenerateToServer));
inferenceRouter.post('/chat--:serverId', asyncHandler(handleChatToServer));
inferenceRouter.post('/embeddings--:serverId', asyncHandler(handleEmbeddingsToServer));
