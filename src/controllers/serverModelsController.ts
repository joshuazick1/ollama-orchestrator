/**
 * serverModelsController.ts
 * Per-server model management controllers (pull, delete, list)
 */

import type { Request, Response } from 'express';

import { ERROR_MESSAGES } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator-instance.js';
import { fetchWithTimeout, parseResponse } from '../utils/fetchWithTimeout.js';
import { safeJsonStringify } from '../utils/json-utils.js';
import { logger } from '../utils/logger.js';

/** Shape of a request body containing a model name */
interface ModelRequestBody {
  model?: string;
}

/** Shape of a request body for copying a model (includes source server) */
interface CopyModelRequestBody extends ModelRequestBody {
  sourceServerId?: string;
}

/** Shape of an Ollama API error response */
interface OllamaErrorResponse {
  error?: string;
}

/** Shape of an Ollama API pull response */
interface OllamaPullResponse {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
}

/**
 * Normalize model name by:
 * - Trimming whitespace
 * - Removing spaces around slashes (e.g., "model/name " -> "model/name")
 * - Lowercasing
 */
function normalizeModelName(model: string): string {
  return model
    .trim()
    .replace(/\s*\/\s*/g, '/') // Remove spaces around slashes
    .toLowerCase();
}

/**
 * List all models on a specific server
 * GET /api/orchestrator/servers/:id/models
 */
export async function listServerModels(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServers().find(s => s.id === id);
  if (!server) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  if (!server.healthy) {
    res.status(503).json({ error: `Server '${id}' is not healthy` });
    return;
  }

  if (server.supportsOllama === false) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_NO_OLLAMA_SUPPORT(id) });
    return;
  }

  try {
    const response = await fetchWithTimeout(`${server.url}/api/tags`, {
      timeout: 10000, // 10 second timeout
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      models?: Array<{ name: string; modified_at?: string; size?: number; digest?: string }>;
    };
    const models = data.models ?? [];

    res.status(200).json({
      success: true,
      serverId: id,
      serverUrl: server.url,
      models: models.map(m => ({
        name: m.name,
        modified_at: m.modified_at,
        size: m.size,
        digest: m.digest,
      })),
    });
  } catch (error) {
    logger.error(`Failed to list models for server ${id}:`, { error });
    res.status(500).json({
      error: 'Failed to list models',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Stream SSE progress events from an Ollama pull response to the client.
 * Ollama streams NDJSON lines with { status, digest, total, completed } fields.
 * We re-emit these as SSE events to the frontend.
 */
async function streamPullProgress(
  ollamaResponse: globalThis.Response,
  res: Response,
  serverId: string,
  model: string,
  label: string
): Promise<void> {
  const orchestrator = getOrchestratorInstance();
  const server = orchestrator.getServers().find(s => s.id === serverId);

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const body = ollamaResponse.body;
  if (!body) {
    const errorEvent = safeJsonStringify({ type: 'error', error: 'No response body from Ollama' });
    res.write(`data: ${errorEvent}\n\n`);
    res.end();
    return;
  }

  const reader = (body as unknown as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastStatus: OllamaPullResponse | null = null;

  // Send a keep-alive comment every 15 seconds to prevent proxy timeouts
  const keepAliveInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  try {
    /* eslint-disable no-constant-condition */
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {break;}

      buffer += decoder.decode(value, { stream: true });

      // Ollama streams NDJSON — one JSON object per line
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          const progress = JSON.parse(trimmed) as OllamaPullResponse;
          lastStatus = progress;

          const event = safeJsonStringify({
            type: 'progress',
            status: progress.status,
            digest: progress.digest,
            total: progress.total,
            completed: progress.completed,
          });
          res.write(`data: ${event}\n\n`);
        } catch {
          // Skip malformed JSON lines
          logger.debug(`${label}: Skipping malformed NDJSON line`, { line: trimmed });
        }
      }
    }
    /* eslint-enable no-constant-condition */

    // Process any remaining data in the buffer
    if (buffer.trim()) {
      try {
        const progress = JSON.parse(buffer.trim()) as OllamaPullResponse;
        lastStatus = progress;
        const event = safeJsonStringify({
          type: 'progress',
          status: progress.status,
          digest: progress.digest,
          total: progress.total,
          completed: progress.completed,
        });
        res.write(`data: ${event}\n\n`);
      } catch {
        // Ignore trailing malformed data
      }
    }

    // Refresh server models after successful pull
    if (server) {
      await orchestrator.updateServerStatus(server);
    }

    logger.info(`Successfully completed ${label}: ${model} on server ${serverId}`);

    const completeEvent = safeJsonStringify({
      type: 'complete',
      serverId,
      model,
      message: `Model '${model}' ${label} completed successfully`,
      lastStatus,
    });
    res.write(`data: ${completeEvent}\n\n`);
  } catch (error) {
    logger.error(`${label} stream error for ${model} on server ${serverId}:`, { error });
    const errorEvent = safeJsonStringify({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    res.write(`data: ${errorEvent}\n\n`);
  } finally {
    clearInterval(keepAliveInterval);
    res.end();
  }
}

/**
 * Pull a model to a specific server (with streaming progress)
 * POST /api/orchestrator/servers/:id/models/pull
 *
 * Streams SSE events with pull progress. Each event is a JSON object:
 *   { type: 'progress', status, digest, total, completed }
 *   { type: 'complete', serverId, model, message }
 *   { type: 'error', error }
 */
export async function pullModelToServer(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const body = req.body as ModelRequestBody;
  const rawModel = body?.model;

  if (!rawModel || typeof rawModel !== 'string') {
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED_STRING });
    return;
  }

  const model = normalizeModelName(rawModel);

  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServers().find(s => s.id === id);
  if (!server) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  if (!server.healthy) {
    res.status(503).json({ error: `Server '${id}' is not healthy` });
    return;
  }

  if (server.supportsOllama === false) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_NO_OLLAMA_SUPPORT(id) });
    return;
  }

  logger.info(`Starting model pull: ${model} to server ${id} (${server.url})`);

  try {
    // Use activity-based timeout: 30s to connect, 120s between chunks
    // (Ollama streams progress updates regularly during download)
    const controller = new AbortController();
    const connectionTimeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(`${server.url}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: safeJsonStringify({ name: model, stream: true }),
      signal: controller.signal,
    });

    clearTimeout(connectionTimeout);

    if (!response.ok) {
      const errorData = ((await parseResponse(response)) as OllamaErrorResponse) || {};
      throw new Error(errorData.error ?? `Pull failed: ${response.statusText}`);
    }

    await streamPullProgress(response, res, id, model, 'pull');
  } catch (error) {
    logger.error(`Failed to pull model ${model} to server ${id}:`, { error });

    // If headers haven't been sent yet, return JSON error
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to pull model',
        details: error instanceof Error ? error.message : String(error),
      });
    } else {
      // Headers already sent (SSE), send error as SSE event
      const errorEvent = safeJsonStringify({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      res.write(`data: ${errorEvent}\n\n`);
      res.end();
    }
  }
}

/**
 * Delete a model from a specific server
 * DELETE /api/orchestrator/servers/:id/models/:model
 */
export async function deleteModelFromServer(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const rawModel = req.params.model as string;

  if (!rawModel) {
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_PARAMETER_REQUIRED });
    return;
  }

  const model = normalizeModelName(rawModel);

  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServers().find(s => s.id === id);
  if (!server) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  if (!server.healthy) {
    res.status(503).json({ error: `Server '${id}' is not healthy` });
    return;
  }

  if (server.supportsOllama === false) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_NO_OLLAMA_SUPPORT(id) });
    return;
  }

  logger.info(`Deleting model ${model} from server ${id} (${server.url})`);

  try {
    const response = await fetchWithTimeout(`${server.url}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: safeJsonStringify({ name: model }),
      timeout: 30000, // 30 second timeout for delete
    });

    if (!response.ok) {
      const errorData = ((await parseResponse(response)) as OllamaErrorResponse) || {};
      throw new Error(errorData.error ?? `Delete failed: ${response.statusText}`);
    }

    // Refresh server models after successful deletion
    await orchestrator.updateServerStatus(server);

    // Clean up circuit breaker for this server:model combination
    orchestrator.removeModelCircuitBreaker(id, model);

    logger.info(`Successfully deleted model ${model} from server ${id}`);

    res.status(200).json({
      success: true,
      serverId: id,
      model,
      message: `Model '${model}' deleted successfully`,
    });
  } catch (error) {
    logger.error(`Failed to delete model ${model} from server ${id}:`, { error });
    res.status(500).json({
      error: 'Failed to delete model',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Copy a model from one server to another
 * POST /api/orchestrator/servers/:id/models/copy
 */
export async function copyModelToServer(req: Request, res: Response): Promise<void> {
  const targetServerId = req.params.id as string;
  const body = req.body as CopyModelRequestBody;
  const rawModel = body?.model;
  const { sourceServerId } = body ?? {};

  if (!rawModel || typeof rawModel !== 'string') {
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
    return;
  }

  const model = normalizeModelName(rawModel);

  const orchestrator = getOrchestratorInstance();

  const targetServer = orchestrator.getServers().find(s => s.id === targetServerId);
  if (!targetServer) {
    res.status(404).json({ error: ERROR_MESSAGES.TARGET_SERVER_NOT_FOUND(targetServerId) });
    return;
  }

  if (!targetServer.healthy) {
    res.status(503).json({ error: `Target server '${targetServerId}' is not healthy` });
    return;
  }

  if (targetServer.supportsOllama === false) {
    res.status(400).json({
      error: `Target server '${targetServerId}' does not support Ollama model management`,
    });
    return;
  }

  // If source server specified, verify it has the model
  if (sourceServerId) {
    const sourceServer = orchestrator.getServers().find(s => s.id === sourceServerId);
    if (!sourceServer) {
      res.status(404).json({ error: ERROR_MESSAGES.SOURCE_SERVER_NOT_FOUND(sourceServerId) });
      return;
    }

    if (sourceServer.supportsOllama === false) {
      res.status(400).json({
        error: `Source server '${sourceServerId}' does not support Ollama model management`,
      });
      return;
    }

    if (!sourceServer.models.includes(model)) {
      res.status(400).json({
        error: ERROR_MESSAGES.MODEL_NOT_FOUND_ON_SOURCE(model, sourceServerId),
      });
      return;
    }
  }

  // For now, we just pull the model. In a more sophisticated implementation,
  // we could copy the model files directly if both servers are on the same filesystem
  logger.info(`Copying model ${model} to server ${targetServerId} (using pull)`);

  try {
    // Use activity-based timeout: 30s to connect, 120s between chunks
    const controller = new AbortController();
    const connectionTimeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(`${targetServer.url}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: safeJsonStringify({ name: model, stream: true }),
      signal: controller.signal,
    });

    clearTimeout(connectionTimeout);

    if (!response.ok) {
      const errorData = ((await parseResponse(response)) as OllamaErrorResponse) || {};
      throw new Error(errorData.error ?? `Copy failed: ${response.statusText}`);
    }

    await streamPullProgress(response, res, targetServerId, model, 'copy');
  } catch (error) {
    logger.error(`Failed to copy model ${model} to server ${targetServerId}:`, { error });

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Failed to copy model',
        details: error instanceof Error ? error.message : String(error),
      });
    } else {
      const errorEvent = safeJsonStringify({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      res.write(`data: ${errorEvent}\n\n`);
      res.end();
    }
  }
}

/**
 * Get fleet-wide model statistics
 * GET /api/orchestrator/models/fleet-stats
 */
export function getFleetModelStats(req: Request, res: Response): void {
  try {
    const orchestrator = getOrchestratorInstance();
    const servers = orchestrator.getServers();
    const healthyServers = servers.filter(s => s.healthy);

    // Count model occurrences across fleet
    const modelStats: Record<
      string,
      {
        count: number;
        servers: string[];
        lastModified?: string;
        totalSize?: number;
      }
    > = {};

    for (const server of healthyServers) {
      for (const model of server.models) {
        if (!modelStats[model]) {
          modelStats[model] = {
            count: 0,
            servers: [],
          };
        }
        modelStats[model].count++;
        modelStats[model].servers.push(server.url);
      }
    }

    // Convert to array and sort by popularity
    const popularModels = Object.entries(modelStats)
      .map(([name, stats]) => ({
        name,
        serverCount: stats.count,
        percentage: Math.round((stats.count / healthyServers.length) * 100),
        servers: stats.servers,
      }))
      .sort((a, b) => b.serverCount - a.serverCount)
      .slice(0, 15); // Top 15

    res.status(200).json({
      success: true,
      totalServers: servers.length,
      healthyServers: healthyServers.length,
      totalUniqueModels: Object.keys(modelStats).length,
      popularModels,
    });
  } catch (error) {
    logger.error('Failed to get fleet model stats:', { error });
    res.status(500).json({
      error: 'Failed to get fleet model stats',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
