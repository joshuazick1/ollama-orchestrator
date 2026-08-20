import { Router } from 'express';

import {
  handleBedrockInvoke,
  handleBedrockInvokeStream,
} from '../controllers/bedrock-controller.js';
import { asyncHandler } from '../middleware/async-handler.js';

export const bedrockRouter = Router();

bedrockRouter.post('/model/:modelId/invoke', asyncHandler(handleBedrockInvoke));
bedrockRouter.post(
  '/model/:modelId/invoke-with-response-stream',
  asyncHandler(handleBedrockInvokeStream)
);
