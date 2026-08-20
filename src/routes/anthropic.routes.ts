import { Router } from 'express';

import {
  handleMessages,
  handleMessagesToServer,
  handleListModels,
  handleGetModel,
} from '../controllers/anthropic-controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';

export const anthropicRouter = Router();

anthropicRouter.post('/messages', requireAuth(), asyncHandler(handleMessages));
anthropicRouter.get('/models', asyncHandler(handleListModels));
anthropicRouter.get('/models/:model', asyncHandler(handleGetModel));
anthropicRouter.post('/messages--:serverId', requireAuth(), asyncHandler(handleMessagesToServer));
