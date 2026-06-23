/**
 * ollamaController.ts
 * Ollama API proxy controllers with streaming support
 */

import type { Request, Response } from 'express';

import { getConfigManager } from '../config/config.js';
import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants/index.js';
import { TTFTTracker } from '../metrics/ttft-tracker.js';
import { isInternalAdmin } from '../middleware/auth.js';
import {
  getOrchestratorInstance,
  type RoutingContext,
} from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import {
  streamResponse,
  isStreamingRequest,
  handleStreamWithRetry,
  type OllamaDurations,
} from '../streaming.js';
import type {
  GenerateRequestBody,
  ChatRequestBody,
  EmbeddingsRequestBody,
  ShowRequestBody,
  EmbedRequestBody,
  PsModelEntry,
  PsResponse,
  OllamaStreamingMetrics,
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
import { performStreamHandoff } from '../utils/stream-handoff.js';
import { setupStreamingClientDisconnectCleanup } from '../utils/streaming-cleanup.js';
import {
  computeStallThresholds,
  createStreamingStallHandler,
} from '../utils/streaming-response-handler.js';
import { resolveRequestTimeout } from '../utils/timeout-manager.js';
import { APP_VERSION } from '../utils/version.js';

/**
 * Get headers for Ollama backend requests including optional auth
 */
function getOllamaHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  server: AIServer
): Record<string, string> {
  return forwardRequestHeaders(clientHeaders, 'ollama' as ProviderType, server);
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
    // Extract user info for access control scoping
    const userId = req.user?.id;
    const isAdmin = isInternalAdmin(req);
    const requestId = req.requestId;

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
              headers: getOllamaHeaders(req.headers, server),
              body:
                toBodyInit(req.rawBody) ??
                safeJsonStringify({
                  ...body,
                  stream: true,
                }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
              requestId: requestId,
              telemetryMeta: {
                serverId: server.id,
                model,
                protocol: 'ollama',
                endpoint: 'generate',
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

          const ttftTracker = new TTFTTracker({ serverId: server.id, model });
          const streamStartTime = Date.now();
          let tokenMetrics: { tokensGenerated: number; tokensPrompt: number } | undefined;
          let streamingChunkData:
            | {
                chunkCount?: number;
                totalBytes?: number;
                maxChunkGapMs?: number;
                avgChunkSizeBytes?: number;
                chunkGaps?: number[];
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
              'generate',
              prompt // pass original prompt so handoff can use it verbatim
            );
          }

          logger.debug('STREAM_RESPONSE_PARAMS', {
            requestId: streamingRequestId,
            serverId: server.id,
            model,
            hasOnStall: true,
          });

          const { onStall: sharedOnStall } = createStreamingStallHandler({
            server,
            requestId: streamingRequestId ?? '',
            model,
            protocol: 'ollama',
            endpoint: 'generate',
            clientResponse: res,
            originalRequestBody: body as Record<string, unknown>,
            stallThreshold,
            stallCheckInterval,
          });

          const onStallCallback = async (
            _abortController: AbortController,
            passedRequestId?: string
          ) => {
            stallDetected = true;
            stallStartTime = Date.now();

            logger.error('OLLAMA_ON_STALL_CALLED', {
              requestId: passedRequestId,
              serverId: server.id,
              model,
              endpoint: 'generate',
              passedRequestId,
            });

            const result = await sharedOnStall(_abortController, passedRequestId);

            handoffAttempted = true;
            handoffSuccess = result.success;
            if (!handoffSuccess) {
              logger.warn('Handoff did not succeed', {
                requestId: passedRequestId,
                error: result.error,
              });
            }

            return result;
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
              activityController,
              // preEnd: write debug chunk before stream ends
              isDebugRequested(req) && !res.writableEnded
                ? () => {
                    const chunkGapPercentiles = streamingChunkData?.chunkGaps?.length
                      ? computeChunkGapPercentiles(streamingChunkData.chunkGaps)
                      : undefined;
                    const debugInfo = getDebugInfo(routingContext, {
                      requestId: streamingRequestId,
                      requestTimestamp: streamStartTime,
                      timeToFirstToken: ttftMetrics?.ttft,
                      streamingDuration: Date.now() - streamStartTime,
                      tokensGenerated: tokenMetrics?.tokensGenerated,
                      tokensPrompt: tokenMetrics?.tokensPrompt,
                      chunkData: streamingChunkData
                        ? {
                            chunkCount: streamingChunkData.chunkCount,
                            totalBytes: streamingChunkData.totalBytes,
                            maxChunkGapMs: streamingChunkData.maxChunkGapMs,
                            avgChunkSizeBytes: streamingChunkData.avgChunkSizeBytes,
                            chunkGapPercentiles,
                          }
                        : undefined,
                      stallDetected,
                      stallDurationMs: stallStartTime ? Date.now() - stallStartTime : undefined,
                      handoffAttempted,
                      handoffSuccess,
                      handoffTargetServer,
                    });
                    if (debugInfo) {
                      res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
                    }
                  }
                : undefined,
              {
                serverId: server.id,
                model,
                protocol: 'ollama',
                endpoint: 'generate',
              }
            );
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
          } as OllamaStreamingMetrics;
        }

        // Non-streaming request uses dynamic timeout from orchestrator
        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`, {
          method: 'POST',
          headers: getOllamaHeaders(req.headers, server),
          body:
            toBodyInit(req.rawBody) ??
            safeJsonStringify({
              ...body,
              stream: false,
            }),
          timeout: timeoutMs,
          telemetryMeta: {
            serverId: server.id,
            model,
            protocol: 'ollama',
            endpoint: 'generate',
            isStreaming: false,
          },
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await parseResponse<Record<string, unknown>>(response))!;
      },
      useStreaming,
      'generate',
      'ollama',
      routingContext,
      undefined,
      estimatePromptTokens(prompt || ''),
      userId,
      isAdmin,
      requestId
    );

    // Only send JSON response if not streaming
    if (!useStreaming) {
      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (
          debugInfo &&
          typeof result === 'object' &&
          result !== null &&
          !('_streamingMetrics' in result)
        ) {
          const debugResult = result as { debug?: unknown };
          debugResult.debug = debugInfo;
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
      const { isNoServersError, isConcurrencySaturated, isAccessDenied, isModelNotFound } =
        classifyOrchestratorRoutingError(errorMessage);

      // Include routing context in error responses when debug is requested
      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;

      if (isModelNotFound) {
        res.status(404).json({
          error: errorMessage,
          model,
          ...(debugPayload && { debug: debugPayload }),
        });
      } else if (isAccessDenied) {
        res.status(403).json({
          error: errorMessage,
          model,
          ...(debugPayload && { debug: debugPayload }),
        });
      } else if (isNoServersError || isConcurrencySaturated) {
        res.status(503).json({
          error: isConcurrencySaturated
            ? 'All servers at max concurrency'
            : 'No available servers for model',
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
    // Extract user info for access control scoping
    const userId = req.user?.id;
    const isAdmin = isInternalAdmin(req);
    const requestId = req.requestId;

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
            'chat',
            undefined, // no single prompt for chat
            messages // original messages for handoff reconstruction
          );

          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`,
            {
              method: 'POST',
              headers: getOllamaHeaders(req.headers, server),
              body:
                toBodyInit(req.rawBody) ??
                safeJsonStringify({
                  ...body,
                  stream: true,
                }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
              requestId,
              telemetryMeta: {
                serverId: server.id,
                model,
                protocol: 'ollama',
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

          const ttftTracker = new TTFTTracker({ serverId: server.id, model });
          const streamStartTime = Date.now();
          let tokenMetrics: { tokensGenerated: number; tokensPrompt: number } | undefined;
          let streamingChunkData:
            | {
                chunkCount?: number;
                totalBytes?: number;
                maxChunkGapMs?: number;
                avgChunkSizeBytes?: number;
                chunkGaps?: number[];
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
                stallThresholdMs: stallThreshold,
                stallCheckIntervalMs: stallCheckInterval,
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
              activityController,
              // preEnd: write debug chunk before stream ends
              isDebugRequested(req) && !res.writableEnded
                ? () => {
                    const chunkGapPercentiles = streamingChunkData?.chunkGaps?.length
                      ? computeChunkGapPercentiles(streamingChunkData.chunkGaps)
                      : undefined;
                    const debugInfo = getDebugInfo(routingContext, {
                      requestId,
                      requestTimestamp: streamStartTime,
                      timeToFirstToken: ttftMetrics?.ttft,
                      streamingDuration: Date.now() - streamStartTime,
                      tokensGenerated: tokenMetrics?.tokensGenerated,
                      tokensPrompt: tokenMetrics?.tokensPrompt,
                      chunkData: streamingChunkData
                        ? {
                            chunkCount: streamingChunkData.chunkCount,
                            totalBytes: streamingChunkData.totalBytes,
                            maxChunkGapMs: streamingChunkData.maxChunkGapMs,
                            avgChunkSizeBytes: streamingChunkData.avgChunkSizeBytes,
                            chunkGapPercentiles,
                          }
                        : undefined,
                      stallDetected: chatStallDetected,
                      stallDurationMs: chatStallStartTime
                        ? Date.now() - chatStallStartTime
                        : undefined,
                      handoffAttempted: chatHandoffAttempted,
                      handoffSuccess: chatHandoffSuccess,
                      handoffTargetServer: chatHandoffTargetServer,
                    });
                    if (debugInfo) {
                      res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
                    }
                  }
                : undefined,
              {
                serverId: server.id,
                model,
                protocol: 'ollama',
                endpoint: 'chat',
              }
            );
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
          } as OllamaStreamingMetrics;
        }

        // Non-streaming request uses dynamic timeout from orchestrator
        const timeoutMs = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`, {
          method: 'POST',
          headers: getOllamaHeaders(req.headers, server),
          body:
            toBodyInit(req.rawBody) ??
            safeJsonStringify({
              ...body,
              stream: false,
            }),
          timeout: timeoutMs,
          telemetryMeta: {
            serverId: server.id,
            model,
            protocol: 'ollama',
            endpoint: 'chat',
            isStreaming: false,
          },
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await parseResponse<Record<string, unknown>>(response))!;
      },
      useStreaming,
      'generate',
      'ollama',
      routingContext,
      undefined,
      estimateChatTokens((messages || []) as Array<{ role?: string; content?: string }>),
      userId,
      isAdmin,
      requestId
    );

    // Only send JSON response if not streaming
    if (!useStreaming) {
      const includeDebug = isDebugRequested(req);
      if (includeDebug) {
        const debugInfo = getDebugInfo(routingContext);
        if (
          debugInfo &&
          typeof result === 'object' &&
          result !== null &&
          !('_streamingMetrics' in result)
        ) {
          const debugResult = result as { debug?: unknown };
          debugResult.debug = debugInfo;
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
      const { isNoServersError, isConcurrencySaturated, isAccessDenied, isModelNotFound } =
        classifyOrchestratorRoutingError(errorMessage);

      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;

      if (isModelNotFound) {
        res.status(404).json({
          error: errorMessage,
          model,
          ...(debugPayload && { debug: debugPayload }),
        });
      } else if (isAccessDenied) {
        res.status(403).json({
          error: errorMessage,
          model,
          ...(debugPayload && { debug: debugPayload }),
        });
      } else if (isNoServersError || isConcurrencySaturated) {
        res.status(503).json({
          error: isConcurrencySaturated
            ? 'All servers at max concurrency'
            : 'No available servers for model',
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
    // Extract user info for access control scoping
    const userId = req.user?.id;
    const isAdmin = isInternalAdmin(req);

    const result = await orchestrator.tryRequestWithFailover(
      model,
      async (server, _context) => {
        const timeout = resolveRequestTimeout(
          req.headers,
          orchestrator.getTimeout(server.id, model)
        );
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.EMBEDDINGS}`, {
          method: 'POST',
          headers: getOllamaHeaders(req.headers, server),
          body: safeJsonStringify({ ...body, model, prompt }),
          timeout,
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await parseResponse<Record<string, unknown>>(response))!;
      },
      false,
      'embeddings',
      'ollama',
      routingContext,
      undefined,
      estimatePromptTokens(prompt || ''),
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
    logger.error('Embeddings request failed:', { error, model });

    const errorMessage = error instanceof Error ? error.message : String(error);
    const { isNoServersError, isConcurrencySaturated, isAccessDenied, isModelNotFound } =
      classifyOrchestratorRoutingError(errorMessage);

    const debugPayload = isDebugRequested(req)
      ? getDebugInfo(routingContext, { lastError: errorMessage })
      : undefined;

    if (isModelNotFound) {
      res.status(404).json({
        error: errorMessage,
        model,
        ...(debugPayload && { debug: debugPayload }),
      });
    } else if (isAccessDenied) {
      res.status(403).json({
        error: errorMessage,
        model,
        ...(debugPayload && { debug: debugPayload }),
      });
    } else if (isNoServersError || isConcurrencySaturated) {
      res.status(503).json({
        error: isConcurrencySaturated
          ? 'All servers at max concurrency'
          : 'No available servers for model',
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
    const promises = servers.map(async server => {
      try {
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.PS}`, {
          method: 'GET',
          headers: getOllamaHeaders(req.headers, server),
          timeout: 10000, // 10 second timeout for PS
        });

        if (!response.ok) {
          logger.warn(`Failed to get ps from ${server.id}: ${response.status}`);
          return [];
        }

        const data = (await parseResponse<PsResponse>(response))!;
        if (data.models && Array.isArray(data.models)) {
          // Add server info to each model entry
          return data.models.map(model => ({
            ...model,
            server: server.id,
          }));
        }
        return [];
      } catch (error) {
        logger.error(`Error getting ps from ${server.id}:`, error);
        return [];
      }
    });

    const results = await Promise.all(promises);
    const allModels: Array<PsModelEntry & { server: string }> = results.flat();

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
  res.json({ version: APP_VERSION });
}

/**
 * Handle /api/show - Show model info by proxying to backend server
 */
export async function handleShow(req: Request, res: Response): Promise<void> {
  const body = req.body as ShowRequestBody;
  const { model } = body;
  if (!model) {
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
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
        const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.SHOW}`, {
          method: 'POST',
          headers: getOllamaHeaders(req.headers, server),
          body: safeJsonStringify(body),
          timeout,
        });

        if (!response.ok) {
          const errorMessage = await parseOllamaError(response);
          throw new Error(errorMessage);
        }

        return (await parseResponse<Record<string, unknown>>(response))!;
      },
      false,
      'generate',
      'ollama',
      routingContext
    );

    const includeDebug = isDebugRequested(req);
    if (includeDebug) {
      const debugInfo = getDebugInfo(routingContext);
      if (debugInfo && typeof result === 'object' && result !== null) {
        result.debug = debugInfo;
        setDebugResponseHeaders(res, debugInfo);
      }
    }

    res.json(result);

    // Extract and store context length if available
    if (routingContext.selectedServerId && typeof result === 'object' && result !== null) {
      const resultObj = result;
      const details = resultObj.details as Record<string, unknown> | undefined;
      if (details && typeof details.context_length === 'number') {
        orchestrator.setModelContextLimit(
          routingContext.selectedServerId,
          model,
          details.context_length
        );
      }
    }
  } catch (error) {
    logger.error('Show request failed:', { error, model });

    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { isNoServersError, isConcurrencySaturated } =
        classifyOrchestratorRoutingError(errorMessage);

      const debugPayload = isDebugRequested(req)
        ? getDebugInfo(routingContext, { lastError: errorMessage })
        : undefined;

      if (isNoServersError || isConcurrencySaturated) {
        res.status(503).json({
          error: isConcurrencySaturated
            ? 'All servers at max concurrency'
            : 'No available servers for model',
          model,
          message: errorMessage,
          ...(debugPayload && { debug: debugPayload }),
        });
      } else if (errorMessage.includes('not found')) {
        // Treat model-not-found as 404
        res.status(404).json({ error: errorMessage, ...(debugPayload && { debug: debugPayload }) });
      } else {
        res.status(500).json({
          error: 'Show request failed',
          details: errorMessage,
          ...(debugPayload && { debug: debugPayload }),
        });
      }
    }
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

    // Extract user info for access control scoping
    const userId = req.user?.id;
    const isAdmin = isInternalAdmin(req);

    const server = orchestrator.getBestServerForModel(
      model,
      false,
      undefined,
      userId,
      isAdmin,
      req.requestId
    );
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

    const timeoutMs = resolveRequestTimeout(req.headers, orchestrator.getTimeout(server.id, model));
    const response = await fetchWithTimeout(`${server.url}${API_ENDPOINTS.OLLAMA.EMBED}`, {
      method: 'POST',
      headers: getOllamaHeaders(req.headers, server),
      body: safeJsonStringify(embedBody),
      timeout: timeoutMs,
      telemetryMeta: {
        serverId: server.id,
        model,
        protocol: 'ollama',
        endpoint: 'embed',
        isStreaming: false,
      },
    });

    if (!response.ok) {
      const error = await parseOllamaError(response);
      res.status(response.status).json({ error });
      return;
    }

    const data = (await parseResponse<Record<string, unknown>>(response))!;
    if (data === null) {
      res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
      return;
    }
    res.json(data);
  } catch (error) {
    logger.error('Error in handleEmbed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const { isAccessDenied } = classifyOrchestratorRoutingError(errorMessage);
    if (isAccessDenied) {
      res.status(403).json({ error: errorMessage });
    } else {
      res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
    }
  }
}

/**
 * Handle unsupported multi-node endpoints with helpful error messages
 */
export function handleUnsupported(req: Request, res: Response): void {
  const path = req.path;
  let message: string;

  switch (path) {
    case API_ENDPOINTS.OLLAMA.PULL:
      message =
        'This is a multi-node orchestrator. Use POST /api/orchestrator/servers/:id/models/pull to pull models to a specific server.';
      break;
    case API_ENDPOINTS.OLLAMA.DELETE:
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
  req: Request,
  model: string,
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
          headers: getOllamaHeaders({}, server),
          body: safeJsonStringify({
            model,
            prompt,
            stream: true,
            context,
            options,
          }),
          connectionTimeout: timeoutMs,
          activityTimeout: timeoutMs,
          telemetryMeta: {
            serverId: server.id,
            model,
            protocol: 'ollama',
            endpoint: 'generate',
            isStreaming: true,
          },
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
          ttftTracker,
          undefined, // onStall
          undefined, // stallThresholdMs
          undefined, // stallCheckIntervalMs
          undefined, // onStreamEnd
          undefined, // activityController
          undefined, // preEnd
          {
            serverId: server.id,
            model,
            protocol: 'ollama',
            endpoint: 'generate',
          }
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
    const result = await orchestrator.requestToServer<Record<string, unknown> | null>(
      serverId,
      model,
      async (server, context) => {
        if (useStreaming) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          activeStreamState.serverId = server.id;
          activeStreamState.model = model;
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`,
            {
              method: 'POST',
              headers: getOllamaHeaders(req.headers, server),
              body: toBodyInit(req.rawBody) ?? safeJsonStringify({ ...body, stream: true }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
              telemetryMeta: {
                serverId: server.id,
                model,
                protocol: 'ollama',
                endpoint: 'generate',
                isStreaming: true,
              },
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
          activeStreamState.streamingRequestId = streamingRequestId;
          activeStreamState.activityController = activityController;

          // Register streaming request with InFlightManager for tracking
          if (streamingRequestId) {
            getInFlightManager().addStreamingRequest(
              streamingRequestId,
              server.id,
              model,
              'ollama',
              'generate',
              prompt // pass original prompt so handoff can use it verbatim
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
              // Cleanup callback - remove from InFlightManager only; clearTimeout moved to preEnd
              if (streamingRequestId) {
                getInFlightManager().removeStreamingRequest(streamingRequestId);
              }
            },
            activityController,
            // preEnd: clear activity timeout and write debug chunk before stream ends
            () => {
              activityController.clearTimeout();
              if (isDebugRequested(req) && !res.writableEnded) {
                const debugInfo = getDebugInfo(routingContext, {
                  requestId: streamingRequestId,
                });
                if (debugInfo) {
                  res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
                }
              }
            },
            {
              serverId: server.id,
              model,
              protocol: 'ollama',
              endpoint: 'generate',
            }
          );

          return null;
        } else {
          // No timeout for per-server requests - let active tests determine appropriate timeouts
          const response = await fetch(`${server.url}${API_ENDPOINTS.OLLAMA.GENERATE}`, {
            method: 'POST',
            headers: getOllamaHeaders(req.headers, server),
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
          const data: Record<string, unknown> = safeJsonParse(lines[0]) ?? {};
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
          result.debug = debugInfo;
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
  const { model, messages } = body;
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
    const result = await orchestrator.requestToServer<Record<string, unknown> | null>(
      serverId,
      model,
      async (server, context) => {
        if (useStreaming) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );
          activeStreamState.serverId = server.id;
          activeStreamState.model = model;
          const { response, activityController } = await fetchWithActivityTimeout(
            `${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`,
            {
              method: 'POST',
              headers: getOllamaHeaders(req.headers, server),
              body: toBodyInit(req.rawBody) ?? safeJsonStringify({ ...body, stream: true }),
              connectionTimeout: timeoutMs,
              activityTimeout: timeoutMs,
              telemetryMeta: {
                serverId: server.id,
                model,
                protocol: 'ollama',
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

          if (!response.body) {
            activityController.clearTimeout();
            throw new Error('No response body');
          }

          const streamingRequestId = context?.requestId;
          activeStreamState.streamingRequestId = streamingRequestId;

          // Register streaming request with InFlightManager for tracking
          if (streamingRequestId) {
            getInFlightManager().addStreamingRequest(
              streamingRequestId,
              server.id,
              model,
              'ollama',
              'chat',
              undefined, // no single prompt for chat
              messages // original messages for handoff reconstruction
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
              // Cleanup callback - remove from InFlightManager only; clearTimeout moved to preEnd
              if (streamingRequestId) {
                getInFlightManager().removeStreamingRequest(streamingRequestId);
              }
            },
            activityController,
            // preEnd: clear activity timeout and write debug chunk before stream ends
            () => {
              activityController.clearTimeout();
              if (isDebugRequested(req) && !res.writableEnded) {
                const debugInfo = getDebugInfo(routingContext, {
                  requestId: streamingRequestId,
                });
                if (debugInfo) {
                  res.write(`data: ${JSON.stringify({ debug: debugInfo })}\n\n`);
                }
              }
            },
            {
              serverId: server.id,
              model,
              protocol: 'ollama',
              endpoint: 'chat',
            }
          );

          return null;
        } else {
          // No timeout for per-server requests - let active tests determine appropriate timeouts
          const response = await fetch(`${server.url}${API_ENDPOINTS.OLLAMA.CHAT}`, {
            method: 'POST',
            headers: getOllamaHeaders(req.headers, server),
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
          const data: Record<string, unknown> | null = safeJsonParse(lines[0]) ?? null;
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
          result.debug = debugInfo;
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
          headers: getOllamaHeaders(req.headers, server),
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
        const data: Record<string, unknown> = safeJsonParse(lines[0]) ?? {};
        return data;
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
      error: errorMessage,
      ...(debugPayload && { debug: debugPayload }),
    });
  }
}

function computeChunkGapPercentiles(gaps: number[]): { p50: number; p95: number; p99: number } {
  const sorted = [...gaps].sort((a, b) => a - b);
  const p = (n: number) =>
    sorted[Math.max(0, Math.min(sorted.length - 1, Math.round((n / 100) * sorted.length - 1)))];
  return { p50: p(50), p95: p(95), p99: p(99) };
}
