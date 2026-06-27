import type { Request, Response } from 'express';

import { isInternalAdmin } from '../middleware/auth.js';
import { getQuarantinePool } from '../utils/quarantine-pool.js';

export function listQuarantined(_req: Request, res: Response): void {
  const pool = getQuarantinePool();
  const entries = pool.getAll();
  res.json({ quarantined: entries, count: entries.length });
}

export function quarantineServer(req: Request, res: Response): void {
  if (!isInternalAdmin(req)) {
    res.status(403).json({ error: 'Admin required' });
    return;
  }
  const serverId = req.params.serverId as string;
  if (!serverId) {
    res.status(400).json({ error: 'serverId is required' });
    return;
  }
  const pool = getQuarantinePool();
  const evidence = req.body?.evidence ?? null;
  const reason = req.body?.reason ?? 'manual';
  pool.quarantine(serverId, reason, evidence, true);
  res.json({ success: true, serverId });
}

export function unquarantineServer(req: Request, res: Response): void {
  if (!isInternalAdmin(req)) {
    res.status(403).json({ error: 'Admin required' });
    return;
  }
  const serverId = req.params.serverId as string;
  if (!serverId) {
    res.status(400).json({ error: 'serverId is required' });
    return;
  }
  const pool = getQuarantinePool();
  const existed = pool.unquarantine(serverId);
  res.json({ success: existed, serverId });
}
