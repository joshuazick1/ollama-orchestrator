/**
 * openaiController.ts
 * OpenAI-compatible API endpoints for Ollama
 * Implements /v1/chat/completions, /v1/completions, /v1/embeddings, /v1/models
 */

import type { Request, Response } from 'express';

import { getConfigManager } from '../config/config.js';
import { API_ENDPOINTS } from '../constants/index.js';
import { getOrchestratorInstance, type RoutingContext } from '../orchestrator-instance.js';
import type { AIServer } from '../orchestrator.types.js';
import { type OllamaStreamChunk, type OllamaToolCall } from '../streaming.js';
import { resolveApiKey } from '../utils/api-keys.js';
import { shouldBypassCircuitBreaker } from '../utils/circuit-breaker-helpers.js';
import { getDebugInfo, isDebugRequested, setDebugResponseHeaders } from '../utils/debug-headers.js';
import { fetchWithTimeout, fetchWithActivityTimeout } from '../utils/fetchWithTimeout.js';
import { getInFlightManager } from '../utils/in-flight-manager.js';
import { safeJsonParse, safeJsonStringify } from '../utils/json-utils.js';
import { logger } from '../utils/logger.js';
import { parseOllamaErrorGlobal as parseOllamaError } from '../utils/ollamaError.js';
import { performStreamHandoff } from '../utils/stream-handoff.js';
import { resolveRequestTimeout } from '../utils/timeout-manager.js';

/**
 * Get headers for backend requests including optional auth
 */
function getBackendHeaders(server: AIServer): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const resolvedKey = resolveApiKey(server.apiKey);
  if (resolvedKey) {
    headers['Authorization'] = `Bearer ${resolvedKey}`;
  }
  return headers;
}

// OpenAI API Types
interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; image_url?: string | { url: string } }>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  response_format?: { type: 'text' | 'json_object' };
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: object };
  }>;
  stream_options?: { include_usage?: boolean };
}

interface OpenAICompletionRequest {
  model: string;
  prompt: string | string[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  suffix?: string;
  stream_options?: { include_usage?: boolean };
}

interface OpenAIEmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
}

interface _OpenAIModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

/** Model entry returned from Ollama's aggregated tags */
interface _OllamaModelEntry {
  name?: string;
  model?: string;
  modified_at?: string;
}

/**
 * Generate a unique ID for OpenAI-style responses
 */
function generateId(prefix: string = 'chatcmpl'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Stream OpenAI-format SSE response from Ollama's NDJSON stream
 */
async function streamOpenAIResponse(
  upstreamResponse: globalThis.Response,
  clientResponse: Response,
  responseId: string,
  model: string,
  isChat: boolean,
  includeUsage: boolean = false,
  onChunk?: () => void,
  // Optional streamingRequestId to pass through to onStall
  streamingRequestId?: string,
  // Accept optional streamingRequestId to match streaming.ts onStall signature
  onStall?: (
    abortController: AbortController,
    streamingRequestId?: string
  ) => Promise<{ success: boolean; error?: string } | void>,
  stallThresholdMs?: number,
  stallCheckIntervalMs?: number,
  _onStreamEnd?: () => void
): Promise<void> {
  const startTime = Date.now();
  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let lastChunkTime = startTime;
  let hasReceivedFirstChunk = false;
  let hasEmittedRoleChunk = false; // Track whether role-only first chunk has been sent (REC-37)
  let stallCheckInterval: ReturnType<typeof setInterval> | undefined;
  let stallTriggered = false;
  const effectiveStallThreshold = stallThresholdMs ?? 300000; // Default 5 minutes
  const effectiveStallCheckInterval = stallCheckIntervalMs ?? 10000; // Default 10 seconds

  const abortController = new AbortController();

  try {
    // Set SSE headers for OpenAI-style streaming
    clientResponse.setHeader('Content-Type', 'text/event-stream');
    clientResponse.setHeader('Cache-Control', 'no-cache');
    clientResponse.setHeader('Connection', 'keep-alive');
    clientResponse.setHeader('X-Accel-Buffering', 'no');

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      throw new Error('No response body to stream');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Clear stall check interval on completion
        if (stallCheckInterval) {
          clearInterval(stallCheckInterval);
          stallCheckInterval = undefined;
        }
        break;
      }

      const now = Date.now();

      // Start stall detection after first chunk
      if (!hasReceivedFirstChunk && onStall) {
        hasReceivedFirstChunk = true;

        stallCheckInterval = setInterval(() => {
          if (stallTriggered) {
            return;
          }

          const timeSinceLastChunk = Date.now() - lastChunkTime;
          if (timeSinceLastChunk > effectiveStallThreshold) {
            logger.warn('OpenAI stream stall detected', {
              responseId,
              model,
              timeSinceLastChunk,
              stallThreshold: effectiveStallThreshold,
            });
            stallTriggered = true;

            // Clear the interval since we've triggered stall handling
            if (stallCheckInterval) {
              clearInterval(stallCheckInterval);
              stallCheckInterval = undefined;
            }

            // Try to handle the stall - call the async handler
            onStall(abortController, streamingRequestId)
              .then(res => {
                // Cancel the stalled reader regardless of handoff success/failure so the
                // original read loop exits cleanly.  On success the handoff stream is
                // already writing to clientResponse; leaving this reader open risks
                // interleaving old-server chunks with the continuation.
                try {
                  void reader.cancel();
                } catch (_e) {
                  // Ignore cancel errors
                }
                if (res?.success) {
                  logger.info('OpenAI stall handled successfully via handoff', {
                    responseId,
                  });
                }
              })
              .catch(stallError => {
                logger.error('OpenAI stall handler threw error', {
                  responseId,
                  error: stallError instanceof Error ? stallError.message : String(stallError),
                });

                try {
                  void reader.cancel();
                } catch (_e) {
                  // Ignore cancel errors
                }
              });
          }
        }, effectiveStallCheckInterval);
      }

      lastChunkTime = now;

      onChunk?.();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const chunk = safeJsonParse(line) as OllamaStreamChunk;

          // Check if done
          if (chunk.done) {
            // Extract usage info from final chunk if available
            if (chunk.prompt_eval_count) {
              promptTokens = chunk.prompt_eval_count;
            }
            if (chunk.eval_count) {
              completionTokens = chunk.eval_count;
            }
            totalTokens = promptTokens + completionTokens;

            // Determine finish_reason: 'length' if truncated, else 'stop'
            const doneFinishReason = chunk.truncated ? 'length' : 'stop';

            // Send final chunk with finish_reason
            const finalDelta = isChat
              ? {
                  id: responseId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: doneFinishReason,
                    },
                  ],
                }
              : {
                  id: responseId,
                  object: 'text_completion',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      text: '',
                      finish_reason: doneFinishReason,
                    },
                  ],
                };

            const writeResult1 = clientResponse.write(`data: ${safeJsonStringify(finalDelta)}\n\n`);
            if (!writeResult1) {
              await new Promise<void>(r => clientResponse.once('drain', r));
            }

            // Include usage if requested
            if (includeUsage && totalTokens > 0) {
              const usageChunk = {
                id: responseId,
                object: isChat ? 'chat.completion.chunk' : 'text_completion',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [],
                usage: {
                  prompt_tokens: promptTokens,
                  completion_tokens: completionTokens,
                  total_tokens: totalTokens,
                },
              };
              const writeResult2 = clientResponse.write(
                `data: ${safeJsonStringify(usageChunk)}\n\n`
              );
              if (!writeResult2) {
                await new Promise<void>(r => clientResponse.once('drain', r));
              }
            }

            const writeResult3 = clientResponse.write('data: [DONE]\n\n');
            if (!writeResult3) {
              await new Promise<void>(r => clientResponse.once('drain', r));
            }
            continue;
          }

          // Extract content and tool_calls from Ollama response
          const content = isChat ? (chunk.message?.content ?? '') : (chunk.response ?? '');
          const toolCalls: OllamaToolCall[] | undefined = isChat
            ? chunk.message?.tool_calls
            : undefined;

          // Emit role-only first chunk for chat (OpenAI spec: first chunk carries role)
          if (isChat && !hasEmittedRoleChunk) {
            hasEmittedRoleChunk = true;
            const roleChunk = {
              id: responseId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: '' },
                  finish_reason: null,
                },
              ],
            };
            const writeResultRole = clientResponse.write(
              `data: ${safeJsonStringify(roleChunk)}\n\n`
            );
            if (!writeResultRole) {
              await new Promise<void>(r => clientResponse.once('drain', r));
            }
          }

          if (content || (toolCalls && toolCalls.length > 0)) {
            let sseChunk: Record<string, unknown>;

            if (isChat) {
              const delta: Record<string, unknown> = {};
              if (content) {
                delta.content = content;
              }
              if (toolCalls && toolCalls.length > 0) {
                // Determine finish_reason for tool_calls
                delta.tool_calls = toolCalls.map((tc, idx) => ({
                  index: tc.index ?? idx,
                  id: tc.id,
                  type: tc.type ?? 'function',
                  function: {
                    name: tc.function?.name,
                    arguments: tc.function?.arguments ?? '',
                  },
                }));
              }
              const finishReason = toolCalls && toolCalls.length > 0 ? 'tool_calls' : null;
              sseChunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta,
                    finish_reason: finishReason,
                  },
                ],
              };
            } else {
              sseChunk = {
                id: responseId,
                object: 'text_completion',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    text: content,
                    finish_reason: null,
                  },
                ],
              };
            }

            const writeResult4 = clientResponse.write(`data: ${safeJsonStringify(sseChunk)}\n\n`);
            if (!writeResult4) {
              await new Promise<void>(r => clientResponse.once('drain', r));
            }
          }
        } catch (e) {
          // Skip malformed JSON lines
          logger.debug('Failed to parse stream chunk:', { line, error: e });
        }
      }

      if (clientResponse.writableEnded) {
        logger.info('Client disconnected from OpenAI stream');
        void reader.cancel();
        break;
      }
    }

    clientResponse.end();

    logger.info('OpenAI stream completed', {
      responseId,
      model,
      duration: Date.now() - startTime,
      promptTokens,
      completionTokens,
      totalTokens,
    });
  } catch (error) {
    logger.error('OpenAI streaming error:', { error });

    if (!clientResponse.headersSent) {
      clientResponse.status(500).json({
        error: {
          message: 'Streaming failed',
          type: 'server_error',
          code: 'streaming_error',
        },
      });
    } else {
      clientResponse.end();
    }
  }
}

/**
 * Passthrough SSE stream — for servers that already speak OpenAI SSE format.
 * Forwards `data: …` lines verbatim while extracting TTFT/token metrics.
 * Implements backpressure (REC-42) and handles upstream close, client
 * disconnect, and stall detection (REC-36).
 */
async function passthroughSSEStream(
  upstreamResponse: globalThis.Response,
  clientResponse: Response,
  responseId: string,
  model: string,
  onChunk?: () => void,
  streamingRequestId?: string,
  onStall?: (
    abortController: AbortController,
    streamingRequestId?: string
  ) => Promise<{ success: boolean; error?: string } | void>,
  stallThresholdMs?: number,
  stallCheckIntervalMs?: number,
  _onStreamEnd?: () => void
): Promise<void> {
  const startTime = Date.now();
  let lastChunkTime = startTime;
  let hasReceivedFirstChunk = false;
  let stallCheckInterval: ReturnType<typeof setInterval> | undefined;
  let stallTriggered = false;
  const effectiveStallThreshold = stallThresholdMs ?? 300000;
  const effectiveStallCheckInterval = stallCheckIntervalMs ?? 10000;
  const abortController = new AbortController();

  try {
    clientResponse.setHeader('Content-Type', 'text/event-stream');
    clientResponse.setHeader('Cache-Control', 'no-cache');
    clientResponse.setHeader('Connection', 'keep-alive');
    clientResponse.setHeader('X-Accel-Buffering', 'no');

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      throw new Error('No response body to stream');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        if (stallCheckInterval) {
          clearInterval(stallCheckInterval);
          stallCheckInterval = undefined;
        }
        break;
      }

      const now = Date.now();

      // Start stall detection after first chunk
      if (!hasReceivedFirstChunk && onStall) {
        hasReceivedFirstChunk = true;

        stallCheckInterval = setInterval(() => {
          if (stallTriggered) {
            return;
          }
          const timeSinceLastChunk = Date.now() - lastChunkTime;
          if (timeSinceLastChunk > effectiveStallThreshold) {
            logger.warn('SSE passthrough stall detected', {
              responseId,
              model,
              timeSinceLastChunk,
              stallThreshold: effectiveStallThreshold,
            });
            stallTriggered = true;
            if (stallCheckInterval) {
              clearInterval(stallCheckInterval);
              stallCheckInterval = undefined;
            }
            onStall(abortController, streamingRequestId)
              .then(res => {
                // Cancel the stalled reader on both success and failure so the read loop
                // exits cleanly.  On success the handoff stream is already writing to
                // clientResponse; leaving this reader open would interleave content.
                try {
                  void reader.cancel();
                } catch {
                  // Ignore cancel errors
                }
                if (res?.success) {
                  logger.info('SSE passthrough stall handled successfully via handoff', {
                    responseId,
                  });
                }
              })
              .catch(stallError => {
                logger.error('SSE passthrough stall handler threw error', {
                  responseId,
                  error: stallError instanceof Error ? stallError.message : String(stallError),
                });
                try {
                  void reader.cancel();
                } catch {
                  // Ignore cancel errors
                }
              });
          }
        }, effectiveStallCheckInterval);
      }

      lastChunkTime = now;

      onChunk?.();

      // Decode and buffer the chunk
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        // Forward SSE lines verbatim (includes `data: …` and blank separator lines)
        const writeResult = clientResponse.write(`${line}\n`);
        if (!writeResult) {
          await new Promise<void>(r => clientResponse.once('drain', r));
        }

        // Detect [DONE] sentinel for logging
        if (line === 'data: [DONE]') {
          logger.debug('SSE passthrough received [DONE]', { responseId, model });
        }
      }

      if (clientResponse.writableEnded) {
        logger.info('Client disconnected from SSE passthrough stream', { responseId, model });
        try {
          void reader.cancel();
        } catch {
          // Ignore cancel errors
        }
        break;
      }
    }

    // Flush any remaining buffer content
    if (buffer.trim()) {
      const writeResult = clientResponse.write(`${buffer}\n`);
      if (!writeResult) {
        await new Promise<void>(r => clientResponse.once('drain', r));
      }
    }

    clientResponse.end();

    logger.info('SSE passthrough stream completed', {
      responseId,
      model,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('SSE passthrough streaming error:', { error });

    if (!clientResponse.headersSent) {
      clientResponse.status(500).json({
        error: {
          message: 'Streaming failed',
          type: 'server_error',
          code: 'streaming_error',
        },
      });
    } else {
      clientResponse.end();
    }
  } finally {
    if (stallCheckInterval) {
      clearInterval(stallCheckInterval);
      stallCheckInterval = undefined;
    }
    _onStreamEnd?.();
  }
}

/**
 * Handle POST /v1/chat/completions - OpenAI-compatible chat completions
 */
export async function handleChatCompletions(req: Request, res: Response): Promise<void> {
  const body = req.body as OpenAIChatCompletionRequest;
  const { model, messages, stream = false } = body;

  logger.info('Received OpenAI chat completions request', {
    model,
    messageCount: messages?.length,
    stream,
  });

  if (!model || !messages || !Array.isArray(messages)) {
    res.status(400).json({
      error: {
        message: 'model and messages array are required',
        type: 'invalid_request_error',
        param: !model ? 'model' : 'messages',
        code: 'missing_required_parameter',
      },
    });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const _config = getConfigManager().getConfig();
  const routingContext: RoutingContext = {};
  const responseId = generateId('chatcmpl');

  // Build Ollama options from OpenAI parameters
  const ollamaOptions: Record<string, unknown> = {};
  if (body.temperature !== undefined) {
    ollamaOptions.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    ollamaOptions.top_p = body.top_p;
  }
  if (body.presence_penalty !== undefined) {
    ollamaOptions.presence_penalty = body.presence_penalty;
  }
  if (body.frequency_penalty !== undefined) {
    ollamaOptions.frequency_penalty = body.frequency_penalty;
  }
  if (body.seed !== undefined) {
    ollamaOptions.seed = body.seed;
  }
  if (body.max_tokens !== undefined) {
    ollamaOptions.num_predict = body.max_tokens;
  }
  if (body.stop) {
    ollamaOptions.stop = Array.isArray(body.stop) ? body.stop : [body.stop];
  }

  // Handle response format for JSON mode
  if (body.response_format?.type === 'json_object') {
    ollamaOptions.format = 'json';
  }

  try {
    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer, context?: { requestId?: string }) => {
        const headers = getBackendHeaders(server);

        if (stream) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          const requestId = context?.requestId;
          // Use same dynamic stall threshold formula as the Ollama path:
          // 1.5× the request timeout, clamped to [10s, 60s].
          const stallThreshold = Math.min(Math.max(timeoutMs * 1.5, 10_000), 60_000);
          const stallCheckInterval = Math.min(timeoutMs / 8, 3_000);

          logger.info('STREAM_REQUEST_START', {
            requestId,
            serverId: server.id,
            model,
            endpoint: 'chat',
            protocol: 'openai',
            timeoutMs,
            stallThresholdMs: stallThreshold,
            stallCheckIntervalMs: stallCheckInterval,
            messageCount: messages?.length ?? 0,
          });

          logger.debug(
            `Using dynamic timeout for streaming: ${timeoutMs}ms for ${server.id}:${model}, stallThreshold: ${stallThreshold}ms`
          );
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS}`,
            {
              method: 'POST',
              headers,
              body: safeJsonStringify({
                model,
                messages,
                stream: true,
                options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined,
                ...(body.tools && { tools: body.tools }),
              }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs, // Use same dynamic timeout for activity
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          const streamStartTime = Date.now();
          let firstChunkTime: number | undefined;

          // Register with InFlightManager so the stall handler can retrieve progress
          if (requestId) {
            getInFlightManager().addStreamingRequest(
              requestId,
              server.id,
              model,
              'openai',
              'chat',
              undefined, // no originalPrompt for chat endpoint
              messages as unknown[]
            );
          }

          // Stall detection tracking variables (set by onStallCallback closure)
          let openaiChatStallDetected = false;
          let openaiChatStallStartTime: number | undefined;
          let openaiChatHandoffAttempted = false;
          let openaiChatHandoffSuccess = false;

          const onStallCallback = async (
            _abortController: AbortController,
            passedRequestId?: string
          ): Promise<{ success: boolean; error?: string }> => {
            // Track stall detection for debug output
            openaiChatStallDetected = true;
            openaiChatStallStartTime = Date.now();

            logger.warn('STREAM_STALL_DETECTED', {
              requestId: passedRequestId,
              serverId: server.id,
              model,
              endpoint: 'chat',
              protocol: 'openai',
              message: 'Stall detected - attempting seamless handoff',
            });

            const progress = passedRequestId
              ? getInFlightManager().getStreamingRequestProgress(passedRequestId)
              : undefined;

            if (!progress) {
              logger.warn('No streaming progress found for OpenAI handoff', {
                requestId: passedRequestId,
              });
              return { success: false, error: 'No progress tracked' };
            }

            // Find an eligible server for failover
            const orchestratorInst = getOrchestratorInstance();
            const allServers = orchestratorInst.getServers();
            const newServer = allServers.find(
              s =>
                s.id !== server.id &&
                s.healthy &&
                s.models.includes(model) &&
                orchestratorInst.isCircuitAllowed(s.id) &&
                s.supportsV1 !== false
            );

            if (!newServer) {
              logger.warn('No eligible OpenAI servers for handoff', {
                requestId: passedRequestId,
                currentServer: server.id,
                model,
              });
              return { success: false, error: 'No alternative servers with closed circuit' };
            }

            openaiChatHandoffAttempted = true;

            try {
              const result = await performStreamHandoff({
                originalRequest: progress,
                newServer,
                clientResponse: res,
                originalRequestBody: body as unknown as Record<string, unknown>,
                stallThresholdMs: stallThreshold,
                stallCheckIntervalMs: stallCheckInterval,
              });

              openaiChatHandoffSuccess = result.success;
              return { success: result.success, error: result.error };
            } catch (handoffError) {
              logger.error('OpenAI handoff failed with exception', {
                requestId: passedRequestId,
                error: handoffError instanceof Error ? handoffError.message : String(handoffError),
              });
              openaiChatHandoffSuccess = false;
              return { success: false, error: 'Handoff exception' };
            }
          };

          try {
            let chunkCount = 0;

            if (server.supportsV1) {
              // REC-36: Server speaks OpenAI SSE natively — passthrough directly
              logger.info('STREAM_MODE_PASSTHROUGH', {
                requestId,
                serverId: server.id,
                model,
              });
              await passthroughSSEStream(
                response,
                res,
                responseId,
                model,
                () => {
                  if (!firstChunkTime) {
                    firstChunkTime = Date.now();
                    logger.info('STREAM_FIRST_CHUNK', {
                      requestId,
                      serverId: server.id,
                      model,
                      timeToFirstChunk: firstChunkTime - streamStartTime,
                    });
                  }
                  activityController.resetTimeout();
                  chunkCount++;
                  logger.debug('STREAM_CHUNK', {
                    requestId,
                    serverId: server.id,
                    model,
                    chunkCount,
                  });
                  if (requestId) {
                    getInFlightManager().updateChunkProgress(requestId, chunkCount);
                  }
                },
                requestId,
                onStallCallback,
                stallThreshold,
                stallCheckInterval,
                () => {
                  if (requestId) {
                    getInFlightManager().removeStreamingRequest(requestId);
                  }
                }
              );
            } else {
              // REC-36: Server only speaks Ollama NDJSON — translate to OpenAI SSE
              logger.info('STREAM_MODE_TRANSLATE', {
                requestId,
                serverId: server.id,
                model,
              });
              await streamOpenAIResponse(
                response,
                res,
                responseId,
                model,
                true,
                body.stream_options?.include_usage,
                () => {
                  if (!firstChunkTime) {
                    firstChunkTime = Date.now();
                    logger.info('STREAM_FIRST_CHUNK', {
                      requestId,
                      serverId: server.id,
                      model,
                      timeToFirstChunk: firstChunkTime - streamStartTime,
                    });
                  }

                  activityController.resetTimeout();
                  chunkCount++;

                  logger.debug('STREAM_CHUNK', {
                    requestId,
                    serverId: server.id,
                    model,
                    chunkCount,
                  });

                  // Update InFlightManager with current chunk count for real-time tracking
                  if (requestId) {
                    getInFlightManager().updateChunkProgress(requestId, chunkCount);
                  }
                },
                // streamingRequestId (for onStall)
                requestId,
                // Stall detection parameters
                onStallCallback,
                stallThreshold,
                stallCheckInterval,
                // Cleanup callback
                () => {
                  if (requestId) {
                    getInFlightManager().removeStreamingRequest(requestId);
                  }
                }
              );
            }

            logger.info('STREAM_COMPLETE', {
              requestId,
              serverId: server.id,
              model,
              endpoint: 'chat',
              duration: Date.now() - streamStartTime,
              chunkCount,
            });

            const includeDebug = isDebugRequested(req);
            if (includeDebug) {
              const streamDuration = Date.now() - streamStartTime;
              const ttft = firstChunkTime ? firstChunkTime - streamStartTime : undefined;
              const debugInfo = getDebugInfo(routingContext, {
                requestId: requestId,
                requestTimestamp: streamStartTime,
                timeToFirstToken: ttft,
                streamingDuration: streamDuration,
                stallDetected: openaiChatStallDetected,
                stallDurationMs: openaiChatStallStartTime
                  ? Date.now() - openaiChatStallStartTime
                  : undefined,
              });
              if (debugInfo) {
                setDebugResponseHeaders(res, debugInfo);
                res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
              }
            }
          } finally {
            activityController.clearTimeout();
          }

          return { _streamed: true } as Record<string, unknown>;
        }

        // Non-streaming request - proxy to Ollama's OpenAI endpoint
        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(
          `${server.url}${API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS}`,
          {
            method: 'POST',
            headers,
            body: safeJsonStringify({
              model,
              messages,
              stream: false,
              options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined,
              ...(body.tools && { tools: body.tools }),
            }),
            timeout: timeoutMs,
          }
        );

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await response.json()) as Record<string, unknown>;
      },
      stream,
      'generate',
      'openai',
      routingContext
    );

    // Send non-streaming response
    if (!stream && result && !result._streamed) {
      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (debugInfo) {
          result.debug = debugInfo;
          setDebugResponseHeaders(res, debugInfo);
        }
      }
      res.json(result);
    }
  } catch (error) {
    logger.error('OpenAI chat completions failed:', { error, model });

    if (res.writableEnded) {
      return;
    }

    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : 'Request failed';
      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;
      res.status(500).json({
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'internal_error',
        },
        ...(debugPayload && { debug: debugPayload }),
      });
    }
  }
}

/**
 * Handle POST /v1/completions - OpenAI-compatible completions
 */
export async function handleCompletions(req: Request, res: Response): Promise<void> {
  const body = req.body as OpenAICompletionRequest;
  const { model, stream = false } = body;

  logger.info('Received OpenAI completions request', { model, stream });

  if (!model) {
    res
      .status(400)
      .json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const _config = getConfigManager().getConfig();
  const routingContext: RoutingContext = {};

  try {
    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer) => {
        const headers = getBackendHeaders(server);

        if (stream) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OPENAI.COMPLETIONS}`,
            {
              method: 'POST',
              headers,
              body: safeJsonStringify({ ...body, stream: true }),
              connectionTimeout: timeoutMs, // Use dynamic timeout
              activityTimeout: timeoutMs, // Use same dynamic timeout for activity
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          try {
            const responseId = generateId('cmpl');
            const completionStreamStart = Date.now();
            await streamOpenAIResponse(
              response,
              res,
              responseId,
              model,
              false, // isChat = false for /v1/completions
              body.stream_options?.include_usage,
              () => {
                activityController.resetTimeout();
              }
            );

            const includeDebug = isDebugRequested(req);
            if (includeDebug) {
              const debugInfo = getDebugInfo(routingContext, {
                streamingDuration: Date.now() - completionStreamStart,
              });
              if (debugInfo) {
                setDebugResponseHeaders(res, debugInfo);
                res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
              }
            }
          } finally {
            activityController.clearTimeout();
          }

          return { _streamed: true } as Record<string, unknown>;
        }

        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(
          `${server.url}${API_ENDPOINTS.OPENAI.COMPLETIONS}`,
          {
            method: 'POST',
            headers,
            body: safeJsonStringify(body),
            timeout: timeoutMs,
          }
        );

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await response.json()) as Record<string, unknown>;
      },
      stream,
      'generate',
      'openai',
      routingContext
    );

    if (!stream && result && !result._streamed) {
      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (debugInfo) {
          result.debug = debugInfo;
          setDebugResponseHeaders(res, debugInfo);
        }
      }
      res.json(result);
    }
  } catch (error) {
    logger.error('OpenAI completions failed:', { error, model });
    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : 'Request failed';
      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;
      res.status(500).json({
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'internal_error',
        },
        ...(debugPayload && { debug: debugPayload }),
      });
    }
  }
}

/**
 * Handle POST /v1/embeddings - OpenAI-compatible embeddings
 */
export async function handleOpenAIEmbeddings(req: Request, res: Response): Promise<void> {
  const body = req.body as OpenAIEmbeddingRequest;
  const { model } = body;

  logger.info('Received OpenAI embeddings request', { model });

  if (!model || !body.input) {
    res
      .status(400)
      .json({ error: { message: 'model and input are required', type: 'invalid_request_error' } });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const routingContext: RoutingContext = {};

  try {
    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer) => {
        const headers = getBackendHeaders(server);
        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OPENAI.EMBEDDINGS}`, {
          method: 'POST',
          headers,
          body: safeJsonStringify(body),
          timeout: timeoutMs, // Use dynamic timeout
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await response.json()) as Record<string, unknown>;
      },
      false,
      'embeddings',
      'openai',
      routingContext
    );

    // Send response with optional debug info (?debug=true or X-Include-Debug-Info: true)
    const includeDebug = isDebugRequested(req);
    if (includeDebug) {
      const debugInfo = getDebugInfo(routingContext);
      if (debugInfo && typeof result === 'object' && result !== null) {
        result.debug = debugInfo;
        setDebugResponseHeaders(res, debugInfo);
      }
    }
    res.json(result);
  } catch (error) {
    logger.error('OpenAI embeddings failed:', { error, model });
    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : 'Request failed';
      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;
      res.status(500).json({
        error: {
          message: errorMessage,
          type: 'server_error',
          code: 'internal_error',
        },
        ...(debugPayload && { debug: debugPayload }),
      });
    }
  }
}

/**
 * Handle GET /v1/models - List all available models in OpenAI format
 */
export function handleListModels(req: Request, res: Response): Promise<void> {
  const orchestrator = getOrchestratorInstance();

  try {
    const result = orchestrator.getAggregatedOpenAIModels();
    res.json(result);
    return Promise.resolve();
  } catch (error) {
    logger.error('Failed to list models:', { error });
    res.status(500).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to list models',
        type: 'server_error',
        code: 'internal_error',
      },
    });
    return Promise.resolve();
  }
}

/**
 * Handle GET /v1/models/:model - Get specific model info
 */
export function handleGetModel(req: Request, res: Response): Promise<void> {
  const { model } = req.params;

  const orchestrator = getOrchestratorInstance();

  try {
    const result = orchestrator.getAggregatedOpenAIModels();
    const modelInfo = result.data.find(m => m.id === model);

    if (!modelInfo) {
      res.status(404).json({
        error: {
          message: `Model '${String(model)}' not found`,
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found',
        },
      });
      return Promise.resolve();
    }

    res.json(modelInfo);
    return Promise.resolve();
  } catch (error) {
    logger.error('Failed to get model info:', { error, model });
    res.status(500).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to get model',
        type: 'server_error',
        code: 'internal_error',
      },
    });
    return Promise.resolve();
  }
}

/**
 * Handle /v1/chat/completions:$serverId - Route to specific server
 * Calls /v1/chat/completions directly (Ollama's OpenAI compatible endpoint)
 */
export async function handleChatCompletionsToServer(req: Request, res: Response): Promise<void> {
  const body = req.body as OpenAIChatCompletionRequest;
  const { model, messages, stream, ...rest } = body;
  const serverId = Array.isArray((req.params as Record<string, unknown>).serverId)
    ? ((req.params as Record<string, unknown>).serverId as string[])[0]
    : String((req.params as Record<string, unknown>).serverId);

  // Check for bypass circuit breaker flag
  const bypassCircuitBreaker = shouldBypassCircuitBreaker(req);

  logger.info(`Received chat completions request to specific server`, {
    serverId,
    model,
    bypassCircuitBreaker,
  });

  if (!model) {
    res
      .status(400)
      .json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = stream ?? false;
  const config = getConfigManager().getConfig();
  const routingContext: RoutingContext = { algorithm: 'direct', protocol: 'openai' };

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown>>(
      serverId,
      model,
      async (server, context) => {
        const requestBody: Record<string, unknown> = {
          model,
          messages,
          ...rest,
        };

        if (useStreaming) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          const requestId = context?.requestId;
          const stallThreshold = config.streaming.stallThresholdMs;
          const stallCheckInterval = config.streaming.stallCheckIntervalMs;

          logger.info('STREAM_REQUEST_START', {
            requestId,
            serverId: server.id,
            model,
            endpoint: 'chat',
            protocol: 'openai',
            timeoutMs,
            stallThresholdMs: stallThreshold,
            stallCheckIntervalMs: stallCheckInterval,
            messageCount: messages?.length ?? 0,
          });

          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: safeJsonStringify({ ...requestBody, stream: true }),
              connectionTimeout: timeoutMs, // Use dynamic timeout
              activityTimeout: timeoutMs, // Use same dynamic timeout for activity
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          const streamStartTime = Date.now();
          let firstChunkTime: number | undefined;

          // Stall detection tracking variables (set by onStallCallback closure)
          let openaiCompStallDetected = false;
          let openaiCompStallStartTime: number | undefined;

          const onStallCallback = (
            _abortController: AbortController,
            _streamingRequestId?: string
          ): Promise<{ success: boolean; error?: string }> => {
            // Track stall detection for debug output
            openaiCompStallDetected = true;
            openaiCompStallStartTime = Date.now();

            logger.warn('STREAM_STALL_DETECTED', {
              requestId,
              serverId: server.id,
              model,
              endpoint: 'chat',
              protocol: 'openai',
              message: 'Stall detected - OpenAI does not support continuation, failing gracefully',
            });

            // OpenAI doesn't support continuation, so we just return false
            // The stream will end gracefully with what we have
            return Promise.resolve({
              success: false,
              error: 'OpenAI protocol does not support stream continuation',
            });
          };

          try {
            let chunkCount = 0;
            await streamOpenAIResponse(
              response,
              res,
              `chatcmpl-${crypto.randomUUID()}`,
              model,
              true,
              body.stream_options?.include_usage,
              () => {
                if (!firstChunkTime) {
                  firstChunkTime = Date.now();
                  logger.info('STREAM_FIRST_CHUNK', {
                    requestId,
                    serverId: server.id,
                    model,
                    timeToFirstChunk: firstChunkTime - streamStartTime,
                  });
                }

                activityController.resetTimeout();
                chunkCount++;

                logger.debug('STREAM_CHUNK', {
                  requestId,
                  serverId: server.id,
                  model,
                  chunkCount,
                });

                // Update InFlightManager with current chunk count for real-time tracking
                if (requestId) {
                  getInFlightManager().updateChunkProgress(requestId, chunkCount);
                }
              },
              // streamingRequestId (for onStall)
              requestId,
              // Stall detection parameters
              onStallCallback,
              stallThreshold,
              stallCheckInterval,
              // Cleanup callback
              () => {
                if (requestId) {
                  getInFlightManager().removeStreamingRequest(requestId);
                }
              }
            );

            logger.info('STREAM_COMPLETE', {
              requestId,
              serverId: server.id,
              model,
              endpoint: 'chat',
              duration: Date.now() - streamStartTime,
              chunkCount,
            });

            const includeDebug = isDebugRequested(req);
            if (includeDebug) {
              const streamDuration = Date.now() - streamStartTime;
              const ttft = firstChunkTime ? firstChunkTime - streamStartTime : undefined;
              const debugInfo = getDebugInfo(routingContext, {
                requestId: requestId,
                requestTimestamp: streamStartTime,
                timeToFirstToken: ttft,
                streamingDuration: streamDuration,
                stallDetected: openaiCompStallDetected,
                stallDurationMs: openaiCompStallStartTime
                  ? Date.now() - openaiCompStallStartTime
                  : undefined,
              });
              if (debugInfo) {
                setDebugResponseHeaders(res, debugInfo);
                if (!res.writableEnded) {
                  res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
                }
              }
            }
          } finally {
            activityController.clearTimeout();
          }

          return { _streamed: true } as Record<string, unknown>;
        }

        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(
          `${server.url}${API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: safeJsonStringify(requestBody),
            timeout: timeoutMs,
          }
        );

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return response.json() as Promise<Record<string, unknown>>;
      },
      { isStreaming: useStreaming, bypassCircuitBreaker, routingContext }
    );

    if (result && typeof result === 'object' && '_streamed' in result) {
      // Streaming handled internally
    } else if (result) {
      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (debugInfo) {
          (result as Record<string, unknown>).debug = debugInfo;
          setDebugResponseHeaders(res, debugInfo);
        }
      }
      res.json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Chat completions to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    const debugPayload = isDebugRequested(req)
      ? getDebugInfo(routingContext, { lastError: errorMessage })
      : undefined;
    res.status(500).json({
      error: { message: errorMessage, type: 'server_error' },
      ...(debugPayload && { debug: debugPayload }),
    });
  }
}

/**
 * Handle /v1/completions:$serverId - Route to specific server
 * Calls /v1/completions directly (Ollama's OpenAI compatible endpoint)
 */
export async function handleCompletionsToServer(req: Request, res: Response): Promise<void> {
  const body = req.body as OpenAICompletionRequest;
  const { model, stream, ...rest } = body;
  const serverId = Array.isArray((req.params as Record<string, unknown>).serverId)
    ? ((req.params as Record<string, unknown>).serverId as string[])[0]
    : String((req.params as Record<string, unknown>).serverId);

  // Check for bypass circuit breaker flag
  const bypassCircuitBreaker = shouldBypassCircuitBreaker(req);

  logger.info(`Received completions request to specific server`, {
    serverId,
    model,
    bypassCircuitBreaker,
  });

  if (!model) {
    res
      .status(400)
      .json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = stream ?? false;
  const _config = getConfigManager().getConfig();
  const routingContext: RoutingContext = { algorithm: 'direct', protocol: 'openai' };

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown>>(
      serverId,
      model,
      async (server, _context) => {
        const requestBody: Record<string, unknown> = {
          model,
          ...rest,
        };

        if (useStreaming) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OPENAI.COMPLETIONS}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: safeJsonStringify({ ...requestBody, stream: true }),
              connectionTimeout: timeoutMs, // Use dynamic timeout
              activityTimeout: timeoutMs, // Use same dynamic timeout for activity
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          // Stream the response
          const reader = response.body?.getReader();
          if (!reader) {
            activityController.clearTimeout();
            throw new Error('No response body');
          }

          try {
            const decoder = new TextDecoder();
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              res.write(decoder.decode(value, { stream: true }));
            }

            // Emit debug info before ending the stream
            const includeDebug = isDebugRequested(req);
            if (includeDebug && !res.writableEnded) {
              const debugInfo = getDebugInfo(routingContext);
              if (debugInfo) {
                setDebugResponseHeaders(res, debugInfo);
                res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
              }
            }

            res.end();
          } finally {
            activityController.clearTimeout();
          }

          return { _streamed: true };
        }

        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(
          `${server.url}${API_ENDPOINTS.OPENAI.COMPLETIONS}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: safeJsonStringify(requestBody),
            timeout: timeoutMs,
          }
        );

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return response.json() as Promise<Record<string, unknown>>;
      },
      { isStreaming: useStreaming, bypassCircuitBreaker, routingContext }
    );

    if (result && typeof result === 'object' && '_streamed' in result) {
      // Streaming handled internally
    } else if (result) {
      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (debugInfo) {
          (result as Record<string, unknown>).debug = debugInfo;
          setDebugResponseHeaders(res, debugInfo);
        }
      }
      res.json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Completions to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    const debugPayload = isDebugRequested(req)
      ? getDebugInfo(routingContext, { lastError: errorMessage })
      : undefined;
    res.status(500).json({
      error: { message: errorMessage, type: 'server_error' },
      ...(debugPayload && { debug: debugPayload }),
    });
  }
}

/**
 * Handle /v1/embeddings:$serverId - Route to specific server
 * Calls /v1/embeddings directly (Ollama's OpenAI compatible endpoint)
 */
export async function handleOpenAIEmbeddingsToServer(req: Request, res: Response): Promise<void> {
  const body = req.body as OpenAIEmbeddingRequest;
  const { model } = body;
  const serverId = Array.isArray((req.params as Record<string, unknown>).serverId)
    ? ((req.params as Record<string, unknown>).serverId as string[])[0]
    : String((req.params as Record<string, unknown>).serverId);

  // Check for bypass circuit breaker flag
  const bypassCircuitBreaker = shouldBypassCircuitBreaker(req);

  logger.info(`Received embeddings request to specific server`, {
    serverId,
    model,
    bypassCircuitBreaker,
  });

  if (!model) {
    res
      .status(400)
      .json({ error: { message: 'model is required', type: 'invalid_request_error' } });
    return;
  }
  if (!body.input) {
    res
      .status(400)
      .json({ error: { message: 'input is required', type: 'invalid_request_error' } });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const routingContext: RoutingContext = { algorithm: 'direct', protocol: 'openai' };

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown>>(
      serverId,
      model,
      async (server, _context) => {
        // Call OpenAI-compatible embeddings endpoint directly
        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OPENAI.EMBEDDINGS}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: safeJsonStringify(body),
          timeout: timeoutMs, // Use dynamic timeout
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return response.json() as Promise<Record<string, unknown>>;
      },
      { bypassCircuitBreaker, routingContext }
    );

    if (result) {
      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (debugInfo) {
          (result as Record<string, unknown>).debug = debugInfo;
          setDebugResponseHeaders(res, debugInfo);
        }
      }
      res.json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Embeddings to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    const debugPayload = isDebugRequested(req)
      ? getDebugInfo(routingContext, { lastError: errorMessage })
      : undefined;
    res.status(500).json({
      error: { message: errorMessage, type: 'server_error' },
      ...(debugPayload && { debug: debugPayload }),
    });
  }
}
