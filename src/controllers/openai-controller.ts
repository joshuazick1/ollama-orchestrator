/**
 * openaiController.ts
 * OpenAI-compatible API endpoints for Ollama
 * Implements /v1/chat/completions, /v1/completions, /v1/embeddings, /v1/models
 */

import type { Request, Response } from 'express';

import { getConfigManager } from '../config/config.js';
import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants/index.js';
import { isInternalAdmin } from '../middleware/auth.js';
import {
  getOrchestratorInstance,
  type RoutingContext,
} from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import { createStallDetector, type OllamaStreamChunk, type OllamaToolCall } from '../streaming.js';
import type {
  OpenAIChatCompletionRequest,
  OpenAICompletionRequest,
  OpenAIEmbeddingRequest,
} from '../types/api-request.types.js';
import { shouldBypassCircuitBreaker } from '../utils/circuit-breaker-helpers.js';
import { getDebugInfo, isDebugRequested, setDebugResponseHeaders } from '../utils/debug-headers.js';
import {
  fetchWithTimeout,
  fetchWithActivityTimeout,
  parseResponse,
} from '../utils/fetch-with-timeout.js';
import { forwardRequestHeaders, type ProviderType } from '../utils/header-forwarder.js';
import { getInFlightManager } from '../utils/in-flight-manager.js';
import { safeJsonParse, safeJsonStringify, toBodyInit } from '../utils/json-utils.js';
import { logger } from '../utils/logger.js';
import { parseOllamaErrorGlobal as parseOllamaError } from '../utils/ollama-error.js';
import { classifyOrchestratorRoutingError } from '../utils/orchestrator-error-classifier.js';
import { estimateChatTokens, estimatePromptTokens } from '../utils/prompt-estimator.js';
// import { performStreamHandoff } from '../utils/stream-handoff.js';
import { forwardStreamingResponseHeaders } from '../utils/response-header-forwarder.js';
import { setupStreamingClientDisconnectCleanup } from '../utils/streaming-cleanup.js';
import {
  computeStallThresholds,
  createStreamingStallHandler,
} from '../utils/streaming-response-handler.js';
import { resolveRequestTimeout } from '../utils/timeout-manager.js';

/**
 * Get headers for backend requests including optional auth
 */
function getBackendHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  server: AIServer
): Record<string, string> {
  return forwardRequestHeaders(clientHeaders, 'openai' as ProviderType, server);
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
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 13)}`;
}

function isOllamaServer(server: AIServer): boolean {
  const url = server.url.toLowerCase();
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('.ollama.');
}

function waitForDrain(clientResponse: Response, abortSignal?: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    let settled = false;
    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      clientResponse.removeListener('drain', onDrain);
      clientResponse.removeListener('close', onClose);
      clientResponse.removeListener('finish', onClose);
      abortSignal?.removeEventListener('abort', onAbort);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      resolve();
    };
    clientResponse.once('drain', onDrain);
    clientResponse.once('close', onClose);
    clientResponse.once('finish', onClose);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
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
  streamingRequestId?: string,
  onStall?: (
    abortController: AbortController,
    streamingRequestId?: string
  ) => Promise<{ success: boolean; error?: string } | void>,
  stallThresholdMs?: number,
  stallCheckIntervalMs?: number,
  _onStreamEnd?: () => void,
  preEnd?: (
    clientResponse: Response,
    tokenData?: { promptTokens: number; completionTokens: number }
  ) => void,
  activityController?: { controller: { signal: AbortSignal } }
): Promise<void> {
  const startTime = Date.now();
  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let hasEmittedRoleChunk = false;
  const effectiveStallThreshold = stallThresholdMs ?? 300000;
  const effectiveStallCheckInterval = stallCheckIntervalMs ?? 10000;

  try {
    forwardStreamingResponseHeaders(upstreamResponse, clientResponse);

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      throw new Error('No response body to stream');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let stallDetector: ReturnType<typeof createStallDetector> | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        stallDetector?.stop();
        break;
      }

      if (stallDetector) {
        stallDetector.onChunk();
      } else if (onStall) {
        stallDetector = createStallDetector(
          async (abortController: AbortController, reqId: string | undefined) => {
            logger.warn('OpenAI stream stall detected', {
              responseId,
              model,
              stallThreshold: effectiveStallThreshold,
            });
            const res = await onStall(abortController, reqId);
            try {
              void reader.cancel();
            } catch (_e) {
              logger.error('Reader cancel failed in stall handler', {
                responseId,
                error: String(_e),
              });
            }
            if (res?.success) {
              logger.info('OpenAI stall handled successfully via handoff', { responseId });
            }
            return res;
          },
          effectiveStallThreshold,
          effectiveStallCheckInterval,
          streamingRequestId
        );
      }

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
              await waitForDrain(clientResponse, activityController?.controller.signal);
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
                await waitForDrain(clientResponse, activityController?.controller.signal);
              }
            }

            const writeResult3 = clientResponse.write('data: [DONE]\n\n');
            if (!writeResult3) {
              await waitForDrain(clientResponse, activityController?.controller.signal);
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
              await waitForDrain(clientResponse, activityController?.controller.signal);
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
              await waitForDrain(clientResponse, activityController?.controller.signal);
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

    preEnd?.(clientResponse, { promptTokens, completionTokens });
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
  _onStreamEnd?: () => void,
  preEnd?: (clientResponse: Response) => void,
  activityController?: { controller: { signal: AbortSignal } },
  onUpstreamRequestId?: (upstreamRequestId: string | undefined) => void
): Promise<void> {
  const startTime = Date.now();
  const effectiveStallThreshold = stallThresholdMs ?? 300000;
  const effectiveStallCheckInterval = stallCheckIntervalMs ?? 10000;
  let stallDetector: ReturnType<typeof createStallDetector> | undefined;

  // Forward upstream status code
  clientResponse.status(upstreamResponse.status);

  // Forward upstream's Content-Type instead of hardcoding
  const upstreamContentType = upstreamResponse.headers.get('content-type');
  if (upstreamContentType) {
    clientResponse.setHeader('Content-Type', upstreamContentType);
  }

  // If upstream returned non-OK, forward error body byte-perfect
  if (!upstreamResponse.ok) {
    try {
      const errorBody = await upstreamResponse.text();
      clientResponse.setHeader('Content-Type', 'application/json');
      clientResponse.send(errorBody);
      return;
    } catch {
      // Fall through to send generic error
    }
  }

  try {
    const upstreamRequestId = forwardStreamingResponseHeaders(upstreamResponse, clientResponse);
    onUpstreamRequestId?.(upstreamRequestId);

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      throw new Error('No response body to stream');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let upstreamSentDone = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        stallDetector?.stop();
        break;
      }

      if (stallDetector) {
        stallDetector.onChunk();
      } else if (onStall) {
        stallDetector = createStallDetector(
          async (abortController: AbortController, reqId: string | undefined) => {
            logger.warn('SSE passthrough stall detected', {
              responseId,
              model,
              stallThreshold: effectiveStallThreshold,
            });
            const res = await onStall(abortController, reqId);
            try {
              void reader.cancel();
            } catch (cancelErr) {
              logger.debug('Reader cancel failed in SSE passthrough stall handler', {
                responseId,
                error: String(cancelErr),
              });
            }
            if (res?.success) {
              logger.info('SSE passthrough stall handled successfully via handoff', { responseId });
            }
            return res;
          },
          effectiveStallThreshold,
          effectiveStallCheckInterval,
          streamingRequestId
        );
      }

      onChunk?.();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        // Forward SSE lines verbatim (includes `data: …` and blank separator lines)
        const writeResult = clientResponse.write(`${line}\n`);
        if (!writeResult) {
          await waitForDrain(clientResponse, activityController?.controller.signal);
        }

        // Track if upstream already sent [DONE]
        if (line === 'data: [DONE]') {
          upstreamSentDone = true;
          logger.debug('SSE passthrough received [DONE]', { responseId, model });
        }
      }

      if (clientResponse.writableEnded) {
        logger.info('Client disconnected from SSE passthrough stream', { responseId, model });
        try {
          void reader.cancel();
        } catch (cancelErr) {
          logger.debug('Reader cancel failed in SSE passthrough stall handler', {
            responseId,
            error: String(cancelErr),
          });
        }
        break;
      }
    }

    // Flush any remaining buffer content
    if (buffer.trim()) {
      const writeResult = clientResponse.write(`${buffer}\n`);
      if (!writeResult) {
        await waitForDrain(clientResponse, activityController?.controller.signal);
      }
    }

    // Only send [DONE] if upstream didn't already send it
    if (!upstreamSentDone) {
      const writeResult = clientResponse.write('data: [DONE]\n\n');
      if (!writeResult) {
        await waitForDrain(clientResponse, activityController?.controller.signal);
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
      preEnd?.(clientResponse);
      clientResponse.end();
    }
  } finally {
    stallDetector?.stop();
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

  const n = body.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    res.status(400).json({
      error: {
        message: 'n must be an integer between 1 and 10',
        type: 'invalid_request_error',
        param: 'n',
        code: 'invalid_value',
      },
    });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const _config = getConfigManager().getConfig();
  const routingContext: RoutingContext = {};
  const responseId = generateId('chatcmpl');

  const activeStreamState: {
    serverId?: string;
    model?: string;
    streamingRequestId?: string;
    activityController?: { controller: AbortController };
  } = {};
  if (stream) {
    setupStreamingClientDisconnectCleanup(req, res, () => activeStreamState);
  }

  // Build Ollama options from OpenAI parameters
  // Provider compatibility:
  // - Ollama (localhost/.ollama.): uses 'options' object with 'format' for JSON schema,
  //   'parallel_tool_calls', 'tool_choice' inside options
  // - OpenAI-compatible (DeepSeek, Groq, vLLM): uses top-level 'response_format',
  //   'parallel_tool_calls', 'tool_choice' fields natively
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

  // Handle response format for JSON mode (Ollama uses 'format' param)
  // json_object -> format: 'json' (legacy)
  // json_schema -> format: {json_schema} (Ollama 0.5+) - handled at request time per server
  if (body.response_format?.type === 'json_object') {
    ollamaOptions.format = 'json';
  }

  try {
    // Extract user info for access control scoping
    const userId = req.user?.id;
    const isAdmin = isInternalAdmin(req);

    if (stream && n > 1) {
      const baseResponseId = generateId('chatcmpl');

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const streamCompletion = async (idx: number): Promise<Record<string, unknown>> => {
        return orchestrator.tryRequestWithFailover<Record<string, unknown>>(
          model,
          async (server: AIServer, context?: { requestId?: string }) => {
            const headers = getBackendHeaders(req.headers, server);
            const timeoutMs = resolveRequestTimeout(
              req.headers,
              orchestrator.getTimeout(server.id, model)
            );
            const _requestId = context?.requestId;

            const { response, activityController } = await fetchWithActivityTimeout(
              `${server.url}${API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS}`,
              {
                method: 'POST',
                headers,
                body:
                  toBodyInit(req.rawBody) ??
                  safeJsonStringify({
                    model,
                    messages,
                    stream: true,
                    options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined,
                    ...(body.tools && { tools: body.tools }),
                  }),
                connectionTimeout: timeoutMs,
                activityTimeout: timeoutMs,
                telemetryMeta: {
                  serverId: server.id,
                  model,
                  protocol: 'openai',
                  endpoint: 'chat',
                  isStreaming: true,
                },
              }
            );

            if (!response.ok) {
              activityController.clearTimeout();
              const errorMessage = await parseOllamaError(response);
              throw new Error(errorMessage);
            }

            const reader = response.body?.getReader();
            if (!reader) {
              throw new Error('No response body to stream');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                  break;
                }

                activityController.resetTimeout();
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                  if (!line.trim() || line === 'data: [DONE]') {
                    continue;
                  }

                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.choices && data.choices[0]) {
                      data.choices[0].index = idx;
                      data.id = `${baseResponseId}-${idx}`;
                    }
                    const writeResult = res.write(`data: ${JSON.stringify(data)}\n\n`);
                    if (!writeResult) {
                      await new Promise<void>(resolve => res.once('drain', resolve));
                    }
                  } catch {
                    // Skip malformed JSON
                  }
                }

                if (res.writableEnded) {
                  void reader.cancel();
                  break;
                }
              }

              const doneWrite = res.write('data: [DONE]\n\n');
              if (!doneWrite) {
                await new Promise<void>(resolve => res.once('drain', resolve));
              }
            } finally {
              activityController.clearTimeout();
            }

            return { _streamed: true } as Record<string, unknown>;
          },
          true,
          'generate',
          'openai',
          routingContext,
          undefined,
          estimateChatTokens(messages as unknown as Array<{ role?: string; content?: string }>),
          userId,
          isAdmin
        );
      };

      await Promise.all(Array.from({ length: n }, (_, idx) => streamCompletion(idx)));

      orchestrator.getMetricsAggregator().recordParallelCompletions(n);

      res.end();
      return;
    }

    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer, context?: { requestId?: string }) => {
        const headers = getBackendHeaders(req.headers, server);

        if (stream) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          const requestId = context?.requestId;
          activeStreamState.serverId = server.id;
          activeStreamState.model = model;
          activeStreamState.streamingRequestId = requestId;
          const { stallThreshold, stallCheckInterval } = computeStallThresholds(timeoutMs, {
            factor: _config.timeout.stallThresholdMultiplier,
            upperBound: _config.timeout.stallThresholdCapMs,
          });

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

          // Determine server type and build appropriate request body
          // Ollama uses 'options' object; OpenAI-compatible uses top-level fields
          const isOllama = isOllamaServer(server);
          const requestOptions = { ...ollamaOptions };
          const requestBody: Record<string, unknown> = {
            model,
            messages,
            stream: true,
          };

          if (isOllama) {
            // Ollama: add format for json_schema, parallel_tool_calls, tool_choice to options
            if (body.response_format?.type === 'json_schema' && body.response_format?.json_schema) {
              requestOptions.format = body.response_format.json_schema;
            }
            if (body.parallel_tool_calls !== undefined) {
              requestOptions.parallel_tool_calls = body.parallel_tool_calls;
            }
            if (body.tool_choice !== undefined) {
              requestOptions.tool_choice = body.tool_choice;
            }
            if (Object.keys(requestOptions).length > 0) {
              requestBody.options = requestOptions;
            }
          } else {
            // OpenAI-compatible (DeepSeek, Groq, vLLM): forward at top level
            if (Object.keys(requestOptions).length > 0) {
              requestBody.options = requestOptions;
            }
            if (body.response_format !== undefined) {
              requestBody.response_format = body.response_format;
            }
            if (body.parallel_tool_calls !== undefined) {
              requestBody.parallel_tool_calls = body.parallel_tool_calls;
            }
            if (body.tool_choice !== undefined) {
              requestBody.tool_choice = body.tool_choice;
            }
          }

          if (body.tools) {
            requestBody.tools = body.tools;
          }

          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS}`,
            {
              method: 'POST',
              headers,
              body: toBodyInit(req.rawBody) ?? safeJsonStringify(requestBody),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
              telemetryMeta: {
                serverId: server.id,
                model,
                protocol: 'openai',
                endpoint: 'chat',
                isStreaming: true,
              },
            }
          );

          activeStreamState.activityController = activityController;

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
          let _openaiChatHandoffAttempted = false;
          let _openaiChatHandoffSuccess = false;

          const { onStall: sharedOnStall } = createStreamingStallHandler({
            server,
            requestId: requestId ?? '',
            model,
            protocol: 'openai',
            endpoint: 'chat',
            clientResponse: res,
            originalRequestBody: body as unknown as Record<string, unknown>,
            stallThreshold,
            stallCheckInterval,
          });

          const onStallCallback = async (
            _abortController: AbortController,
            passedRequestId?: string
          ): Promise<{ success: boolean; error?: string }> => {
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

            const result = await sharedOnStall(_abortController, passedRequestId);

            _openaiChatHandoffAttempted = true;
            _openaiChatHandoffSuccess = result.success;

            return result;
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
                },
                isDebugRequested(req)
                  ? () => {
                      const streamDuration = Date.now() - streamStartTime;
                      const ttft = firstChunkTime ? firstChunkTime - streamStartTime : undefined;
                      const debugInfo = getDebugInfo(routingContext, {
                        requestId,
                        requestTimestamp: streamStartTime,
                        timeToFirstToken: ttft,
                        streamingDuration: streamDuration,
                        stallDetected: openaiChatStallDetected,
                        stallDurationMs: openaiChatStallStartTime
                          ? Date.now() - openaiChatStallStartTime
                          : undefined,
                      });
                      if (debugInfo) {
                        res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
                      }
                    }
                  : undefined,
                activityController,
                (upstreamRequestId?: string) => {
                  logger.info('request_forwarded', {
                    orchestratorRequestId: requestId,
                    upstreamRequestId,
                    provider: 'openai',
                    serverId: server.id,
                  });
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
                false, // Do not synthesize usage - forward only what upstream provides
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
                },
                isDebugRequested(req)
                  ? clientResponse => {
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
                        clientResponse.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
                      }
                    }
                  : undefined,
                activityController
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

        // Determine server type and build appropriate request body
        // Ollama uses 'options' object; OpenAI-compatible uses top-level fields
        const isOllama = isOllamaServer(server);
        const requestOptions = { ...ollamaOptions };
        const requestBody: Record<string, unknown> = {
          model,
          messages,
          stream: false,
        };

        if (isOllama) {
          // Ollama: add format for json_schema, parallel_tool_calls, tool_choice to options
          if (body.response_format?.type === 'json_schema' && body.response_format?.json_schema) {
            requestOptions.format = body.response_format.json_schema;
          }
          if (body.parallel_tool_calls !== undefined) {
            requestOptions.parallel_tool_calls = body.parallel_tool_calls;
          }
          if (body.tool_choice !== undefined) {
            requestOptions.tool_choice = body.tool_choice;
          }
          if (Object.keys(requestOptions).length > 0) {
            requestBody.options = requestOptions;
          }
        } else {
          // OpenAI-compatible (DeepSeek, Groq, vLLM): forward at top level
          if (Object.keys(requestOptions).length > 0) {
            requestBody.options = requestOptions;
          }
          if (body.response_format !== undefined) {
            requestBody.response_format = body.response_format;
          }
          if (body.parallel_tool_calls !== undefined) {
            requestBody.parallel_tool_calls = body.parallel_tool_calls;
          }
          if (body.tool_choice !== undefined) {
            requestBody.tool_choice = body.tool_choice;
          }
        }

        if (body.tools) {
          requestBody.tools = body.tools;
        }

        const response = await fetchWithTimeout(
          `${server.url}${API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS}`,
          {
            method: 'POST',
            headers,
            body: toBodyInit(req.rawBody) ?? safeJsonStringify(requestBody),
            timeout: timeoutMs,
            telemetryMeta: {
              serverId: server.id,
              model,
              protocol: 'openai',
              endpoint: 'chat',
              isStreaming: false,
            },
          }
        );

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await parseResponse<Record<string, unknown>>(response))!;
      },
      stream,
      'generate',
      'openai',
      routingContext,
      undefined,
      estimateChatTokens(messages as unknown as Array<{ role?: string; content?: string }>),
      userId,
      isAdmin
    );

    if (!stream && n > 1) {
      const createdTimestamp = Math.floor(Date.now() / 1000);
      const baseResponseId = generateId('chatcmpl');

      const parallelResults = await Promise.all(
        Array.from({ length: n }, async () => {
          return orchestrator.tryRequestWithFailover<Record<string, unknown>>(
            model,
            async (server: AIServer) => {
              const headers = getBackendHeaders(req.headers, server);
              const timeoutMs = resolveRequestTimeout(
                req.headers,
                orchestrator.getTimeout(server.id, model)
              );
              const response = await fetchWithTimeout(
                `${server.url}${API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS}`,
                {
                  method: 'POST',
                  headers,
                  body:
                    toBodyInit(req.rawBody) ??
                    safeJsonStringify({
                      model,
                      messages,
                      stream: false,
                      options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined,
                      ...(body.tools && { tools: body.tools }),
                    }),
                  timeout: timeoutMs,
                  telemetryMeta: {
                    serverId: server.id,
                    model,
                    protocol: 'openai',
                    endpoint: 'chat',
                    isStreaming: false,
                  },
                }
              );

              if (!response.ok) {
                const errorMessage = await parseOllamaError(response);
                throw new Error(errorMessage);
              }

              return (await parseResponse<Record<string, unknown>>(response))!;
            },
            false,
            'generate',
            'openai',
            routingContext,
            undefined,
            estimateChatTokens(messages as unknown as Array<{ role?: string; content?: string }>),
            userId,
            isAdmin
          );
        })
      );

      orchestrator.getMetricsAggregator().recordParallelCompletions(n);

      const choices = parallelResults.map((r, idx) => {
        const result = r;
        const choice = (result.choices as Array<Record<string, unknown>>)?.[0];
        return {
          index: idx,
          message: (choice?.message as Record<string, unknown>) || {
            role: 'assistant',
            content: '',
          },
          finish_reason: (choice?.finish_reason as string) || 'stop',
        };
      });

      const totalUsage = parallelResults.reduce(
        (acc: { prompt_tokens: number; completion_tokens: number; total_tokens: number }, r) => {
          const result = r;
          const u = (result.usage as Record<string, number>) || {};
          return {
            prompt_tokens: acc.prompt_tokens + (u.prompt_tokens || 0),
            completion_tokens: acc.completion_tokens + (u.completion_tokens || 0),
            total_tokens: acc.total_tokens + (u.total_tokens || 0),
          };
        },
        { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      );

      const mergedResponse: Record<string, unknown> = {
        id: baseResponseId,
        object: 'chat.completion',
        created: createdTimestamp,
        model,
        choices,
        usage: totalUsage,
      };

      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (debugInfo) {
          mergedResponse.debug = debugInfo;
          setDebugResponseHeaders(res, debugInfo);
        }
      }

      res.json(mergedResponse);
      return;
    }

    // Send non-streaming response (n === 1)
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
      const { isNoServersError, isConcurrencySaturated, isAccessDenied } =
        classifyOrchestratorRoutingError(errorMessage);
      const isCapacityError = isNoServersError || isConcurrencySaturated;
      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;
      if (isAccessDenied) {
        res.status(403).json({
          error: {
            message: errorMessage,
            type: 'access_denied',
            code: 'forbidden',
          },
          ...(debugPayload && { debug: debugPayload }),
        });
      } else {
        res.status(isCapacityError ? 503 : 500).json({
          error: {
            message: errorMessage,
            type: isCapacityError ? 'capacity_error' : 'server_error',
            code: isCapacityError ? 'service_unavailable' : 'internal_error',
          },
          ...(debugPayload && { debug: debugPayload }),
        });
      }
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
      .json({ error: { message: ERROR_MESSAGES.MODEL_REQUIRED, type: 'invalid_request_error' } });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const _config = getConfigManager().getConfig();
  const routingContext: RoutingContext = {};

  const activeStreamState: {
    serverId?: string;
    model?: string;
    streamingRequestId?: string;
    activityController?: { controller: AbortController };
  } = {};
  if (stream) {
    setupStreamingClientDisconnectCleanup(req, res, () => activeStreamState);
  }

  try {
    // Extract user info for access control scoping
    const userId = req.user?.id;
    const isAdmin = isInternalAdmin(req);

    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer) => {
        const headers = getBackendHeaders(req.headers, server);

        if (stream) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          activeStreamState.serverId = server.id;
          activeStreamState.model = model;
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OPENAI.COMPLETIONS}`,
            {
              method: 'POST',
              headers,
              body: toBodyInit(req.rawBody) ?? safeJsonStringify({ ...body, stream: true }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
              telemetryMeta: {
                serverId: server.id,
                model,
                protocol: 'openai',
                endpoint: 'completions',
                isStreaming: true,
              },
            }
          );

          activeStreamState.activityController = activityController;

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
              false, // Do not synthesize usage - forward only what upstream provides
              () => {
                activityController.resetTimeout();
              },
              undefined, // streamingRequestId
              undefined, // onStall
              undefined, // stallThresholdMs
              undefined, // stallCheckIntervalMs
              undefined, // _onStreamEnd
              isDebugRequested(req)
                ? (clientResponse, tokenData) => {
                    const debugInfo = getDebugInfo(routingContext, {
                      streamingDuration: Date.now() - completionStreamStart,
                      tokensGenerated: tokenData?.completionTokens,
                      tokensPrompt: tokenData?.promptTokens,
                    });
                    if (debugInfo) {
                      clientResponse.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
                    }
                  }
                : undefined,
              activityController
            );
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
            telemetryMeta: {
              serverId: server.id,
              model,
              protocol: 'openai',
              endpoint: 'completions',
              isStreaming: false,
            },
          }
        );

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await parseResponse<Record<string, unknown>>(response))!;
      },
      stream,
      'generate',
      'openai',
      routingContext,
      undefined,
      Array.isArray(body.prompt)
        ? body.prompt.reduce((sum, p) => sum + estimatePromptTokens(p), 0)
        : estimatePromptTokens(body.prompt || ''),
      userId,
      isAdmin
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
      const { isNoServersError, isConcurrencySaturated, isAccessDenied } =
        classifyOrchestratorRoutingError(errorMessage);
      const isCapacityError = isNoServersError || isConcurrencySaturated;
      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;
      if (isAccessDenied) {
        res.status(403).json({
          error: {
            message: errorMessage,
            type: 'access_denied',
            code: 'forbidden',
          },
          ...(debugPayload && { debug: debugPayload }),
        });
      } else {
        res.status(isCapacityError ? 503 : 500).json({
          error: {
            message: errorMessage,
            type: isCapacityError ? 'capacity_error' : 'server_error',
            code: isCapacityError ? 'service_unavailable' : 'internal_error',
          },
          ...(debugPayload && { debug: debugPayload }),
        });
      }
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
    // Extract user info for access control scoping
    const userId = req.user?.id;
    const isAdmin = isInternalAdmin(req);

    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer) => {
        const headers = getBackendHeaders(req.headers, server);
        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OPENAI.EMBEDDINGS}`, {
          method: 'POST',
          headers,
          body: safeJsonStringify(body),
          timeout: timeoutMs,
          telemetryMeta: {
            serverId: server.id,
            model,
            protocol: 'openai',
            endpoint: 'embeddings',
            isStreaming: false,
          },
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await parseResponse<Record<string, unknown>>(response))!;
      },
      false,
      'embeddings',
      'openai',
      routingContext,
      undefined,
      Array.isArray(body.input)
        ? body.input.reduce((sum, p) => sum + estimatePromptTokens(p), 0)
        : estimatePromptTokens(body.input || ''),
      userId,
      isAdmin
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
      const { isNoServersError, isConcurrencySaturated, isAccessDenied } =
        classifyOrchestratorRoutingError(errorMessage);
      const isCapacityError = isNoServersError || isConcurrencySaturated;
      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;
      if (isAccessDenied) {
        res.status(403).json({
          error: {
            message: errorMessage,
            type: 'access_denied',
            code: 'forbidden',
          },
          ...(debugPayload && { debug: debugPayload }),
        });
      } else {
        res.status(isCapacityError ? 503 : 500).json({
          error: {
            message: errorMessage,
            type: isCapacityError ? 'capacity_error' : 'server_error',
            code: isCapacityError ? 'service_unavailable' : 'internal_error',
          },
          ...(debugPayload && { debug: debugPayload }),
        });
      }
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
      .json({ error: { message: ERROR_MESSAGES.MODEL_REQUIRED, type: 'invalid_request_error' } });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = stream ?? false;
  const config = getConfigManager().getConfig();
  const routingContext: RoutingContext = { algorithm: 'direct', protocol: 'openai' };

  const activeStreamState: {
    serverId?: string;
    model?: string;
    streamingRequestId?: string;
    activityController?: { controller: AbortController };
  } = {};
  if (useStreaming) {
    setupStreamingClientDisconnectCleanup(req, res, () => activeStreamState);
  }

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
          activeStreamState.serverId = server.id;
          activeStreamState.model = model;
          activeStreamState.streamingRequestId = requestId;
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
              body: toBodyInit(req.rawBody) ?? safeJsonStringify({ ...requestBody, stream: true }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
              telemetryMeta: {
                serverId: server.id,
                model,
                protocol: 'openai',
                endpoint: 'chat',
                isStreaming: true,
              },
            }
          );

          activeStreamState.activityController = activityController;

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
              false, // Do not synthesize usage - forward only what upstream provides
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
              },
              isDebugRequested(req)
                ? clientResponse => {
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
                      clientResponse.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
                    }
                  }
                : undefined,
              activityController
            );

            logger.info('STREAM_COMPLETE', {
              requestId,
              serverId: server.id,
              model,
              endpoint: 'chat',
              duration: Date.now() - streamStartTime,
              chunkCount,
            });
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
            telemetryMeta: {
              serverId: server.id,
              model,
              protocol: 'openai',
              endpoint: 'chat',
              isStreaming: false,
            },
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
          result.debug = debugInfo;
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
      .json({ error: { message: ERROR_MESSAGES.MODEL_REQUIRED, type: 'invalid_request_error' } });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = stream ?? false;
  const _config = getConfigManager().getConfig();
  const routingContext: RoutingContext = { algorithm: 'direct', protocol: 'openai' };

  const activeStreamState: {
    serverId?: string;
    model?: string;
    streamingRequestId?: string;
    activityController?: { controller: AbortController };
  } = {};
  if (useStreaming) {
    setupStreamingClientDisconnectCleanup(req, res, () => activeStreamState);
  }

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
          activeStreamState.serverId = server.id;
          activeStreamState.model = model;
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OPENAI.COMPLETIONS}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: toBodyInit(req.rawBody) ?? safeJsonStringify({ ...requestBody, stream: true }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
              telemetryMeta: {
                serverId: server.id,
                model,
                protocol: 'openai',
                endpoint: 'completions',
                isStreaming: true,
              },
            }
          );

          activeStreamState.activityController = activityController;

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
            telemetryMeta: {
              serverId: server.id,
              model,
              protocol: 'openai',
              endpoint: 'completions',
              isStreaming: false,
            },
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
          result.debug = debugInfo;
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
      .json({ error: { message: ERROR_MESSAGES.MODEL_REQUIRED, type: 'invalid_request_error' } });
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
          timeout: timeoutMs,
          telemetryMeta: {
            serverId: server.id,
            model,
            protocol: 'openai',
            endpoint: 'embeddings',
            isStreaming: false,
          },
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
          result.debug = debugInfo;
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
