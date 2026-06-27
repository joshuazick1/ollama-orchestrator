/**
 * circuitBreakerController.ts
 * Circuit breaker management API endpoints using the new probe system.
 *
 * Task 1.3: Refactor to support per-endpoint operations, removing the hardcoded
 * `ollama_chat` default. All 7 ProbeEndpoint values are now first-class citizens.
 */

import type { Request, Response } from 'express';

import { ERROR_MESSAGES } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import type { Tuple, ProbeState, UIState, StateProjection } from '../probe/types.js';
import { KNOWN_PROBE_ENDPOINTS, tupleKey } from '../probe/types.js';
import { logger } from '../utils/logger.js';
import { normalizeServerUrl } from '../utils/url-utils.js';
import { ValidationError } from '../utils/domain-errors.js';

/**
 * Map internal 4-state probe system to UI 3-state.
 * HEALTHY + SUSPECT → CLOSED (both are "serving" traffic)
 * UNHEALTHY → OPEN
 * RECOVERING → HALF-OPEN
 */
function toUIState(internal: ProbeState): UIState {
  switch (internal) {
    case 'HEALTHY':
      return 'CLOSED';
    case 'SUSPECT':
      return 'CLOSED';
    case 'UNHEALTHY':
      return 'OPEN';
    case 'RECOVERING':
      return 'HALF-OPEN';
  }
}

/**
 * Validate that an endpoint value is one of the 7 known ProbeEndpoint values.
 * Throws ValidationError if invalid.
 */
function validateEndpoint(endpoint: string | undefined): void {
  if (endpoint === undefined) return;
  if (!KNOWN_PROBE_ENDPOINTS.includes(endpoint as never)) {
    throw new ValidationError(
      `Invalid endpoint '${endpoint}'. Must be one of: ${KNOWN_PROBE_ENDPOINTS.join(', ')}`
    );
  }
}

/**
 * Validate required string params (trimmed, non-empty).
 * Throws ValidationError if invalid.
 */
function validateRequired(value: string | undefined, fieldName: string): void {
  if (value === undefined || value.trim() === '') {
    throw new ValidationError(`${fieldName} is required`);
  }
}

/**
 * Build a Tuple from serverId, model, and endpoint.
 * For server-level breakers (model === 'server'), uses 'server' as model.
 */
function buildTuple(serverId: string, model: string, endpoint: string): Tuple {
  return {
    serverId,
    model: model === 'server' ? 'server' : model,
    endpoint: endpoint as never,
  };
}

/**
 * Compute error rate from tuple state.
 */
function computeErrorRate(
  tupleState: { consecutiveSuccesses: number; errorWindow: number[] } | undefined
): number {
  if (!tupleState) {
    return 0;
  }
  const { consecutiveSuccesses, errorWindow } = tupleState;
  const total = consecutiveSuccesses + errorWindow.length;
  if (total === 0) {
    return 0;
  }
  return errorWindow.length / total;
}

/**
 * Build a single StateProjection entry for one endpoint of a server:model tuple.
 */
function buildStateProjection(
  serverId: string,
  model: string,
  endpoint: string,
  orchestrator: ReturnType<typeof getOrchestratorInstance>
): StateProjection {
  const tuple = buildTuple(serverId, model, endpoint);
  const probeOrchestrator = orchestrator.getProbeOrchestrator();
  const tupleState = probeOrchestrator.getTupleState(tuple);
  const state = probeOrchestrator.getState(tuple);

  const lbScore =
    model !== 'server' ? orchestrator.getLBScoreForServerModel(serverId, model) : null;

  const errorCounts = {
    retryable: 0,
    'non-retryable': 0,
    transient: 0,
    permanent: 0,
    rateLimited: 0,
  };

  return {
    serverId,
    model: model === 'server' ? 'server' : model,
    endpoint: endpoint as never,
    tupleKey: tupleKey(tuple),
    state,
    uiState: toUIState(state),
    failureCount: tupleState?.consecutiveFailures ?? 0,
    successCount: tupleState?.consecutiveSuccesses ?? 0,
    totalRequestCount:
      (tupleState?.consecutiveSuccesses ?? 0) + (tupleState?.consecutiveFailures ?? 0),
    blockedRequestCount: 0,
    consecutiveSuccesses: tupleState?.consecutiveSuccesses ?? 0,
    lastFailure: tupleState?.lastProbeAt ?? 0,
    lastSuccess: tupleState?.lastProbeAt ?? 0,
    nextRetryAt: tupleState?.nextProbeAt ?? 0,
    halfOpenStartedAt: state === 'RECOVERING' ? tupleState?.lastTransition : undefined,
    errorRate: computeErrorRate(tupleState),
    errorCounts,
    modelType: undefined,
    lastFailureReason: tupleState?.lastErrorKind ?? undefined,
    lastErrorType: tupleState?.lastErrorKind ?? undefined,
    halfOpenAttempts: state === 'RECOVERING' ? tupleState?.recoveryAttempts : undefined,
    activeTestsInProgress: undefined,
    lbScore: lbScore
      ? {
          totalScore: lbScore.totalScore,
          latencyScore: lbScore.breakdown.latencyScore,
          successRateScore: lbScore.breakdown.successRateScore,
          loadScore: lbScore.breakdown.loadScore,
          capacityScore: lbScore.breakdown.capacityScore,
          circuitBreakerScore: 1.0,
          timeoutScore: 1.0,
        }
      : null,
  };
}

/**
 * Get circuit breaker details for a specific server and model.
 * GET /api/orchestrator/circuit-breakers/:serverId/:model
 * GET /api/orchestrator/circuit-breakers/:serverId/:model/:endpoint
 *
 * When endpoint is provided, returns a single StateProjection for that endpoint.
 * When endpoint is omitted, returns { serverId, model, endpoints: StateProjection[] }
 * with all 7 ProbeEndpoint values (unknown tuples show as HEALTHY).
 */
export function getBreakerDetails(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);
    const endpoint = req.params.endpoint as string | undefined;

    validateRequired(serverId, 'serverId');
    validateRequired(model, 'model');
    validateEndpoint(endpoint);

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    if (endpoint) {
      // Single endpoint — return one StateProjection
      const projection = buildStateProjection(serverId, model, endpoint, orchestrator);
      res.json(projection);
    } else {
      // All 7 endpoints — return aggregated view
      const endpoints: StateProjection[] = KNOWN_PROBE_ENDPOINTS.map(ep =>
        buildStateProjection(serverId, model, ep, orchestrator)
      );
      res.json({
        serverId,
        model: model === 'server' ? 'server' : model,
        endpoints,
      });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Error getting circuit breaker details:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Reset a circuit breaker for a specific server and model.
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/reset
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/:endpoint/reset
 *
 * When endpoint is provided, resets only that endpoint.
 * When endpoint is omitted, resets ALL 7 endpoints for the tuple.
 */
export function resetBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);
    const endpoint = req.params.endpoint as string | undefined;

    validateRequired(serverId, 'serverId');
    validateRequired(model, 'model');
    validateEndpoint(endpoint);

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const results: Array<{ endpoint: string; previousState: ProbeState }> = [];

    if (endpoint) {
      // Single endpoint
      const tuple = buildTuple(serverId, model, endpoint);
      const previousState = probeOrchestrator.getState(tuple);
      probeOrchestrator.resetTuple(tuple);
      results.push({ endpoint, previousState });
    } else {
      // All 7 endpoints
      for (const ep of KNOWN_PROBE_ENDPOINTS) {
        const tuple = buildTuple(serverId, model, ep);
        const previousState = probeOrchestrator.getState(tuple);
        probeOrchestrator.resetTuple(tuple);
        results.push({ endpoint: ep, previousState });
      }
    }

    logger.info('Circuit breaker manually reset', {
      serverId,
      model: model === 'server' ? 'server-level' : model,
      endpoint: endpoint ?? 'ALL',
      results,
      action: 'admin_reset',
      adminUserId: req.user?.id ?? 'unknown',
    });

    res.json({
      success: true,
      message: `Circuit breaker reset for ${serverId}:${model}${endpoint ? `:${endpoint}` : ' (all 7 endpoints)'}`,
      results,
      previousStates: results.map(r => r.previousState),
      currentState: 'HEALTHY',
      uiState: 'CLOSED',
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Error resetting circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Force open a circuit breaker for a specific server and model.
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/open
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/:endpoint/open
 *
 * When endpoint is provided, forces only that endpoint.
 * When endpoint is omitted, forces ALL 7 endpoints to OPEN.
 */
export function forceOpenBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);
    const endpoint = req.params.endpoint as string | undefined;

    validateRequired(serverId, 'serverId');
    validateRequired(model, 'model');
    validateEndpoint(endpoint);

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const results: Array<{ endpoint: string; previousState: ProbeState }> = [];

    if (endpoint) {
      const tuple = buildTuple(serverId, model, endpoint);
      const previousState = probeOrchestrator.getState(tuple);
      probeOrchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      results.push({ endpoint, previousState });
    } else {
      for (const ep of KNOWN_PROBE_ENDPOINTS) {
        const tuple = buildTuple(serverId, model, ep);
        const previousState = probeOrchestrator.getState(tuple);
        probeOrchestrator.setStateForTesting(tuple, 'UNHEALTHY');
        results.push({ endpoint: ep, previousState });
      }
    }

    logger.info('admin_force_breaker', {
      adminUserId: req.user?.id ?? 'unknown',
      action: 'force_open',
      serverId,
      model,
      endpoint: endpoint ?? 'ALL',
      results,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: `Circuit breaker force-opened for ${serverId}:${model}${endpoint ? `:${endpoint}` : ' (all 7 endpoints)'}`,
      results,
      previousStates: results.map(r => r.previousState),
      currentState: 'UNHEALTHY',
      uiState: 'OPEN',
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Error force-opening circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Force close (reset) a circuit breaker for a specific server and model.
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/close
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/:endpoint/close
 *
 * When endpoint is provided, forces only that endpoint to HEALTHY.
 * When endpoint is omitted, forces ALL 7 endpoints to HEALTHY.
 */
export function forceCloseBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);
    const endpoint = req.params.endpoint as string | undefined;

    validateRequired(serverId, 'serverId');
    validateRequired(model, 'model');
    validateEndpoint(endpoint);

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const results: Array<{ endpoint: string; previousState: ProbeState }> = [];

    if (endpoint) {
      const tuple = buildTuple(serverId, model, endpoint);
      const previousState = probeOrchestrator.getState(tuple);
      probeOrchestrator.setStateForTesting(tuple, 'HEALTHY');
      results.push({ endpoint, previousState });
    } else {
      for (const ep of KNOWN_PROBE_ENDPOINTS) {
        const tuple = buildTuple(serverId, model, ep);
        const previousState = probeOrchestrator.getState(tuple);
        probeOrchestrator.setStateForTesting(tuple, 'HEALTHY');
        results.push({ endpoint: ep, previousState });
      }
    }

    logger.info('admin_force_breaker', {
      adminUserId: req.user?.id ?? 'unknown',
      action: 'force_close',
      serverId,
      model,
      endpoint: endpoint ?? 'ALL',
      results,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: `Circuit breaker force-closed for ${serverId}:${model}${endpoint ? `:${endpoint}` : ' (all 7 endpoints)'}`,
      results,
      previousStates: results.map(r => r.previousState),
      currentState: 'HEALTHY',
      uiState: 'CLOSED',
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Error force-closing circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Force half-open a circuit breaker for a specific server and model.
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/half-open
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/:endpoint/half-open
 *
 * When endpoint is provided, forces only that endpoint to RECOVERING.
 * When endpoint is omitted, forces ALL 7 endpoints to RECOVERING.
 */
export function forceHalfOpenBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);
    const endpoint = req.params.endpoint as string | undefined;

    validateRequired(serverId, 'serverId');
    validateRequired(model, 'model');
    validateEndpoint(endpoint);

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const results: Array<{ endpoint: string; previousState: ProbeState }> = [];

    if (endpoint) {
      const tuple = buildTuple(serverId, model, endpoint);
      const previousState = probeOrchestrator.getState(tuple);
      probeOrchestrator.setStateForTesting(tuple, 'RECOVERING');
      results.push({ endpoint, previousState });
    } else {
      for (const ep of KNOWN_PROBE_ENDPOINTS) {
        const tuple = buildTuple(serverId, model, ep);
        const previousState = probeOrchestrator.getState(tuple);
        probeOrchestrator.setStateForTesting(tuple, 'RECOVERING');
        results.push({ endpoint: ep, previousState });
      }
    }

    logger.info('admin_force_breaker', {
      adminUserId: req.user?.id ?? 'unknown',
      action: 'force_half_open',
      serverId,
      model,
      endpoint: endpoint ?? 'ALL',
      results,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: `Circuit breaker force-half-open for ${serverId}:${model}${endpoint ? `:${endpoint}` : ' (all 7 endpoints)'}`,
      results,
      previousStates: results.map(r => r.previousState),
      currentState: 'RECOVERING',
      uiState: 'HALF-OPEN',
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Error force-half-opening circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Get endpoint states for a server:model combination.
 * GET /api/orchestrator/circuit-breakers/:serverId/:model/endpoints
 *
 * Returns { serverId, model, endpoints: CircuitBreakerInfo[] } — one entry per
 * ProbeEndpoint, including unknown tuples as default HEALTHY (matching canServe
 * default behavior for admin callers).
 *
 * This is the dedicated handler for the new /endpoints route that Task 1.4
 * will wire up alongside the existing :serverId/:model routes.
 */
export function getEndpointStates(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);

    validateRequired(serverId, 'serverId');
    validateRequired(model, 'model');

    const orchestrator = getOrchestratorInstance();

    // Always return all 7 endpoints, even unknown tuples show as HEALTHY
    const endpoints: StateProjection[] = KNOWN_PROBE_ENDPOINTS.map(ep =>
      buildStateProjection(serverId, model, ep, orchestrator)
    );

    res.json({
      serverId,
      model: model === 'server' ? 'server' : model,
      endpoints,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Error getting endpoint states:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

function normalizeServerId(serverId: string, servers: AIServer[]): string {
  if (servers.some(s => s.id === serverId)) {
    return serverId;
  }
  if (serverId.startsWith('srv-')) {
    return serverId;
  }
  try {
    const decoded = Buffer.from(serverId, 'base64url').toString('utf8');
    const decodedUrl = decodeURIComponent(decoded);
    const normalizedDecodedUrl = normalizeServerUrl(decodedUrl);
    const match = servers.find(s => normalizeServerUrl(s.url) === normalizedDecodedUrl);
    if (match) {
      return match.id;
    }
  } catch (_) {
    /* noop */
  }
  return serverId;
}

export function resetAllBreakersForServer(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;

    validateRequired(serverId, 'serverId');

    const orchestrator = getOrchestratorInstance();
    const servers = orchestrator.getServers();
    const normalizedServerId = normalizeServerId(serverId, servers);
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const resetCount = probeOrchestrator.resetAllForServer(normalizedServerId);

    logger.info('Bulk circuit breaker reset for server', {
      serverId: normalizedServerId,
      resetCount,
      adminUserId: req.user?.id ?? 'unknown',
    });

    res.json({
      success: true,
      message: `Reset ${resetCount} circuit breaker(s) for server ${normalizedServerId}`,
      resetCount,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Error resetting all circuit breakers for server:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

export function deleteAllBreakersForServer(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;

    validateRequired(serverId, 'serverId');

    const orchestrator = getOrchestratorInstance();
    const servers = orchestrator.getServers();
    const normalizedServerId = normalizeServerId(serverId, servers);
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const deletedCount = probeOrchestrator.evictAllForServer(normalizedServerId);

    logger.info('Bulk circuit breaker eviction for server', {
      serverId: normalizedServerId,
      deletedCount,
      adminUserId: req.user?.id ?? 'unknown',
    });

    res.json({
      success: true,
      message: `Evicted ${deletedCount} circuit breaker(s) for server ${normalizedServerId}`,
      deletedCount,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Error evicting all circuit breakers for server:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}
