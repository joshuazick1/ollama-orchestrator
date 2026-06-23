import type { Request, Response } from 'express';

import { API_ENDPOINTS } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import { AnthropicMessagesRequestSchema } from '../types/anthropic.types.js';
import type { StreamingTelemetryMeta } from '../streaming.js';
import { resolveApiKey } from '../utils/api-keys.js';
import {
  fetchWithTimeout,
  fetchWithActivityTimeout,
  parseResponse,
} from '../utils/fetch-with-timeout.js';
import { logger } from '../utils/logger.js';
import { classifyOrchestratorRoutingError } from '../utils/orchestrator-error-classifier.js';
import { setupStreamingClientDisconnectCleanup } from '../utils/streaming-cleanup.js';
import { resolveRequestTimeout } from '../utils/timeout-manager.js';

const UPSTREAM_REQUEST_TIMEOUT_MS = 5000;

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

function buildUpstreamHeaders(server: AIServer, anthropicVersion: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': anthropicVersion,
  };
  const resolvedKey = resolveApiKey(server.apiKey);
  if (resolvedKey) {
    headers['Authorization'] = `Bearer ${resolvedKey}`;
  }
  return headers;
}

async function passthroughAnthropicSSE(
  upstreamResponse: globalThis.Response,
  clientResponse: Response,
  serverId: string,
  model: string,
  _streamingTelemetryMeta?: StreamingTelemetryMeta,
  abortSignal?: AbortSignal
): Promise<void> {
  const startTime = Date.now();

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
  const anthropicVersion = req.headers['anthropic-version'];
  if (!anthropicVersion || typeof anthropicVersion !== 'string') {
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'anthropic-version header is required',
      },
    });
    return;
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

        const headers = buildUpstreamHeaders(server, anthropicVersion);
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
            body: JSON.stringify({ ...rawBody, stream: true }),
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
              activityController.controller.signal
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
          body: JSON.stringify(rawBody),
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
      stream,
      'generate',
      'openai',
      undefined,
      undefined,
      undefined
    );

    if (!stream && result && !result._streamed) {
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
  const anthropicVersion = req.headers['anthropic-version'];
  if (!anthropicVersion || typeof anthropicVersion !== 'string') {
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'anthropic-version header is required',
      },
    });
    return;
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
        const headers = buildUpstreamHeaders(server, anthropicVersion);
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
            body: JSON.stringify({ ...rawBody, stream: true }),
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
              activityController.controller.signal
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
          body: JSON.stringify(rawBody),
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
    res.json({ object: 'list', data: [] });
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
  const aggregatedModels: AnthropicModel[] = [];

  for (const models of results) {
    for (const model of models) {
      if (!seenModelIds.has(model.id)) {
        seenModelIds.add(model.id);
        aggregatedModels.push(model);
      }
    }
  }

  res.json({ object: 'list', data: aggregatedModels });
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
