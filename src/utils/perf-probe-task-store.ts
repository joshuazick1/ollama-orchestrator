import { logger } from './logger.js';

export const TASK_TTL_MS = 60 * 60 * 1000; // 1 hour

export type PerfProbeTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PerfProbeTask {
  id: string;
  status: PerfProbeTaskStatus;
  createdAt: number;
  completedAt?: number;
  // Flexible result fields
  probeModels?: string[];
  serverScores?: Record<string, Record<string, number>>;
  flat?: unknown[];
  metadata?: Record<string, unknown>;
  // Allow additional fields via index signature
  [key: string]: unknown;
}

export class TaskConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskConflictError';
  }
}

function generateId(): string {
  return `perf-probe-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isTerminalStatus(status: PerfProbeTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

class PerfProbeTaskStore {
  private tasks: Map<string, PerfProbeTask> = new Map();

  /**
   * Create a new task. Throws TaskConflictError if an active (non-terminal) task already exists.
   */
  createTask(initialState: Partial<PerfProbeTask> = {}): PerfProbeTask {
    const active = this.getActiveTask();
    if (active !== undefined) {
      throw new TaskConflictError('An active performance probe task already exists');
    }

    const id = generateId();
    const now = Date.now();

    const task: PerfProbeTask = {
      id,
      status: 'pending',
      createdAt: now,
      ...initialState,
    };

    this.tasks.set(id, task);
    logger.debug(`PerfProbeTask created: ${id}`);
    return task;
  }

  /**
   * Get a task by id. Triggers TTL cleanup before returning.
   */
  getTask(id: string): PerfProbeTask | undefined {
    this.evictExpired();
    return this.tasks.get(id);
  }

  /**
   * Get the currently active task (if any). Returns undefined if no active task.
   * Triggers TTL cleanup before returning.
   */
  getActiveTask(): PerfProbeTask | undefined {
    this.evictExpired();
    for (const task of this.tasks.values()) {
      if (!isTerminalStatus(task.status)) {
        return task;
      }
    }
    return undefined;
  }

  /**
   * List recent tasks sorted by creation time (most recent first).
   * Triggers TTL cleanup before returning.
   * @param limit Maximum number of tasks to return (default 5, max 20)
   */
  listTasks(limit = 5): PerfProbeTask[] {
    this.evictExpired();
    const sorted = Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
    return sorted.slice(0, limit);
  }

  /**
   * Update a task's fields. Only allowed for non-terminal tasks.
   * Rejects invalid state transitions.
   */
  updateTask(id: string, partial: Partial<PerfProbeTask>): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    // If status is being updated, validate the transition
    if (partial.status !== undefined && partial.status !== task.status) {
      this.validateTransition(task.status, partial.status);
    }

    // Apply updates
    Object.assign(task, partial);

    logger.debug(`PerfProbeTask updated: ${id}`, { status: task.status });
  }

  /**
   * Cancel a task. Works for 'pending' and 'running' states.
   * Returns false if task not found or already in a terminal state.
   */
  cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    if (isTerminalStatus(task.status)) {
      return false;
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();
    logger.debug(`PerfProbeTask cancelled: ${id}`);
    return true;
  }

  /**
   * Validate a state transition.
   * Valid transitions:
   *   pending → running
   *   pending → cancelled
   *   running → completed
   *   running → failed
   *   running → cancelled
   */
  private validateTransition(from: PerfProbeTaskStatus, to: PerfProbeTaskStatus): void {
    const validTransitions: Record<PerfProbeTaskStatus, PerfProbeTaskStatus[]> = {
      pending: ['running', 'cancelled'],
      running: ['completed', 'failed', 'cancelled'],
      completed: [],
      failed: [],
      cancelled: [],
    };

    const allowed = validTransitions[from];
    if (!allowed.includes(to)) {
      throw new Error(`Invalid state transition: ${from} → ${to}`);
    }
  }

  /**
   * Evict expired tasks (completed more than TASK_TTL_MS ago).
   * Called lazily on getTask/getActiveTask.
   */
  private evictExpired(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, task] of this.tasks) {
      if (task.completedAt && now - task.completedAt > TASK_TTL_MS) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.tasks.delete(id);
      logger.debug(`PerfProbeTask evicted (TTL): ${id}`);
    }
  }
}

let storeInstance: PerfProbeTaskStore | undefined;

export function getPerfProbeTaskStore(): PerfProbeTaskStore {
  if (!storeInstance) {
    storeInstance = new PerfProbeTaskStore();
  }
  return storeInstance;
}

export function resetPerfProbeTaskStore(): void {
  storeInstance = undefined;
}
