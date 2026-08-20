/**
 * inference.routes.ts
 * Ollama-compatible inference endpoints mounted at /api/*.
 */

import { Router } from 'express';

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
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { createInferenceRateLimiter } from '../middleware/rate-limiter.js';
import {
  validateRequest,
  generateRequestSchema,
  chatRequestSchema,
  embeddingsRequestSchema,
  embedRequestSchema,
} from '../middleware/validation.js';

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
