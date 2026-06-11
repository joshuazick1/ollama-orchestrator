/**
 * error-events-controller.ts
 * Error events query API endpoints
 */

import type { Request, Response } from 'express';

import { getErrorEventStore } from '../storage/error-event-store.js';
import type { ErrorQueryFilters, ErrorType } from '../types/error-event.js';
import { logger } from '../utils/logger.js';

const VALID_ERROR_TYPES: ErrorType[] = [
  'retryable',
  'non_retryable',
  'transient',
  'permanent',
  'rate_limited',
];

function parseErrorQueryParams(req: Request): ErrorQueryFilters {
  const { startTime, endTime, errorType, limit } = req.query;

  const parsed: ErrorQueryFilters = {};

  if (startTime && typeof startTime === 'string') {
    parsed.startTime = startTime;
  }

  if (endTime && typeof endTime === 'string') {
    parsed.endTime = endTime;
  }

  if (errorType && typeof errorType === 'string') {
    if (VALID_ERROR_TYPES.includes(errorType as ErrorType)) {
      parsed.errorType = errorType as ErrorType;
    }
  }

  if (limit) {
    const parsedLimit = parseInt(limit as string, 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      parsed.limit = Math.min(parsedLimit, 1000); // Cap at 1000
    }
  }

  return parsed;
}

/**
 * List all errors with optional filters.
 * GET /api/orchestrator/errors
 * Query params: ?startTime=&endTime=&errorType=&limit=
 */
export async function getErrors(req: Request, res: Response): Promise<void> {
  try {
    const filters = parseErrorQueryParams(req);
    const store = getErrorEventStore();

    const errors = await store.queryErrors(filters);

    res.json({
      success: true,
      count: errors.length,
      errors,
    });
  } catch (error) {
    logger.error('Error listing error events:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve error events' });
  }
}

/**
 * Get errors for a specific server.
 * GET /api/orchestrator/errors/:serverId
 * Query params: ?startTime=&endTime=&errorType=&limit=
 */
export async function getServerErrors(req: Request, res: Response): Promise<void> {
  try {
    const serverId = req.params.serverId as string;

    if (!serverId) {
      res.status(400).json({ success: false, error: 'Server ID is required' });
      return;
    }

    const filters = parseErrorQueryParams(req);
    filters.serverId = serverId;

    const store = getErrorEventStore();
    const errors = await store.queryErrors(filters);

    res.json({
      success: true,
      serverId,
      count: errors.length,
      errors,
    });
  } catch (error) {
    logger.error(`Error listing error events for server ${String(req.params.serverId)}:`, error);
    res.status(500).json({ success: false, error: 'Failed to retrieve server error events' });
  }
}

/**
 * Get errors for a specific circuit (serverId:model).
 * GET /api/orchestrator/errors/:serverId/:circuitId
 * Query params: ?startTime=&endTime=&errorType=&limit=
 */
export async function getCircuitErrors(req: Request, res: Response): Promise<void> {
  try {
    const serverId = req.params.serverId as string;
    const circuitId = req.params.circuitId as string;

    if (!serverId || !circuitId) {
      res.status(400).json({ success: false, error: 'Server ID and Circuit ID are required' });
      return;
    }

    const filters = parseErrorQueryParams(req);
    filters.serverId = serverId;
    filters.circuitId = circuitId;

    const store = getErrorEventStore();
    const errors = await store.queryErrors(filters);

    res.json({
      success: true,
      serverId,
      circuitId,
      count: errors.length,
      errors,
    });
  } catch (error) {
    logger.error(
      `Error listing error events for circuit ${String(req.params.serverId)}/${String(req.params.circuitId)}:`,
      error
    );
    res.status(500).json({ success: false, error: 'Failed to retrieve circuit error events' });
  }
}
