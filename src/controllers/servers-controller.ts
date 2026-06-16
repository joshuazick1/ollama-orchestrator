/**
 * serversController.ts
 * Server management controllers
 */

import type { Request, Response } from 'express';

import { serverConfigSchema } from '../config/schema.js';
import { ERROR_MESSAGES } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import { getErrorMessage } from '../utils/error-helpers.js';
import { logger } from '../utils/logger.js';
import { normalizeServerUrl } from '../utils/url-utils.js';
import { parseTupleKey, probeStateToUIState } from '../probe/types.js';

/**
 * Add a new server
 * POST /api/orchestrator/servers/add
 */
export function addServer(req: Request, res: Response): void {
  const result = serverConfigSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({ error: result.error.message });
    return;
  }

  const { id, url, type, maxConcurrency, apiKey } = result.data;

  const orchestrator = getOrchestratorInstance();
  const normalizedUrl = normalizeServerUrl(url);

  orchestrator.addServer({
    id,
    url,
    type,
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
    res.status(500).json({ error: ERROR_MESSAGES.FAILED_TO_UPDATE_SERVER });
  }
}

/**
 * Update server configuration (type, v1Models, forcedCapabilities, endpointOverrides)
 * PATCH /api/orchestrator/servers/:id/config
 */
export function updateServerConfig(req: Request, res: Response): void {
  const id = req.params.id as string;
  const body = (req.body ?? {}) as {
    type?: 'ollama' | 'openai' | 'auto';
    v1Models?: string[];
    forcedCapabilities?: {
      supportsOllama?: boolean;
      supportsV1?: boolean;
      supportsAnthropic?: boolean;
    };
    endpointOverrides?: {
      anthropic_messages?: string;
      anthropic_auth?: {
        headerName?: string;
        headerPrefix?: string;
      };
      modelPrefix?: string;
    };
  };
  const { type, v1Models, forcedCapabilities, endpointOverrides } = body;
  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServers().find(s => s.id === id);
  if (!server) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  const success = orchestrator.updateServer(id, {
    type,
    v1Models,
    forcedCapabilities,
    endpointOverrides,
  });

  if (success) {
    res.status(200).json({
      success: true,
      id,
      type: type ?? server.type,
      v1Models: v1Models ?? server.v1Models,
      forcedCapabilities: forcedCapabilities ?? server.forcedCapabilities,
      endpointOverrides: endpointOverrides ?? server.endpointOverrides,
    });
  } else {
    res.status(500).json({ error: ERROR_MESSAGES.FAILED_TO_UPDATE_SERVER });
  }
}

/**
 * Refresh V1 models for a server by triggering an immediate health check
 * POST /api/orchestrator/servers/:id/refresh-v1-models
 */
export async function refreshServerV1Models(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServers().find(s => s.id === id);
  if (!server) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  // Trigger immediate health check to refresh discoveredV1Models
  await orchestrator.updateServerStatus(server);

  res.status(200).json({
    success: true,
    id,
    discoveredV1Models: server.discoveredV1Models,
  });
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
      recovering: s.recovering ?? false,
      lastResponseTime: s.lastResponseTime,
      models: s.models,
      maxConcurrency: s.maxConcurrency,
      version: s.version,
      supportsOllama: s.supportsOllama,
      supportsV1: s.supportsV1,
      supportsAnthropic: s.supportsAnthropic,
      v1Models: s.v1Models,
      type: s.type,
      apiKey: s.apiKey ? '***REDACTED***' : undefined,
      forcedCapabilities: s.forcedCapabilities,
      endpointOverrides: s.endpointOverrides,
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
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const allStates = probeOrchestrator.getAllStates();

  let healthy = 0;
  for (const [, tupleState] of allStates.entries()) {
    if (tupleState.state === 'HEALTHY') {
      healthy++;
    }
  }

  const globalMetrics = orchestrator.getGlobalMetrics();

  res.status(200).json({
    success: true,
    status: 'healthy',
    uptime: process.uptime(),
    version: '1.0.0',
    servers: orchestrator.getServers().length,
    requestsPerSecond: Math.round(globalMetrics.requestsPerSecond * 100) / 100,
    healthy,
    total: allStates.size,
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
      error: ERROR_MESSAGES.HEALTH_CHECK_FAILED,
      details: getErrorMessage(error),
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
    const probeOrchestrator = orchestrator.getProbeOrchestrator();
    const endpointRegistry = orchestrator.getEndpointRegistry();
    const allStates = probeOrchestrator.getAllStates();

    const breakerArray = Array.from(allStates.entries()).map(([tupleKey, tupleState]) => {
      const { serverId, model, endpoint } = parseTupleKey(tupleKey);
      const lbScore = orchestrator.getLBScoreForServerModel(serverId, model);
      const errorRate =
        tupleState.errorWindow.length > 0
          ? tupleState.errorWindow.length /
            Math.max(1, tupleState.consecutiveSuccesses + tupleState.errorWindow.length)
          : 0;

      return {
        serverId: tupleKey,
        serverIdOnly: serverId,
        model,
        endpoint,
        tupleKey,
        state: tupleState.state,
        uiState: probeStateToUIState(tupleState.state),
        failureCount: tupleState.consecutiveFailures,
        successCount: tupleState.consecutiveSuccesses,
        totalRequestCount: 0,
        blockedRequestCount: 0,
        lastFailure: 0,
        lastSuccess: 0,
        nextRetryAt: tupleState.nextProbeAt,
        halfOpenStartedAt:
          tupleState.state === 'RECOVERING' ? tupleState.lastTransition : undefined,
        errorRate: Math.round(errorRate * 100) / 100,
        errorCounts: {
          retryable: 0,
          'non-retryable': 0,
          transient: 0,
          permanent: 0,
          rateLimited: 0,
        },
        consecutiveSuccesses: tupleState.consecutiveSuccesses,
        modelType: endpointRegistry.isEmbeddingModel(model) ? 'embedding' : 'generation',
        lastFailureReason: tupleState.lastErrorKind ?? undefined,
        lastErrorType: tupleState.lastErrorKind ?? undefined,
        halfOpenAttempts: tupleState.recoveryAttempts,
        activeTestsInProgress: undefined,
        lbScore: lbScore
          ? {
              totalScore: lbScore.totalScore,
              latencyScore: lbScore.breakdown.latencyScore,
              successRateScore: lbScore.breakdown.successRateScore,
              loadScore: lbScore.breakdown.loadScore,
              capacityScore: lbScore.breakdown.capacityScore,
              circuitBreakerScore: lbScore.breakdown.circuitBreakerScore,
              timeoutScore: lbScore.breakdown.timeoutScore,
            }
          : null,
      };
    });

    res.status(200).json({
      success: true,
      circuitBreakers: breakerArray,
    });
  } catch (error) {
    res.status(500).json({
      error: ERROR_MESSAGES.FAILED_TO_GET_CIRCUIT_BREAKER_STATUS,
      details: getErrorMessage(error),
    });
  }
}

/**
 * Get aggregate circuit breaker status per server (fleet-wide view)
 * GET /api/orchestrator/servers/circuit-breakers
 */
export function getServersCircuitBreakers(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  try {
    const probeOrchestrator = orchestrator.getProbeOrchestrator();
    const endpointRegistry = orchestrator.getEndpointRegistry();
    const allStates = probeOrchestrator.getAllStates();

    // Group by serverId, aggregate worst state per server
    const serverBreakers = new Map<
      string,
      {
        serverId: string;
        state: string;
        failureCount: number;
        successCount: number;
        totalRequestCount: number;
        blockedRequestCount: number;
        lastFailure: number;
        lastSuccess: number;
        nextRetryAt: number;
        errorRate: number;
        consecutiveSuccesses: number;
        lastFailureReason: string | undefined;
        halfOpenStartedAt: number | undefined;
        halfOpenAttempts: number | undefined;
        activeTestsInProgress: number | undefined;
        lbScore: {
          totalScore: number;
          latencyScore: number;
          successRateScore: number;
          loadScore: number;
          capacityScore: number;
          circuitBreakerScore: number;
          timeoutScore: number;
        } | null;
      }
    >();

    for (const [tupleKey, tupleState] of allStates.entries()) {
      const { serverId, model } = parseTupleKey(tupleKey);
      const lbScore = orchestrator.getLBScoreForServerModel(serverId, model);
      const errorRate =
        tupleState.errorWindow.length > 0
          ? tupleState.errorWindow.length /
            Math.max(1, tupleState.consecutiveSuccesses + tupleState.errorWindow.length)
          : 0;

      const breakerInfo = {
        serverId,
        state: tupleState.state,
        failureCount: tupleState.consecutiveFailures,
        successCount: tupleState.consecutiveSuccesses,
        totalRequestCount: tupleState.consecutiveSuccesses + tupleState.consecutiveFailures,
        blockedRequestCount: 0,
        lastFailure: tupleState.lastProbeAt,
        lastSuccess: tupleState.lastProbeAt,
        nextRetryAt: tupleState.nextProbeAt,
        errorRate: Math.round(errorRate * 100) / 100,
        consecutiveSuccesses: tupleState.consecutiveSuccesses,
        lastFailureReason: tupleState.lastErrorKind ?? undefined,
        halfOpenStartedAt:
          tupleState.state === 'RECOVERING' ? tupleState.lastTransition : undefined,
        halfOpenAttempts: tupleState.recoveryAttempts,
        activeTestsInProgress: undefined,
        lbScore: lbScore
          ? {
              totalScore: lbScore.totalScore,
              latencyScore: lbScore.breakdown.latencyScore,
              successRateScore: lbScore.breakdown.successRateScore,
              loadScore: lbScore.breakdown.loadScore,
              capacityScore: lbScore.breakdown.capacityScore,
              circuitBreakerScore: lbScore.breakdown.circuitBreakerScore,
              timeoutScore: lbScore.breakdown.timeoutScore,
            }
          : null,
      };

      const existing = serverBreakers.get(serverId);
      if (existing) {
        // Aggregate: worst state wins (UNHEALTHY > RECOVERING > SUSPECT > HEALTHY)
        const statePriority: Record<string, number> = {
          UNHEALTHY: 4,
          RECOVERING: 3,
          SUSPECT: 2,
          HEALTHY: 1,
        };
        const existingPriority = statePriority[existing.state] || 0;
        const newPriority = statePriority[breakerInfo.state] || 0;

        if (newPriority > existingPriority) {
          existing.state = breakerInfo.state;
        }
        if (breakerInfo.failureCount > existing.failureCount) {
          existing.failureCount = breakerInfo.failureCount;
        }
        if (breakerInfo.errorRate > existing.errorRate) {
          existing.errorRate = breakerInfo.errorRate;
        }
      } else {
        serverBreakers.set(serverId, breakerInfo);
      }
    }

    const result: Record<string, any> = {};
    for (const [serverId, info] of serverBreakers) {
      result[serverId] = info;
    }

    res.status(200).json({
      success: true,
      circuitBreakers: result,
    });
  } catch (error) {
    res.status(500).json({
      error: ERROR_MESSAGES.FAILED_TO_GET_CIRCUIT_BREAKER_STATUS,
      details: getErrorMessage(error),
    });
  }
}

export function getCircuitBreakersByModel(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  try {
    const probeOrchestrator = orchestrator.getProbeOrchestrator();
    const endpointRegistry = orchestrator.getEndpointRegistry();
    const allStates = probeOrchestrator.getAllStates();
    const modelBreakers = new Map<string, any[]>();

    for (const [tupleKey, tupleState] of allStates.entries()) {
      const { serverId, model, endpoint } = parseTupleKey(tupleKey);
      const lbScore = orchestrator.getLBScoreForServerModel(serverId, model);
      const errorRate =
        tupleState.errorWindow.length > 0
          ? tupleState.errorWindow.length /
            Math.max(1, tupleState.consecutiveSuccesses + tupleState.errorWindow.length)
          : 0;

      const breakerInfo: any = {
        serverId,
        state: tupleState.state,
        uiState: probeStateToUIState(tupleState.state),
        failureCount: tupleState.consecutiveFailures,
        successCount: tupleState.consecutiveSuccesses,
        totalRequestCount: 0,
        blockedRequestCount: 0,
        lastFailure: 0,
        lastSuccess: 0,
        nextRetryAt: tupleState.nextProbeAt,
        errorRate: Math.round(errorRate * 100) / 100,
        consecutiveSuccesses: tupleState.consecutiveSuccesses,
        lastFailureReason: tupleState.lastErrorKind ?? undefined,
        halfOpenStartedAt:
          tupleState.state === 'RECOVERING' ? tupleState.lastTransition : undefined,
        halfOpenAttempts: tupleState.recoveryAttempts,
        activeTestsInProgress: undefined,
        model,
        endpoint,
        lbScore: lbScore
          ? {
              totalScore: lbScore.totalScore,
              latencyScore: lbScore.breakdown.latencyScore,
              successRateScore: lbScore.breakdown.successRateScore,
              loadScore: lbScore.breakdown.loadScore,
              capacityScore: lbScore.breakdown.capacityScore,
              circuitBreakerScore: lbScore.breakdown.circuitBreakerScore,
              timeoutScore: lbScore.breakdown.timeoutScore,
            }
          : null,
      };

      const existing = modelBreakers.get(model);
      if (existing) {
        existing.push(breakerInfo);
      } else {
        modelBreakers.set(model, [breakerInfo]);
      }
    }

    const result: Record<string, any[]> = {};
    for (const [model, breakers] of modelBreakers) {
      result[model] = breakers;
    }

    res.status(200).json({
      success: true,
      models: result,
    });
  } catch (error) {
    res.status(500).json({
      error: ERROR_MESSAGES.FAILED_TO_GET_CIRCUIT_BREAKER_STATUS,
      details: getErrorMessage(error),
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
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const recoveryDriver = orchestrator.getRecoveryDriver();
  const decodedModel = decodeURIComponent(model);

  try {
    const activeEndpoints = endpointRegistry.getActiveEndpoints(serverId, decodedModel);
    if (activeEndpoints.length === 0) {
      res.status(404).json({
        success: false,
        error: `No active endpoints found for ${serverId}:${decodedModel}`,
      });
      return;
    }

    await recoveryDriver.tick();

    const tupleKey = `${serverId}:${decodedModel}:${activeEndpoints[0]}`;
    const tupleState = probeOrchestrator.getTupleState({
      serverId,
      model: decodedModel,
      endpoint: activeEndpoints[0],
    });

    res.status(200).json({
      success: true,
      message: `Recovery test initiated for ${serverId}:${decodedModel}`,
      breakerState: tupleState?.state ?? 'UNKNOWN',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Manual recovery test failed',
      details: getErrorMessage(error),
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
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const allStates = probeOrchestrator.getAllStates();
  const decodedModel = decodeURIComponent(model);

  const matchingTuples: Array<{
    tupleKey: string;
    tupleState: ReturnType<typeof probeOrchestrator.getAllStates> extends Map<string, infer T>
      ? T
      : never;
  }> = [];

  for (const [tupleKey, tupleState] of allStates.entries()) {
    const parsed = parseTupleKey(tupleKey);
    if (parsed.serverId === serverId && parsed.model === decodedModel) {
      matchingTuples.push({ tupleKey, tupleState });
    }
  }

  if (matchingTuples.length === 0) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  const { tupleKey, tupleState } = matchingTuples[0];
  const { endpoint } = parseTupleKey(tupleKey);
  const lbScore = orchestrator.getLBScoreForServerModel(serverId, decodedModel);
  const errorRate =
    tupleState.errorWindow.length > 0
      ? tupleState.errorWindow.length /
        Math.max(1, tupleState.consecutiveSuccesses + tupleState.errorWindow.length)
      : 0;

  res.status(200).json({
    success: true,
    serverId,
    model: decodedModel,
    circuitBreaker: {
      name: tupleKey,
      serverId: tupleKey,
      serverIdOnly: serverId,
      model: decodedModel,
      endpoint,
      tupleKey,
      state: tupleState.state,
      uiState: probeStateToUIState(tupleState.state),
      failureCount: tupleState.consecutiveFailures,
      successCount: tupleState.consecutiveSuccesses,
      totalRequestCount: 0,
      blockedRequestCount: 0,
      lastFailure: 0,
      lastSuccess: 0,
      nextRetryAt: tupleState.nextProbeAt,
      halfOpenStartedAt: tupleState.state === 'RECOVERING' ? tupleState.lastTransition : undefined,
      errorRate: Math.round(errorRate * 100) / 100,
      errorCounts: {
        retryable: 0,
        'non-retryable': 0,
        transient: 0,
        permanent: 0,
        rateLimited: 0,
      },
      consecutiveSuccesses: tupleState.consecutiveSuccesses,
      modelType: endpointRegistry.isEmbeddingModel(decodedModel) ? 'embedding' : 'generation',
      lastFailureReason: tupleState.lastErrorKind ?? undefined,
      lastErrorType: tupleState.lastErrorKind ?? undefined,
      halfOpenAttempts: tupleState.recoveryAttempts,
      activeTestsInProgress: undefined,
      errorRatePercent: Math.round(errorRate * 10000) / 100,
      lbScore: lbScore
        ? {
            totalScore: lbScore.totalScore,
            latencyScore: lbScore.breakdown.latencyScore,
            successRateScore: lbScore.breakdown.successRateScore,
            loadScore: lbScore.breakdown.loadScore,
            capacityScore: lbScore.breakdown.capacityScore,
            circuitBreakerScore: lbScore.breakdown.circuitBreakerScore,
            timeoutScore: lbScore.breakdown.timeoutScore,
          }
        : null,
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
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const decodedModel = decodeURIComponent(model);

  const activeEndpoints = endpointRegistry.getActiveEndpoints(serverId, decodedModel);
  if (activeEndpoints.length === 0) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  for (const endpoint of activeEndpoints) {
    probeOrchestrator.setStateForTesting({ serverId, model: decodedModel, endpoint }, 'UNHEALTHY');
  }

  logger.info('admin_force_breaker', {
    adminUserId: req.user?.id ?? 'unknown',
    action: 'force_open',
    serverId,
    model: decodedModel,
    timestamp: new Date().toISOString(),
  });

  const tupleKey = `${serverId}:${decodedModel}:${activeEndpoints[0]}`;
  const tupleState = probeOrchestrator.getTupleState({
    serverId,
    model: decodedModel,
    endpoint: activeEndpoints[0],
  });

  res.status(200).json({
    success: true,
    message: `Circuit breaker force-opened for ${serverId}:${decodedModel}`,
    circuitBreaker: {
      name: `${serverId}:${decodedModel}`,
      state: 'UNHEALTHY',
      uiState: 'OPEN',
      tupleKey,
      tupleState,
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
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const decodedModel = decodeURIComponent(model);

  const activeEndpoints = endpointRegistry.getActiveEndpoints(serverId, decodedModel);
  if (activeEndpoints.length === 0) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  for (const endpoint of activeEndpoints) {
    probeOrchestrator.setStateForTesting({ serverId, model: decodedModel, endpoint }, 'HEALTHY');
  }

  logger.info('admin_force_breaker', {
    adminUserId: req.user?.id ?? 'unknown',
    action: 'force_close',
    serverId,
    model: decodedModel,
    timestamp: new Date().toISOString(),
  });

  const tupleKey = `${serverId}:${decodedModel}:${activeEndpoints[0]}`;
  const tupleState = probeOrchestrator.getTupleState({
    serverId,
    model: decodedModel,
    endpoint: activeEndpoints[0],
  });

  res.status(200).json({
    success: true,
    message: `Circuit breaker force-closed for ${serverId}:${decodedModel}`,
    circuitBreaker: {
      name: `${serverId}:${decodedModel}`,
      state: 'HEALTHY',
      uiState: 'CLOSED',
      tupleKey,
      tupleState,
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
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const decodedModel = decodeURIComponent(model);

  const activeEndpoints = endpointRegistry.getActiveEndpoints(serverId, decodedModel);
  if (activeEndpoints.length === 0) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  for (const endpoint of activeEndpoints) {
    probeOrchestrator.setStateForTesting({ serverId, model: decodedModel, endpoint }, 'RECOVERING');
  }

  logger.info('admin_force_breaker', {
    adminUserId: req.user?.id ?? 'unknown',
    action: 'force_half_open',
    serverId,
    model: decodedModel,
    timestamp: new Date().toISOString(),
  });

  const tupleKey = `${serverId}:${decodedModel}:${activeEndpoints[0]}`;
  const tupleState = probeOrchestrator.getTupleState({
    serverId,
    model: decodedModel,
    endpoint: activeEndpoints[0],
  });

  res.status(200).json({
    success: true,
    message: `Circuit breaker force-half-open for ${serverId}:${decodedModel}`,
    circuitBreaker: {
      name: `${serverId}:${decodedModel}`,
      state: 'RECOVERING',
      uiState: 'HALF-OPEN',
      tupleKey,
      tupleState,
    },
  });
}

/**
 * Get aggregate circuit breaker status for a specific server
 * GET /api/orchestrator/servers/:serverId/circuit-breaker
 */
export function getServerCircuitBreaker(req: Request, res: Response): void {
  const serverId = req.params.serverId as string;

  if (!serverId) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const allStates = probeOrchestrator.getAllStates();

  const serverTuples: Array<{
    tupleKey: string;
    tupleState: ReturnType<typeof probeOrchestrator.getAllStates> extends Map<string, infer T>
      ? T
      : never;
  }> = [];

  for (const [tupleKey, tupleState] of allStates.entries()) {
    const parsed = parseTupleKey(tupleKey);
    if (parsed.serverId === serverId) {
      serverTuples.push({ tupleKey, tupleState });
    }
  }

  if (serverTuples.length === 0) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, 'server') });
    return;
  }

  const statePriority: Record<string, number> = {
    UNHEALTHY: 4,
    RECOVERING: 3,
    SUSPECT: 2,
    HEALTHY: 1,
  };

  let worstState = 'HEALTHY';
  let worstPriority = 1;
  let totalFailureCount = 0;
  let totalSuccessCount = 0;
  let totalErrorRate = 0;

  for (const { tupleState } of serverTuples) {
    const priority = statePriority[tupleState.state] || 0;
    if (priority > worstPriority) {
      worstPriority = priority;
      worstState = tupleState.state;
    }
    totalFailureCount += tupleState.consecutiveFailures;
    totalSuccessCount += tupleState.consecutiveSuccesses;
    const errorRate =
      tupleState.errorWindow.length > 0
        ? tupleState.errorWindow.length /
          Math.max(1, tupleState.consecutiveSuccesses + tupleState.errorWindow.length)
        : 0;
    totalErrorRate += errorRate;
  }

  const avgErrorRate = serverTuples.length > 0 ? totalErrorRate / serverTuples.length : 0;
  const lbScore = orchestrator.getLBScoreForServerModel(serverId, '');

  res.status(200).json({
    success: true,
    serverId,
    state: worstState,
    uiState: probeStateToUIState(worstState as any),
    tupleCount: serverTuples.length,
    failureCount: totalFailureCount,
    successCount: totalSuccessCount,
    totalRequestCount: totalFailureCount + totalSuccessCount,
    blockedRequestCount: 0,
    lastFailure: 0,
    lastSuccess: 0,
    nextRetryAt: 0,
    errorRate: Math.round(avgErrorRate * 100) / 100,
    consecutiveSuccesses: totalSuccessCount,
    lastFailureReason: undefined,
    halfOpenStartedAt: undefined,
    halfOpenAttempts: undefined,
    activeTestsInProgress: undefined,
    lbScore: lbScore
      ? {
          totalScore: lbScore.totalScore,
          latencyScore: lbScore.breakdown.latencyScore,
          successRateScore: lbScore.breakdown.successRateScore,
          loadScore: lbScore.breakdown.loadScore,
          capacityScore: lbScore.breakdown.capacityScore,
          circuitBreakerScore: lbScore.breakdown.circuitBreakerScore,
          timeoutScore: lbScore.breakdown.timeoutScore,
        }
      : null,
  });
}

/**
 * Reset all circuit breakers for a specific server
 * POST /api/orchestrator/servers/:serverId/circuit-breaker/reset
 */
export function resetServerCircuitBreaker(req: Request, res: Response): void {
  const serverId = req.params.serverId as string;
  if (!serverId) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const allStates = probeOrchestrator.getAllStates();

  let resetCount = 0;
  for (const [tupleKey] of allStates.entries()) {
    const parsed = parseTupleKey(tupleKey);
    if (parsed.serverId === serverId) {
      probeOrchestrator.resetTuple({ serverId, model: parsed.model, endpoint: parsed.endpoint });
      resetCount++;
    }
  }

  logger.info('admin_reset_server_circuit_breakers', {
    adminUserId: req.user?.id ?? 'unknown',
    serverId,
    resetCount,
    timestamp: new Date().toISOString(),
  });

  res.status(200).json({
    success: true,
    message: `Reset ${resetCount} circuit breaker(s) for server ${serverId}`,
    resetCount,
  });
}
