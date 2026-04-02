/**
 * logsController.ts
 * Controller for log retrieval
 */

import { Request, Response } from 'express';

import { logger } from '../utils/logger.js';

export const getLogs = (req: Request, res: Response): void => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const level = req.query.level as string;
    const since = req.query.since as string;

    let logs = logger.getLogs(limit);

    // Filter by level if specified
    if (level) {
      logs = logs.filter(log => log.level === level);
    }

    // Filter by timestamp if since is specified (ISO string)
    if (since) {
      const sinceDate = new Date(since);
      logs = logs.filter(log => new Date(log.timestamp) >= sinceDate);
    }

    res.json({
      logs,
      count: logs.length,
      total: logger.getLogs().length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve logs' });
  }
};

export const clearLogs = (req: Request, res: Response): void => {
  try {
    logger.clearLogs();
    res.json({ message: 'Logs cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear logs' });
  }
};
