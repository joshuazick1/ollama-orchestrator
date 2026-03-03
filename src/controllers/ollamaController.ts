/**
 * ollamaController.ts
 * Ollama API proxy controllers with streaming support
 */

import type { Request, Response } from 'express';

import { getConfigManager } from '../config/config.js';
import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants/index.js';
import { TTFTTracker } from '../metrics/ttft-tracker.js';
import { getOrchestratorInstance, type RoutingContext } from '../orchestrator-instance.js';
import type { AIServer } from '../orchestrator.types.js';
import {
  streamResponse,
  isStreamingRequest,
  handleStreamWithRetry,
  type OllamaDurations,
} from '../streaming.js';
import { shouldBypassCircuitBreaker } from '../utils/circuit-breaker-helpers.js';
import { getDebugInfo, isDebugRequested, setDebugResponseHeaders } from '../utils/debug-headers.js';
import { fetchWithTimeout, fetchWithActivityTimeout } from '../utils/fetchWithTimeout.js';
import { getInFlightManager } from '../utils/in-flight-manager.js';
import { safeJsonParse, safeJsonStringify } from '../utils/json-utils.js';
import { logger } from '../utils/logger.js';
import { parseOllamaErrorGlobal as parseOllamaError } from '../utils/ollamaError.js';
import { performStreamHandoff } from '../utils/stream-handoff.js';
import { resolveRequestTimeout } from '../utils/timeout-manager.js';

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
  _chunkData?: {
    chunkCount: number;
    totalBytes: number;
    maxChunkGapMs: number;
    avgChunkSizeBytes: number;
  };
  _ollamaDurations?: OllamaDurations;
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
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
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
  const _config = getConfigManager().getConfig();
  const routingContext: RoutingContext = {};

  try {
    const result = await orchestrator.tryRequestWithFailover(
      model,
      async (server, context) => {
        // Use dynamic timeout for streaming (same as non-streaming requests)
        // This timeout adapts based on historical response times
        if (useStreaming) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          const requestId = context?.requestId;

          // Use dynamic timeout as stall threshold
          // Multiplier of 1.5x gives enough buffer for slow responses but detects true stalls
          // Minimum 10 seconds, max 60 seconds to keep detection timely
          const stallThreshold = Math.min(Math.max(timeoutMs * 1.5, 10000), 60000);
          const stallCheckInterval = Math.min(timeoutMs / 8, 3000);

          logger.info('STREAM_REQUEST_START', {
            requestId,
            serverId: server.id,
            model,
            endpoint: 'generate',
            protocol: 'ollama',
            timeoutMs,
            stallThresholdMs: stallThreshold,
            stallCheckIntervalMs: stallCheckInterval,
            promptLength: prompt?.length ?? 0,
          });

          logger.debug(
            `Using dynamic timeout for streaming: ${timeoutMs}ms for ${server.id}:${model}, stallThreshold: ${stallThreshold}ms`
          );
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: safeJsonStringify({
                ...body,
                stream: true,
              }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs, // Use same dynamic timeout for activity (between chunks)
              requestId: requestId,
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          const ttftTracker = new TTFTTracker({ serverId: server.id, model });
          const streamStartTime = Date.now();
          let tokenMetrics: { tokensGenerated: number; tokensPrompt: number } | undefined;
          let streamingChunkData:
            | {
                chunkCount?: number;
                totalBytes?: number;
                maxChunkGapMs?: number;
                avgChunkSizeBytes?: number;
              }
            | undefined;
          let capturedOllamaDurations: OllamaDurations | undefined;
          let ttftMetrics: ReturnType<typeof ttftTracker.getMetrics> | undefined;

          // Stall detection tracking variables (set by onStallCallback closure)
          let stallDetected = false;
          let stallStartTime: number | undefined;
          let handoffAttempted = false;
          let handoffSuccess = false;
          let handoffTargetServer: string | undefined;

          const streamingRequestId = context?.requestId;

          // Register streaming request with InFlightManager for stall detection and handoff.
          // Must be called before streamResponse so that when onStallCallback fires and
          // calls getStreamingRequestProgress() it finds a valid progress entry.
          if (streamingRequestId) {
            getInFlightManager().addStreamingRequest(
              streamingRequestId,
              server.id,
              model,
              'ollama',
              'generate'
            );
          }

          logger.debug('STREAM_RESPONSE_PARAMS', {
            requestId: streamingRequestId,
            serverId: server.id,
            model,
            hasOnStall: true,
          });

          const onStallCallback = async (
            _abortController: AbortController,
            passedRequestId?: string
          ) => {
            // Use only the authoritative streamingRequestId passed into the handler.
            // Do NOT fall back to the closure-captured streamingRequestId to avoid races.
            const requestId = passedRequestId;

            // Track stall detection for debug output
            stallDetected = true;
            stallStartTime = Date.now();

            logger.error('OLLAMA_ON_STALL_CALLED', {
              requestId,
              serverId: server.id,
              model,
              endpoint: 'generate',
              passedRequestId,
            });
            logger.warn('STREAM_STALL_DETECTED', {
              requestId,
              serverId: server.id,
              model,
              endpoint: 'generate',
              protocol: 'ollama',
              message: 'Stall detected - attempting seamless handoff',
            });

            logger.info('ON_STALL_DEBUG', {
              requestId,
              hasRequestId: !!requestId,
            });

            // Extra debug: log list of tracked request IDs to help diagnose missing progress
            try {
              const tracked = getInFlightManager().getAllStreamingRequests();
              logger.debug('ON_STALL_TRACKED_IDS', {
                authoritativeRequestId: requestId,
                trackedCount: tracked.length,
                trackedIds: tracked.slice(0, 20).map(r => r.id),
              });
            } catch (e) {
              logger.debug('ON_STALL_TRACKED_IDS_ERROR', {
                error: e instanceof Error ? e.message : String(e),
              });
            }

            // Try to get the streaming request progress from InFlightManager using authoritative id
            const progress = requestId
              ? getInFlightManager().getStreamingRequestProgress(requestId)
              : undefined;

            logger.info('ON_STALL_PROGRESS', {
              requestId,
              progressFound: !!progress,
              progressDetails: progress
                ? {
                    chunkCount: progress.chunkCount,
                    accumulatedTextLength: progress.accumulatedText.length,
                    lastChunkTime: progress.lastChunkTime,
                  }
                : undefined,
            });

            if (!progress) {
              logger.warn('No streaming progress found for handoff', {
                requestId,
              });
              return { success: false, error: 'No progress tracked' };
            }

            // Get a new server for failover (excluding current)
            const orchestrator = getOrchestratorInstance();
            const allServers = orchestrator.getServers();

            // Filter for healthy servers with the model, excluding current server
            // Also check that the circuit breaker is not open (allows requests)
            // REC-49: additionally require protocol compatibility
            const requestProtocol = progress.protocol;
            const newServer = allServers.find(
              s =>
                s.id !== server.id &&
                s.healthy &&
                s.models.includes(model) &&
                orchestrator.isCircuitAllowed(s.id) &&
                (requestProtocol === 'openai' ? s.supportsV1 !== false : s.supportsOllama !== false)
            );

            if (!newServer) {
              logger.warn(
                'No eligible servers for handoff - all circuits open or no servers with model',
                {
                  requestId,
                  currentServer: server.id,
                  model,
                  requestProtocol,
                  checkedServers: allServers
                    .filter(s => s.id !== server.id && s.models.includes(model))
                    .map(s => ({
                      id: s.id,
                      healthy: s.healthy,
                      circuitOpen: !orchestrator.isCircuitAllowed(s.id),
                      supportsOllama: s.supportsOllama,
                      supportsV1: s.supportsV1,
                    })),
                }
              );
              return { success: false, error: 'No alternative servers with closed circuit' };
            }

            logger.info('Attempting seamless handoff to new server', {
              requestId,
              fromServer: server.id,
              toServer: newServer.id,
              accumulatedTextLength: progress.accumulatedText.length,
            });

            // Track handoff attempt for debug output
            handoffAttempted = true;
            handoffTargetServer = newServer.id;

            // Perform the handoff - this will stream directly to clientResponse
            try {
              logger.debug('PERFORM_HANDOFF_INVOKE', { requestId, toServer: newServer.id });
              const result = await performStreamHandoff({
                originalRequest: progress,
                newServer,
                clientResponse: res,
                originalRequestBody: body as Record<string, unknown>,
              });
              logger.debug('PERFORM_HANDOFF_RESULT', { requestId, result });

              handoffSuccess = result.success;
              return { success: result.success, error: result.error };
            } catch (handoffError) {
              logger.error('Handoff failed with exception', {
                requestId,
                error: handoffError instanceof Error ? handoffError.message : String(handoffError),
              });
              handoffSuccess = false;
              return { success: false, error: 'Handoff failed' };
            }
          };

          try {
            // Pass authoritative streamingRequestId into onStall so handlers can
            // look up progress reliably and avoid races with server._streamingRequestId
            await streamResponse(
              response,
              res,
              () => {
                // First token callback
                // Track with TTFTTracker
                ttftTracker.markFirstChunk(0);

                logger.info('STREAM_FIRST_CHUNK', {
                  requestId: streamingRequestId,
                  serverId: server.id,
                  model,
                  timeToFirstToken: ttftTracker.getCurrentElapsed(),
                });
              },
              (duration, tokensGenerated, tokensPrompt, chunkData, ollamaDurations) => {
                // Get TTFT metrics from tracker
                ttftMetrics = ttftTracker.getMetrics();

                // Stream complete callback - capture token metrics
                logger.info('STREAM_COMPLETE', {
                  requestId: streamingRequestId,
                  serverId: server.id,
                  model,
                  duration,
                  tokensGenerated,
                  tokensPrompt,
                  chunkCount: chunkData?.chunkCount ?? 0,
                  ttft: ttftMetrics?.ttft,
                  maxChunkGapMs: chunkData?.maxChunkGapMs,
                });
                tokenMetrics = { tokensGenerated, tokensPrompt };
                // Store chunk data for return value
                streamingChunkData = chunkData;
                // Store Ollama duration fields
                capturedOllamaDurations = ollamaDurations;
              },
              chunkCount => {
                logger.debug('STREAM_CHUNK', {
                  requestId: streamingRequestId,
                  serverId: server.id,
                  model,
                  chunkCount,
                });

                // Update InFlightManager with current chunk count for real-time tracking
                if (streamingRequestId) {
                  getInFlightManager().updateChunkProgress(streamingRequestId, chunkCount);
                }
              },
              // Pass TTFT options
              ttftTracker ? { serverId: server.id, model } : undefined,
              // Pass streaming request ID for InFlightManager tracking
              streamingRequestId,
              // Pass the TTFTTracker instance so streaming.ts uses the same tracker
              ttftTracker,
              // Stall detection callback
              onStallCallback,
              // Stall threshold from config
              stallThreshold,
              // Stall check interval from config
              stallCheckInterval,
              // Cleanup callback - remove streaming request from InFlightManager when stream ends
              () => {
                if (streamingRequestId) {
                  getInFlightManager().removeStreamingRequest(streamingRequestId);
                }
              },
              // Pass activityController for timeout-based abort (pre-first-chunk detection)
              activityController
            );

            const includeDebug = isDebugRequested(req);
            if (includeDebug && !res.writableEnded) {
              const streamDuration = Date.now() - streamStartTime;
              const debugInfo = getDebugInfo(routingContext, {
                requestId: streamingRequestId,
                requestTimestamp: streamStartTime,
                timeToFirstToken: ttftMetrics?.ttft,
                streamingDuration: streamDuration,
                tokensGenerated: tokenMetrics?.tokensGenerated,
                tokensPrompt: tokenMetrics?.tokensPrompt,
                chunkData: streamingChunkData
                  ? {
                      chunkCount: streamingChunkData.chunkCount,
                      totalBytes: streamingChunkData.totalBytes,
                      maxChunkGapMs: streamingChunkData.maxChunkGapMs,
                      avgChunkSizeBytes: streamingChunkData.avgChunkSizeBytes,
                    }
                  : undefined,
                stallDetected,
                stallDurationMs: stallStartTime ? Date.now() - stallStartTime : undefined,
                handoffAttempted,
                handoffSuccess,
                handoffTargetServer,
              });
              if (debugInfo) {
                setDebugResponseHeaders(res, debugInfo);
                res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
              }
            }
          } finally {
            activityController.clearTimeout();
          }

          // Return streaming metrics and token metrics so orchestrator can record them
          const finalDuration = Date.now() - streamStartTime;
          return {
            _streamingMetrics: {
              ttft: ttftMetrics?.ttft,
              streamingDuration: finalDuration,
            },
            _tokenMetrics: tokenMetrics ?? {
              tokensGenerated: 0,
              tokensPrompt: 0,
            },
            _chunkData: streamingChunkData,
            _ollamaDurations: capturedOllamaDurations,
          } as StreamingMetrics;
        }

        // Non-streaming request uses dynamic timeout from orchestrator
        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: safeJsonStringify({
            ...body,
            stream: false,
          }),
          timeout: timeoutMs,
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

    // Only send JSON response if not streaming
    if (!useStreaming) {
      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (debugInfo && typeof result === 'object' && result !== null) {
          (result as Record<string, unknown>).debug = debugInfo;
          setDebugResponseHeaders(res, debugInfo);
        }
      }
      res.json(result);
    }
  } catch (error) {
    logger.error('Generate request failed:', { error, model });

    if (res.writableEnded) {
      logger.info('Client disconnected during generate request');
      return;
    }

    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isNoServersError =
        errorMessage.includes('No') && errorMessage.includes('servers available');

      // Include routing context in error responses when debug is requested
      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;

      if (isNoServersError) {
        res.status(503).json({
          error: 'No available servers for model',
          model,
          message: errorMessage,
          ...(debugPayload && { debug: debugPayload }),
        });
      } else {
        res.status(500).json({
          error: 'Generate request failed',
          details: errorMessage,
          ...(debugPayload && { debug: debugPayload }),
        });
      }
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
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
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
  const _config = getConfigManager().getConfig();
  const routingContext: RoutingContext = {};

  try {
    const result = await orchestrator.tryRequestWithFailover(
      model,
      async (server, context) => {
        // Use dynamic timeout for streaming (same as non-streaming requests)
        if (useStreaming) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          const requestId = context?.requestId;
          // Use dynamic timeout as stall threshold
          // Multiplier of 1.5x gives enough buffer for slow responses but detects true stalls
          // Minimum 10 seconds, max 60 seconds to keep detection timely
          const stallThreshold = Math.min(Math.max(timeoutMs * 1.5, 10000), 60000);
          const stallCheckInterval = Math.min(timeoutMs / 8, 3000);

          logger.info('STREAM_REQUEST_START', {
            requestId,
            serverId: server.id,
            model,
            endpoint: 'chat',
            protocol: 'ollama',
            timeoutMs,
            stallThresholdMs: stallThreshold,
            stallCheckIntervalMs: stallCheckInterval,
            messageCount: messages?.length ?? 0,
          });

          logger.debug(
            `Using dynamic timeout for streaming: ${timeoutMs}ms for ${server.id}:${model}, stallThreshold: ${stallThreshold}ms`
          );

          // Register streaming request with InFlightManager for stall detection and handoff
          getInFlightManager().addStreamingRequest(
            requestId ?? 'unknown',
            server.id,
            model,
            'ollama',
            'chat'
          );

          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: safeJsonStringify({
                ...body,
                stream: true,
              }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs, // Use same dynamic timeout for activity
              requestId,
            }
          );

          if (!response.ok) {
            activityController.clearTimeout();
            const errorMessage = await parseOllamaError(response);
            throw new Error(errorMessage);
          }

          const ttftTracker = new TTFTTracker({ serverId: server.id, model });
          const streamStartTime = Date.now();
          let tokenMetrics: { tokensGenerated: number; tokensPrompt: number } | undefined;
          let streamingChunkData:
            | {
                chunkCount?: number;
                totalBytes?: number;
                maxChunkGapMs?: number;
                avgChunkSizeBytes?: number;
              }
            | undefined;
          let capturedOllamaDurations: OllamaDurations | undefined;
          let ttftMetrics: ReturnType<typeof ttftTracker.getMetrics> | undefined;

          // Stall detection tracking variables (set by onStallCallback closure)
          let chatStallDetected = false;
          let chatStallStartTime: number | undefined;
          let chatHandoffAttempted = false;
          let chatHandoffSuccess = false;
          let chatHandoffTargetServer: string | undefined;

          const onStallCallback = async (
            _abortController: AbortController,
            passedRequestId?: string
          ) => {
            // Use only the authoritative streamingRequestId passed into the handler.
            // Do NOT fall back to the closure-captured requestId to avoid races.
            const effectiveRequestId = passedRequestId;

            // Track stall detection for debug output
            chatStallDetected = true;
            chatStallStartTime = Date.now();

            logger.warn('STREAM_STALL_DETECTED', {
              requestId: effectiveRequestId,
              serverId: server.id,
              model,
              endpoint: 'chat',
              protocol: 'ollama',
              message: 'Stall detected - attempting seamless handoff',
            });

            // Try to get the streaming request progress from InFlightManager using authoritative id
            const progress = effectiveRequestId
              ? getInFlightManager().getStreamingRequestProgress(effectiveRequestId)
              : undefined;

            if (!progress) {
              logger.warn('No streaming progress found for handoff', {
                requestId: effectiveRequestId,
              });
              return { success: false, error: 'No progress tracked' };
            }

            // Get a new server for failover (excluding current)
            const orchestrator = getOrchestratorInstance();
            const allServers = orchestrator.getServers();

            // Filter for healthy servers with the model, excluding current server
            // Also check that the circuit breaker is not open (allows requests)
            // REC-49: additionally require protocol compatibility
            const requestProtocol2 = progress.protocol;
            const newServer = allServers.find(
              s =>
                s.id !== server.id &&
                s.healthy &&
                s.models.includes(model) &&
                orchestrator.isCircuitAllowed(s.id) &&
                (requestProtocol2 === 'openai'
                  ? s.supportsV1 !== false
                  : s.supportsOllama !== false)
            );

            if (!newServer) {
              logger.warn(
                'No eligible servers for handoff - all circuits open or no servers with model',
                {
                  requestId: effectiveRequestId,
                  currentServer: server.id,
                  model,
                  requestProtocol: requestProtocol2,
                  checkedServers: allServers
                    .filter(s => s.id !== server.id && s.models.includes(model))
                    .map(s => ({
                      id: s.id,
                      healthy: s.healthy,
                      circuitOpen: !orchestrator.isCircuitAllowed(s.id),
                      supportsOllama: s.supportsOllama,
                      supportsV1: s.supportsV1,
                    })),
                }
              );
              return { success: false, error: 'No alternative servers with closed circuit' };
            }

            logger.info('Attempting seamless handoff to new server', {
              requestId: effectiveRequestId,
              fromServer: server.id,
              toServer: newServer.id,
              accumulatedTextLength: progress.accumulatedText.length,
            });

            // Track handoff attempt for debug output
            chatHandoffAttempted = true;
            chatHandoffTargetServer = newServer.id;

            // Perform the handoff - this will stream directly to clientResponse
            try {
              logger.debug('PERFORM_HANDOFF_INVOKE', {
                requestId: effectiveRequestId,
                toServer: newServer.id,
              });
              const result = await performStreamHandoff({
                originalRequest: progress,
                newServer,
                clientResponse: res,
                originalRequestBody: body as Record<string, unknown>,
              });
              logger.debug('PERFORM_HANDOFF_RESULT', { requestId: effectiveRequestId, result });

              chatHandoffSuccess = result.success;
              return { success: result.success, error: result.error };
            } catch (handoffError) {
              logger.error('Handoff failed with exception', {
                requestId: effectiveRequestId,
                error: handoffError instanceof Error ? handoffError.message : String(handoffError),
              });
              chatHandoffSuccess = false;
              return { success: false, error: 'Handoff failed' };
            }
          };

          try {
            await streamResponse(
              response,
              res,
              () => {
                // First token callback
                // Track with TTFTTracker
                ttftTracker.markFirstChunk(0);

                logger.info('STREAM_FIRST_CHUNK', {
                  requestId,
                  serverId: server.id,
                  model,
                  timeToFirstToken: ttftTracker.getCurrentElapsed(),
                });
              },
              (duration, tokensGenerated, tokensPrompt, _chunkData, ollamaDurations) => {
                // Get TTFT metrics from tracker
                ttftMetrics = ttftTracker.getMetrics();

                // Stream complete callback - capture token metrics
                logger.info('STREAM_COMPLETE', {
                  requestId,
                  serverId: server.id,
                  model,
                  endpoint: 'chat',
                  duration,
                  tokensGenerated,
                  tokensPrompt,
                  chunkCount: _chunkData?.chunkCount ?? 0,
                  ttft: ttftMetrics?.ttft,
                  maxChunkGapMs: _chunkData?.maxChunkGapMs,
                });
                tokenMetrics = { tokensGenerated, tokensPrompt };
                capturedOllamaDurations = ollamaDurations;
              },
              chunkCount => {
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
              // Pass TTFT options
              { serverId: server.id, model },
              // Pass streaming request ID for InFlightManager tracking
              requestId,
              // Pass the TTFTTracker instance so streaming.ts uses the same tracker
              ttftTracker,
              // Stall detection callback
              onStallCallback,
              // Stall threshold from config
              stallThreshold,
              // Stall check interval from config
              stallCheckInterval,
              // Cleanup callback - remove streaming request from InFlightManager when stream ends
              () => {
                if (requestId) {
                  getInFlightManager().removeStreamingRequest(requestId);
                }
              },
              // Pass activityController so streaming.ts can race reader.read() against the
              // abort signal, enabling pre-first-chunk stall detection for /api/chat.
              activityController
            );

            const includeDebug = isDebugRequested(req);
            if (includeDebug && !res.writableEnded) {
              const streamDuration = Date.now() - streamStartTime;
              const debugInfo = getDebugInfo(routingContext, {
                requestId: requestId,
                requestTimestamp: streamStartTime,
                timeToFirstToken: ttftMetrics?.ttft,
                streamingDuration: streamDuration,
                tokensGenerated: tokenMetrics?.tokensGenerated,
                tokensPrompt: tokenMetrics?.tokensPrompt,
                chunkData: streamingChunkData
                  ? {
                      chunkCount: streamingChunkData.chunkCount,
                      totalBytes: streamingChunkData.totalBytes,
                      maxChunkGapMs: streamingChunkData.maxChunkGapMs,
                      avgChunkSizeBytes: streamingChunkData.avgChunkSizeBytes,
                    }
                  : undefined,
                stallDetected: chatStallDetected,
                stallDurationMs: chatStallStartTime ? Date.now() - chatStallStartTime : undefined,
                handoffAttempted: chatHandoffAttempted,
                handoffSuccess: chatHandoffSuccess,
                handoffTargetServer: chatHandoffTargetServer,
              });
              if (debugInfo) {
                setDebugResponseHeaders(res, debugInfo);
                res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
              }
            }
          } finally {
            activityController.clearTimeout();
          }

          // Return streaming metrics and token metrics so orchestrator can record them
          const finalDuration = Date.now() - streamStartTime;
          return {
            _streamingMetrics: {
              ttft: ttftMetrics?.ttft,
              streamingDuration: finalDuration,
            },
            _tokenMetrics: tokenMetrics ?? {
              tokensGenerated: 0,
              tokensPrompt: 0,
            },
            _chunkData: streamingChunkData,
            _ollamaDurations: capturedOllamaDurations,
          } as StreamingMetrics;
        }

        // Non-streaming request uses dynamic timeout from orchestrator
        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: safeJsonStringify({
            ...body,
            stream: false,
          }),
          timeout: timeoutMs,
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

    // Only send JSON response if not streaming
    if (!useStreaming) {
      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (debugInfo && typeof result === 'object' && result !== null) {
          (result as Record<string, unknown>).debug = debugInfo;
          setDebugResponseHeaders(res, debugInfo);
        }
      }
      res.json(result);
    }
  } catch (error) {
    logger.error('Chat request failed:', { error, model });

    if (res.writableEnded) {
      logger.info('Client disconnected during chat request');
      return;
    }

    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isNoServersError =
        errorMessage.includes('No') && errorMessage.includes('servers available');

      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;

      if (isNoServersError) {
        res.status(503).json({
          error: 'No available servers for model',
          model,
          message: errorMessage,
          ...(debugPayload && { debug: debugPayload }),
        });
      } else {
        res.status(500).json({
          error: 'Chat request failed',
          details: errorMessage,
          ...(debugPayload && { debug: debugPayload }),
        });
      }
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
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_AND_PROMPT_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const routingContext: RoutingContext = {};

  try {
    const result = await orchestrator.tryRequestWithFailover(
      model,
      async (server, _context) => {
        const timeout = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.EMBEDDINGS}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: safeJsonStringify({ ...body, model, prompt }),
          timeout,
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
    logger.error('Embeddings request failed:', { error, model });

    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNoServersError =
      errorMessage.includes('No') && errorMessage.includes('servers available');

    const debugPayload = isDebugRequested(req)
      ? getDebugInfo(routingContext, { lastError: errorMessage })
      : undefined;

    if (isNoServersError) {
      res.status(503).json({
        error: 'No available servers for model',
        model,
        message: errorMessage,
        ...(debugPayload && { debug: debugPayload }),
      });
    } else {
      res.status(500).json({
        error: 'Embeddings request failed',
        details: errorMessage,
        ...(debugPayload && { debug: debugPayload }),
      });
    }
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
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
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
      res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
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
      body: safeJsonStringify(body),
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
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
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
      res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
      return;
    }

    // Handle both single input and batch input
    const inputs = Array.isArray(input) ? input : [input ?? body.prompt];
    if (inputs.length === 0 || inputs.some(i => !i)) {
      res.status(400).json({ error: ERROR_MESSAGES.INPUT_OR_PROMPT_REQUIRED });
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
      body: safeJsonStringify(embedBody),
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
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
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
  const _config = getConfigManager().getConfig();
  const orchestrator = getOrchestratorInstance();

  await handleStreamWithRetry(
    async () => {
      const timeoutMs = orchestrator.getTimeout(server.id, model);
      logger.debug(`Using dynamic timeout for streaming: ${timeoutMs}ms for ${server.id}:${model}`);
      const { response, activityController } = await fetchWithActivityTimeout(
        `${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: safeJsonStringify({
            model,
            prompt,
            stream: true,
            context,
            options,
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

      if (!response.body) {
        activityController.clearTimeout();
        throw new Error('No response body for streaming');
      }

      let firstTokenReceived = false;
      const ttftTracker = new TTFTTracker({ serverId: server.id, model });

      // Generate requestId for streaming tracking
      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
          (duration, _tokensGenerated, _tokensPrompt, _chunkData) => {
            logger.debug(`Stream from ${server.id} completed`, {
              duration,
              tokens: _tokensGenerated,
              chunks: _chunkData?.chunkCount ?? 0,
            });
          },
          chunkCount => {
            logger.debug('GENERATE CHUNK CALLBACK FIRED', {
              chunkCount,
              serverId: server.id,
              requestId,
            });

            // Update InFlightManager with current chunk count for real-time tracking
            logger.info('GEN_CHUNK_RECEIVED', {
              requestId,
              chunkCount,
              serverId: server.id,
              model,
            });
            if (requestId) {
              getInFlightManager().updateChunkProgress(requestId, chunkCount);
            }
          },
          // Pass TTFT options
          { serverId: server.id, model },
          // Pass streaming request ID for InFlightManager tracking
          requestId,
          // Pass the TTFTTracker instance so streaming.ts uses the same tracker
          ttftTracker
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
  const bypassCircuitBreaker = shouldBypassCircuitBreaker(req);

  logger.info(`Received generate request to specific server`, {
    serverId,
    model,
    promptLength: prompt?.length,
    bypassCircuitBreaker,
  });

  if (!model) {
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
    return;
  }
  if (!prompt && (!body.keep_alive || body.keep_alive !== 0)) {
    res.status(400).json({ error: ERROR_MESSAGES.PROMPT_REQUIRED_FOR_GENERATION });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = isStreamingRequest(body);
  const routingContext: RoutingContext = { algorithm: 'direct', protocol: 'ollama' };

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown> | null>(
      serverId,
      model,
      async (server, context) => {
        if (useStreaming) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: safeJsonStringify({ ...body, stream: true }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
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

          const streamingRequestId = context?.requestId;

          // Register streaming request with InFlightManager for tracking
          if (streamingRequestId) {
            getInFlightManager().addStreamingRequest(
              streamingRequestId,
              server.id,
              model,
              'ollama',
              'generate'
            );
          }

          await streamResponse(
            response,
            res,
            undefined,
            (duration, tokensGenerated, tokensPrompt, chunkData) => {
              // Stream complete callback
              logger.info('STREAM_COMPLETE', {
                requestId: streamingRequestId,
                serverId: server.id,
                model,
                endpoint: 'generate-to-server',
                duration,
                tokensGenerated,
                tokensPrompt,
                chunkCount: chunkData?.chunkCount ?? 0,
              });
            },
            chunkCount => {
              // Update InFlightManager with current chunk count
              if (streamingRequestId) {
                getInFlightManager().updateChunkProgress(streamingRequestId, chunkCount);
              }
            },
            undefined,
            streamingRequestId,
            undefined,
            undefined,
            undefined,
            undefined,
            () => {
              // Cleanup callback - remove from InFlightManager and clear activity timeout
              if (streamingRequestId) {
                getInFlightManager().removeStreamingRequest(streamingRequestId);
              }
              activityController.clearTimeout();
            },
            activityController
          );

          // Emit debug info for streaming per-server requests
          const includeDebug = isDebugRequested(req);
          if (includeDebug && !res.writableEnded) {
            const debugInfo = getDebugInfo(routingContext, {
              requestId: streamingRequestId,
            });
            if (debugInfo) {
              setDebugResponseHeaders(res, debugInfo);
              res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
            }
          }

          return null;
        } else {
          // No timeout for per-server requests - let active tests determine appropriate timeouts
          const response = await fetch(`${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: safeJsonStringify(body),
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
          const data: Record<string, unknown> = safeJsonParse(lines[0]);
          return data;
        }
      },
      { isStreaming: useStreaming, bypassCircuitBreaker, routingContext }
    );

    if (!useStreaming && result) {
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
    logger.error(`Generate to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    const debugPayload = isDebugRequested(req)
      ? getDebugInfo(routingContext, { lastError: errorMessage })
      : undefined;
    res.status(500).json({
      error: errorMessage,
      ...(debugPayload && { debug: debugPayload }),
    });
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
  const bypassCircuitBreaker = shouldBypassCircuitBreaker(req);

  logger.info(`Received chat request to specific server`, {
    serverId,
    model,
    bypassCircuitBreaker,
  });

  if (!model) {
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const useStreaming = isStreamingRequest(body);
  const routingContext: RoutingContext = { algorithm: 'direct', protocol: 'ollama' };

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown> | null>(
      serverId,
      model,
      async (server, context) => {
        if (useStreaming) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: safeJsonStringify({ ...body, stream: true }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
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

          const streamingRequestId = context?.requestId;

          // Register streaming request with InFlightManager for tracking
          if (streamingRequestId) {
            getInFlightManager().addStreamingRequest(
              streamingRequestId,
              server.id,
              model,
              'ollama',
              'chat'
            );
          }

          await streamResponse(
            response,
            res,
            undefined,
            (duration, tokensGenerated, tokensPrompt, chunkData) => {
              // Stream complete callback
              logger.info('STREAM_COMPLETE', {
                requestId: streamingRequestId,
                serverId: server.id,
                model,
                endpoint: 'chat-to-server',
                duration,
                tokensGenerated,
                tokensPrompt,
                chunkCount: chunkData?.chunkCount ?? 0,
              });
            },
            chunkCount => {
              // Update InFlightManager with current chunk count
              if (streamingRequestId) {
                getInFlightManager().updateChunkProgress(streamingRequestId, chunkCount);
              }
            },
            undefined,
            streamingRequestId,
            undefined,
            undefined,
            undefined,
            undefined,
            () => {
              // Cleanup callback - remove from InFlightManager and clear activity timeout
              if (streamingRequestId) {
                getInFlightManager().removeStreamingRequest(streamingRequestId);
              }
              activityController.clearTimeout();
            },
            activityController
          );

          // Emit debug info for streaming per-server requests
          const includeDebug = isDebugRequested(req);
          if (includeDebug && !res.writableEnded) {
            const debugInfo = getDebugInfo(routingContext, {
              requestId: streamingRequestId,
            });
            if (debugInfo) {
              setDebugResponseHeaders(res, debugInfo);
              res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
            }
          }

          return null;
        } else {
          // No timeout for per-server requests - let active tests determine appropriate timeouts
          const response = await fetch(`${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: safeJsonStringify(body),
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
          const data = safeJsonParse(lines[0]);
          return data;
        }
      },
      { isStreaming: useStreaming, bypassCircuitBreaker, routingContext }
    );

    if (!useStreaming && result) {
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
    logger.error(`Chat to server ${serverId} failed:`, {
      error: errorMessage,
      bypassCircuitBreaker,
    });
    const debugPayload = isDebugRequested(req)
      ? getDebugInfo(routingContext, { lastError: errorMessage })
      : undefined;
    res.status(500).json({
      error: errorMessage,
      ...(debugPayload && { debug: debugPayload }),
    });
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
  const bypassCircuitBreaker = shouldBypassCircuitBreaker(req);

  logger.info(`Received embeddings request to specific server`, {
    serverId,
    model,
    bypassCircuitBreaker,
  });

  if (!model) {
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
    return;
  }
  if (!body.prompt) {
    res.status(400).json({ error: ERROR_MESSAGES.PROMPT_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const routingContext: RoutingContext = { algorithm: 'direct', protocol: 'ollama' };

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown> | null>(
      serverId,
      model,
      async (server, _context) => {
        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.EMBEDDINGS}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: safeJsonStringify(body),
          timeout: timeoutMs, // Use dynamic timeout
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
        const data: Record<string, unknown> = safeJsonParse(lines[0]);
        return data;
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
      error: errorMessage,
      ...(debugPayload && { debug: debugPayload }),
    });
  }
}
