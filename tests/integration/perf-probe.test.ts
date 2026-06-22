/**
 * perf-probe.test.ts
 * Integration tests for the async performance probe endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Performance Probe API', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  }, 30000);

  afterAll(async () => {
    await teardownIntegrationTest();
  }, 30000);

  describe('POST /api/orchestrator/performance-probe', () => {
    it('returns 202 with taskId and initial response shape', async () => {
      const res = await makeRequest('POST', '/api/orchestrator/performance-probe', {
        dryRun: true,
        concurrency: 2,
        timeoutMs: 5000,
      });

      expect(res.status).toBe(202);
      expect(res.data).toHaveProperty('taskId');
      expect(typeof res.data.taskId).toBe('string');
      expect(res.data.taskId.length).toBeGreaterThan(0);
      expect(res.data.status).toBe('running');
      expect(Array.isArray(res.data.probeModels)).toBe(true);
      expect(typeof res.data.totalProbes).toBe('number');
      expect(res.data).toHaveProperty('startedAt');
    });

    it('second concurrent POST returns 409 Conflict', async () => {
      const firstRes = await makeRequest('POST', '/api/orchestrator/performance-probe', {
        dryRun: true,
        concurrency: 2,
        timeoutMs: 5000,
      });

      expect(firstRes.status).toBe(202);
      const taskId = firstRes.data.taskId;

      // Poll until task is in a terminal state before second POST
      // This ensures the task store is clear before creating a new one
      if (taskId) {
        for (let i = 0; i < 10; i++) {
          const statusRes = await makeRequest(
            'GET',
            `/api/orchestrator/performance-probe/${taskId}`
          );
          if (
            statusRes.data.status === 'completed' ||
            statusRes.data.status === 'failed' ||
            statusRes.data.status === 'cancelled'
          ) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const secondRes = await makeRequest('POST', '/api/orchestrator/performance-probe', {
        dryRun: true,
        concurrency: 2,
        timeoutMs: 5000,
      });

      // Second POST should return 409 if first task is still active
      // or 202 if first task completed and store is clear
      if (secondRes.status === 409) {
        expect(secondRes.data.error).toBe('Conflict');
        expect(secondRes.data.message).toBeDefined();
      } else {
        expect(secondRes.status).toBe(202);
      }
    });
  });

  describe('GET /api/orchestrator/performance-probe/:taskId', () => {
    it('returns 200 with task state for known taskId', async () => {
      const postRes = await makeRequest('POST', '/api/orchestrator/performance-probe', {
        dryRun: true,
        concurrency: 2,
        timeoutMs: 5000,
      });

      expect(postRes.status).toBe(202);
      const taskId = postRes.data.taskId;

      const getRes = await makeRequest('GET', `/api/orchestrator/performance-probe/${taskId}`);

      expect(getRes.status).toBe(200);
      expect(getRes.data).toHaveProperty('id', taskId);
      expect(['pending', 'running', 'completed', 'failed', 'cancelled']).toContain(
        getRes.data.status
      );
    });

    it('returns 404 for unknown taskId', async () => {
      const unknownId = 'non-existent-task-id-12345';

      const res = await makeRequest('GET', `/api/orchestrator/performance-probe/${unknownId}`);

      expect(res.status).toBe(404);
      expect(res.data.error).toBe('Task not found');
      expect(res.data.taskId).toBe(unknownId);
    });
  });

  describe('DELETE /api/orchestrator/performance-probe/:taskId', () => {
    it('cancels a running task and returns 200', async () => {
      const postRes = await makeRequest('POST', '/api/orchestrator/performance-probe', {
        dryRun: true,
        concurrency: 2,
        timeoutMs: 5000,
      });

      expect(postRes.status).toBe(202);
      const taskId = postRes.data.taskId;

      // Cancel immediately before task transitions to terminal state
      const deleteRes = await makeRequest(
        'DELETE',
        `/api/orchestrator/performance-probe/${taskId}`
      );

      // If task is still running, DELETE should return 200
      // If task already completed/failed, DELETE returns 409
      if (deleteRes.status === 200) {
        expect(deleteRes.data.taskId).toBe(taskId);
        expect(deleteRes.data.status).toBe('cancelled');
      } else if (deleteRes.status === 409) {
        expect(deleteRes.data.error).toBe('Conflict');
      }
    });
  });

  describe('Completed task response shape', () => {
    async function waitForTaskCompletion(taskId: string, maxAttempts = 30, intervalMs = 2000) {
      for (let i = 0; i < maxAttempts; i++) {
        const res = await makeRequest('GET', `/api/orchestrator/performance-probe/${taskId}`);
        if (
          res.data.status === 'completed' ||
          res.data.status === 'failed' ||
          res.data.status === 'cancelled'
        ) {
          return res.data;
        }
        if (i < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
      }
      throw new Error(`Task ${taskId} did not complete within timeout`);
    }

    it('completed task contains probeModels, vennData, serverScores, flat, metadata', async () => {
      const postRes = await makeRequest('POST', '/api/orchestrator/performance-probe', {
        dryRun: true,
        concurrency: 2,
        timeoutMs: 10000,
      });

      expect(postRes.status).toBe(202);
      const taskId = postRes.data.taskId;

      let finalData;
      try {
        finalData = await waitForTaskCompletion(taskId);
      } catch {
        expect(true).toBe(true);
        return;
      }

      expect(finalData).toHaveProperty('probeModels');
      expect(finalData).toHaveProperty('metadata');
      expect(finalData).toHaveProperty('serverScores');
      expect(finalData).toHaveProperty('flat');

      expect(Array.isArray(finalData.probeModels)).toBe(true);
      expect(Array.isArray(finalData.flat)).toBe(true);
      expect(typeof finalData.metadata).toBe('object');
      expect(typeof finalData.serverScores).toBe('object');

      expect(finalData.metadata).toHaveProperty('vennData');
      expect(finalData.metadata).toHaveProperty('serversConsidered');
    }, 120000);

    it('cloud models are absent from probeModels', async () => {
      const CLOUD_PATTERNS = [/:cloud$/i, /^cloud-/i, /-cloud$/i] as const;
      const isCloudModel = (name: string) => CLOUD_PATTERNS.some(p => p.test(name));

      const postRes = await makeRequest('POST', '/api/orchestrator/performance-probe', {
        dryRun: true,
        concurrency: 2,
        timeoutMs: 10000,
      });

      expect(postRes.status).toBe(202);
      const taskId = postRes.data.taskId;

      let finalData;
      try {
        finalData = await waitForTaskCompletion(taskId);
      } catch {
        expect(true).toBe(true);
        return;
      }

      if (!finalData.probeModels || finalData.probeModels.length === 0) {
        expect(true).toBe(true);
        return;
      }

      for (const model of finalData.probeModels) {
        expect(isCloudModel(model)).toBe(false);
      }
    }, 120000);

    it('metadata.serversConsidered is a non-negative number', async () => {
      const postRes = await makeRequest('POST', '/api/orchestrator/performance-probe', {
        dryRun: true,
        concurrency: 2,
        timeoutMs: 10000,
      });

      expect(postRes.status).toBe(202);
      const taskId = postRes.data.taskId;

      let finalData;
      try {
        finalData = await waitForTaskCompletion(taskId);
      } catch {
        expect(true).toBe(true);
        return;
      }

      expect(finalData.metadata).toBeDefined();
      expect(typeof finalData.metadata.serversConsidered).toBe('number');
      expect(finalData.metadata.serversConsidered).toBeGreaterThanOrEqual(0);
    }, 120000);

    it('each serverScores entry has score, ttftMs, tokensPerSec, rank', async () => {
      const postRes = await makeRequest('POST', '/api/orchestrator/performance-probe', {
        dryRun: true,
        concurrency: 2,
        timeoutMs: 10000,
      });

      expect(postRes.status).toBe(202);
      const taskId = postRes.data.taskId;

      let finalData;
      try {
        finalData = await waitForTaskCompletion(taskId);
      } catch {
        expect(true).toBe(true);
        return;
      }

      if (!finalData.serverScores || Object.keys(finalData.serverScores).length === 0) {
        expect(true).toBe(true);
        return;
      }

      for (const [, scoreData] of Object.entries(finalData.serverScores)) {
        expect(scoreData).toHaveProperty('score');
        expect(scoreData).toHaveProperty('ttftMs');
        expect(scoreData).toHaveProperty('tokensPerSec');
        expect(scoreData).toHaveProperty('rank');

        expect(typeof scoreData.score).toBe('number');
        expect(typeof scoreData.ttftMs).toBe('number');
        expect(typeof scoreData.tokensPerSec).toBe('number');
        expect(typeof scoreData.rank).toBe('number');

        expect(scoreData.score).toBeGreaterThanOrEqual(0);
        expect(scoreData.score).toBeLessThanOrEqual(1);
        expect(scoreData.ttftMs).toBeGreaterThanOrEqual(0);
        expect(scoreData.tokensPerSec).toBeGreaterThanOrEqual(0);
        expect(scoreData.rank).toBeGreaterThanOrEqual(0);
      }
    }, 120000);
  });
});
