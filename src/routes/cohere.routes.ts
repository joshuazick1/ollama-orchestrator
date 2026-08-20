import { Router } from 'express';

import { handleChat, handleChatToServer } from '../controllers/cohere-controller.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';

export const cohereRouter = Router();

cohereRouter.post('/chat', requireAuth(), asyncHandler(handleChat));
cohereRouter.post('/chat--:serverId', requireAuth(), asyncHandler(handleChatToServer));
