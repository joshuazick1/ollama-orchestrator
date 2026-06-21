import type { Request, Response } from 'express';

import { getPerfProbeTaskStore } from '../utils/perf-probe-task-store.js';

export function getPerfProbeStatus(req: Request, res: Response): void {
  const taskId = req.params.taskId as string;

  if (!taskId) {
    res.status(400).json({ error: 'taskId is required' });
    return;
  }

  const store = getPerfProbeTaskStore();
  const task = store.getTask(taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  res.status(200).json({
    id: task.id,
    status: task.status,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    probeModels: task.probeModels,
    serverScores: task.serverScores,
    flat: task.flat,
    metadata: task.metadata,
  });
}

export function cancelPerfProbe(req: Request, res: Response): void {
  const taskId = req.params.taskId as string;

  if (!taskId) {
    res.status(400).json({ error: 'taskId is required' });
    return;
  }

  const store = getPerfProbeTaskStore();
  const task = store.getTask(taskId);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    res.status(409).json({ error: `Cannot cancel task in ${task.status} state` });
    return;
  }

  const cancelled = store.cancelTask(taskId);

  if (!cancelled) {
    res.status(409).json({ error: 'Failed to cancel task' });
    return;
  }

  res.status(200).json({
    id: taskId,
    status: 'cancelled',
    message: 'Task cancelled successfully',
  });
}
