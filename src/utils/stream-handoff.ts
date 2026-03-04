/**
 * stream-handoff.ts
 * Handles streaming request handoff when stalls are detected
 */

import type { Response } from 'express';

import { getConfigManager } from '../config/config.js';
import type { AIServer } from '../orchestrator.types.js';
import { streamResponse } from '../streaming.js';
import { fetchWithActivityTimeout } from '../utils/fetchWithTimeout.js';
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
  /** Stall threshold for the handoff stream (ms). Defaults to 60 s. */
  stallThresholdMs?: number;
  /** Stall check interval for the handoff stream (ms). Defaults to 3 s. */
  stallCheckIntervalMs?: number;
}

const OLLAMA_GENERATE_ENDPOINT = '/api/generate';
const OLLAMA_CHAT_ENDPOINT = '/api/chat';
const OPENAI_CHAT_ENDPOINT = '/v1/chat/completions';

export async function performStreamHandoff(handoffRequest: HandoffRequest): Promise<HandoffResult> {
  const {
    originalRequest,
    newServer,
    clientResponse,
    originalRequestBody,
    stallThresholdMs: handoffStallThreshold,
    stallCheckIntervalMs: handoffStallCheckInterval,
  } = handoffRequest;
  const config = getConfigManager().getConfig();
  const maxHandoffAttempts = config.streaming.maxHandoffAttempts;

  // Default stall detection parameters for the handoff stream.
  // Use provided values, or fall back to config defaults.
  const effectiveStallThreshold = handoffStallThreshold ?? config.streaming.stallThresholdMs;
  const effectiveStallCheckInterval =
    handoffStallCheckInterval ?? config.streaming.stallCheckIntervalMs;

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

    let upstreamResponse: globalThis.Response;
    let activityController: { resetTimeout: () => void; controller: AbortController };
    try {
      // F-8: Use fetchWithActivityTimeout so the handoff fetch cannot hang forever.
      // Use the effective stall threshold as the connection/activity timeout for the
      // initial connection; a separate activity controller handles mid-stream activity.
      const fetchResult = await fetchWithActivityTimeout(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(newServer.apiKey ? { Authorization: `Bearer ${newServer.apiKey}` } : {}),
        },
        body: JSON.stringify(continuationRequest),
        connectionTimeout: effectiveStallThreshold,
        activityTimeout: effectiveStallThreshold,
        requestId: originalRequest.id,
      });
      upstreamResponse = fetchResult.response;
      activityController = fetchResult.activityController;
    } catch (fetchError) {
      const fetchErrorMessage =
        fetchError instanceof Error ? fetchError.message : String(fetchError);
      logger.error('Continuation fetch failed', {
        requestId: originalRequest.id,
        newServer: newServer.id,
        error: fetchErrorMessage,
      });
      return {
        success: false,
        chunksFromHandoff: 0,
        finalChunkCount: originalRequest.chunkCount,
        error: `Continuation fetch failed: ${fetchErrorMessage}`,
      };
    }

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

    // F-9: Pass stall detection to the handoff stream so a second stall on the
    // new server is detected and handled (returns { success: false } to let the
    // caller decide how to proceed) rather than hanging indefinitely.
    const handoffOnStall = (
      _abortController: AbortController,
      _streamingRequestId?: string
    ): Promise<{ success: boolean; error?: string }> => {
      logger.warn('Handoff stream stalled on new server', {
        requestId: originalRequest.id,
        newServer: newServer.id,
      });
      return Promise.resolve({ success: false, error: 'Handoff stream stalled on new server' });
    };

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
      undefined, // ttftOptions
      undefined, // streamingRequestId
      undefined, // existingTtftTracker
      handoffOnStall,
      effectiveStallThreshold,
      effectiveStallCheckInterval,
      undefined, // onStreamEnd
      activityController
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
  // OpenAI: support pseudo-continuation for chat endpoint by appending
  // accumulated text as an assistant message and continuing from there
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
  // Use the original prompt so the new server re-generates the full response
  // rather than treating the partially-accumulated text as a new prompt.
  // Fall back to accumulatedText only if originalPrompt was never stored.
  const prompt = request.originalPrompt ?? request.accumulatedText;

  const continuation: Record<string, unknown> = {
    model: request.model,
    prompt,
    stream: true,
  };

  // Do NOT forward request.lastContext: it was generated by the stalled server
  // and is not meaningful to a different server.  The new server will build its
  // own KV-cache from the prompt above.

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
  // REC-51: Preserve additional parameters
  if (originalBody.tools !== undefined) {
    continuation.tools = originalBody.tools;
  }
  if (originalBody.format !== undefined) {
    continuation.format = originalBody.format;
  }
  if (request.lastContext) {
    continuation.context = request.lastContext;
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
  // REC-51: Preserve additional parameters
  if (originalBody.stop !== undefined) {
    continuation.stop = originalBody.stop;
  }
  if (originalBody.presence_penalty !== undefined) {
    continuation.presence_penalty = originalBody.presence_penalty;
  }
  if (originalBody.frequency_penalty !== undefined) {
    continuation.frequency_penalty = originalBody.frequency_penalty;
  }
  if (originalBody.seed !== undefined) {
    continuation.seed = originalBody.seed;
  }
  if (originalBody.response_format !== undefined) {
    continuation.response_format = originalBody.response_format;
  }

  return continuation;
}
