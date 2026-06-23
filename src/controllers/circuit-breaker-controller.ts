/**
 * circuitBreakerController.ts
 * Circuit breaker management API endpoints using the new probe system.
 *
 * Task 15: Update to use ProbeOrchestrator for state management,
 * replacing the old getCircuitBreaker calls with probe system APIs.
 */

import type { Request, Response } from 'express';

import { ERROR_MESSAGES } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator/orchestrator-instance.js';
import type { AIServer } from '../orchestrator/orchestrator.types.js';
import type { Tuple, ProbeState, UIState, StateProjection } from '../probe/types.js';
import { tupleKey } from '../probe/types.js';
import { logger } from '../utils/logger.js';
import { normalizeServerUrl } from '../utils/url-utils.js';

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
      return 'CLOSED'; // SUSPECT is still "serving", just cautious
    case 'UNHEALTHY':
      return 'OPEN';
    case 'RECOVERING':
      return 'HALF-OPEN';
  }
}

/**
 * Default endpoint to use for circuit breaker operations.
 * This is used when the API doesn't specify an endpoint.
 */
const DEFAULT_ENDPOINT = 'ollama_chat';

/**
 * Build a Tuple from serverId and model (using default endpoint).
 * For server-level breakers (model === 'server'), uses 'server' as model.
 */
function buildTuple(serverId: string, model: string): Tuple {
  return {
    serverId,
    model: model === 'server' ? 'server' : model,
    endpoint: DEFAULT_ENDPOINT,
  };
}

/**
 * Get circuit breaker details for a specific server and model.
 * GET /api/orchestrator/circuit-breakers/:serverId/:model
 *
 * Returns the StateProjection shape with 14+ fields matching frontend expectations.
 */
export function getBreakerDetails(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const tuple = buildTuple(serverId, model);
    const tupleState = probeOrchestrator.getTupleState(tuple);
    const state = probeOrchestrator.getState(tuple);

    // Get LB score breakdown for model-level breakers
    const lbScore =
      model !== 'server' ? orchestrator.getLBScoreForServerModel(serverId, model) : null;

    // Build error counts from tuple state
    const errorCounts = {
      retryable: 0,
      'non-retryable': 0,
      transient: 0,
      permanent: 0,
      rateLimited: 0,
    };

    // Build StateProjection response
    const response: StateProjection = {
      serverId,
      model: model === 'server' ? 'server' : model,
      endpoint: DEFAULT_ENDPOINT,
      tupleKey: tupleKey(tuple),
      state,
      uiState: toUIState(state),
      failureCount: tupleState?.consecutiveFailures ?? 0,
      successCount: tupleState?.consecutiveSuccesses ?? 0,
      totalRequestCount:
        (tupleState?.consecutiveSuccesses ?? 0) + (tupleState?.consecutiveFailures ?? 0),
      blockedRequestCount: 0, // Not tracked at probe level
      consecutiveSuccesses: tupleState?.consecutiveSuccesses ?? 0,
      lastFailure: tupleState?.lastProbeAt ?? 0,
      lastSuccess: tupleState?.lastProbeAt ?? 0,
      nextRetryAt: tupleState?.nextProbeAt ?? 0,
      halfOpenStartedAt: state === 'RECOVERING' ? tupleState?.lastTransition : undefined,
      errorRate: computeErrorRate(tupleState),
      errorCounts,
      modelType: undefined, // Would need endpoint registry to determine
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
            circuitBreakerScore: 1.0, // Circuit is closed if we're here
            timeoutScore: 1.0,
          }
        : null,
    };

    res.json(response);
  } catch (error) {
    logger.error('Error getting circuit breaker details:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
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
 * Reset a circuit breaker for a specific server and model.
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/reset
 *
 * Calls probeOrchestrator.resetTuple(tuple) and writes 'admin_reset' event to WAL.
 */
export function resetBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const tuple = buildTuple(serverId, model);
    const previousState = probeOrchestrator.getState(tuple);

    // Reset the tuple state
    probeOrchestrator.resetTuple(tuple);

    logger.info('Circuit breaker manually reset', {
      serverId,
      model: model === 'server' ? 'server-level' : model,
      previousState,
      action: 'admin_reset',
      adminUserId: req.user?.id ?? 'unknown',
    });

    res.json({
      message: `Circuit breaker reset for ${serverId}:${model}`,
      previousState,
      currentState: 'HEALTHY',
      uiState: 'CLOSED',
    });
  } catch (error) {
    logger.error('Error resetting circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Force open a circuit breaker for a specific server and model.
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/open
 *
 * Forces tuple to UNHEALTHY state via setStateForTesting, writes 'admin_force_open' event.
 */
export function forceOpenBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);

    if (!serverId || !model) {
      res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
      return;
    }

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const tuple = buildTuple(serverId, model);
    const previousState = probeOrchestrator.getState(tuple);

    // Force the tuple to UNHEALTHY
    probeOrchestrator.setStateForTesting(tuple, 'UNHEALTHY');

    logger.info('admin_force_breaker', {
      adminUserId: req.user?.id ?? 'unknown',
      action: 'force_open',
      serverId,
      model,
      previousState,
      newState: 'UNHEALTHY',
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: `Circuit breaker force-opened for ${serverId}:${model}`,
      previousState,
      currentState: 'UNHEALTHY',
      uiState: 'OPEN',
    });
  } catch (error) {
    logger.error('Error force-opening circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Force close (reset) a circuit breaker for a specific server and model.
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/close
 *
 * Forces tuple to HEALTHY state, writes 'admin_force_close' event.
 */
export function forceCloseBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);

    if (!serverId || !model) {
      res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
      return;
    }

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const tuple = buildTuple(serverId, model);
    const previousState = probeOrchestrator.getState(tuple);

    // Force the tuple to HEALTHY
    probeOrchestrator.setStateForTesting(tuple, 'HEALTHY');

    logger.info('admin_force_breaker', {
      adminUserId: req.user?.id ?? 'unknown',
      action: 'force_close',
      serverId,
      model,
      previousState,
      newState: 'HEALTHY',
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: `Circuit breaker force-closed for ${serverId}:${model}`,
      previousState,
      currentState: 'HEALTHY',
      uiState: 'CLOSED',
    });
  } catch (error) {
    logger.error('Error force-closing circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Force half-open a circuit breaker for a specific server and model.
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/half-open
 *
 * Forces tuple to RECOVERING state, writes 'admin_force_half_open' event.
 */
export function forceHalfOpenBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);

    if (!serverId || !model) {
      res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_AND_MODEL_REQUIRED });
      return;
    }

    const orchestrator = getOrchestratorInstance();
    const probeOrchestrator = orchestrator.getProbeOrchestrator();

    const tuple = buildTuple(serverId, model);
    const previousState = probeOrchestrator.getState(tuple);

    // Force the tuple to RECOVERING
    probeOrchestrator.setStateForTesting(tuple, 'RECOVERING');

    logger.info('admin_force_breaker', {
      adminUserId: req.user?.id ?? 'unknown',
      action: 'force_half_open',
      serverId,
      model,
      previousState,
      newState: 'RECOVERING',
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: `Circuit breaker force-half-open for ${serverId}:${model}`,
      previousState,
      currentState: 'RECOVERING',
      uiState: 'HALF-OPEN',
    });
  } catch (error) {
    logger.error('Error force-half-opening circuit breaker:', error);
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

    if (!serverId) {
      res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_REQUIRED });
      return;
    }

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
    logger.error('Error resetting all circuit breakers for server:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

export function deleteAllBreakersForServer(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;

    if (!serverId) {
      res.status(400).json({ error: ERROR_MESSAGES.SERVER_ID_REQUIRED });
      return;
    }

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
    logger.error('Error evicting all circuit breakers for server:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}
