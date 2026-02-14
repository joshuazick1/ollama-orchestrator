/**
 * modelController.ts
 * Model management controllers for warmup and status
 */

import type { Request, Response } from 'express';

import { getModelManager } from '../model-manager-instance.js';
import { getOrchestratorInstance } from '../orchestrator-instance.js';
import { logger } from '../utils/logger.js';

/**
 * Warmup a model on specified or all servers
 * POST /api/orchestrator/models/:model/warmup
 */
export async function warmupModel(req: Request, res: Response): Promise<void> {
  const model = req.params.model as string;
  const { servers, priority = 'normal' } = (req.body ?? {}) as {
    servers?: string[];
    priority?: string;
  };

  if (!model) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  const modelManager = getModelManager();
  const orchestrator = getOrchestratorInstance();

  // Get target servers
  const targetServers: string[] = servers ?? orchestrator.getServers().map(s => s.id);

  if (targetServers.length === 0) {
    res.status(400).json({ error: 'No servers available for warmup' });
    return;
  }

  try {
    // Ensure all servers are registered with model manager
    for (const server of orchestrator.getServers()) {
      modelManager.registerServer(server);
    }

    const result = await modelManager.warmupModel(model, {
      serverIds: targetServers,
      priority: priority as 'low' | 'normal' | 'high',
    });

    res.status(200).json({
      success: true,
      model,
      jobs: result.jobs.map(job => ({
        serverId: job.serverId,
        status: job.status,
        estimatedTime: job.estimatedTime,
        loadTime: job.loadTime,
      })),
      summary: {
        totalServers: result.totalServers,
        loadedOn: result.loadedOn,
        loadingOn: result.loadingOn,
        failedOn: result.failedOn,
      },
    });
  } catch (error) {
    logger.error('Failed to warmup model:', error);
    res.status(500).json({
      error: 'Failed to warmup model',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get warmup status for a model across all servers
 * GET /api/orchestrator/models/:model/status
 */
export function getModelStatus(req: Request, res: Response): void {
  const model = req.params.model as string;

  if (!model) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  const modelManager = getModelManager();
  const orchestrator = getOrchestratorInstance();

  // Register all servers
  for (const server of orchestrator.getServers()) {
    modelManager.registerServer(server);
  }

  const status = modelManager.getModelWarmupStatus(model);

  res.status(200).json({
    success: true,
    model,
    status: {
      totalServers: status.totalServers,
      loadedOn: status.loadedOn,
      loadingOn: status.loadingOn,
      notLoadedOn: status.notLoadedOn,
      failedOn: status.failedOn,
    },
    servers: status.servers,
  });
}

/**
 * Get model loading summary across all servers
 * GET /api/orchestrator/models/status
 */
export function getAllModelsStatus(req: Request, res: Response): void {
  const modelManager = getModelManager();
  const orchestrator = getOrchestratorInstance();

  // Register all servers
  for (const server of orchestrator.getServers()) {
    modelManager.registerServer(server);
  }

  const summary = modelManager.getSummary();
  const models = orchestrator.getAllModels();

  // Get status for each model
  const modelStatuses: Record<string, ReturnType<typeof modelManager.getModelWarmupStatus>> = {};
  for (const model of models) {
    modelStatuses[model] = modelManager.getModelWarmupStatus(model);
  }

  res.status(200).json({
    success: true,
    summary,
    models: modelStatuses,
  });
}

/**
 * Get recommended models to warmup based on usage
 * GET /api/orchestrator/models/recommendations
 */
export function getWarmupRecommendations(req: Request, res: Response): void {
  const modelManager = getModelManager();
  const orchestrator = getOrchestratorInstance();

  // Register all servers
  for (const server of orchestrator.getServers()) {
    modelManager.registerServer(server);
  }

  const recommendations = modelManager.getRecommendedWarmupModels();

  res.status(200).json({
    success: true,
    recommendations: recommendations.map(model => ({
      model,
      reason: 'High usage pattern detected',
    })),
    count: recommendations.length,
  });
}

/**
 * Unload a model from a server to free up memory
 * POST /api/orchestrator/models/:model/unload
 */
export async function unloadModel(req: Request, res: Response): Promise<void> {
  const model = req.params.model as string;
  const { serverId } = (req.body ?? {}) as { serverId?: string };

  if (!model) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  const modelManager = getModelManager();
  const orchestrator = getOrchestratorInstance();

  // Register all servers
  for (const server of orchestrator.getServers()) {
    modelManager.registerServer(server);
  }

  const targetServers: string[] = serverId
    ? [serverId]
    : modelManager.getServersWithModelLoaded(model);

  if (targetServers.length === 0) {
    res.status(404).json({
      error: `Model '${model}' is not loaded on any server`,
    });
    return;
  }

  const results: Array<{ serverId: string; success: boolean }> = [];

  for (const sid of targetServers) {
    const success = await modelManager.unloadModel(sid, model);
    results.push({ serverId: sid, success });
  }

  const successful = results.filter(r => r.success).length;

  res.status(200).json({
    success: true,
    model,
    results,
    summary: {
      totalServers: targetServers.length,
      successfullyUnloaded: successful,
      failed: targetServers.length - successful,
    },
  });
}

/**
 * Cancel warmup for a model
 * POST /api/orchestrator/models/:model/cancel
 */
export function cancelWarmup(req: Request, res: Response): void {
  const model = req.params.model as string;
  const { jobId } = (req.body ?? {}) as { jobId?: string };

  if (!model) {
    res.status(400).json({ error: 'Model name is required' });
    return;
  }

  const modelManager = getModelManager();
  const orchestrator = getOrchestratorInstance();

  // Register all servers
  for (const server of orchestrator.getServers()) {
    modelManager.registerServer(server);
  }

  let cancelled = 0;

  if (jobId) {
    // Cancel specific job
    if (modelManager.cancelWarmup(jobId)) {
      cancelled = 1;
    }
  } else {
    // Cancel all warmup jobs for this model
    cancelled = modelManager.cancelModelWarmup(model);
  }

  res.status(200).json({
    success: true,
    model,
    cancelled,
    message:
      cancelled > 0
        ? `Cancelled ${cancelled} warmup job(s) for ${model}`
        : `No active warmup jobs found for ${model}`,
  });
}

/**
 * Get idle models that can be unloaded
 * GET /api/orchestrator/models/idle
 */
export function getIdleModels(req: Request, res: Response): void {
  const { threshold = 1800000 } = req.query;
  const idleThreshold = parseInt(threshold as string, 10) || 1800000;

  const modelManager = getModelManager();
  const orchestrator = getOrchestratorInstance();

  // Register all servers
  for (const server of orchestrator.getServers()) {
    modelManager.registerServer(server);
  }

  const idleModels = modelManager.getIdleModels(idleThreshold);

  res.status(200).json({
    success: true,
    threshold: idleThreshold,
    models: idleModels.map(item => ({
      serverId: item.serverId,
      model: item.model,
      idleTime: item.idleTime,
      idleTimeMinutes: Math.round(item.idleTime / 60000),
    })),
    count: idleModels.length,
  });
}
