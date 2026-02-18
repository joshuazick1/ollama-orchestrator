/**
 * queueController.ts
 * Queue management API endpoints
 */

import type { Request, Response } from 'express';

import { getOrchestratorInstance } from '../orchestrator-instance.js';
import { logger } from '../utils/logger.js';

/**
 * Get queue status
 * GET /api/orchestrator/queue
 */
export function getQueueStatus(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  try {
    const stats = orchestrator.getQueueStats();
    const items = orchestrator.getQueueItems();
    const inFlight = orchestrator.getInFlightByServer();

    res.status(200).json({
      success: true,
      queue: {
        ...stats,
        items,
      },
      inFlight,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get queue status',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Pause queue
 * POST /api/orchestrator/queue/pause
 */
export function pauseQueue(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  try {
    orchestrator.pauseQueue();

    res.status(200).json({
      success: true,
      paused: true,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to pause queue',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Resume queue
 * POST /api/orchestrator/queue/resume
 */
export function resumeQueue(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  try {
    orchestrator.resumeQueue();

    res.status(200).json({
      success: true,
      paused: false,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to resume queue',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get in-flight requests by server
 * GET /api/orchestrator/in-flight
 */
export function getInFlightByServer(req: Request, res: Response): void {
  const orchestrator = getOrchestratorInstance();

  try {
    const inFlight = orchestrator.getInFlightByServer();
    const servers = orchestrator.getServers();

    // Enhance with server details
    const enhanced = Object.entries(inFlight).map(([serverId, data]) => {
      const server = servers.find(s => s.id === serverId);
      return {
        serverId,
        serverUrl: server?.url ?? 'unknown',
        healthy: server?.healthy ?? false,
        ...data,
      };
    });

    logger.debug('getInFlightByServer API response:', {
      inFlight,
      enhanced,
      totalInFlight: Object.values(inFlight).reduce((sum, s) => sum + s.total, 0),
    });

    res.status(200).json({
      success: true,
      inFlight: enhanced,
      total: Object.values(inFlight).reduce((sum, s) => sum + s.total, 0),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get in-flight requests',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Drain server (graceful shutdown)
 * POST /api/orchestrator/drain
 */
export async function drainServer(req: Request, res: Response): Promise<void> {
  const orchestrator = getOrchestratorInstance();
  const timeout = parseInt(req.query.timeout as string) || 30000;

  try {
    res.status(200).json({
      success: true,
      message: 'Draining started',
      timeout,
    });

    // Start drain asynchronously
    const completed = await orchestrator.drain(timeout);

    if (!completed) {
      logger.warn('Drain completed with timeout');
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to drain server',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Drain a specific server (stop routing new requests)
 * POST /api/orchestrator/servers/:id/drain
 */
export function drainSpecificServer(req: Request, res: Response): void {
  try {
    const id = req.params.id as string;
    const orchestrator = getOrchestratorInstance();
    const server = orchestrator.getServer(id);

    if (!server) {
      res.status(404).json({ error: `Server ${id} not found` });
      return;
    }

    // Set draining flag
    orchestrator.updateServer(id, {
      maxConcurrency: server.maxConcurrency,
    });

    // Get in-flight count across all models on this server
    const inFlightByServer = orchestrator.getInFlightByServer();
    const serverInFlight = inFlightByServer[id];
    const inFlight = serverInFlight?.total ?? 0;

    res.json({
      message: `Server ${id} is now draining`,
      inFlightRequests: inFlight,
      estimatedCompletion: 'Calculating...',
    });
  } catch (error) {
    logger.error('Error draining server:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Remove drain mode from a specific server
 * POST /api/orchestrator/servers/:id/undrain
 */
export function undrainSpecificServer(req: Request, res: Response): void {
  try {
    const id = req.params.id as string;
    const orchestrator = getOrchestratorInstance();

    orchestrator.updateServer(id, {
      maxConcurrency: undefined,
    });

    res.json({ message: `Server ${id} drain mode removed` });
  } catch (error) {
    logger.error('Error undraining server:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Set maintenance mode on a specific server
 * POST /api/orchestrator/servers/:id/maintenance
 */
export function setServerMaintenance(req: Request, res: Response): void {
  try {
    const id = req.params.id as string;
    const body = (req.body ?? {}) as { enabled?: boolean };
    const { enabled = true } = body;
    const orchestrator = getOrchestratorInstance();
    const server = orchestrator.getServer(id);

    if (!server) {
      res.status(404).json({ error: `Server ${id} not found` });
      return;
    }

    orchestrator.updateServer(id, {
      maxConcurrency: enabled ? 0 : server.maxConcurrency,
    });

    res.json({
      message: `Server ${id} maintenance mode ${enabled ? 'enabled' : 'disabled'}`,
      serverId: id,
      maintenance: enabled,
    });
  } catch (error) {
    logger.error('Error setting server maintenance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
