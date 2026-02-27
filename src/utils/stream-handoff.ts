/**
 * stream-handoff.ts
 * Handles streaming request handoff when stalls are detected
 */

import type { Response } from 'express';

import { getConfigManager } from '../config/config.js';
import type { AIServer } from '../orchestrator.types.js';
import { streamResponse } from '../streaming.js';
import { logger } from '../utils/logger.js';

import type { StreamingRequestProgress } from './in-flight-manager.js';

export interface HandoffResult {
  success: boolean;
  chunksFromHandoff: number;
  finalChunkCount: number;
  error?: string;
}

export interface HandoffRequest {
  originalRequest: StreamingRequestProgress;
  newServer: AIServer;
  clientResponse: Response;
  originalRequestBody: Record<string, unknown>;
}

const OLLAMA_GENERATE_ENDPOINT = '/api/generate';
const OLLAMA_CHAT_ENDPOINT = '/api/chat';
const OPENAI_CHAT_ENDPOINT = '/v1/chat/completions';

export async function performStreamHandoff(handoffRequest: HandoffRequest): Promise<HandoffResult> {
  const { originalRequest, newServer, clientResponse, originalRequestBody } = handoffRequest;
  const config = getConfigManager().getConfig();
  const maxHandoffAttempts = config.streaming.maxHandoffAttempts;

  logger.info('Attempting stream handoff', {
    requestId: originalRequest.id,
    currentServer: originalRequest.serverId,
    newServer: newServer.id,
    model: originalRequest.model,
    handoffCount: originalRequest.handoffCount,
    accumulatedTextLength: originalRequest.accumulatedText.length,
    hasContext: !!originalRequest.lastContext,
    protocol: originalRequest.protocol,
    endpoint: originalRequest.endpoint,
  });

  if (originalRequest.handoffCount >= maxHandoffAttempts) {
    logger.warn('Max handoff attempts reached', {
      requestId: originalRequest.id,
      handoffCount: originalRequest.handoffCount,
      maxHandoffAttempts,
    });
    return {
      success: false,
      chunksFromHandoff: 0,
      finalChunkCount: originalRequest.chunkCount,
      error: 'Max handoff attempts reached',
    };
  }

  const supportsContinuation = checkSupportsContinuation(
    originalRequest.protocol,
    originalRequest.endpoint
  );

  if (!supportsContinuation) {
    logger.info('Endpoint does not support continuation, failing gracefully', {
      requestId: originalRequest.id,
      protocol: originalRequest.protocol,
      endpoint: originalRequest.endpoint,
    });
    return {
      success: false,
      chunksFromHandoff: 0,
      finalChunkCount: originalRequest.chunkCount,
      error: 'Endpoint does not support continuation',
    };
  }

  try {
    const continuationRequest = buildContinuationRequest(originalRequest, originalRequestBody);

    const upstreamUrl = `${newServer.url}${getEndpointForRequest(originalRequest)}`;

    logger.debug('Sending continuation request', {
      requestId: originalRequest.id,
      upstreamUrl,
      continuationPromptLength: (continuationRequest.prompt as string)?.length ?? 0,
      messagesCount: ((continuationRequest.messages as unknown[]) || []).length,
    });

    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(newServer.apiKey ? { Authorization: `Bearer ${newServer.apiKey}` } : {}),
      },
      body: JSON.stringify(continuationRequest),
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      logger.error('Continuation request failed', {
        requestId: originalRequest.id,
        status: upstreamResponse.status,
        error: errorText,
      });
      return {
        success: false,
        chunksFromHandoff: 0,
        finalChunkCount: originalRequest.chunkCount,
        error: `Continuation failed: ${upstreamResponse.status}`,
      };
    }

    let handoffChunkCount = 0;
    await streamResponse(
      upstreamResponse,
      clientResponse,
      undefined,
      (_duration, _tokensGenerated, _tokensPrompt) => {
        // Stream complete
      },
      chunkCount => {
        handoffChunkCount = chunkCount;
      },
      undefined,
      undefined,
      undefined
    );

    logger.info('Stream handoff completed', {
      requestId: originalRequest.id,
      chunksFromHandoff: handoffChunkCount,
      totalChunks: originalRequest.chunkCount + handoffChunkCount,
    });

    return {
      success: true,
      chunksFromHandoff: handoffChunkCount,
      finalChunkCount: originalRequest.chunkCount + handoffChunkCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Stream handoff failed with exception', {
      requestId: originalRequest.id,
      error: errorMessage,
    });
    return {
      success: false,
      chunksFromHandoff: 0,
      finalChunkCount: originalRequest.chunkCount,
      error: errorMessage,
    };
  }
}

function checkSupportsContinuation(
  protocol: 'ollama' | 'openai',
  endpoint: 'generate' | 'chat'
): boolean {
  if (protocol === 'ollama') {
    return true;
  }
  if (protocol === 'openai' && endpoint === 'chat') {
    return true;
  }
  return false;
}

function getEndpointForRequest(request: StreamingRequestProgress): string {
  if (request.protocol === 'ollama') {
    return request.endpoint === 'chat' ? OLLAMA_CHAT_ENDPOINT : OLLAMA_GENERATE_ENDPOINT;
  }
  return OPENAI_CHAT_ENDPOINT;
}

function buildContinuationRequest(
  request: StreamingRequestProgress,
  originalBody: Record<string, unknown>
): Record<string, unknown> {
  if (request.protocol === 'ollama' && request.endpoint === 'generate') {
    return buildOllamaGenerateContinuation(request, originalBody);
  }
  if (request.protocol === 'ollama' && request.endpoint === 'chat') {
    return buildOllamaChatContinuation(request, originalBody);
  }
  if (request.protocol === 'openai' && request.endpoint === 'chat') {
    return buildOpenAIChatContinuation(request, originalBody);
  }
  return originalBody;
}

function buildOllamaGenerateContinuation(
  request: StreamingRequestProgress,
  originalBody: Record<string, unknown>
): Record<string, unknown> {
  const continuation: Record<string, unknown> = {
    model: request.model,
    prompt: request.accumulatedText,
    stream: true,
  };

  if (request.lastContext) {
    continuation.context = request.lastContext;
  }

  if (originalBody.options) {
    continuation.options = originalBody.options;
  }
  if (originalBody.system) {
    continuation.system = originalBody.system;
  }
  if (originalBody.template) {
    continuation.template = originalBody.template;
  }
  if (originalBody.keep_alive !== undefined) {
    continuation.keep_alive = originalBody.keep_alive;
  }

  return continuation;
}

function buildOllamaChatContinuation(
  request: StreamingRequestProgress,
  originalBody: Record<string, unknown>
): Record<string, unknown> {
  const originalMessages = (originalBody.messages as unknown[]) || [];

  const messages = [
    ...originalMessages,
    {
      role: 'assistant',
      content: request.accumulatedText,
    },
  ];

  const continuation: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: true,
  };

  if (originalBody.options) {
    continuation.options = originalBody.options;
  }
  if (originalBody.system) {
    continuation.system = originalBody.system;
  }
  if (originalBody.keep_alive !== undefined) {
    continuation.keep_alive = originalBody.keep_alive;
  }

  return continuation;
}

function buildOpenAIChatContinuation(
  request: StreamingRequestProgress,
  originalBody: Record<string, unknown>
): Record<string, unknown> {
  const originalMessages = (originalBody.messages as unknown[]) || [];

  const messages = [
    ...originalMessages,
    {
      role: 'assistant',
      content: request.accumulatedText,
    },
  ];

  const continuation: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: true,
  };

  if (originalBody.temperature !== undefined) {
    continuation.temperature = originalBody.temperature;
  }
  if (originalBody.top_p !== undefined) {
    continuation.top_p = originalBody.top_p;
  }
  if (originalBody.max_tokens !== undefined) {
    continuation.max_tokens = originalBody.max_tokens;
  }
  if (originalBody.tools !== undefined) {
    continuation.tools = originalBody.tools;
  }

  return continuation;
}
