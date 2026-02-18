/**
 * openaiController.ts
 * OpenAI-compatible API endpoints for Ollama
 * Implements /v1/chat/completions, /v1/completions, /v1/embeddings, /v1/models
 */

import type { Request, Response } from 'express';

import { getConfigManager } from '../config/config.js';
import { getOrchestratorInstance } from '../orchestrator-instance.js';
import type { AIServer } from '../orchestrator.types.js';
import { fetchWithTimeout, fetchWithActivityTimeout } from '../utils/fetchWithTimeout.js';
import { logger } from '../utils/logger.js';
import { parseOllamaErrorGlobal as parseOllamaError } from '../utils/ollamaError.js';

/**
 * Resolve API key from string (supports env:VARNAME format)
 */
function resolveApiKey(apiKey?: string): string | undefined {
  if (!apiKey) return undefined;
  if (apiKey.startsWith('env:')) {
    const envVar = apiKey.substring(4);
    return process.env[envVar];
  }
  return apiKey;
}

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

interface OpenAIModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

/** Parsed chunk from Ollama's NDJSON streaming response */
interface OllamaStreamChunk {
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  message?: { content?: string };
  response?: string;
}

/** Model entry returned from Ollama's aggregated tags */
interface OllamaModelEntry {
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
  onChunk?: () => void
): Promise<void> {
  const startTime = Date.now();
  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;

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
        break;
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
          const chunk = JSON.parse(line) as OllamaStreamChunk;

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
                      finish_reason: 'stop',
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
                      finish_reason: 'stop',
                    },
                  ],
                };

            clientResponse.write(`data: ${JSON.stringify(finalDelta)}\n\n`);

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
              clientResponse.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
            }

            clientResponse.write('data: [DONE]\n\n');
            continue;
          }

          // Extract content from Ollama response
          const content = isChat ? (chunk.message?.content ?? '') : (chunk.response ?? '');

          if (content) {
            const sseChunk = isChat
              ? {
                  id: responseId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: { content, role: 'assistant' },
                      finish_reason: null,
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
                      text: content,
                      finish_reason: null,
                    },
                  ],
                };

            clientResponse.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
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
  const config = getConfigManager().getConfig();
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
      async (server: AIServer) => {
        const headers = getBackendHeaders(server);

        if (stream) {
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}/v1/chat/completions`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model,
                messages,
                stream: true,
                options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined,
                ...(body.tools && { tools: body.tools }),
              }),
              connectionTimeout: 60000,
              activityTimeout: config.streaming.activityTimeoutMs,
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          try {
            await streamOpenAIResponse(
              response,
              res,
              responseId,
              model,
              true,
              body.stream_options?.include_usage,
              () => activityController.resetTimeout()
            );
          } finally {
            activityController.clearTimeout();
          }

          return { _streamed: true };
        }

        // Non-streaming request - proxy to Ollama's OpenAI endpoint
        const response = await fetchWithTimeout(`${server.url}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined,
            ...(body.tools && { tools: body.tools }),
          }),
          timeout: 120000,
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await response.json()) as Record<string, unknown>;
      },
      stream,
      'generate',
      'openai'
    );

    // Send non-streaming response
    if (!stream && result && !result._streamed) {
      res.json(result);
    }
  } catch (error) {
    logger.error('OpenAI chat completions failed:', { error, model });

    if (res.writableEnded) {
      return;
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Request failed',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    }
  }
}

/**
 * Handle POST /v1/completions - OpenAI-compatible text completions
 */
export async function handleCompletions(req: Request, res: Response): Promise<void> {
  const body = req.body as OpenAICompletionRequest;
  const { model, prompt, stream = false } = body;

  logger.info('Received OpenAI completions request', {
    model,
    promptLength: typeof prompt === 'string' ? prompt.length : prompt?.length,
    stream,
  });

  if (!model || !prompt) {
    res.status(400).json({
      error: {
        message: 'model and prompt are required',
        type: 'invalid_request_error',
        param: !model ? 'model' : 'prompt',
        code: 'missing_required_parameter',
      },
    });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const config = getConfigManager().getConfig();
  const responseId = generateId('cmpl');

  // Build Ollama options
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

  // Handle prompt (can be string or array)
  const promptText = Array.isArray(prompt) ? prompt.join('') : prompt;

  try {
    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer) => {
        const headers = getBackendHeaders(server);

        if (stream) {
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}/v1/completions`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model,
                prompt: promptText,
                stream: true,
                options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined,
                ...(body.suffix && { suffix: body.suffix }),
              }),
              connectionTimeout: 60000,
              activityTimeout: config.streaming.activityTimeoutMs,
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          try {
            await streamOpenAIResponse(
              response,
              res,
              responseId,
              model,
              false,
              body.stream_options?.include_usage,
              () => activityController.resetTimeout()
            );
          } finally {
            activityController.clearTimeout();
          }

          return { _streamed: true };
        }

        // Non-streaming
        const response = await fetchWithTimeout(`${server.url}/v1/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            prompt: promptText,
            stream: false,
            options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined,
            ...(body.suffix && { suffix: body.suffix }),
          }),
          timeout: 120000,
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await response.json()) as Record<string, unknown>;
      },
      stream,
      'generate',
      'openai'
    );

    if (!stream && result && !result._streamed) {
      res.json(result);
    }
  } catch (error) {
    logger.error('OpenAI completions failed:', { error, model });

    if (res.writableEnded) {
      return;
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Request failed',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    }
  }
}

/**
 * Handle POST /v1/embeddings - OpenAI-compatible embeddings
 */
export async function handleOpenAIEmbeddings(req: Request, res: Response): Promise<void> {
  const body = req.body as OpenAIEmbeddingRequest;
  const { model, input } = body;

  logger.info('Received OpenAI embeddings request', {
    model,
    inputType: Array.isArray(input) ? 'array' : 'string',
    inputCount: Array.isArray(input) ? input.length : 1,
  });

  if (!model || !input) {
    res.status(400).json({
      error: {
        message: 'model and input are required',
        type: 'invalid_request_error',
        param: !model ? 'model' : 'input',
        code: 'missing_required_parameter',
      },
    });
    return;
  }

  const orchestrator = getOrchestratorInstance();

  try {
    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer) => {
        const headers = getBackendHeaders(server);
        const response = await fetchWithTimeout(`${server.url}/v1/embeddings`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            input,
            ...(body.encoding_format && { encoding_format: body.encoding_format }),
            ...(body.dimensions && { dimensions: body.dimensions }),
          }),
          timeout: 60000,
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await response.json()) as Record<string, unknown>;
      },
      false,
      'embeddings',
      'openai'
    );

    res.json(result);
  } catch (error) {
    logger.error('OpenAI embeddings failed:', { error, model });

    res.status(500).json({
      error: {
        message: error instanceof Error ? error.message : 'Request failed',
        type: 'server_error',
        code: 'internal_error',
      },
    });
  }
}

/**
 * Handle GET /v1/models - List all available models in OpenAI format
 */
export async function handleListModels(req: Request, res: Response): Promise<void> {
  const orchestrator = getOrchestratorInstance();

  try {
    const result = orchestrator.getAggregatedOpenAIModels();
    res.json(result);
  } catch (error) {
    logger.error('Failed to list models:', { error });
    res.status(500).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to list models',
        type: 'server_error',
        code: 'internal_error',
      },
    });
  }
}

/**
 * Handle GET /v1/models/:model - Get specific model info
 */
export async function handleGetModel(req: Request, res: Response): Promise<void> {
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
      return;
    }

    res.json(modelInfo);
  } catch (error) {
    logger.error('Failed to get model info:', { error, model });
    res.status(500).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to get model',
        type: 'server_error',
        code: 'internal_error',
      },
    });
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
  const bypassCircuitBreaker = req.query.bypass === 'true' || req.query.force === 'true';

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

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown>>(
      serverId,
      model,
      async server => {
        const requestBody: Record<string, unknown> = {
          model,
          messages,
          ...rest,
        };

        if (useStreaming) {
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}/v1/chat/completions`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...requestBody, stream: true }),
              connectionTimeout: 60000,
              activityTimeout: config.streaming.activityTimeoutMs,
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          try {
            await streamOpenAIResponse(
              response,
              res,
              `chatcmpl-${crypto.randomUUID()}`,
              model,
              true,
              body.stream_options?.include_usage,
              () => activityController.resetTimeout()
            );
          } finally {
            activityController.clearTimeout();
          }

          return { _streamed: true };
        }

        const response = await fetchWithTimeout(`${server.url}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          timeout: 180000,
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return response.json() as Promise<Record<string, unknown>>;
      },
      { isStreaming: useStreaming, bypassCircuitBreaker }
    );

    if (result && typeof result === 'object' && '_streamed' in result) {
      // Streaming handled internally
    } else if (result) {
      res.json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Chat completions to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    res.status(500).json({ error: { message: errorMessage, type: 'server_error' } });
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
  const bypassCircuitBreaker = req.query.bypass === 'true' || req.query.force === 'true';

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
  const config = getConfigManager().getConfig();

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown>>(
      serverId,
      model,
      async server => {
        const requestBody: Record<string, unknown> = {
          model,
          ...rest,
        };

        if (useStreaming) {
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}/v1/completions`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...requestBody, stream: true }),
              connectionTimeout: 60000,
              activityTimeout: config.streaming.activityTimeoutMs,
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
            res.end();
          } finally {
            activityController.clearTimeout();
          }

          return { _streamed: true };
        }

        const response = await fetchWithTimeout(`${server.url}/v1/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          timeout: 180000,
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return response.json() as Promise<Record<string, unknown>>;
      },
      { isStreaming: useStreaming, bypassCircuitBreaker }
    );

    if (result && typeof result === 'object' && '_streamed' in result) {
      // Streaming handled internally
    } else if (result) {
      res.json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Completions to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    res.status(500).json({ error: { message: errorMessage, type: 'server_error' } });
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
  const bypassCircuitBreaker = req.query.bypass === 'true' || req.query.force === 'true';

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

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown>>(
      serverId,
      model,
      async server => {
        // Call OpenAI-compatible embeddings endpoint directly
        const response = await fetchWithTimeout(`${server.url}/v1/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeout: 60000,
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return response.json() as Promise<Record<string, unknown>>;
      },
      { bypassCircuitBreaker }
    );

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Embeddings to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    res.status(500).json({ error: { message: errorMessage, type: 'server_error' } });
  }
}
