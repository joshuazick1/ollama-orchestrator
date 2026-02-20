/**
 * circuitBreakerController.ts
 * Circuit breaker management API endpoints
 */

import type { Request, Response } from 'express';

import { ERROR_MESSAGES } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator-instance.js';
import { logger } from '../utils/logger.js';

/**
 * Reset a circuit breaker for a specific server and model
 * POST /api/orchestrator/circuit-breakers/:serverId/:model/reset
 */
export function resetBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);

    const orchestrator = getOrchestratorInstance();
    const breaker =
      model === 'server'
        ? orchestrator.getServerCircuitBreaker(serverId)
        : orchestrator.getModelCircuitBreakerPublic(serverId, model);

    if (!breaker) {
      const key = model === 'server' ? serverId : `${serverId}:${model}`;
      res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND_KEY(key) });
      return;
    }

    const previousState = breaker.getStats().state;
    breaker.forceClose();

    const key = model === 'server' ? serverId : `${serverId}:${model}`;
    logger.info(`Circuit breaker manually reset: ${key}`, {
      serverId,
      model: model === 'server' ? 'server-level' : model,
      previousState,
    });

    res.json({
      message: `Circuit breaker reset for ${key}`,
      previousState,
      currentState: 'closed',
    });
  } catch (error) {
    logger.error('Error resetting circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Get circuit breaker details for a specific server and model
 * GET /api/orchestrator/circuit-breakers/:serverId/:model
 */
export function getBreakerDetails(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = decodeURIComponent(req.params.model as string);

    const orchestrator = getOrchestratorInstance();
    const breaker =
      model === 'server'
        ? orchestrator.getServerCircuitBreaker(serverId)
        : orchestrator.getModelCircuitBreakerPublic(serverId, model);

    if (!breaker) {
      const key = model === 'server' ? serverId : `${serverId}:${model}`;
      res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND_KEY(key) });
      return;
    }

    res.json({
      key: model === 'server' ? serverId : `${serverId}:${model}`,
      serverId,
      model: model === 'server' ? 'server-level' : model,
      stats: breaker.getStats(),
    });
  } catch (error) {
    logger.error('Error getting circuit breaker details:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}
