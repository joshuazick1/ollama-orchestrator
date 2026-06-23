import type { Request, Response } from 'express';

import { API_ENDPOINTS, ANTHROPIC_SERVER_CAPABILITIES } from '../constants/index.js';
import { getConfigManager } from '../config/config.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import {
  AnthropicMessagesRequestSchema,
  AnthropicToolSchema,
  AnthropicToolChoiceSchema,
  AnthropicSystemPrompt,
} from '../types/anthropic.types.js';
import type { StreamingTelemetryMeta } from '../streaming.js';
import { forwardRequestHeaders, type ProviderType } from '../utils/header-forwarder.js';
import { resolveApiKey } from '../utils/api-keys.js';
import { estimatePromptTokens } from '../utils/prompt-estimator.js';
import {
  fetchWithTimeout,
  fetchWithActivityTimeout,
  parseResponse,
} from '../utils/fetch-with-timeout.js';
import { logger } from '../utils/logger.js';
import { classifyOrchestratorRoutingError } from '../utils/orchestrator-error-classifier.js';
import { setupStreamingClientDisconnectCleanup } from '../utils/streaming-cleanup.js';
import { resolveRequestTimeout } from '../utils/timeout-manager.js';
import { forwardStreamingResponseHeaders } from '../utils/response-header-forwarder.js';
import { toBodyInit } from '../utils/json-utils.js';

const UPSTREAM_REQUEST_TIMEOUT_MS = 5000;

const VALID_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * Validate a single image content block.
 * Returns an error message if invalid, undefined if valid.
 */
function validateImageBlock(
  block: {
    type?: string;
    source?: { type?: string; media_type?: string; data?: string; url?: string };
  },
  maxImageBytes: number
): { valid: false; error: string; param?: string } | { valid: true } {
  if (block.type !== 'image') {
    return { valid: true };
  }

  const source = block.source;
  if (!source) {
    return { valid: false, error: 'image block missing source', param: 'source' };
  }

  if (source.type !== 'base64' && source.type !== 'url') {
    return {
      valid: false,
      error: `image source type must be 'base64' or 'url', got '${source.type}'`,
      param: 'source.type',
    };
  }

  const mediaType = source.media_type;
  if (!mediaType || !VALID_MEDIA_TYPES.has(mediaType)) {
    return {
      valid: false,
      error: `image media_type must be one of: ${[...VALID_MEDIA_TYPES].join(', ')}, got '${mediaType ?? 'undefined'}'`,
      param: 'source.media_type',
    };
  }

  if (source.type === 'base64') {
    if (!source.data || source.data.trim() === '') {
      return { valid: false, error: 'base64 image data is empty', param: 'source.data' };
    }
    // Estimate base64 decoded size (base64 is ~4/3 of original)
    const estimatedBytes = (source.data.length * 3) / 4;
    if (estimatedBytes > maxImageBytes) {
      return {
        valid: false,
        error: `image size ${Math.round(estimatedBytes)} bytes exceeds maximum ${maxImageBytes} bytes`,
        param: 'source.data',
      };
    }
  }

  if (source.type === 'url') {
    if (!source.url || source.url.trim() === '') {
      return { valid: false, error: 'url image source URL is empty', param: 'source.url' };
    }
    try {
      new URL(source.url);
    } catch {
      return { valid: false, error: `invalid URL: ${source.url}`, param: 'source.url' };
    }
  }

  return { valid: true };
}

/**
 * Validate all image content blocks in a request body.
 * Returns validation error with Anthropic error format if invalid.
 */
function validateImageBlocks(
  body: Record<string, unknown>,
  maxImageBytes: number
):
  | {
      valid: false;
      error: { type: string; error: { type: string; message: string; param?: string } };
    }
  | { valid: true; imageCount: number; imageBytes: number } {
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return { valid: true, imageCount: 0, imageBytes: 0 };
  }

  let imageCount = 0;
  let totalImageBytes = 0;

  for (const message of messages) {
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const block of content) {
      if ((block as { type?: string }).type !== 'image') {
        continue;
      }

      const imageBlock = block as {
        type: string;
        source: { type?: string; media_type?: string; data?: string; url?: string };
      };
      const validation = validateImageBlock(imageBlock, maxImageBytes);
      if (!validation.valid) {
        return {
          valid: false,
          error: {
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: validation.error,
              param: validation.param,
            },
          },
        };
      }

      imageCount++;
      if (imageBlock.source.type === 'base64' && imageBlock.source.data) {
        totalImageBytes += (imageBlock.source.data.length * 3) / 4;
      }
    }
  }

  return { valid: true, imageCount, imageBytes: Math.round(totalImageBytes) };
}

/**
 * Validate anthropic-beta header format.
 * Each token must be [a-zA-Z0-9-]+ separated by commas.
 * Returns true if valid, false otherwise.
 */
function isValidAnthropicBetaHeader(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const tokens = value.split(',');
  return tokens.every(token => /^[a-zA-Z0-9-]+$/.test(token.trim()));
}

/**
 * Validate anthropic-version header format.
 * Must be in YYYY-MM-DD format (e.g., '2023-06-01').
 * Returns true if valid, false otherwise.
 */
function isValidAnthropicVersion(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Map Anthropic stop_reason to OpenAI-compatible finish_reason.
 * Anthropic stop_reason values:
 *   - end_turn     → 'stop'       (normal completion)
 *   - max_tokens   → 'length'     (hit token limit)
 *   - stop_sequence → 'stop'      (stop sequence generated)
 *   - tool_use     → 'tool_calls' (model invoked a tool)
 */
function mapAnthropicStopReasonToOpenAI(stopReason: string | undefined | null): string | undefined {
  if (!stopReason) {
    return undefined;
  }
  switch (stopReason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    default:
      // Unknown stop_reason - return as-is for forward compatibility
      return stopReason;
  }
}

/**
 * Build auth headers for upstream Anthropic API requests.
 * For self-hosted servers (LiteLLM, vLLM), uses the server's configured auth.
 * For Anthropic SaaS, prefers x-api-key header.
 */
function buildModelsUpstreamHeaders(server: AIServer): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Check for custom anthropic auth config first
  const customAuth = server.endpointOverrides?.anthropic_auth;
  if (customAuth) {
    const resolvedKey = resolveApiKey(server.apiKey);
    if (resolvedKey) {
      const headerName = customAuth.headerName ?? 'Authorization';
      const prefix = customAuth.headerPrefix ?? 'Bearer';
      headers[headerName] = prefix ? `${prefix} ${resolvedKey}` : resolvedKey;
    }
    return headers;
  }

  // Default: use x-api-key for Anthropic SaaS convention
  const resolvedKey = resolveApiKey(server.apiKey);
  if (resolvedKey) {
    // Prefer x-api-key for Anthropic-compatible servers
    headers['x-api-key'] = resolvedKey;
  }

  return headers;
}

/**
 * Estimate tokens in a system prompt.
 * Anthropic uses a top-level `system` field (not a message with role=system).
 * System can be a plain string or an array of text blocks.
 */
function estimateSystemPromptTokens(system: AnthropicSystemPrompt | undefined): number {
  if (!system) {
    return 0;
  }
  if (typeof system === 'string') {
    return estimatePromptTokens(system);
  }
  // Array of text blocks - sum tokens from each block's text
  let total = 0;
  for (const block of system) {
    if (block.type === 'text' && block.text) {
      total += estimatePromptTokens(block.text);
    }
  }
  return total;
}

/**
 * Anthropic models list response shape
 */
interface AnthropicModel {
  id: string;
  type: 'model';
  display_name?: string;
  created_at?: number;
}

interface AnthropicModelsResponse {
  object: 'list';
  data: AnthropicModel[];
}
import { shouldBypassCircuitBreaker } from '../utils/circuit-breaker-helpers.js';

function buildUpstreamHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  server: AIServer,
  anthropicVersion: string,
  anthropicBeta?: string
): Record<string, string> {
  const headers = forwardRequestHeaders(clientHeaders, 'anthropic' as ProviderType, server);
  headers['anthropic-version'] = anthropicVersion;
  if (anthropicBeta) {
    headers['anthropic-beta'] = anthropicBeta;
  }
  return headers;
}

async function passthroughAnthropicSSE(
  upstreamResponse: globalThis.Response,
  clientResponse: Response,
  serverId: string,
  model: string,
  _streamingTelemetryMeta?: StreamingTelemetryMeta,
  abortSignal?: AbortSignal,
  onToolUse?: (toolName: string) => void,
  onUpstreamRequestId?: (upstreamRequestId: string | undefined) => void
): Promise<void> {
  const startTime = Date.now();

  clientResponse.status(upstreamResponse.status);

  const upstreamContentType = upstreamResponse.headers.get('content-type');
  if (upstreamContentType) {
    clientResponse.setHeader('Content-Type', upstreamContentType);
  }

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

  const upstreamRequestId = forwardStreamingResponseHeaders(upstreamResponse, clientResponse);
  onUpstreamRequestId?.(upstreamRequestId);

  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    throw new Error('No response body to stream');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (onToolUse && line.startsWith('event: content_block_start')) {
          continue;
        }
        if (onToolUse && line.startsWith('data: ')) {
          try {
            const dataStr = line.slice(6).trim();
            if (dataStr) {
              const parsed = JSON.parse(dataStr);
              if (
                parsed.type === 'content_block_start' &&
                parsed.content_block?.type === 'tool_use' &&
                parsed.content_block?.name
              ) {
                onToolUse(parsed.content_block.name);
              }
            }
          } catch {
            // Not JSON, ignore parse errors
          }
        }
        const writeResult = clientResponse.write(`${line}\n`);
        if (!writeResult) {
          await new Promise<void>(resolve => {
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
      }

      if (clientResponse.writableEnded) {
        logger.info('Client disconnected from Anthropic SSE stream', { serverId, model });
        try {
          void reader.cancel();
        } catch {
          // ignore cancel errors
        }
        break;
      }
    }

    if (buffer.trim()) {
      const writeResult = clientResponse.write(`${buffer}\n`);
      if (!writeResult) {
        await new Promise<void>(resolve => {
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
    }

    clientResponse.end();

    logger.info('Anthropic SSE passthrough complete', {
      serverId,
      model,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('Anthropic SSE passthrough error', { error, serverId, model });

    if (!clientResponse.headersSent) {
      clientResponse.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'Streaming failed',
        },
      });
    } else {
      clientResponse.end();
    }
  }
}

export async function handleMessages(req: Request, res: Response): Promise<void> {
  const clientVersion = req.headers['anthropic-version'];
  const orchestratorConfig = getConfigManager().getConfig();
  const defaultVersion = orchestratorConfig.anthropic?.defaultVersion ?? '2023-06-01';

  // Validate format if provided, use default if absent
  let anthropicVersion: string;
  if (clientVersion !== undefined) {
    if (typeof clientVersion !== 'string' || !isValidAnthropicVersion(clientVersion)) {
      res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'anthropic-version header format is invalid; expected YYYY-MM-DD (e.g., 2023-06-01)',
        },
      });
      return;
    }
    // Forward client's exact value verbatim
    anthropicVersion = clientVersion;
  } else {
    // Use default version from config
    anthropicVersion = defaultVersion;
  }

  const anthropicBetaHeader = req.headers['anthropic-beta'];
  let anthropicBeta: string | undefined;
  if (anthropicBetaHeader) {
    if (
      typeof anthropicBetaHeader !== 'string' ||
      !isValidAnthropicBetaHeader(anthropicBetaHeader)
    ) {
      res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'anthropic-beta header format is invalid; expected comma-separated alphanumeric+hyphen tokens',
        },
      });
      return;
    }
    anthropicBeta = anthropicBetaHeader;
  }

  const rawBody = req.body as Record<string, unknown>;

  const parseResult = AnthropicMessagesRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: firstIssue?.message ?? 'Invalid request body',
        param: firstIssue?.path?.join('.'),
      },
    });
    return;
  }

  const body = parseResult.data;
  const { model, stream = false } = body;

  logger.info('Received Anthropic messages request', { model, stream });

  const orchestrator = getOrchestratorInstance();

  // Detect tool_result blocks in request messages and record metrics
  if (body.messages) {
    for (const message of body.messages) {
      const content = message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            orchestrator.getMetricsAggregator().recordToolResult();
          }
        }
      }
    }
  }

  const config = getConfigManager().getConfig();
  const imageValidation = validateImageBlocks(rawBody, config.anthropic.maxImageBytes);
  if (!imageValidation.valid) {
    res.status(400).json(imageValidation.error);
    return;
  }

  if (config.anthropic.lifecycleMode === 'saas-only') {
    res.status(404).json({
      type: 'error',
      error: {
        type: 'not_found_error',
        message: 'Lifecycle endpoints are not available in saas-only mode',
      },
    });
    return;
  }

  const { imageCount, imageBytes } = imageValidation;

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
    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer, _context?: { requestId?: string }) => {
        if (!server.supportsAnthropic) {
          throw new Error(`Server ${server.id} does not support Anthropic API`);
        }

        const config = getConfigManager().getConfig();
        const lifecycleCheck = checkLifecycleModeAllowed(server, config.anthropic.lifecycleMode);
        if (!lifecycleCheck.allowed) {
          throw new Error(
            `Server ${server.id} cannot handle lifecycle request: ${lifecycleCheck.message}`
          );
        }

        const headers = buildUpstreamHeaders(req.headers, server, anthropicVersion, anthropicBeta);
        const anthropicPath =
          server.endpointOverrides?.anthropic_messages ?? API_ENDPOINTS.ANTHROPIC.MESSAGES;
        const upstreamUrl = `${server.url}${anthropicPath}`;

        if (stream) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );

          activeStreamState.serverId = server.id;
          activeStreamState.model = model;

          const { response, activityController } = await fetchWithActivityTimeout(upstreamUrl, {
            method: 'POST',
            headers,
            body: toBodyInit(req.rawBody) ?? JSON.stringify({ ...rawBody, stream: true }),
            connectionTimeout: timeoutMs,
            activityTimeout: timeoutMs,
            telemetryMeta: {
              serverId: server.id,
              model,
              protocol: 'anthropic',
              endpoint: 'messages',
              isStreaming: true,
            },
          });

          if (!response.ok) {
            activityController.clearTimeout();
            const errorText = await response.text();
            throw new Error(errorText || `Upstream returned ${String(response.status)}`);
          }

          activeStreamState.activityController = activityController;

          try {
            await passthroughAnthropicSSE(
              response,
              res,
              server.id,
              model,
              {
                serverId: server.id,
                model,
                protocol: 'anthropic',
                endpoint: 'messages',
              },
              activityController.controller.signal,
              (toolName: string) => {
                orchestrator.getMetricsAggregator().recordToolUse(toolName);
              },
              (upstreamRequestId?: string) => {
                logger.info('request_forwarded', {
                  orchestratorRequestId: req.requestId,
                  upstreamRequestId,
                  provider: 'anthropic',
                  serverId: server.id,
                });
              }
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

        const thinkingEnabled = 'thinking' in rawBody && rawBody.thinking !== undefined;
        const requestBody = { ...rawBody };

        let response = await fetchWithTimeout(upstreamUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          timeout: timeoutMs,
          telemetryMeta: {
            serverId: server.id,
            model,
            protocol: 'anthropic',
            endpoint: 'messages',
            isStreaming: false,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorObj: { error?: { param?: string; message?: string } } = {};
          try {
            errorObj = JSON.parse(errorText);
          } catch {
            // Not JSON, use as-is
          }
          const isThinkingError =
            response.status === 400 &&
            errorObj.error?.param === 'thinking' &&
            config.anthropic.thinkingAutoDisable;

          if (isThinkingError && thinkingEnabled) {
            logger.warn('auto-disabled thinking due to upstream rejection', {
              action: 'auto_disable_thinking',
              serverId: server.id,
              model,
              upstreamStatus: 400,
            });
            delete requestBody.thinking;
            response = await fetchWithTimeout(upstreamUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
              timeout: timeoutMs,
              telemetryMeta: {
                serverId: server.id,
                model,
                protocol: 'anthropic',
                endpoint: 'messages',
                isStreaming: false,
              },
            });
            if (response.ok) {
              const result = (await parseResponse<Record<string, unknown>>(response))!;
              result._thinkingAutoDisabled = true;
              return result;
            }
            const retryErrorText = await response.text();
            throw new Error(retryErrorText || `Upstream returned ${String(response.status)}`);
          }
          throw new Error(errorText || `Upstream returned ${String(response.status)}`);
        }

        return (await parseResponse<Record<string, unknown>>(response))!;
      },
      stream,
      'generate',
      'openai',
      undefined,
      undefined,
      undefined
    );

    if (!stream && result && !result._streamed) {
      // Record system prompt tokens (Anthropic uses top-level system field, not role=system message)
      const systemPromptTokens = estimateSystemPromptTokens(body.system);
      if (systemPromptTokens > 0) {
        orchestrator.getMetricsAggregator().recordSystemPromptTokens(systemPromptTokens);
      }
      // Record Anthropic cache metrics if enabled
      if (config.anthropic.cacheMetrics.enabled) {
        const usage = result.usage as
          | { cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
          | undefined;
        if (usage) {
          const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
          const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
          orchestrator
            .getMetricsAggregator()
            .recordCacheMetrics(
              cacheReadTokens,
              cacheCreationTokens,
              config.anthropic.cacheMetrics.savingsRatePerToken
            );
        }
      }
      // Record thinking auto-disable metric
      if ((result as Record<string, unknown>)._thinkingAutoDisabled === true) {
        orchestrator.getMetricsAggregator().recordThinkingAutoDisabled();
      }
      // Extract thinking tokens from response content blocks
      const content = result.content as Array<{ type?: string; thinking?: string }> | undefined;
      if (content) {
        let thinkingTokens = 0;
        for (const block of content) {
          if (block.type === 'thinking' && block.thinking) {
            // Rough estimation: ~4 chars per token for thinking content
            thinkingTokens += block.thinking.length / 4;
          }
        }
        if (thinkingTokens > 0) {
          orchestrator.getMetricsAggregator().recordThinkingTokens(thinkingTokens);
        }
      }
      // Record image metrics
      if (imageCount > 0) {
        orchestrator.getMetricsAggregator().recordImageMetrics(imageCount, imageBytes);
      }
      res.json(result);
    }
  } catch (error) {
    if (res.writableEnded) {
      return;
    }

    logger.error('Anthropic messages request failed', { error, model });

    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : 'Request failed';
      const { isNoServersError } = classifyOrchestratorRoutingError(errorMessage);
      const isNoServers = isNoServersError;

      res.status(isNoServers ? 503 : 500).json({
        type: 'error',
        error: {
          type: isNoServers ? 'overloaded_error' : 'api_error',
          message: errorMessage,
        },
      });
    }
  }
}

/**
 * Handle /v1/messages--:serverId - Route to specific server
 * Bypasses load balancer, routes directly to specified server
 */
export async function handleMessagesToServer(req: Request, res: Response): Promise<void> {
  const clientVersion = req.headers['anthropic-version'];
  const orchestratorConfig = getConfigManager().getConfig();
  const defaultVersion = orchestratorConfig.anthropic?.defaultVersion ?? '2023-06-01';

  // Validate format if provided, use default if absent
  let anthropicVersion: string;
  if (clientVersion !== undefined) {
    if (typeof clientVersion !== 'string' || !isValidAnthropicVersion(clientVersion)) {
      res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'anthropic-version header format is invalid; expected YYYY-MM-DD (e.g., 2023-06-01)',
        },
      });
      return;
    }
    // Forward client's exact value verbatim
    anthropicVersion = clientVersion;
  } else {
    // Use default version from config
    anthropicVersion = defaultVersion;
  }

  const anthropicBetaHeader = req.headers['anthropic-beta'];
  let anthropicBeta: string | undefined;
  if (anthropicBetaHeader) {
    if (
      typeof anthropicBetaHeader !== 'string' ||
      !isValidAnthropicBetaHeader(anthropicBetaHeader)
    ) {
      res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'anthropic-beta header format is invalid; expected comma-separated alphanumeric+hyphen tokens',
        },
      });
      return;
    }
    anthropicBeta = anthropicBetaHeader;
  }

  const rawBody = req.body as Record<string, unknown>;

  const parseResult = AnthropicMessagesRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: firstIssue?.message ?? 'Invalid request body',
        param: firstIssue?.path?.join('.'),
      },
    });
    return;
  }

  const body = parseResult.data;
  const { model, stream = false } = body;

  const serverId = Array.isArray(req.params.serverId)
    ? req.params.serverId[0]
    : req.params.serverId;

  const orchestrator = getOrchestratorInstance();

  // Detect tool_result blocks in request messages and record metrics
  if (body.messages) {
    for (const message of body.messages) {
      const content = message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            orchestrator.getMetricsAggregator().recordToolResult();
          }
        }
      }
    }
  }

  const config = getConfigManager().getConfig();
  const imageValidation = validateImageBlocks(rawBody, config.anthropic.maxImageBytes);
  if (!imageValidation.valid) {
    res.status(400).json(imageValidation.error);
    return;
  }

  const { imageCount, imageBytes } = imageValidation;

  // Validate server exists
  const server = orchestrator.getServers().find(s => s.id === serverId);
  if (!server) {
    res.status(404).json({
      type: 'error',
      error: {
        type: 'not_found_error',
        message: `Server '${serverId}' not found`,
      },
    });
    return;
  }

  // Validate server supports Anthropic
  if (server.supportsAnthropic === false) {
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Server '${serverId}' does not support Anthropic API`,
      },
    });
    return;
  }

  // Check lifecycleMode restrictions
  const lifecycleCheck = checkLifecycleModeAllowed(server, config.anthropic.lifecycleMode);
  if (!lifecycleCheck.allowed) {
    res.status(lifecycleCheck.status).json({
      type: 'error',
      error: {
        type: lifecycleCheck.errorType,
        message: lifecycleCheck.message,
      },
    });
    return;
  }

  // Check for bypass circuit breaker flag
  const bypassCircuitBreaker = shouldBypassCircuitBreaker(req);

  logger.info('Received Anthropic messages request to specific server', {
    serverId,
    model,
    stream,
    bypassCircuitBreaker,
  });

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
    const result = await orchestrator.requestToServer<Record<string, unknown>>(
      serverId,
      model,
      async (server, context) => {
        const headers = buildUpstreamHeaders(req.headers, server, anthropicVersion, anthropicBeta);
        const anthropicPath =
          server.endpointOverrides?.anthropic_messages ?? API_ENDPOINTS.ANTHROPIC.MESSAGES;
        const upstreamUrl = `${server.url}${anthropicPath}`;

        if (stream) {
          const timeoutMs = resolveRequestTimeout(
            req.headers,
            orchestrator.getTimeout(server.id, model)
          );

          activeStreamState.serverId = server.id;
          activeStreamState.model = model;

          const { response, activityController } = await fetchWithActivityTimeout(upstreamUrl, {
            method: 'POST',
            headers,
            body: toBodyInit(req.rawBody) ?? JSON.stringify({ ...rawBody, stream: true }),
            connectionTimeout: timeoutMs,
            activityTimeout: timeoutMs,
            telemetryMeta: {
              serverId: server.id,
              model,
              protocol: 'anthropic',
              endpoint: 'messages',
              isStreaming: true,
            },
          });

          if (!response.ok) {
            activityController.clearTimeout();
            const errorText = await response.text();
            throw new Error(errorText || `Upstream returned ${String(response.status)}`);
          }

          activeStreamState.activityController = activityController;

          try {
            await passthroughAnthropicSSE(
              response,
              res,
              server.id,
              model,
              {
                serverId: server.id,
                model,
                protocol: 'anthropic',
                endpoint: 'messages',
              },
              activityController.controller.signal,
              (toolName: string) => {
                orchestrator.getMetricsAggregator().recordToolUse(toolName);
              },
              (upstreamRequestId?: string) => {
                logger.info('request_forwarded', {
                  orchestratorRequestId: req.requestId,
                  upstreamRequestId,
                  provider: 'anthropic',
                  serverId: server.id,
                });
              }
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

        const response = await fetchWithTimeout(upstreamUrl, {
          method: 'POST',
          headers,
          body: toBodyInit(req.rawBody) ?? JSON.stringify(rawBody),
          timeout: timeoutMs,
          telemetryMeta: {
            serverId: server.id,
            model,
            protocol: 'anthropic',
            endpoint: 'messages',
            isStreaming: false,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `Upstream returned ${String(response.status)}`);
        }

        return (await parseResponse<Record<string, unknown>>(response))!;
      },
      {
        isStreaming: stream,
        bypassCircuitBreaker,
        routingContext: { algorithm: 'direct', protocol: 'anthropic' },
      }
    );

    if (!stream && result && !result._streamed) {
      // Record system prompt tokens (Anthropic uses top-level system field, not role=system message)
      const systemPromptTokens = estimateSystemPromptTokens(body.system);
      if (systemPromptTokens > 0) {
        orchestrator.getMetricsAggregator().recordSystemPromptTokens(systemPromptTokens);
      }
      // Record Anthropic cache metrics if enabled
      if (config.anthropic.cacheMetrics.enabled) {
        const usage = result.usage as
          | { cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
          | undefined;
        if (usage) {
          const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
          const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
          orchestrator
            .getMetricsAggregator()
            .recordCacheMetrics(
              cacheReadTokens,
              cacheCreationTokens,
              config.anthropic.cacheMetrics.savingsRatePerToken
            );
        }
      }
      // Record image metrics
      if (imageCount > 0) {
        orchestrator.getMetricsAggregator().recordImageMetrics(imageCount, imageBytes);
      }
      res.json(result);
    }
  } catch (error) {
    if (res.writableEnded) {
      return;
    }

    logger.error('Anthropic messages to server request failed', { error, serverId, model });

    if (!res.headersSent) {
      const errorMessage = error instanceof Error ? error.message : 'Request failed';
      res.status(500).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: errorMessage,
        },
      });
    }
  }
}

export async function handleListModels(_req: Request, res: Response): Promise<void> {
  try {
    const orchestrator = getOrchestratorInstance();
    const result = await orchestrator.getAggregatedAnthropicModels();
    res.json(result);
  } catch (error) {
    logger.error('Failed to get aggregated Anthropic models', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Failed to retrieve models list',
      },
    });
  }
}

export async function handleGetModel(req: Request, res: Response): Promise<void> {
  const { model } = req.params;

  const orchestrator = getOrchestratorInstance();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const servers = orchestrator.getServers({ healthyOnly: false });

  const serversWithAnthropicCapability: AIServer[] = [];
  for (const server of servers) {
    const cap = endpointRegistry.getCapability(server.id, 'anthropic_messages');
    if (cap?.confirmed === true) {
      serversWithAnthropicCapability.push(server);
    }
  }

  if (serversWithAnthropicCapability.length === 0) {
    res.status(404).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Model '${String(model)}' not found`,
      },
    });
    return;
  }

  const upstreamCalls = serversWithAnthropicCapability.map(async server => {
    try {
      const headers = buildModelsUpstreamHeaders(server);
      const modelsPath =
        server.endpointOverrides?.anthropic_messages?.replace('/messages', '/models') ??
        API_ENDPOINTS.ANTHROPIC.MODELS;
      const upstreamUrl = `${server.url}${modelsPath}`;

      const response = await fetchWithTimeout(upstreamUrl, {
        method: 'GET',
        headers,
        timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
        telemetryMeta: {
          serverId: server.id,
          model: '',
          protocol: 'anthropic',
          endpoint: 'models',
          isStreaming: false,
        },
      });

      if (!response.ok) {
        logger.warn('Upstream /v1/models request failed', {
          serverId: server.id,
          status: response.status,
        });
        return [];
      }

      const data = (await parseResponse<{ data?: unknown[] }>(response))?.data ?? [];
      const models: AnthropicModel[] = [];

      for (const item of data) {
        if (
          item &&
          typeof item === 'object' &&
          'id' in item &&
          typeof (item as Record<string, unknown>).id === 'string'
        ) {
          const modelItem = item as Record<string, unknown>;
          models.push({
            id: modelItem.id as string,
            type: 'model',
            display_name:
              typeof modelItem.display_name === 'string' ? modelItem.display_name : undefined,
            created_at: typeof modelItem.created_at === 'number' ? modelItem.created_at : undefined,
          });
        }
      }

      return models;
    } catch (error) {
      logger.warn('Failed to fetch models from server', {
        serverId: server.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });

  const results = await Promise.all(upstreamCalls);
  const seenModelIds = new Set<string>();
  let foundModel: AnthropicModel | null = null;

  for (const models of results) {
    for (const m of models) {
      if (!seenModelIds.has(m.id)) {
        seenModelIds.add(m.id);
        if (m.id === model) {
          foundModel = m;
          break;
        }
      }
    }
    if (foundModel) {
      break;
    }
  }

  if (!foundModel) {
    res.status(404).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Model '${String(model)}' not found`,
      },
    });
    return;
  }

  res.json(foundModel);
}

/**
 * Determine if a server is SaaS (Anthropic hosted) based on its URL.
 * SaaS servers use api.anthropic.com or similar hosted endpoints.
 */
function isServerSaas(server: AIServer): boolean {
  const url = server.url.toLowerCase();
  return url.includes('api.anthropic.com') || url.includes('anthropic.com/api');
}

/**
 * Get the capability status from an EndpointCapability record.
 */
function getCapabilityStatus(
  cap: { declared: boolean; confirmed: boolean; lastSeen: number; failureCount: number } | undefined
): 'confirmed' | 'pending' | 'softRevoked' | 'unknown' {
  if (!cap) {
    return 'unknown';
  }
  if (cap.confirmed) {
    return 'confirmed';
  }
  if (cap.declared && cap.lastSeen === 0 && cap.failureCount > 0) {
    return 'softRevoked';
  }
  if (cap.declared) {
    return 'pending';
  }
  return 'unknown';
}

/**
 * Check if lifecycle operations are allowed based on lifecycleMode config.
 * Returns { allowed: false, status: number, message: string } if not allowed,
 * or { allowed: true } if allowed.
 */
function checkLifecycleModeAllowed(
  server: AIServer,
  lifecycleMode: 'saas-only' | 'self-hosted-only' | 'both'
): { allowed: true } | { allowed: false; status: number; errorType: string; message: string } {
  const isSaas = isServerSaas(server);

  switch (lifecycleMode) {
    case 'saas-only':
      return {
        allowed: false,
        status: 404,
        errorType: 'not_found_error',
        message: 'Lifecycle endpoints are not available in saas-only mode',
      };
    case 'self-hosted-only':
      if (isSaas) {
        return {
          allowed: false,
          status: 501,
          errorType: 'invalid_request_error',
          message:
            'Lifecycle endpoints are not available for SaaS servers in self-hosted-only mode',
        };
      }
      return { allowed: true };
    case 'both':
      if (isSaas) {
        return {
          allowed: false,
          status: 501,
          errorType: 'invalid_request_error',
          message: 'Lifecycle endpoints are not available for SaaS servers',
        };
      }
      return { allowed: true };
  }
}

/**
 * Handle GET /api/orchestrator/anthropic/servers/:serverId/capabilities
 * Returns rich server capability state for Anthropic integration.
 */
export async function handleAnthropicServerCapabilities(
  req: Request,
  res: Response
): Promise<void> {
  const serverId = Array.isArray(req.params.serverId)
    ? req.params.serverId[0]
    : req.params.serverId;

  const orchestrator = getOrchestratorInstance();
  const endpointRegistry = orchestrator.getEndpointRegistry();

  const server = orchestrator.getServers().find(s => s.id === serverId);
  if (!server) {
    res.status(404).json({
      type: 'error',
      error: {
        type: 'not_found_error',
        message: `Server '${serverId}' not found`,
      },
    });
    return;
  }

  const messagesCap = endpointRegistry.getCapability(serverId, 'anthropic_messages');
  const capabilityStatus = getCapabilityStatus(messagesCap);
  const isSaas = isServerSaas(server);

  const response = {
    serverId,
    type: isSaas ? 'saas' : 'self-hosted',
    supportsLifecycle: isSaas ? false : capabilityStatus === 'confirmed',
    supportsModels: capabilityStatus !== 'unknown',
    supportsThinking: server.supportsAnthropic === true,
    supportsCaching: server.supportsAnthropic === true,
    capabilityStatus,
  };

  res.json(response);
}
