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
    accumulatedTextPreview: originalRequest.accumulatedText.slice(0, 100),
    hasContext: !!originalRequest.lastContext,
    contextLength: originalRequest.lastContext?.length ?? 0,
    protocol: originalRequest.protocol,
    endpoint: originalRequest.endpoint,
    chunkCount: originalRequest.chunkCount,
    timeSinceLastChunk: Date.now() - originalRequest.lastChunkTime,
  });

  logger.info('Stream handoff initiated', {
    requestId: originalRequest.id,
    currentServer: originalRequest.serverId,
    newServer: newServer.id,
    model: originalRequest.model,
    handoffCount: originalRequest.handoffCount,
    maxHandoffAttempts,
    accumulatedTextLength: originalRequest.accumulatedText.length,
    accumulatedTextPreview: originalRequest.accumulatedText.slice(0, 50),
    timeSinceLastChunk: Date.now() - originalRequest.lastChunkTime,
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
      logger.warn('Stream handoff failed - upstream error', {
        requestId: originalRequest.id,
        currentServer: originalRequest.serverId,
        newServer: newServer.id,
        status: upstreamResponse.status,
        error: errorText,
        chunksReceivedBeforeHandoff: originalRequest.chunkCount,
      });
      return {
        success: false,
        chunksFromHandoff: 0,
        finalChunkCount: originalRequest.chunkCount,
        error: `Continuation failed: ${upstreamResponse.status}`,
      };
    }

    let handoffChunkCount = 0;
    const handoffStartTime = Date.now();

    await streamResponse(
      upstreamResponse,
      clientResponse,
      () => {
        logger.debug('Handoff: first token received', {
          requestId: originalRequest.id,
          newServer: newServer.id,
          timeToFirstToken: Date.now() - handoffStartTime,
        });
      },
      (duration, _tokensGenerated, _tokensPrompt) => {
        logger.info('Stream handoff completed successfully', {
          requestId: originalRequest.id,
          currentServer: originalRequest.serverId,
          newServer: newServer.id,
          duration,
          chunksFromHandoff: handoffChunkCount,
          totalChunks: originalRequest.chunkCount + handoffChunkCount,
          originalChunks: originalRequest.chunkCount,
        });
      },
      chunkCount => {
        handoffChunkCount = chunkCount;
      },
      undefined,
      undefined,
      undefined
    );

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
  // Ollama supports true continuation via context array
  if (protocol === 'ollama') {
    return true;
  }
  // OpenAI: Does NOT support true continuation
  // We could do pseudo-continuation (add accumulated text as assistant message),
  // but that's not true continuation and may produce different results
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
