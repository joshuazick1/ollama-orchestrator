/**
 * modelController.ts
 * Model management controllers for warmup and status
 */

import type { Request, Response } from 'express';

import { ERROR_MESSAGES } from '../constants/index.js';
import { getModelManager } from '../model-manager.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { getErrorMessage } from '../utils/error-helpers.js';
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
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_NAME_REQUIRED });
    return;
  }

  const modelManager = getModelManager();
  const orchestrator = getOrchestratorInstance();

  // Get target servers
  const targetServers: string[] = servers ?? orchestrator.getServers().map(s => s.id);

  if (targetServers.length === 0) {
    res.status(400).json({ error: ERROR_MESSAGES.NO_SERVERS_FOR_WARMUP });
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
      details: getErrorMessage(error),
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
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_NAME_REQUIRED });
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
 * Get capability probe status across all servers from EndpointRegistry
 * GET /api/orchestrator/models/status
 */
export function getAllModelsStatus(req: Request, res: Response): void {
  try {
    const orchestrator = getOrchestratorInstance();
    const endpointRegistry = orchestrator.getEndpointRegistry();
    const servers = orchestrator.getServers();

    const modelStatuses: Array<{
      serverId: string;
      model: string;
      status: 'confirmed' | 'revoked' | 'pending' | 'rate_limited';
      lastProbeAt: number;
      confidence: number;
      endpoints: string[];
    }> = [];

    for (const server of servers) {
      const caps = endpointRegistry.getCapabilities(server.id);
      const endpointNames: string[] = [];
      let confirmedCount = 0;
      let revokedCount = 0;
      let lastProbeAt = 0;

      for (const [_endpoint, cap] of caps.entries()) {
        endpointNames.push(cap.endpoint);
        if (cap.confirmed) {
          confirmedCount++;
        } else if (cap.failureCount > 0) {
          revokedCount++;
        }
        if (cap.lastSeen > lastProbeAt) {
          lastProbeAt = cap.lastSeen;
        }
      }

      // Determine the overall status for this server
      let status: 'confirmed' | 'revoked' | 'pending' | 'rate_limited';
      if (confirmedCount > 0) {
        status = 'confirmed';
      } else if (revokedCount > 0) {
        status = 'revoked';
      } else {
        status = 'pending';
      }

      modelStatuses.push({
        serverId: server.id,
        model: 'capability',
        status,
        lastProbeAt,
        confidence: confirmedCount / Math.max(endpointNames.length, 1),
        endpoints: endpointNames,
      });
    }

    const confirmed = modelStatuses.filter(m => m.status === 'confirmed').length;
    const revoked = modelStatuses.filter(m => m.status === 'revoked').length;
    const pending = modelStatuses.filter(m => m.status === 'pending').length;

    res.status(200).json({
      success: true,
      summary: {
        totalServers: servers.length,
        totalCapabilities: modelStatuses.length,
        confirmed,
        revoked,
        pending,
      },
      models: modelStatuses,
    });
  } catch (err) {
    logger.warn('[model-controller] Failed to get models status', { error: String(err) });
    res.status(500).json({ error: 'Failed to get models status' });
  }
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
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_NAME_REQUIRED });
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
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_NAME_REQUIRED });
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
  const parsed = parseInt(threshold as string, 10);
  const idleThreshold = !isNaN(parsed) && parsed >= 0 ? parsed : 1800000;

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
