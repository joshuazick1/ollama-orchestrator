/**
 * serversController.ts
 * Server management controllers
 */

import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';

import { getConfigManager } from '../config/config.js';
import { serverConfigSchema } from '../config/schema.js';
import { ERROR_MESSAGES } from '../constants/index.js';
import { isInternalAdmin } from '../middleware/auth.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import { testServerCapabilities } from '../orchestrator/test-server-capabilities.js';
import { getTestStore } from '../orchestrator/test-store-instance.js';
import { getCapabilityProbeScheduler } from '../probe/probe-scheduler-instance.js';
import { getPsPollCoordinator } from '../probe/ps-poll-coordinator-instance.js';
import {
  KNOWN_PROBE_ENDPOINTS,
  parseTupleKey,
  probeStateToUIState,
  type ProbeEndpoint,
  type ProbeState,
} from '../probe/types.js';
import { getErrorMessage } from '../utils/error-helpers.js';
import { logger } from '../utils/logger.js';
import { isBlockedUrl } from '../utils/url-safety.js';
import { normalizeServerUrl } from '../utils/url-utils.js';

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
 * Drain a server - marks it as draining to prevent new requests
 * POST /api/orchestrator/servers/:id/drain
 */
export function drainServer(req: Request, res: Response): void {
  const id = req.params.id as string;
  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServer(id);
  if (!server) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  server.draining = true;
  server.drainStartedAt = new Date();
  orchestrator.persistServers();

  logger.info('server_drain', {
    adminUserId: req.user?.id ?? 'unknown',
    serverId: id,
    timestamp: new Date().toISOString(),
  });

  res.status(200).json({
    success: true,
    id,
    draining: true,
    drainStartedAt: server.drainStartedAt,
  });
}

/**
 * Undrain a server - reverses the drain state
 * POST /api/orchestrator/servers/:id/undrain
 */
export function undrainServer(req: Request, res: Response): void {
  const id = req.params.id as string;
  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServer(id);
  if (!server) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  server.draining = false;
  server.drainStartedAt = undefined;
  orchestrator.persistServers();

  logger.info('server_undrain', {
    adminUserId: req.user?.id ?? 'unknown',
    serverId: id,
    timestamp: new Date().toISOString(),
  });

  res.status(200).json({
    success: true,
    id,
    draining: false,
  });
}

/**
 * Set server maintenance mode
 * POST /api/orchestrator/servers/:id/maintenance
 */
export function setMaintenanceMode(req: Request, res: Response): void {
  const id = req.params.id as string;
  const body = req.body as { enabled?: boolean };
  const enabled = body.enabled === true;

  const orchestrator = getOrchestratorInstance();

  const server = orchestrator.getServer(id);
  if (!server) {
    res.status(404).json({ error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  server.maintenance = enabled;
  orchestrator.persistServers();

  logger.info('server_maintenance', {
    adminUserId: req.user?.id ?? 'unknown',
    serverId: id,
    enabled,
    timestamp: new Date().toISOString(),
  });

  res.status(200).json({
    success: true,
    id,
    maintenance: enabled,
  });
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
 * Query params:
 *   - excludeGhosts: if "true", exclude servers with 0 models loaded (per PS poll)
 *   - healthyOnly: if "true", return only healthy servers
 */
export function getServers(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  const excludeGhosts = req.query.excludeGhosts === 'true';
  const healthyOnly = req.query.healthyOnly === 'true';

  const options = {
    excludeGhosts: excludeGhosts || undefined,
    healthyOnly: healthyOnly || undefined,
  };

  const servers = orchestrator.getServers(options);

  const ghostCount = (() => {
    const allHealthy = orchestrator.getServers({ healthyOnly: true });
    const psCoordinator = getPsPollCoordinator();
    return allHealthy.filter(s => psCoordinator.getModelsOnServer(s.id).size === 0).length;
  })();

  res.status(200).json({
    success: true,
    count: servers.length,
    ghostCount,
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
  const servers = orchestrator.getServers();
  const globalMetrics = orchestrator.getGlobalMetrics();

  res.status(200).json({
    success: true,
    status: 'healthy',
    uptime: process.uptime(),
    version: '1.0.0',
    servers: servers.length,
    requestsPerSecond: Math.round(globalMetrics.requestsPerSecond * 100) / 100,
    healthy: servers.filter(s => s.healthy).length,
    total: servers.length,
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
 * Normalize a serverId from probe tuple keys to match actual server IDs.
 * Handles legacy IDs that lack the srv- prefix or use bare base64url encoding.
 * Returns the canonical serverId if found, otherwise returns the original.
 */
function normalizeServerId(serverId: string, servers: AIServer[]): string {
  // If the serverId already exists in our servers, it's already correct
  if (servers.some(s => s.id === serverId)) {
    return serverId;
  }

  // Try to decode a bare base64url serverId and find matching server by URL
  if (serverId.startsWith('srv-')) {
    // Has prefix but doesn't match any server - return as-is (can't fix)
    return serverId;
  }

  // Try to decode as base64url and find server by URL
  try {
    const decoded = Buffer.from(serverId, 'base64url').toString('utf8');
    const decodedUrl = decodeURIComponent(decoded);
    const normalizedDecodedUrl = normalizeServerUrl(decodedUrl);
    const match = servers.find(s => normalizeServerUrl(s.url) === normalizedDecodedUrl);
    if (match) {
      return match.id;
    }
  } catch {
    // Not base64url encoded or other decode error - fall through
  }

  // Try to find server by URL substring match (for partial legacy IDs)
  const partialMatch = servers.find(s => {
    // Try matching URL without protocol
    const urlWithoutProtocol = s.url.replace(/^https?:\/\//, '');
    return serverId.includes(urlWithoutProtocol) || urlWithoutProtocol.includes(serverId);
  });
  if (partialMatch) {
    return partialMatch.id;
  }

  // Could not normalize - return original
  return serverId;
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
    const servers = orchestrator.getServers();

    const breakerArray = Array.from(allStates.entries())
      .filter(([tupleKey]) => tupleKey && typeof tupleKey === 'string' && tupleKey.includes(':'))
      .map(([tupleKey, tupleState]) => {
        const { serverId: rawServerId, model, endpoint } = parseTupleKey(tupleKey);
        // Normalize serverId to match actual server IDs (srv- prefix + base64url format)
        const serverId = normalizeServerId(rawServerId, servers);
        const lbScore = orchestrator.getLBScoreForServerModel(serverId, model);
        const errorRate =
          tupleState.errorWindow.length > 0
            ? tupleState.errorWindow.length /
              Math.max(1, tupleState.consecutiveSuccesses + tupleState.errorWindow.length)
            : 0;

        return {
          serverId,
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

    const byState: Record<string, number> = { OPEN: 0, CLOSED: 0, HALF_OPEN: 0, UNKNOWN: 0 };
    for (const breaker of breakerArray) {
      const raw = breaker.uiState || 'UNKNOWN';
      const state = raw.replace(/-/g, '_');
      if (state in byState) {
        byState[state]++;
      } else {
        byState.UNKNOWN++;
      }
    }

    res.status(200).json({
      success: true,
      circuitBreakers: breakerArray,
      byState,
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
    const allStates = probeOrchestrator.getAllStates();
    const servers = orchestrator.getServers();

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
      const { serverId: rawServerId, model } = parseTupleKey(tupleKey);
      const serverId = normalizeServerId(rawServerId, servers);
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
    const allStates = probeOrchestrator.getAllStates();
    const servers = orchestrator.getServers();
    const modelBreakers = new Map<string, any[]>();

    for (const [tupleKey, tupleState] of allStates.entries()) {
      const { serverId: rawServerId, model, endpoint } = parseTupleKey(tupleKey);
      const serverId = normalizeServerId(rawServerId, servers);
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
export function manualRecoveryTest(req: Request, res: Response): void {
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

    recoveryDriver.tick();

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
 * Optional query param ?endpoint=<ProbeEndpoint> to filter to a single endpoint
 */
export function getCircuitBreakerDetails(req: Request, res: Response): void {
  const serverId = req.params.serverId as string;
  const model = req.params.model as string;
  const endpointFilter = req.query.endpoint as string | undefined;

  if (!serverId || !model) {
    res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
    return;
  }

  const orchestrator = getOrchestratorInstance();
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const endpointRegistry = orchestrator.getEndpointRegistry();
  const allStates = probeOrchestrator.getAllStates();
  const servers = orchestrator.getServers();
  const decodedModel = decodeURIComponent(model);
  const normalizedServerId = normalizeServerId(serverId, servers);

  const matchingTuples: Array<{
    tupleKey: string;
    tupleState: ReturnType<typeof probeOrchestrator.getAllStates> extends Map<string, infer T>
      ? T
      : never;
  }> = [];

  for (const [tupleKey, tupleState] of allStates.entries()) {
    const parsed = parseTupleKey(tupleKey);
    const parsedServerId = normalizeServerId(parsed.serverId, servers);
    if (parsedServerId === normalizedServerId && parsed.model === decodedModel) {
      matchingTuples.push({ tupleKey, tupleState });
    }
  }

  if (matchingTuples.length === 0) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  // Helper to build the structured circuit breaker projection for a single tuple
  const buildTupleProjection = (
    tupleKey: string,
    tupleState: ReturnType<typeof probeOrchestrator.getAllStates> extends Map<string, infer T>
      ? T
      : never
  ) => {
    const { endpoint } = parseTupleKey(tupleKey);
    const lbScore = orchestrator.getLBScoreForServerModel(serverId, decodedModel);
    const errorRate =
      tupleState.errorWindow.length > 0
        ? tupleState.errorWindow.length /
          Math.max(1, tupleState.consecutiveSuccesses + tupleState.errorWindow.length)
        : 0;
    return {
      serverId: normalizedServerId,
      model: decodedModel,
      endpoint,
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
    };
  };

  // When endpoint filter is provided, return the single matching tuple or 404
  if (endpointFilter) {
    const matched = matchingTuples.find(({ tupleKey }) => {
      const { endpoint } = parseTupleKey(tupleKey);
      return endpoint === endpointFilter;
    });
    if (!matched) {
      res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
      return;
    }
    res.status(200).json({
      success: true,
      ...buildTupleProjection(matched.tupleKey, matched.tupleState),
    });
    return;
  }

  // No endpoint filter — return aggregated view with all matching tuples
  const endpoints = matchingTuples.map(({ tupleKey, tupleState }) =>
    buildTupleProjection(tupleKey, tupleState)
  );
  res.status(200).json({
    success: true,
    serverId: normalizedServerId,
    model: decodedModel,
    endpoints,
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
  const servers = orchestrator.getServers();
  const normalizedServerId = normalizeServerId(serverId, servers);
  const decodedModel = decodeURIComponent(model);

  const activeEndpoints = endpointRegistry.getActiveEndpoints(normalizedServerId, decodedModel);
  if (activeEndpoints.length === 0) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  for (const endpoint of activeEndpoints) {
    probeOrchestrator.setStateForTesting(
      { serverId: normalizedServerId, model: decodedModel, endpoint },
      'UNHEALTHY'
    );
  }

  logger.info('admin_force_breaker', {
    adminUserId: req.user?.id ?? 'unknown',
    action: 'force_open',
    serverId: normalizedServerId,
    model: decodedModel,
    timestamp: new Date().toISOString(),
  });

  const tupleKey = `${normalizedServerId}:${decodedModel}:${activeEndpoints[0]}`;
  const tupleState = probeOrchestrator.getTupleState({
    serverId: normalizedServerId,
    model: decodedModel,
    endpoint: activeEndpoints[0],
  });

  res.status(200).json({
    success: true,
    message: `Circuit breaker force-opened for ${normalizedServerId}:${decodedModel}`,
    circuitBreaker: {
      name: `${normalizedServerId}:${decodedModel}`,
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
  const servers = orchestrator.getServers();
  const normalizedServerId = normalizeServerId(serverId, servers);
  const decodedModel = decodeURIComponent(model);

  const activeEndpoints = endpointRegistry.getActiveEndpoints(normalizedServerId, decodedModel);
  if (activeEndpoints.length === 0) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  for (const endpoint of activeEndpoints) {
    probeOrchestrator.setStateForTesting(
      { serverId: normalizedServerId, model: decodedModel, endpoint },
      'HEALTHY'
    );
  }

  logger.info('admin_force_breaker', {
    adminUserId: req.user?.id ?? 'unknown',
    action: 'force_close',
    serverId: normalizedServerId,
    model: decodedModel,
    timestamp: new Date().toISOString(),
  });

  const tupleKey = `${normalizedServerId}:${decodedModel}:${activeEndpoints[0]}`;
  const tupleState = probeOrchestrator.getTupleState({
    serverId: normalizedServerId,
    model: decodedModel,
    endpoint: activeEndpoints[0],
  });

  res.status(200).json({
    success: true,
    message: `Circuit breaker force-closed for ${normalizedServerId}:${decodedModel}`,
    circuitBreaker: {
      name: `${normalizedServerId}:${decodedModel}`,
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
  const servers = orchestrator.getServers();
  const normalizedServerId = normalizeServerId(serverId, servers);
  const decodedModel = decodeURIComponent(model);

  const activeEndpoints = endpointRegistry.getActiveEndpoints(normalizedServerId, decodedModel);
  if (activeEndpoints.length === 0) {
    res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND(serverId, model) });
    return;
  }

  for (const endpoint of activeEndpoints) {
    probeOrchestrator.setStateForTesting(
      { serverId: normalizedServerId, model: decodedModel, endpoint },
      'RECOVERING'
    );
  }

  logger.info('admin_force_breaker', {
    adminUserId: req.user?.id ?? 'unknown',
    action: 'force_half_open',
    serverId: normalizedServerId,
    model: decodedModel,
    timestamp: new Date().toISOString(),
  });

  const tupleKey = `${normalizedServerId}:${decodedModel}:${activeEndpoints[0]}`;
  const tupleState = probeOrchestrator.getTupleState({
    serverId: normalizedServerId,
    model: decodedModel,
    endpoint: activeEndpoints[0],
  });

  res.status(200).json({
    success: true,
    message: `Circuit breaker force-half-open for ${normalizedServerId}:${decodedModel}`,
    circuitBreaker: {
      name: `${normalizedServerId}:${decodedModel}`,
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
  const servers = orchestrator.getServers();
  const normalizedServerId = normalizeServerId(serverId, servers);

  const serverTuples: Array<{
    tupleKey: string;
    tupleState: ReturnType<typeof probeOrchestrator.getAllStates> extends Map<string, infer T>
      ? T
      : never;
  }> = [];

  for (const [tupleKey, tupleState] of allStates.entries()) {
    const parsed = parseTupleKey(tupleKey);
    const parsedServerId = normalizeServerId(parsed.serverId, servers);
    if (parsedServerId === normalizedServerId) {
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

  let worstState: ProbeState = 'HEALTHY';
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

  // Group tuples by model for per-model breakdown
  const modelMap = new Map<string, typeof serverTuples>();
  for (const entry of serverTuples) {
    const { model } = parseTupleKey(entry.tupleKey);
    if (!modelMap.has(model)) {
      modelMap.set(model, []);
    }
    modelMap.get(model)!.push(entry);
  }

  const models: Array<{
    model: string;
    state: ProbeState;
    uiState: 'OPEN' | 'CLOSED' | 'HALF-OPEN' | 'UNKNOWN';
    endpoints: Array<{
      endpoint: ProbeEndpoint;
      state: ProbeState;
      uiState: 'OPEN' | 'CLOSED' | 'HALF-OPEN' | 'UNKNOWN';
    }>;
  }> = [];

  for (const [model, tuples] of modelMap.entries()) {
    let modelWorstState: ProbeState = 'HEALTHY';
    let modelWorstPriority = 1;
    for (const { tupleState } of tuples) {
      const priority = statePriority[tupleState.state] || 0;
      if (priority > modelWorstPriority) {
        modelWorstPriority = priority;
        modelWorstState = tupleState.state;
      }
    }

    const endpoints: Array<{
      endpoint: ProbeEndpoint;
      state: ProbeState;
      uiState: 'OPEN' | 'CLOSED' | 'HALF-OPEN' | 'UNKNOWN';
    }> = [];
    for (const ep of KNOWN_PROBE_ENDPOINTS) {
      const tupleState = probeOrchestrator.getTupleState({
        serverId: normalizedServerId,
        model,
        endpoint: ep,
      });
      const state: ProbeState = tupleState?.state ?? 'HEALTHY';
      endpoints.push({
        endpoint: ep,
        state,
        uiState: probeStateToUIState(state),
      });
    }

    models.push({
      model,
      state: modelWorstState,
      uiState: probeStateToUIState(modelWorstState),
      endpoints,
    });
  }

  res.status(200).json({
    success: true,
    serverId: normalizedServerId,
    state: worstState,
    uiState: probeStateToUIState(worstState),
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
    models,
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
  const servers = orchestrator.getServers();
  const normalizedServerId = normalizeServerId(serverId, servers);

  let resetCount = 0;
  for (const [tupleKey] of allStates.entries()) {
    const parsed = parseTupleKey(tupleKey);
    const parsedServerId = normalizeServerId(parsed.serverId, servers);
    if (parsedServerId === normalizedServerId) {
      probeOrchestrator.resetTuple({
        serverId: normalizedServerId,
        model: parsed.model,
        endpoint: parsed.endpoint,
      });
      resetCount++;
    }
  }

  logger.info('admin_reset_server_circuit_breakers', {
    adminUserId: req.user?.id ?? 'unknown',
    serverId: normalizedServerId,
    resetCount,
    timestamp: new Date().toISOString(),
  });

  res.status(200).json({
    success: true,
    message: `Reset ${resetCount} circuit breaker(s) for server ${normalizedServerId}`,
    resetCount,
  });
}

/**
 * Trigger capability probe for a specific server
 * POST /api/orchestrator/servers/:id/capability-probe
 */
export async function capabilityProbe(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const orchestrator = getOrchestratorInstance();
  const server = orchestrator.getServer(id);

  if (!server) {
    res.status(404).json({ success: false, error: ERROR_MESSAGES.SERVER_NOT_FOUND(id) });
    return;
  }

  const ssrfCheck = await isBlockedUrl(server.url, {
    allowPrivateNetwork:
      getConfigManager().getConfig().capabilityProbe?.allowPrivateNetwork ?? false,
    isAdmin: isInternalAdmin(req),
  });
  if (ssrfCheck.blocked) {
    res
      .status(400)
      .json({ success: false, error: `URL blocked: ${ssrfCheck.reason ?? 'blocked'}` });
    return;
  }

  const capabilityProbeScheduler = getCapabilityProbeScheduler();
  const result = await capabilityProbeScheduler.runOnce(id);

  res.status(200).json({
    success: true,
    serverId: result.serverId,
    confirmed: result.confirmed,
    revoked: result.revoked,
    rateLimited: result.rateLimited,
    errors: result.errors,
  });
}

export async function testConnection(req: Request, res: Response): Promise<void> {
  const {
    url,
    apiKey,
    name: _name,
  } = (req.body ?? {}) as {
    url?: string;
    apiKey?: string;
    name?: string;
  };
  if (!url || typeof url !== 'string') {
    res.status(400).json({ success: false, error: 'url is required' });
    return;
  }
  try {
    new URL(url);
  } catch {
    res.status(400).json({ success: false, error: 'url is required' });
    return;
  }
  const ssrfCheck = await isBlockedUrl(url, {
    allowPrivateNetwork:
      getConfigManager().getConfig().capabilityProbe?.allowPrivateNetwork ?? false,
    isAdmin: isInternalAdmin(req),
  });
  if (ssrfCheck.blocked) {
    res
      .status(400)
      .json({ success: false, error: `URL blocked: ${ssrfCheck.reason ?? 'blocked'}` });
    return;
  }
  const testId = randomUUID();
  const testStore = getTestStore();
  testStore.create(testId);
  void (async () => {
    try {
      testStore.update(testId, { status: 'running', progress: 10 });
      const result = await testServerCapabilities(url, { apiKey });
      testStore.update(testId, { status: 'completed', progress: 100, result });
    } catch (err) {
      testStore.update(testId, {
        status: 'failed',
        progress: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  res.status(200).json({ success: true, testId, status: 'running' });
}

export function getTestResult(req: Request, res: Response): void {
  const { testId } = req.params as { testId?: string };
  if (!testId) {
    res.status(400).json({ success: false, error: 'testId is required' });
    return;
  }
  const testStore = getTestStore();
  const entry = testStore.get(testId);
  if (!entry) {
    res.status(404).json({ success: false, error: 'Test not found or expired' });
    return;
  }
  res.status(200).json({
    success: true,
    testId: entry.testId,
    status: entry.status,
    progress: entry.progress,
    startedAt: entry.startedAt,
    result: entry.result,
    error: entry.error,
  });
}

export async function testExistingServer(req: Request, res: Response): Promise<void> {
  const serverId = req.params.id as string;
  const orchestrator = getOrchestratorInstance();
  const server = orchestrator.getServer(serverId);
  if (!server) {
    res.status(404).json({ success: false, error: ERROR_MESSAGES.SERVER_NOT_FOUND(serverId) });
    return;
  }

  const ssrfCheck = await isBlockedUrl(server.url, {
    allowPrivateNetwork:
      getConfigManager().getConfig().capabilityProbe?.allowPrivateNetwork ?? false,
    isAdmin: isInternalAdmin(req),
  });
  if (ssrfCheck.blocked) {
    res
      .status(400)
      .json({ success: false, error: `URL blocked: ${ssrfCheck.reason ?? 'blocked'}` });
    return;
  }

  try {
    const result = await testServerCapabilities(server.url, {
      apiKey: server.apiKey,
    });
    res.status(200).json({
      success: true,
      serverId,
      status: result.status,
      reachable: result.reachable,
      capabilities: result.capabilities,
      models: result.models,
      needsCustomModelList: result.needsCustomModelList,
      suggestedConfig: result.suggestedConfig,
      errors: result.errors,
      durationMs: result.durationMs,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function formatMsToHumanReadable(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

/**
 * Get ghost server statistics
 * GET /api/orchestrator/servers/ghost-stats
 * Query params:
 *   - limit: number of servers to return (default 100, max 1000)
 *   - onlyRemovable: if "true", return only servers that would be removed
 */
export function getGhostStats(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();
  const psCoordinator = getPsPollCoordinator();
  const config = getConfigManager().getConfig();

  const ghostConfig = config.loadBalancer?.ghostServers ?? {
    staleThresholdMs: 1800000,
    removeOnCleanup: true,
  };

  const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) || 100), 1000);
  const onlyRemovable = req.query.onlyRemovable === 'true';

  const now = Date.now();
  const allServers = orchestrator.getServers();
  const healthyServers = allServers.filter(s => s.healthy);

  interface GhostServerEntry {
    id: string;
    url: string;
    healthy: boolean;
    ghost: boolean;
    ghostAgeMs: number;
    ghostAgeHumanReadable: string;
    lastPollAt: string;
    wouldBeRemoved: boolean;
    reason: string;
  }

  const ghostEntries: GhostServerEntry[] = [];

  let ghostCount = 0;
  let wouldBeRemovedCount = 0;

  for (const server of allServers) {
    if (!server.healthy) {
      continue;
    }
    const models = psCoordinator.getModelsOnServer(server.id);
    const lastPollAt = psCoordinator.getServerLastPollAt(server.id);
    const hasModels = models.size > 0;

    if (!hasModels && lastPollAt > 0) {
      ghostCount++;
      const staleDuration = now - lastPollAt;
      const isStale = staleDuration >= ghostConfig.staleThresholdMs;
      const wouldRemove = isStale && ghostConfig.removeOnCleanup;

      if (wouldRemove) {
        wouldBeRemovedCount++;
      }

      ghostEntries.push({
        id: server.id,
        url: server.url,
        healthy: server.healthy,
        ghost: true,
        ghostAgeMs: staleDuration,
        ghostAgeHumanReadable: formatMsToHumanReadable(staleDuration),
        lastPollAt: new Date(lastPollAt).toISOString(),
        wouldBeRemoved: wouldRemove,
        reason: isStale
          ? `stale ${Math.round(staleDuration / 60000)}min > ${Math.round(ghostConfig.staleThresholdMs / 60000)}min threshold`
          : `ghost (0 models), not yet stale`,
      });
    }
  }

  ghostEntries.sort((a, b) => b.ghostAgeMs - a.ghostAgeMs);

  const filteredEntries = onlyRemovable ? ghostEntries.filter(e => e.wouldBeRemoved) : ghostEntries;

  const limitedEntries = filteredEntries.slice(0, limit);

  res.status(200).json({
    thresholdMs: ghostConfig.staleThresholdMs,
    removeOnCleanup: ghostConfig.removeOnCleanup,
    summary: {
      totalServers: allServers.length,
      healthyServers: healthyServers.length,
      ghostServers: ghostCount,
      wouldBeRemoved: wouldBeRemovedCount,
      wouldRemainAsGhost: ghostCount - wouldBeRemovedCount,
    },
    servers: limitedEntries,
  });
}
