/**
 * serverModelsController.ts
 * Per-server model management controllers (pull, delete, list)
 */

import type { Request, Response } from 'express';

import { ERROR_MESSAGES } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator-instance.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';
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
    res.status(400).json({ error: `Server '${id}' does not support Ollama model management` });
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
 * Pull a model to a specific server
 * POST /api/orchestrator/servers/:id/models/pull
 */
export async function pullModelToServer(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const body = req.body as ModelRequestBody;
  const rawModel = body?.model;

  if (!rawModel || typeof rawModel !== 'string') {
    res.status(400).json({ error: 'model is required and must be a string' });
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
    res.status(400).json({ error: `Server '${id}' does not support Ollama model management` });
    return;
  }

  logger.info(`Starting model pull: ${model} to server ${id} (${server.url})`);

  try {
    const response = await fetchWithTimeout(`${server.url}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
      timeout: 300000, // 5 minute timeout for model pull
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as OllamaErrorResponse;
      throw new Error(errorData.error ?? `Pull failed: ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaPullResponse;

    // Refresh server models after successful pull
    await orchestrator.updateServerStatus(server);

    logger.info(`Successfully pulled model ${model} to server ${id}`);

    res.status(200).json({
      success: true,
      serverId: id,
      model,
      message: `Model '${model}' pulled successfully`,
      details: data,
    });
  } catch (error) {
    logger.error(`Failed to pull model ${model} to server ${id}:`, { error });
    res.status(500).json({
      error: 'Failed to pull model',
      details: error instanceof Error ? error.message : String(error),
    });
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
    res.status(400).json({ error: 'model parameter is required' });
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
    res.status(400).json({ error: `Server '${id}' does not support Ollama model management` });
    return;
  }

  logger.info(`Deleting model ${model} from server ${id} (${server.url})`);

  try {
    const response = await fetchWithTimeout(`${server.url}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      timeout: 30000, // 30 second timeout for delete
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as OllamaErrorResponse;
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
    res.status(400).json({ error: 'model is required' });
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
    const response = await fetchWithTimeout(`${targetServer.url}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
      timeout: 300000, // 5 minute timeout for model pull/copy
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as OllamaErrorResponse;
      throw new Error(errorData.error ?? `Copy failed: ${response.statusText}`);
    }

    // Refresh server models
    await orchestrator.updateServerStatus(targetServer);

    res.status(200).json({
      success: true,
      serverId: targetServerId,
      model,
      message: `Model '${model}' copied successfully`,
    });
  } catch (error) {
    logger.error(`Failed to copy model ${model} to server ${targetServerId}:`, { error });
    res.status(500).json({
      error: 'Failed to copy model',
      details: error instanceof Error ? error.message : String(error),
    });
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
