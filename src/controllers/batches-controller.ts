import type { Request, Response } from 'express';

import { API_ENDPOINTS } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { BatchCreateRequestSchema } from '../types/batch.types.js';
import { fetchWithTimeout, parseResponse } from '../utils/fetch-with-timeout.js';
import { toBodyInit } from '../utils/json-utils.js';
import { logger } from '../utils/logger.js';

const SAAS_ANTHROPIC_HOST = 'api.anthropic.com';
const UPSTREAM_REQUEST_TIMEOUT_MS = 30000;

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function isSaasServer(serverUrl: string): boolean {
  return serverUrl.includes(SAAS_ANTHROPIC_HOST);
}

function findSaasServer(): { url: string; apiKey?: string } | undefined {
  const orchestrator = getOrchestratorInstance();
  const servers = orchestrator.getServers({ healthyOnly: false });
  for (const server of servers) {
    if (isSaasServer(server.url)) {
      return { url: server.url, apiKey: server.apiKey };
    }
  }
  return undefined;
}

function buildUpstreamHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  apiKey?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  for (const [name, value] of Object.entries(clientHeaders)) {
    if (value === undefined) {
      continue;
    }
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName)) {
      continue;
    }
    if (lowerName === 'host' || lowerName === 'content-length') {
      continue;
    }
    if (lowerName === 'anthropic-version' || lowerName === 'anthropic-beta') {
      continue;
    }
    if (lowerName === 'x-api-key') {
      continue;
    }
    headers[name] = Array.isArray(value) ? value[0] : value;
  }

  return headers;
}

export async function handleCreateBatch(req: Request, res: Response): Promise<void> {
  const rawBody = req.body as Record<string, unknown>;
  const parseResult = BatchCreateRequestSchema.safeParse(rawBody);
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

  const saasServer = findSaasServer();
  if (!saasServer) {
    res.status(501).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Batch processing is only available for SaaS Anthropic providers',
      },
    });
    return;
  }

  const headers = buildUpstreamHeaders(req.headers, saasServer.apiKey);
  const upstreamUrl = `${saasServer.url}${API_ENDPOINTS.ANTHROPIC.MESSAGES_BATCHES}`;

  try {
    const response = await fetchWithTimeout(upstreamUrl, {
      method: 'POST',
      headers,
      body: toBodyInit(req.rawBody) ?? JSON.stringify(rawBody),
      timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
      telemetryMeta: {
        serverId: 'saas',
        model: '',
        protocol: 'anthropic',
        endpoint: 'batches',
        isStreaming: false,
      },
    });

    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      if (key !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    }

    if (response.ok) {
      const data = await parseResponse(response);
      res.json(data);
    } else {
      const errorText = await response.text();
      res.setHeader('Content-Type', 'application/json');
      res.send(errorText);
    }
  } catch (error) {
    logger.error('Batch create failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Failed to create batch',
      },
    });
  }
}

export async function handleListBatches(req: Request, res: Response): Promise<void> {
  const saasServer = findSaasServer();
  if (!saasServer) {
    res.status(501).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Batch processing is only available for SaaS Anthropic providers',
      },
    });
    return;
  }

  const headers = buildUpstreamHeaders(req.headers, saasServer.apiKey);
  const upstreamUrl = `${saasServer.url}${API_ENDPOINTS.ANTHROPIC.MESSAGES_BATCHES}`;

  try {
    const response = await fetchWithTimeout(upstreamUrl, {
      method: 'GET',
      headers,
      timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
      telemetryMeta: {
        serverId: 'saas',
        model: '',
        protocol: 'anthropic',
        endpoint: 'batches',
        isStreaming: false,
      },
    });

    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      if (key !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    }

    if (response.ok) {
      const data = await parseResponse(response);
      res.json(data);
    } else {
      const errorText = await response.text();
      res.setHeader('Content-Type', 'application/json');
      res.send(errorText);
    }
  } catch (error) {
    logger.error('Batch list failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Failed to list batches',
      },
    });
  }
}

export async function handleGetBatch(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const saasServer = findSaasServer();
  if (!saasServer) {
    res.status(501).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Batch processing is only available for SaaS Anthropic providers',
      },
    });
    return;
  }

  const headers = buildUpstreamHeaders(req.headers, saasServer.apiKey);
  const upstreamUrl = `${saasServer.url}${API_ENDPOINTS.ANTHROPIC.MESSAGES_BATCHES}/${String(id)}`;

  try {
    const response = await fetchWithTimeout(upstreamUrl, {
      method: 'GET',
      headers,
      timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
      telemetryMeta: {
        serverId: 'saas',
        model: '',
        protocol: 'anthropic',
        endpoint: 'batches',
        isStreaming: false,
      },
    });

    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      if (key !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    }

    if (response.ok) {
      const data = await parseResponse(response);
      res.json(data);
    } else {
      const errorText = await response.text();
      res.setHeader('Content-Type', 'application/json');
      res.send(errorText);
    }
  } catch (error) {
    logger.error('Batch get failed', {
      batchId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Failed to get batch',
      },
    });
  }
}

export async function handleCancelBatch(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const saasServer = findSaasServer();
  if (!saasServer) {
    res.status(501).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Batch processing is only available for SaaS Anthropic providers',
      },
    });
    return;
  }

  const headers = buildUpstreamHeaders(req.headers, saasServer.apiKey);
  const upstreamUrl = `${saasServer.url}${API_ENDPOINTS.ANTHROPIC.MESSAGES_BATCHES}/${String(id)}/cancel`;

  try {
    const response = await fetchWithTimeout(upstreamUrl, {
      method: 'POST',
      headers,
      timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
      telemetryMeta: {
        serverId: 'saas',
        model: '',
        protocol: 'anthropic',
        endpoint: 'batches',
        isStreaming: false,
      },
    });

    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      if (key !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    }

    if (response.ok) {
      const data = await parseResponse(response);
      res.json(data);
    } else {
      const errorText = await response.text();
      res.setHeader('Content-Type', 'application/json');
      res.send(errorText);
    }
  } catch (error) {
    logger.error('Batch cancel failed', {
      batchId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Failed to cancel batch',
      },
    });
  }
}

export async function handleGetBatchResults(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const saasServer = findSaasServer();
  if (!saasServer) {
    res.status(501).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Batch processing is only available for SaaS Anthropic providers',
      },
    });
    return;
  }

  const headers = buildUpstreamHeaders(req.headers, saasServer.apiKey);
  const upstreamUrl = `${saasServer.url}${API_ENDPOINTS.ANTHROPIC.MESSAGES_BATCHES}/${String(id)}/results`;

  try {
    const response = await fetchWithTimeout(upstreamUrl, {
      method: 'GET',
      headers,
      timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
      telemetryMeta: {
        serverId: 'saas',
        model: '',
        protocol: 'anthropic',
        endpoint: 'batches',
        isStreaming: false,
      },
    });

    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
      if (key !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    }

    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      } else {
        res.setHeader('Content-Type', 'application/jsonl');
      }
      const text = await response.text();
      res.send(text);
    } else {
      const errorText = await response.text();
      res.setHeader('Content-Type', 'application/json');
      res.send(errorText);
    }
  } catch (error) {
    logger.error('Batch results failed', {
      batchId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Failed to get batch results',
      },
    });
  }
}
