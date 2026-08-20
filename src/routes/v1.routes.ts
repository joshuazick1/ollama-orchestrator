/**
 * v1.routes.ts
 * OpenAI-compatible endpoints mounted at /v1/*.
 */

import { Router } from 'express';

import { handleEnsemble } from '../controllers/ensemble-controller.js';
import {
  handleChatCompletions,
  handleCompletions,
  handleOpenAIEmbeddings,
  handleListModels,
  handleGetModel,
  handleGetModelAvailability,
  handleChatCompletionsToServer,
  handleCompletionsToServer,
  handleOpenAIEmbeddingsToServer,
} from '../controllers/openai-controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { createInferenceRateLimiter } from '../middleware/rate-limiter.js';
import { validateRequest } from '../middleware/validation.js';
import { EnsembleRequestSchema } from '../types/ensemble-request.types.js';

const inferenceRateLimit = createInferenceRateLimiter();

const validateEnsembleRequest = validateRequest(EnsembleRequestSchema);

export const v1Router = Router();

v1Router.post(
  '/chat/completions',
  inferenceRateLimit,
  requireAuth(),
  asyncHandler(handleChatCompletions)
);
v1Router.post('/completions', inferenceRateLimit, requireAuth(), asyncHandler(handleCompletions));
v1Router.post(
  '/embeddings',
  inferenceRateLimit,
  requireAuth(),
  asyncHandler(handleOpenAIEmbeddings)
);
v1Router.get('/models', inferenceRateLimit, optionalAuth(), asyncHandler(handleListModels));
v1Router.get(
  '/models/availability',
  inferenceRateLimit,
  optionalAuth(),
  asyncHandler(handleGetModelAvailability)
);
v1Router.get('/models/:model', inferenceRateLimit, optionalAuth(), asyncHandler(handleGetModel));

// Server-specific routes (/v1/:endpoint--$serverid) for testing/debugging
v1Router.post(
  '/chat/completions--:serverId',
  inferenceRateLimit,
  requireAuth(),
  asyncHandler(handleChatCompletionsToServer)
);
v1Router.post(
  '/completions--:serverId',
  inferenceRateLimit,
  requireAuth(),
  asyncHandler(handleCompletionsToServer)
);
v1Router.post(
  '/embeddings--:serverId',
  inferenceRateLimit,
  requireAuth(),
  asyncHandler(handleOpenAIEmbeddingsToServer)
);

v1Router.post(
  '/chat/completions/ensemble',
  inferenceRateLimit,
  requireAuth(),
  validateEnsembleRequest,
  asyncHandler(handleEnsemble)
);
