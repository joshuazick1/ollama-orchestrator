import { describe, it, expect, beforeEach } from 'vitest';

import {
  PerfProbeTaskStore,
  getPerfProbeTaskStore,
  resetPerfProbeTaskStore,
  TaskConflictError,
  TASK_TTL_MS,
} from '../../src/utils/perf-probe-task-store';

describe('PerfProbeTaskStore', () => {
  let store: PerfProbeTaskStore;

  beforeEach(() => {
    resetPerfProbeTaskStore();
    store = getPerfProbeTaskStore();
  });

  describe('createTask', () => {
    it('should create a task in pending state', () => {
      const task = store.createTask();
      expect(task.status).toBe('pending');
      expect(task.id).toBeDefined();
      expect(task.createdAt).toBeGreaterThan(0);
    });

    it('should create a task with initial state', () => {
      const task = store.createTask({
        probeModels: ['llama3:8b'],
        metadata: { foo: 'bar' },
      });
      expect(task.probeModels).toEqual(['llama3:8b']);
      expect(task.metadata).toEqual({ foo: 'bar' });
    });

    it('should throw TaskConflictError if active task exists (pending)', () => {
      store.createTask();
      expect(() => store.createTask()).toThrow(TaskConflictError);
    });

    it('should throw TaskConflictError if active task exists (running)', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      expect(() => store.createTask()).toThrow(TaskConflictError);
    });

    it('should allow createTask after active task completes', () => {
      const task1 = store.createTask();
      store.updateTask(task1.id, { status: 'running' });
      store.updateTask(task1.id, { status: 'completed' });
      const task2 = store.createTask();
      expect(task2.status).toBe('pending');
      expect(task2.id).not.toBe(task1.id);
    });

    it('should allow createTask after active task fails', () => {
      const task1 = store.createTask();
      store.updateTask(task1.id, { status: 'running' });
      store.updateTask(task1.id, { status: 'failed' });
      const task2 = store.createTask();
      expect(task2.status).toBe('pending');
    });

    it('should allow createTask after active task is cancelled', () => {
      const task1 = store.createTask();
      store.cancelTask(task1.id);
      const task2 = store.createTask();
      expect(task2.status).toBe('pending');
    });
  });

  describe('getTask', () => {
    it('should return task by id', () => {
      const task = store.createTask();
      const found = store.getTask(task.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(task.id);
    });

    it('should return undefined for non-existent id', () => {
      const found = store.getTask('non-existent-id');
      expect(found).toBeUndefined();
    });
  });

  describe('getActiveTask', () => {
    it('should return undefined when no active task', () => {
      expect(store.getActiveTask()).toBeUndefined();
    });

    it('should return the active pending task', () => {
      const task = store.createTask();
      expect(store.getActiveTask()?.id).toBe(task.id);
      expect(store.getActiveTask()?.status).toBe('pending');
    });

    it('should return the active running task', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      expect(store.getActiveTask()?.id).toBe(task.id);
      expect(store.getActiveTask()?.status).toBe('running');
    });

    it('should return undefined when only completed tasks exist', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, { status: 'completed' });
      expect(store.getActiveTask()).toBeUndefined();
    });

    it('should return undefined when only failed tasks exist', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, { status: 'failed' });
      expect(store.getActiveTask()).toBeUndefined();
    });

    it('should return undefined when only cancelled tasks exist', () => {
      const task = store.createTask();
      store.cancelTask(task.id);
      expect(store.getActiveTask()).toBeUndefined();
    });
  });

  describe('updateTask', () => {
    it('should update task fields', () => {
      const task = store.createTask();
      store.updateTask(task.id, { probeModels: ['llama3:8b', 'codellama:7b'] });
      const updated = store.getTask(task.id);
      expect(updated?.probeModels).toEqual(['llama3:8b', 'codellama:7b']);
    });

    it('should allow pending → running transition', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      expect(store.getTask(task.id)?.status).toBe('running');
    });

    it('should allow running → completed transition', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, { status: 'completed', completedAt: Date.now() });
      expect(store.getTask(task.id)?.status).toBe('completed');
    });

    it('should allow running → failed transition', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, { status: 'failed', completedAt: Date.now() });
      expect(store.getTask(task.id)?.status).toBe('failed');
    });

    it('should reject invalid state transition: completed → running', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, { status: 'completed', completedAt: Date.now() });
      expect(() => store.updateTask(task.id, { status: 'running' })).toThrow();
    });

    it('should reject invalid state transition: completed → pending', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, { status: 'completed', completedAt: Date.now() });
      expect(() => store.updateTask(task.id, { status: 'pending' })).toThrow();
    });

    it('should reject invalid state transition: pending → completed', () => {
      const task = store.createTask();
      expect(() => store.updateTask(task.id, { status: 'completed' })).toThrow();
    });

    it('should throw for non-existent task', () => {
      expect(() => store.updateTask('non-existent', { status: 'running' })).toThrow(
        'Task not found'
      );
    });
  });

  describe('cancelTask', () => {
    it('should cancel a pending task', () => {
      const task = store.createTask();
      const result = store.cancelTask(task.id);
      expect(result).toBe(true);
      expect(store.getTask(task.id)?.status).toBe('cancelled');
      expect(store.getTask(task.id)?.completedAt).toBeGreaterThan(0);
    });

    it('should cancel a running task', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      const result = store.cancelTask(task.id);
      expect(result).toBe(true);
      expect(store.getTask(task.id)?.status).toBe('cancelled');
    });

    it('should return false for completed task', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, { status: 'completed', completedAt: Date.now() });
      const result = store.cancelTask(task.id);
      expect(result).toBe(false);
    });

    it('should return false for failed task', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, { status: 'failed', completedAt: Date.now() });
      const result = store.cancelTask(task.id);
      expect(result).toBe(false);
    });

    it('should return false for already cancelled task', () => {
      const task = store.createTask();
      store.cancelTask(task.id);
      const result = store.cancelTask(task.id);
      expect(result).toBe(false);
    });

    it('should return false for non-existent task', () => {
      const result = store.cancelTask('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('TTL cleanup', () => {
    it('should evict completed tasks older than TTL on getTask', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, {
        status: 'completed',
        completedAt: Date.now() - TASK_TTL_MS - 1000,
      });

      const found = store.getTask(task.id);
      expect(found).toBeUndefined();
    });

    it('should retain completed tasks within TTL on getTask', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, { status: 'completed', completedAt: Date.now() - 1000 });

      const found = store.getTask(task.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(task.id);
    });

    it('should evict completed tasks older than TTL on getActiveTask', () => {
      const task = store.createTask();
      store.updateTask(task.id, { status: 'running' });
      store.updateTask(task.id, {
        status: 'completed',
        completedAt: Date.now() - TASK_TTL_MS - 1000,
      });

      const active = store.getActiveTask();
      expect(active).toBeUndefined();
    });
  });

  describe('singleton', () => {
    it('should return the same instance from getPerfProbeTaskStore', () => {
      const instance1 = getPerfProbeTaskStore();
      const instance2 = getPerfProbeTaskStore();
      expect(instance1).toBe(instance2);
    });

    it('should share state across getPerfProbeTaskStore calls', () => {
      const instance1 = getPerfProbeTaskStore();
      const task = instance1.createTask();

      const instance2 = getPerfProbeTaskStore();
      expect(instance2.getTask(task.id)).toBeDefined();
      expect(instance2.getActiveTask()?.id).toBe(task.id);
    });
  });

  describe('TaskConflictError', () => {
    it('should have correct name', () => {
      const error = new TaskConflictError('test');
      expect(error.name).toBe('TaskConflictError');
    });

    it('should be an instance of Error', () => {
      const error = new TaskConflictError('test');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
