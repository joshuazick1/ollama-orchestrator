import type { Request, Response } from 'express';

import { API_ENDPOINTS } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import { CohereChatRequestSchema } from '../types/cohere.types.js';
import { resolveApiKey } from '../utils/api-keys.js';
import { shouldBypassCircuitBreaker } from '../utils/circuit-breaker-helpers.js';
import { fetchWithTimeout, parseResponse } from '../utils/fetch-with-timeout.js';
import { forwardRequestHeaders } from '../utils/header-forwarder.js';
import { toBodyInit } from '../utils/json-utils.js';
import { logger } from '../utils/logger.js';
import { classifyOrchestratorRoutingError } from '../utils/orchestrator-error-classifier.js';
import { resolveRequestTimeout } from '../utils/timeout-manager.js';

function buildUpstreamHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  server: AIServer
): Record<string, string> {
  const headers = forwardRequestHeaders(clientHeaders, 'openai', server);
  const resolvedKey = resolveApiKey(server.apiKey);
  if (resolvedKey) {
    headers['Authorization'] = `Bearer ${resolvedKey}`;
  }
  return headers;
}

export async function handleChat(req: Request, res: Response): Promise<void> {
  const rawBody = req.body as Record<string, unknown>;

  const parseResult = CohereChatRequestSchema.safeParse(rawBody);
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
  const model = body.model ?? '';
  const { stream = false } = body;

  logger.info('Received Cohere chat request', { model, stream });

  const orchestrator = getOrchestratorInstance();

  try {
    const result = await orchestrator.tryRequestWithFailover<Record<string, unknown>>(
      model,
      async (server: AIServer, _context?: { requestId?: string }) => {
        const headers = buildUpstreamHeaders(req.headers, server);
        const upstreamUrl = `${server.url}${API_ENDPOINTS.COHERE.CHAT}`;

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
            protocol: 'openai',
            endpoint: 'chat',
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

    if (result) {
      res.json(result);
    }
  } catch (error) {
    if (res.writableEnded) {
      return;
    }

    logger.error('Cohere chat request failed', { error, model });

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

export async function handleChatToServer(req: Request, res: Response): Promise<void> {
  const rawBody = req.body as Record<string, unknown>;

  const parseResult = CohereChatRequestSchema.safeParse(rawBody);
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
  const model = body.model ?? '';
  const { stream = false } = body;

  const serverId = Array.isArray(req.params.serverId)
    ? req.params.serverId[0]
    : req.params.serverId;

  const orchestrator = getOrchestratorInstance();

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

  const bypassCircuitBreaker = shouldBypassCircuitBreaker(req);

  logger.info('Received Cohere chat request to specific server', {
    serverId,
    model,
    stream,
    bypassCircuitBreaker,
  });

  try {
    const result = await orchestrator.requestToServer<Record<string, unknown>>(
      serverId,
      model,
      async (server, _context) => {
        const headers = buildUpstreamHeaders(req.headers, server);
        const upstreamUrl = `${server.url}${API_ENDPOINTS.COHERE.CHAT}`;

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
            protocol: 'openai',
            endpoint: 'chat',
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
        routingContext: { algorithm: 'direct', protocol: 'cohere' },
      }
    );

    if (result) {
      res.json(result);
    }
  } catch (error) {
    if (res.writableEnded) {
      return;
    }

    logger.error('Cohere chat to server request failed', { error, serverId, model });

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
