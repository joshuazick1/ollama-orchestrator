/**
 * ollamaController.ts
 * Ollama API proxy controllers with streaming support
 */

import type { Request, Response } from 'express';

import { getConfigManager } from '../config/config.js';
import { API_ENDPOINTS } from '../constants/index.js';
import { TTFTTracker } from '../metrics/ttft-tracker.js';
import { getOrchestratorInstance, type RoutingContext } from '../orchestrator-instance.js';
import type { AIServer } from '../orchestrator.types.js';
import { streamResponse, isStreamingRequest, handleStreamWithRetry } from '../streaming.js';
import { addDebugHeaders } from '../utils/debug-headers.js';
import { fetchWithTimeout, fetchWithActivityTimeout } from '../utils/fetchWithTimeout.js';
import { logger } from '../utils/logger.js';
import { parseOllamaErrorGlobal as parseOllamaError } from '../utils/ollamaError.js';

/** Request body for /api/generate */
interface GenerateRequestBody {
  model?: string;
  prompt?: string;
  stream?: boolean;
  context?: number[];
  options?: Record<string, unknown>;
  keep_alive?: number;
}

/** Request body for /api/chat */
interface ChatRequestBody {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  options?: Record<string, unknown>;
  keep_alive?: number;
}

/** Request body for /api/embeddings */
interface EmbeddingsRequestBody {
  model?: string;
  prompt?: string;
}

/** Request body for /api/show */
interface ShowRequestBody {
  model?: string;
}

/** Request body for /api/embed */
interface EmbedRequestBody {
  model?: string;
  input?: string | string[];
  prompt?: string;
  truncate?: boolean;
  options?: Record<string, unknown>;
  keep_alive?: number;
  dimensions?: number;
}

/** Response from /api/ps */
interface PsModelEntry {
  name?: string;
  model?: string;
  size?: number;
  digest?: string;
  expires_at?: string;
  size_vram?: number;
  [key: string]: unknown;
}

interface PsResponse {
  models?: PsModelEntry[];
}

/** Streaming metrics returned from streaming requests */
interface StreamingMetrics {
  _streamingMetrics: {
    ttft: number | undefined;
    streamingDuration: number;
  };
  _tokenMetrics?: {
    tokensGenerated: number;
    tokensPrompt: number;
  };
}

/**
 * Handle /api/tags - Get aggregated tags from all servers
 */
export async function handleTags(req: Request, res: Response): Promise<void> {
  const orchestrator = getOrchestratorInstance();

  try {
    const tags = await orchestrator.getAggregatedTags();
    res.json(tags);
  } catch (error) {
    logger.error('Failed to get aggregated tags:', { error });
    res.status(500).json({
      error: 'Failed to get tags',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle /api/generate - Generate text with failover and streaming support
 */
export async function handleGenerate(req: Request, res: Response): Promise<void> {
  const body = req.body as GenerateRequestBody;
  const { model } = body;
  const prompt = body.prompt;

  logger.info(`Received generate request`, {
    model,
    promptLength: prompt?.length,
    stream: isStreamingRequest(body),
    hasContext: !!body.context,
    hasOptions: !!body.options,
  });

  if (!model) {
    res.status(400).json({ error: 'model is required' });
    return;
  }

  // Handle empty prompt case for model load/unload
  // Empty prompt with keep_alive loads/unloads model without generating
  if (!prompt && (!body.keep_alive || body.keep_alive !== 0)) {
    res.status(400).json({
      error: 'prompt is required for generation (or use keep_alive to load/unload)',
    });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = isStreamingRequest(body);
  const config = getConfigManager().getConfig();
  const routingContext: RoutingContext = {};

  try {
    const result = await orchestrator.tryRequestWithFailover(
      model,
      async server => {
        // Use activity-based timeout for streaming to prevent cutoffs during active streams
        if (useStreaming) {
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...body,
                stream: true,
              }),
              connectionTimeout: 60000, // 1 minute to establish connection
              activityTimeout: config.streaming.activityTimeoutMs, // Reset on each chunk
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          const ttftTracker = new TTFTTracker({ serverId: server.id, model });
          const streamStartTime = Date.now();
          let firstTokenAt: number | undefined;
          let tokenMetrics: { tokensGenerated: number; tokensPrompt: number } | undefined;

          try {
            await streamResponse(
              response,
              res,
              () => {
                // First token callback
                firstTokenAt = Date.now();

                // Track with TTFTTracker
                ttftTracker.markFirstChunk(0);

                logger.debug(`First token received for model ${model}`, {
                  timeToFirstToken: firstTokenAt - streamStartTime,
                });
              },
              (duration, tokensGenerated, tokensPrompt) => {
                // Get TTFT metrics from tracker
                const ttftMetrics = ttftTracker.getMetrics();

                // Stream complete callback - capture token metrics
                logger.info(
                  `Streaming completed in ${duration}ms, tokensGenerated: ${tokensGenerated}, tokensPrompt: ${tokensPrompt}`
                );
                tokenMetrics = { tokensGenerated, tokensPrompt };
                const metrics: StreamingMetrics = {
                  _streamingMetrics: {
                    ttft:
                      ttftMetrics.ttft ??
                      (firstTokenAt ? firstTokenAt - streamStartTime : undefined),
                    streamingDuration: duration,
                  },
                  _tokenMetrics: {
                    tokensGenerated,
                    tokensPrompt,
                  },
                };
                res.write(`data: ${JSON.stringify(metrics)}\n\n`);
                res.end();
              },
              () => {
                // On each chunk, reset the activity timeout
                activityController.resetTimeout();
              },
              // Pass TTFT options
              ttftTracker ? { serverId: server.id, model } : undefined
            );
          } finally {
            activityController.clearTimeout();
          }

          // Return streaming metrics and token metrics so orchestrator can record them
          const finalDuration = Date.now() - streamStartTime;
          return {
            _streamingMetrics: {
              ttft: firstTokenAt ? firstTokenAt - streamStartTime : undefined,
              streamingDuration: finalDuration,
            },
            _tokenMetrics: tokenMetrics ?? {
              tokensGenerated: 0,
              tokensPrompt: 0,
            },
          } as StreamingMetrics;
        }

        // Non-streaming request uses regular timeout
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            stream: false,
          }),
          timeout: 60000, // 1 min for regular
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await response.json()) as Record<string, unknown>;
      },
      useStreaming,
      'generate',
      'ollama',
      routingContext
    );

    // Add debug headers if requested (before streaming starts for streaming requests)
    addDebugHeaders(req, res, routingContext);

    // Only send JSON response if not streaming
    if (!useStreaming) {
      res.json(result);
    }
  } catch (error) {
    logger.error('Generate request failed:', { error, model });

    // Handle client disconnection gracefully
    if (res.writableEnded) {
      logger.info('Client disconnected during generate request');
      return;
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Generate request failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Handle /api/chat - Chat completion with failover and streaming support
 */
export async function handleChat(req: Request, res: Response): Promise<void> {
  const body = req.body as ChatRequestBody;
  const { model } = body;
  const messages = body.messages;

  logger.info(`Received chat request`, {
    model,
    messageCount: messages?.length,
    stream: isStreamingRequest(body),
    hasOptions: !!body.options,
  });

  if (!model) {
    res.status(400).json({ error: 'model is required' });
    return;
  }

  // Handle empty messages case for model load/unload
  const hasMessages = messages && Array.isArray(messages) && messages.length > 0;
  if (!hasMessages && (!body.keep_alive || body.keep_alive !== 0)) {
    res.status(400).json({
      error: 'messages array is required for chat (or use keep_alive to load/unload)',
    });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = isStreamingRequest(body);
  const config = getConfigManager().getConfig();
  const routingContext: RoutingContext = {};

  try {
    const result = await orchestrator.tryRequestWithFailover(
      model,
      async server => {
        // Use activity-based timeout for streaming to prevent cutoffs during active streams
        if (useStreaming) {
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...body,
                stream: true,
              }),
              connectionTimeout: 60000, // 1 minute to establish connection
              activityTimeout: config.streaming.activityTimeoutMs, // Reset on each chunk
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          const ttftTracker = new TTFTTracker({ serverId: server.id, model });
          const streamStartTime = Date.now();
          let firstTokenAt: number | undefined;
          let tokenMetrics: { tokensGenerated: number; tokensPrompt: number } | undefined;

          try {
            await streamResponse(
              response,
              res,
              () => {
                // First token callback
                firstTokenAt = Date.now();

                // Track with TTFTTracker
                ttftTracker.markFirstChunk(0);

                logger.debug(`First token received for chat model ${model}`, {
                  timeToFirstToken: firstTokenAt - streamStartTime,
                });
              },
              (duration, tokensGenerated, tokensPrompt) => {
                // Get TTFT metrics from tracker
                const ttftMetrics = ttftTracker.getMetrics();

                // Stream complete callback - capture token metrics
                logger.debug(`Chat stream completed for model ${model}`, {
                  duration,
                  tokensGenerated,
                  tokensPrompt,
                  timeToFirstToken:
                    ttftMetrics.ttft ?? (firstTokenAt ? firstTokenAt - streamStartTime : undefined),
                });
                tokenMetrics = { tokensGenerated, tokensPrompt };
              },
              () => {
                // On each chunk, reset the activity timeout
                activityController.resetTimeout();
              },
              // Pass TTFT options
              { serverId: server.id, model }
            );
          } finally {
            activityController.clearTimeout();
          }

          // Get final TTFT metrics
          const ttftMetrics = ttftTracker.getMetrics();

          // Return streaming metrics and token metrics so orchestrator can record them
          const finalDuration = Date.now() - streamStartTime;
          return {
            _streamingMetrics: {
              ttft: ttftMetrics.ttft ?? (firstTokenAt ? firstTokenAt - streamStartTime : undefined),
              streamingDuration: finalDuration,
            },
            _tokenMetrics: tokenMetrics ?? {
              tokensGenerated: 0,
              tokensPrompt: 0,
            },
          } as StreamingMetrics;
        }

        // Non-streaming request uses regular timeout
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            stream: false,
          }),
          timeout: 60000, // 1 min for regular
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await response.json()) as Record<string, unknown>;
      },
      useStreaming,
      'generate',
      'ollama',
      routingContext
    );

    // Add debug headers if requested
    addDebugHeaders(req, res, routingContext);

    // Only send JSON response if not streaming
    if (!useStreaming) {
      res.json(result);
    }
  } catch (error) {
    logger.error('Chat request failed:', { error, model });

    // Handle client disconnection gracefully
    if (res.writableEnded) {
      logger.info('Client disconnected during chat request');
      return;
    }

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Chat request failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Handle /api/embeddings - Generate embeddings with failover
 */
export async function handleEmbeddings(req: Request, res: Response): Promise<void> {
  const body = req.body as EmbeddingsRequestBody;
  const { model, prompt } = body;

  logger.info(`Received embeddings request`, {
    model,
    promptLength: prompt?.length,
  });

  if (!model || !prompt) {
    res.status(400).json({ error: 'model and prompt are required' });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const routingContext: RoutingContext = {};

  try {
    const result = await orchestrator.tryRequestWithFailover(
      model,
      async server => {
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.EMBEDDINGS}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, model, prompt }),
          timeout: 30000, // 30 second timeout for embeddings
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await response.json()) as Record<string, unknown>;
      },
      false,
      'embeddings',
      'ollama',
      routingContext
    );

    // Add debug headers if requested
    addDebugHeaders(req, res, routingContext);

    res.json(result);
  } catch (error) {
    logger.error('Embeddings request failed:', { error, model });
    res.status(500).json({
      error: 'Embeddings request failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle /api/ps - Get running models from all servers
 */
export async function handlePs(req: Request, res: Response): Promise<void> {
  const orchestrator = getOrchestratorInstance();
  const servers = orchestrator.getServers().filter(s => s.healthy && s.supportsOllama !== false);

  try {
    const allModels: Array<PsModelEntry & { server: string }> = [];

    const promises = servers.map(async server => {
      try {
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.PS}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000, // 10 second timeout for PS
        });

        if (!response.ok) {
          logger.warn(`Failed to get ps from ${server.id}: ${response.status}`);
          return;
        }

        const data = (await response.json()) as PsResponse;
        if (data.models && Array.isArray(data.models)) {
          // Add server info to each model entry
          for (const model of data.models) {
            allModels.push({
              ...model,
              server: server.id, // Add non-standard field for debugging
            });
          }
        }
      } catch (error) {
        logger.error(`Error getting ps from ${server.id}:`, error);
      }
    });

    await Promise.all(promises);

    // Return Ollama-compatible format
    res.json({ models: allModels });
  } catch (error) {
    logger.error('Error in handlePs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Handle /api/version - Get version info
 */
export function handleVersion(req: Request, res: Response): void {
  res.json({ version: '0.1.0-orchestrator' });
}

/**
 * Handle /api/show - Show model info by proxying to backend server
 */
export async function handleShow(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ShowRequestBody;
    const { model } = body;
    if (!model) {
      res.status(400).json({ error: 'model is required' });
      return;
    }

    const orchestrator = getOrchestratorInstance();

    // Find a server that has this model
    const server = orchestrator.getBestServerForModel(model);
    if (!server) {
      res.status(404).json({
        error: `model '${model}' not found on any healthy server`,
      });
      return;
    }

    // Forward the request to the selected server
    const response = await fetch(`${server.url}${API_ENDPOINTS.OLLAMA.SHOW}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await parseOllamaError(response);
      res.status(response.status).json({ error });
      return;
    }

    const data = (await response.json()) as Record<string, unknown>;
    res.json(data);
  } catch (error) {
    logger.error('Error in handleShow:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Handle /api/embed - Generate embeddings with batch support (current API)
 */
export async function handleEmbed(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as EmbedRequestBody;
    const { model, input } = body;
    if (!model) {
      res.status(400).json({ error: 'model is required' });
      return;
    }

    // Handle both single input and batch input
    const inputs = Array.isArray(input) ? input : [input ?? body.prompt];
    if (inputs.length === 0 || inputs.some(i => !i)) {
      res.status(400).json({ error: 'input or prompt is required' });
      return;
    }

    const orchestrator = getOrchestratorInstance();

    const server = orchestrator.getBestServerForModel(model);
    if (!server) {
      res.status(404).json({
        error: `model '${model}' not found on any healthy server`,
      });
      return;
    }

    // Transform to new API format if needed
    const embedBody: Record<string, unknown> = {
      model,
      input: inputs,
      truncate: body.truncate ?? true,
      options: body.options ?? {},
      keep_alive: body.keep_alive,
    };

    if (body.dimensions) {
      embedBody.dimensions = body.dimensions;
    }

    const response = await fetch(`${server.url}${API_ENDPOINTS.OLLAMA.EMBED}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(embedBody),
    });

    if (!response.ok) {
      const error = await parseOllamaError(response);
      res.status(response.status).json({ error });
      return;
    }

    const data = (await response.json()) as Record<string, unknown>;
    res.json(data);
  } catch (error) {
    logger.error('Error in handleEmbed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Handle unsupported multi-node endpoints with helpful error messages
 */
export function handleUnsupported(req: Request, res: Response): void {
  const path = req.path;
  let message: string;

  switch (path) {
    case '/api/pull':
      message =
        'This is a multi-node orchestrator. Use POST /api/orchestrator/servers/:id/models/pull to pull models to a specific server.';
      break;
    case '/api/delete':
      message =
        'This is a multi-node orchestrator. Use DELETE /api/orchestrator/servers/:id/models/:model to delete models from a specific server.';
      break;
    case '/api/copy':
      message =
        'This is a multi-node orchestrator. Use POST /api/orchestrator/servers/:id/models/copy to copy models on a specific server.';
      break;
    case '/api/create':
    case '/api/blobs':
    case '/api/push':
      message =
        'This is a multi-node orchestrator. Model creation, blob operations, and model push must be performed directly on individual Ollama servers.';
      break;
    default:
      message = 'This operation is not supported in multi-node orchestrator mode.';
  }

  res.status(400).json({ error: message });
}

/**
 * Handle streaming generate with retry logic
 * This is an enhanced version for internal use
 */
export async function handleStreamingGenerate(
  model: string,
  prompt: string,
  server: AIServer,
  res: Response,
  context?: number[],
  options?: Record<string, unknown>
): Promise<void> {
  const config = getConfigManager().getConfig();

  await handleStreamWithRetry(
    async () => {
      const { response, activityController } = await fetchWithActivityTimeout(
        `${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            stream: true,
            context,
            options,
          }),
          connectionTimeout: 60000, // 1 minute to establish connection
          activityTimeout: config.streaming.activityTimeoutMs,
        }
      );

      if (!response.ok) {
        activityController.clearTimeout();
        const errorMessage = await parseOllamaError(response);
        throw new Error(errorMessage);
      }

      if (!response.body) {
        activityController.clearTimeout();
        throw new Error('No response body for streaming');
      }

      let firstTokenReceived = false;
      const ttftTracker = new TTFTTracker({ serverId: server.id, model });

      try {
        await streamResponse(
          response,
          res,
          () => {
            if (!firstTokenReceived) {
              firstTokenReceived = true;

              // Track with TTFTTracker
              ttftTracker.markFirstChunk(0);

              logger.debug(`First token received from ${server.id}`);
            }
          },
          (duration, tokens) => {
            logger.debug(`Stream from ${server.id} completed`, { duration, tokens });
          },
          () => {
            // Reset activity timeout on each chunk
            activityController.resetTimeout();
          },
          // Pass TTFT options
          { serverId: server.id, model }
        );
      } finally {
        activityController.clearTimeout();
      }
    },
    3,
    (attempt, error) => {
      logger.warn(`Streaming attempt ${attempt} failed for ${server.id}:`, {
        error: error.message,
      });
    }
  );
}

/**
 * Handle /api/generate:$serverId - Route to specific server
 */
export async function handleGenerateToServer(req: Request, res: Response): Promise<void> {
  const body = req.body as GenerateRequestBody;
  const { model } = body;
  const prompt = body.prompt;
  const serverId = Array.isArray(req.params.serverId)
    ? req.params.serverId[0]
    : req.params.serverId;

  // Check for bypass circuit breaker flag
  const bypassCircuitBreaker = req.query.bypass === 'true' || req.query.force === 'true';

  logger.info(`Received generate request to specific server`, {
    serverId,
    model,
    promptLength: prompt?.length,
    bypassCircuitBreaker,
  });

  if (!model) {
    res.status(400).json({ error: 'model is required' });
    return;
  }
  if (!prompt && (!body.keep_alive || body.keep_alive !== 0)) {
    res.status(400).json({ error: 'prompt is required for generation' });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = isStreamingRequest(body);

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown> | null>(
      serverId,
      model,
      async server => {
        if (useStreaming) {
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...body, stream: true }),
              connectionTimeout: 60000,
              activityTimeout: getConfigManager().getConfig().streaming.activityTimeoutMs,
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          if (!response.body) {
            activityController.clearTimeout();
            throw new Error('No response body');
          }

          await streamResponse(response, res);
          return null;
        } else {
          // No timeout for per-server requests - let active tests determine appropriate timeouts
          const response = await fetch(`${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          // Handle NDJSON format - Ollama may return multiple JSON objects
          const responseText = await response.text();
          const lines = responseText
            .trim()
            .split('\n')
            .filter(line => line.trim());
          if (lines.length === 0) {
            throw new Error('Empty response from server');
          }
          const data: Record<string, unknown> = JSON.parse(lines[0]);
          return data;
        }
      },
      { isStreaming: useStreaming, bypassCircuitBreaker }
    );

    if (!useStreaming && result) {
      res.json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Generate to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    res.status(500).json({ error: errorMessage });
  }
}

/**
 * Handle /api/chat:$serverId - Route to specific server
 */
export async function handleChatToServer(req: Request, res: Response): Promise<void> {
  const body = req.body as ChatRequestBody;
  const { model } = body;
  const serverId = Array.isArray(req.params.serverId)
    ? req.params.serverId[0]
    : req.params.serverId;

  // Check for bypass circuit breaker flag
  const bypassCircuitBreaker = req.query.bypass === 'true' || req.query.force === 'true';

  logger.info(`Received chat request to specific server`, {
    serverId,
    model,
    bypassCircuitBreaker,
  });

  if (!model) {
    res.status(400).json({ error: 'model is required' });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = isStreamingRequest(body);

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown> | null>(
      serverId,
      model,
      async server => {
        if (useStreaming) {
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...body, stream: true }),
              connectionTimeout: 60000,
              activityTimeout: getConfigManager().getConfig().streaming.activityTimeoutMs,
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          if (!response.body) {
            activityController.clearTimeout();
            throw new Error('No response body');
          }

          await streamResponse(response, res);
          return null;
        } else {
          // No timeout for per-server requests - let active tests determine appropriate timeouts
          const response = await fetch(`${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          // Handle NDJSON format
          const responseText = await response.text();
          const lines = responseText
            .trim()
            .split('\n')
            .filter(line => line.trim());
          if (lines.length === 0) {
            throw new Error('Empty response from server');
          }
          const data = JSON.parse(lines[0]);
          return data;
        }
      },
      { isStreaming: useStreaming, bypassCircuitBreaker }
    );

    if (!useStreaming && result) {
      res.json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Chat to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    res.status(500).json({ error: errorMessage });
  }
}

/**
 * Handle /api/embeddings:$serverId - Route to specific server
 */
export async function handleEmbeddingsToServer(req: Request, res: Response): Promise<void> {
  const body = req.body as EmbeddingsRequestBody;
  const { model } = body;
  const serverId = Array.isArray(req.params.serverId)
    ? req.params.serverId[0]
    : req.params.serverId;

  // Check for bypass circuit breaker flag
  const bypassCircuitBreaker = req.query.bypass === 'true' || req.query.force === 'true';

  logger.info(`Received embeddings request to specific server`, {
    serverId,
    model,
    bypassCircuitBreaker,
  });

  if (!model) {
    res.status(400).json({ error: 'model is required' });
    return;
  }
  if (!body.prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  const orchestrator = getOrchestratorInstance();

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown> | null>(
      serverId,
      model,
      async server => {
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.EMBEDDINGS}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeout: 60000,
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        // Handle NDJSON format
        const responseText = await response.text();
        const lines = responseText
          .trim()
          .split('\n')
          .filter(line => line.trim());
        if (lines.length === 0) {
          throw new Error('Empty response from server');
        }
        const data: Record<string, unknown> = JSON.parse(lines[0]);
        return data;
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
    res.status(500).json({ error: errorMessage });
  }
}
