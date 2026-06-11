import type { Request, Response } from 'express';
import { z } from 'zod';

import { API_ENDPOINTS } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import type { StreamingTelemetryMeta } from '../streaming.js';
import { resolveApiKey } from '../utils/api-keys.js';
import {
  fetchWithTimeout,
  fetchWithActivityTimeout,
  parseResponse,
} from '../utils/fetch-with-timeout.js';
import { logger } from '../utils/logger.js';
import { classifyOrchestratorRoutingError } from '../utils/orchestrator-error-classifier.js';
import { resolveRequestTimeout } from '../utils/timeout-manager.js';

const anthropicMessagesRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(z.record(z.string(), z.unknown())).min(1),
    max_tokens: z.number().int().positive(),
    stream: z.boolean().optional(),
  })
  .passthrough();

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

  if ('thinking' in rawBody) {
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'thinking is not supported',
        param: 'thinking',
      },
    });
    return;
  }

  if ('cache_control' in rawBody) {
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'cache_control is not supported',
        param: 'cache_control',
      },
    });
    return;
  }

  const parseResult = anthropicMessagesRequestSchema.safeParse(rawBody);
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
