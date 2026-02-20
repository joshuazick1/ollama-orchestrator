/**
 * serversController.ts
 * Server management controllers
 */

import type { Request, Response } from 'express';

import { ERROR_MESSAGES } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator-instance.js';
import { normalizeServerUrl, areUrlsEquivalent } from '../utils/urlUtils.js';

/**
 * Add a new server
 * POST /api/orchestrator/servers/add
 */
export function addServer(req: Request, res: Response): void {
  const body = (req.body ?? {}) as {
    id?: string;
    url?: string;
    maxConcurrency?: number;
    apiKey?: string;
  };
  const { id, url, maxConcurrency, apiKey } = body;

  if (!id || !url) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_URL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const normalizedUrl = normalizeServerUrl(url);

  // Check for duplicates by ID
  if (orchestrator.getServers().some(s => s.id === id)) {
    res.status(409).json({ error: ERROR_MESSAGES.SERVER_ALREADY_EXISTS(id) });
    return;
  }

  // Check for duplicates by URL (using normalized comparison)
  const existingByUrl = orchestrator
    .getServers()
    .find(s => areUrlsEquivalent(s.url, normalizedUrl));
  if (existingByUrl) {
    res.status(409).json({
      error: `A server with equivalent URL already exists`,
      existingServerId: existingByUrl.id,
      existingUrl: existingByUrl.url,
      requestedUrl: url,
      normalizedUrl: normalizedUrl,
    });
    return;
  }

  orchestrator.addServer({
    id,
    url,
    type: 'ollama',
    maxConcurrency,
    apiKey,
  });

  res.status(200).json({
    success: true,
    id,
    url: normalizedUrl, // Return the normalized URL
    maxConcurrency: maxConcurrency ?? 4,
  });
}

/**
 * Remove a server
 * DELETE /api/orchestrator/servers/:id
 */
export function removeServer(req: Request, res: Response): void {
  const id = req.params.id as string;
  const orchestrator = getOrchestratorInstance();

  if (!orchestrator.getServers().some(s => s.id === id)) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  orchestrator.removeServer(id);
  res.status(200).json({ success: true, id });
}

/**
 * Update server configuration
 * PATCH /api/orchestrator/servers/:id
 */
export function updateServer(req: Request, res: Response): void {
  const id = req.params.id as string;
  const body = (req.body ?? {}) as { maxConcurrency?: number };
  const { maxConcurrency } = body;
  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServers().find(s => s.id === id);
  if (!server) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  const success = orchestrator.updateServer(id, { maxConcurrency });

  if (success) {
    res.status(200).json({
      success: true,
      id,
      maxConcurrency: maxConcurrency ?? server.maxConcurrency,
    });
  } else {
    res.status(500).json({ error: 'Failed to update server' });
  }
}

/**
 * Get all servers
 * GET /api/orchestrator/servers
 */
export function getServers(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const servers = orchestrator.getServers();

  res.status(200).json({
    success: true,
    count: servers.length,
    servers: servers.map(s => ({
      id: s.id,
      url: s.url,
      healthy: s.healthy,
      lastResponseTime: s.lastResponseTime,
      models: s.models,
      maxConcurrency: s.maxConcurrency,
      version: s.version,
      supportsOllama: s.supportsOllama,
      supportsV1: s.supportsV1,
      v1Models: s.v1Models,
      apiKey: s.apiKey ? '***REDACTED***' : undefined,
    })),
  });
}

/**
 * Get model-to-servers mapping
 * GET /api/orchestrator/model-map
 */
export function getModelMap(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const servers = orchestrator.getServers();
  const modelMap = orchestrator.getModelMap();

  const serverToModels: Record<string, string[]> = {};
  for (const server of servers) {
    serverToModels[server.id] = [...server.models];
  }

  res.status(200).json({
    success: true,
    modelToServers: modelMap,
    serverToModels,
    totalModels: Object.keys(modelMap).length,
    totalServers: servers.length,
  });
}

/**
 * Get all models
 * GET /api/orchestrator/models
 */
export function getModels(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const models = orchestrator.getAllModels();

  res.status(200).json({
    success: true,
    count: models.length,
    models: models.sort(),
  });
}

/**
 * Get basic health status
 * GET /api/orchestrator/health
 */
export function getHealth(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const globalMetrics = orchestrator.getGlobalMetrics();

  res.status(200).json({
    success: true,
    status: 'healthy',
    uptime: process.uptime(),
    version: '1.0.0',
    servers: orchestrator.getServers().length,
    requestsPerSecond: Math.round(globalMetrics.requestsPerSecond * 100) / 100,
  });
}

/**
 * Trigger health check for all servers
 * POST /api/orchestrator/health-check
 */
export async function healthCheck(req: Request, res: Response): Promise<void> {
  const orchestrator = getOrchestratorInstance();

  try {
    await orchestrator.updateAllStatus();
    const servers = orchestrator.getServers();

    res.status(200).json({
      success: true,
      servers: servers.map(s => ({
        id: s.id,
        healthy: s.healthy,
        lastResponseTime: s.lastResponseTime,
        models: s.models.length,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Health check failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get orchestrator statistics
 * GET /api/orchestrator/stats
 */
export function getStats(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const stats = orchestrator.getStats();

  res.status(200).json({
    success: true,
    stats,
  });
}

/**
 * Get circuit breaker status
 * GET /api/orchestrator/circuit-breakers
 */
export function getCircuitBreakers(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  try {
    const circuitBreakers = orchestrator.getCircuitBreakerStats();

    // Convert to array format for API response
    const breakerArray = Object.entries(circuitBreakers).map(([name, stats]) => ({
      serverId: name, // Use full breaker key (server:model) as serverId for frontend grouping
      state: stats.state.toUpperCase(),
      failureCount: stats.failureCount,
      successCount: stats.successCount,
      totalRequestCount: stats.totalRequestCount || 0,
      blockedRequestCount: stats.blockedRequestCount || 0,
      lastFailure: stats.lastFailure,
      lastSuccess: stats.lastSuccess,
      nextRetryAt: stats.nextRetryAt,
      errorRate: Math.round(stats.errorRate * 100) / 100, // Round to 2 decimal places
      errorCounts: stats.errorCounts,
      consecutiveSuccesses: stats.consecutiveSuccesses,
      modelType: stats.modelType,
      lastFailureReason: stats.lastFailureReason,
      halfOpenStartedAt: stats.halfOpenStartedAt,
      halfOpenAttempts: stats.halfOpenAttempts,
      lastErrorType: stats.lastErrorType,
      activeTestsInProgress: stats.activeTestsInProgress,
    }));

    res.status(200).json({
      success: true,
      circuitBreakers: breakerArray,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get circuit breaker status',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get all permanent bans
 * GET /api/orchestrator/bans
 */
export function getBans(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const banDetails = orchestrator.getBanDetails();

  res.status(200).json({
    success: true,
    count: banDetails.length,
    bans: banDetails,
  });
}

/**
 * Remove a specific ban
 * DELETE /api/orchestrator/bans/:serverId/:model
 */
export function removeBan(req: Request, res: Response): void {
  const serverId = req.params.serverId as string;
  const model = req.params.model as string;

  if (!serverId || !model) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const removed = orchestrator.unban(serverId, decodeURIComponent(model));

  if (removed) {
    res.status(200).json({
      success: true,
      message: `Ban removed for ${serverId}:${model}`,
    });
  } else {
    res.status(404).json({
      error: `No ban found for ${serverId}:${model}`,
    });
  }
}

/**
 * Remove all bans for a server
 * DELETE /api/orchestrator/bans/server/:serverId
 */
export function removeBansByServer(req: Request, res: Response): void {
  const serverId = req.params.serverId as string;

  if (!serverId) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const removed = orchestrator.unbanServer(serverId);

  res.status(200).json({
    success: true,
    removed,
    message:
      removed > 0 ? `Removed ${removed} bans for server ${serverId}` : 'No bans found for server',
  });
}

/**
 * Remove all bans for a model
 * DELETE /api/orchestrator/bans/model/:model
 */
export function removeBansByModel(req: Request, res: Response): void {
  const model = req.params.model as string;

  if (!model) {
    res.status(400).json({ error: ERROR_MESSAGES.MODEL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const removed = orchestrator.unbanModel(decodeURIComponent(model));

  res.status(200).json({
    success: true,
    removed,
    message: removed > 0 ? `Removed ${removed} bans for model ${model}` : 'No bans found for model',
  });
}

/**
 * Clear all bans
 * DELETE /api/orchestrator/bans
 */
export function clearAllBans(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const removed = orchestrator.clearAllBans();

  res.status(200).json({
    success: true,
    removed,
    message: removed > 0 ? `Cleared ${removed} bans` : 'No bans to clear',
  });
}

/**
 * Manually trigger recovery test for a server:model breaker
 * POST /api/orchestrator/servers/:serverId/models/:model/recovery-test
 */
export async function manualRecoveryTest(req: Request, res: Response): Promise<void> {
  const serverId = req.params.serverId as string;
  const model = req.params.model as string;

  if (!serverId || !model) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();

  try {
    const result = await orchestrator.manualTriggerRecoveryTest(
      serverId,
      decodeURIComponent(model)
    );

    if (result.success) {
      res.status(200).json({
        success: true,
        message: `Recovery test passed for ${serverId}:${model}`,
        breakerState: result.breakerState,
      });
    } else {
      res.status(200).json({
        success: false,
        error: result.error,
        breakerState: result.breakerState,
        message: `Recovery test failed for ${serverId}:${model}`,
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Manual recovery test failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get circuit breaker details for a specific server:model
 * GET /api/orchestrator/servers/:serverId/models/:model/circuit-breaker
 */
export function getCircuitBreakerDetails(req: Request, res: Response): void {
  const serverId = req.params.serverId as string;
  const model = req.params.model as string;

  if (!serverId || !model) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const breaker = orchestrator.getModelCircuitBreakerPublic(serverId, decodeURIComponent(model));

  if (!breaker) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  const stats = breaker.getStats();

  res.status(200).json({
    success: true,
    serverId,
    model,
    circuitBreaker: {
      name: `${serverId}:${model}`,
      ...stats,
      state: stats.state.toUpperCase(),
      errorRatePercent: Math.round(stats.errorRate * 10000) / 100,
    },
  });
}

/**
 * Force open a circuit breaker for a specific server:model
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/open
 */
export function forceOpenBreaker(req: Request, res: Response): void {
  const serverId = req.params.serverId as string;
  const model = req.params.model as string;

  if (!serverId || !model) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const breaker = orchestrator.getModelCircuitBreakerPublic(serverId, decodeURIComponent(model));

  if (!breaker) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  breaker.forceOpen();
  const stats = breaker.getStats();

  res.status(200).json({
    success: true,
    message: `Circuit breaker force-opened for ${serverId}:${model}`,
    circuitBreaker: {
      name: `${serverId}:${model}`,
      ...stats,
      state: stats.state.toUpperCase(),
    },
  });
}

/**
 * Force close (reset) a circuit breaker for a specific server:model
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/close
 */
export function forceCloseBreaker(req: Request, res: Response): void {
  const serverId = req.params.serverId as string;
  const model = req.params.model as string;

  if (!serverId || !model) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const breaker = orchestrator.getModelCircuitBreakerPublic(serverId, decodeURIComponent(model));

  if (!breaker) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  breaker.forceClose();
  const stats = breaker.getStats();

  res.status(200).json({
    success: true,
    message: `Circuit breaker force-closed for ${serverId}:${model}`,
    circuitBreaker: {
      name: `${serverId}:${model}`,
      ...stats,
      state: stats.state.toUpperCase(),
    },
  });
}

/**
 * Force half-open a circuit breaker for a specific server:model
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/half-open
 */
export function forceHalfOpenBreaker(req: Request, res: Response): void {
  const serverId = req.params.serverId as string;
  const model = req.params.model as string;

  if (!serverId || !model) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const breaker = orchestrator.getModelCircuitBreakerPublic(serverId, decodeURIComponent(model));

  if (!breaker) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  breaker.forceHalfOpen();
  const stats = breaker.getStats();

  res.status(200).json({
    success: true,
    message: `Circuit breaker force-half-open for ${serverId}:${model}`,
    circuitBreaker: {
      name: `${serverId}:${model}`,
      ...stats,
      state: stats.state.toUpperCase(),
    },
  });
}
