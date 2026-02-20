/**
 * recoveryFailureController.ts
 * Recovery failure analysis API endpoints
 */

import type { Request, Response } from 'express';

import { getRecoveryFailureTracker } from '../analytics/recovery-failure-tracker.js';
import { ERROR_MESSAGES } from '../constants/index.js';
import { getOrchestratorInstance } from '../orchestrator-instance.js';
import { logger } from '../utils/logger.js';

/**
 * Get recovery failure summary for all servers
 * GET /api/orchestrator/recovery-failures
 */
export function getRecoveryFailuresSummary(req: Request, res: Response): void {
  try {
    const windowMs = parseInt(req.query.windowMs as string) || 86400000;
    const tracker = getRecoveryFailureTracker();
    const summary = tracker.getGlobalSummary(windowMs);

    res.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    logger.error('Error getting recovery failures summary:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Get recovery statistics for a specific server
 * GET /api/orchestrator/recovery-failures/:serverId
 */
export function getServerRecoveryStats(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const tracker = getRecoveryFailureTracker();
    const stats = tracker.getServerRecoveryStats(serverId);

    if (!stats) {
      res.status(404).json({ error: `No recovery data found for server ${serverId}` });
      return;
    }

    res.json({
      success: true,
      ...stats,
    });
  } catch (error) {
    logger.error('Error getting server recovery stats:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Get failure history for a specific server
 * GET /api/orchestrator/recovery-failures/:serverId/history
 */
export function getServerFailureHistory(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const tracker = getRecoveryFailureTracker();
    const history = tracker.getServerFailureHistory(serverId, limit, offset);

    res.json({
      success: true,
      serverId,
      count: history.length,
      limit,
      offset,
      history,
    });
  } catch (error) {
    logger.error('Error getting server failure history:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Analyze failure patterns for a specific server
 * GET /api/orchestrator/recovery-failures/:serverId/analysis
 */
export function analyzeServerFailures(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const windowMs = parseInt(req.query.windowMs as string) || 3600000;

    const tracker = getRecoveryFailureTracker();
    const analysis = tracker.analyzeFailurePattern(serverId, windowMs);

    res.json({
      success: true,
      windowMs,
      ...analysis,
    });
  } catch (error) {
    logger.error('Error analyzing server failures:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Analyze circuit breaker impact on a server
 * GET /api/orchestrator/recovery-failures/:serverId/circuit-breaker-impact
 */
export function analyzeCircuitBreakerImpact(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;

    const tracker = getRecoveryFailureTracker();
    const analysis = tracker.analyzeCircuitBreakerImpact(serverId);

    res.json({
      success: true,
      serverId,
      ...analysis,
    });
  } catch (error) {
    logger.error('Error analyzing circuit breaker impact:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Get circuit breaker transitions for a server
 * GET /api/orchestrator/recovery-failures/:serverId/circuit-breaker-transitions
 */
export function getCircuitBreakerTransitions(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;
    const model = req.query.model as string | undefined;
    const limit = parseInt(req.query.limit as string) || 100;

    const tracker = getRecoveryFailureTracker();
    const transitions = tracker.getCircuitBreakerTransitions(serverId, model, limit);

    res.json({
      success: true,
      serverId,
      model,
      count: transitions.length,
      transitions,
    });
  } catch (error) {
    logger.error('Error getting circuit breaker transitions:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Get all server recovery statistics
 * GET /api/orchestrator/recovery-failures/stats/all
 */
export function getAllServerRecoveryStats(req: Request, res: Response): void {
  try {
    const tracker = getRecoveryFailureTracker();
    const stats = tracker.getAllServerStats();

    res.json({
      success: true,
      count: stats.length,
      servers: stats,
    });
  } catch (error) {
    logger.error('Error getting all server recovery stats:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Get recent recovery failure records
 * GET /api/orchestrator/recovery-failures/recent
 */
export function getRecentFailureRecords(req: Request, res: Response): void {
  try {
    const limit = parseInt(req.query.limit as string) || 100;

    const tracker = getRecoveryFailureTracker();
    const records = tracker.getRecentRecords(limit);

    res.json({
      success: true,
      count: records.length,
      records,
    });
  } catch (error) {
    logger.error('Error getting recent failure records:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Reset recovery failure tracking for a specific server
 * POST /api/orchestrator/recovery-failures/:serverId/reset
 */
export function resetServerRecoveryStats(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;

    const tracker = getRecoveryFailureTracker();
    tracker.resetServerStats(serverId);

    logger.info(`Recovery failure stats reset for server: ${serverId}`);

    res.json({
      success: true,
      message: `Recovery failure stats reset for server ${serverId}`,
    });
  } catch (error) {
    logger.error('Error resetting server recovery stats:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Force-close a server-level circuit breaker
 * POST /api/orchestrator/circuit-breakers/:serverId/reset
 */
export function resetServerCircuitBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;

    const orchestrator = getOrchestratorInstance();
    const success = orchestrator.resetServerCircuitBreaker(serverId);

    if (!success) {
      res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND_SERVER(serverId) });
      return;
    }

    logger.info(`Server circuit breaker manually reset: ${serverId}`);

    res.json({
      message: `Circuit breaker reset for server ${serverId}`,
      currentState: 'closed',
    });
  } catch (error) {
    logger.error('Error resetting server circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}

/**
 * Get server-level circuit breaker details
 * GET /api/orchestrator/circuit-breakers/:serverId
 */
export function getServerCircuitBreaker(req: Request, res: Response): void {
  try {
    const serverId = req.params.serverId as string;

    const orchestrator = getOrchestratorInstance();
    const breaker = orchestrator.getServerCircuitBreaker(serverId);

    if (!breaker) {
      res.status(404).json({ error: ERROR_MESSAGES.CIRCUIT_BREAKER_NOT_FOUND_SERVER(serverId) });
      return;
    }

    res.json({
      serverId,
      stats: breaker.getStats(),
    });
  } catch (error) {
    logger.error('Error getting server circuit breaker:', error);
    res.status(500).json({ error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR });
  }
}
