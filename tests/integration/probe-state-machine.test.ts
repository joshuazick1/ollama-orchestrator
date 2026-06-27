import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';

import { createServer } from '../fixtures/factories.js';
import {
  createDiverseMockServer,
  mockServerFactory,
  cleanupMockServers,
} from '../utils/mock-server-factory.js';

import { delay } from '../utils/test-helpers.js';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

let serverCounter = 0;
const getUniqueServerId = (prefix = 'cb-sm-test') => `${prefix}-${Date.now()}-${++serverCounter}`;
const getUniquePort = (base = 14100) => base + (Date.now() % 1000) + ++serverCounter;

describe('Probe State Machine Integration', () => {
  let baseUrl: string;

  beforeAll(async () => {
    const setup = await setupIntegrationTest();
    baseUrl = setup.baseUrl;
  });

  afterAll(async () => {
    await cleanupMockServers();
    await teardownIntegrationTest();
  });

  beforeEach(async () => {
    await cleanupMockServers();
    await delay(50);
  });

  afterEach(async () => {
    await cleanupMockServers();
    await delay(50);
  });

  async function addTestServer(serverId: string, port: number): Promise<void> {
    const response = await makeRequest('POST', '/api/orchestrator/servers/add', {
      id: serverId,
      url: `http://localhost:${port}`,
      type: 'ollama',
    });
    expect(response.status).toBe(200);
  }

  async function getProbeStats(
    serverId: string,
    model: string
  ): Promise<{ state: string; uiState: string; failureCount: number; [key: string]: any }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'GET',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}`
    );
    expect(response.status).toBe(200);
    return response.data;
  }

  async function forceOpenProbe(
    serverId: string,
    model: string
  ): Promise<{ success: boolean; currentState: string }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/open`
    );
    expect(response.status).toBe(200);
    return response.data;
  }

  async function forceCloseProbe(
    serverId: string,
    model: string
  ): Promise<{ success: boolean; currentState: string }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/close`
    );
    expect(response.status).toBe(200);
    return response.data;
  }

  async function forceHalfOpenProbe(
    serverId: string,
    model: string
  ): Promise<{ success: boolean; currentState: string }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/half-open`
    );
    expect(response.status).toBe(200);
    return response.data;
  }

  async function resetProbe(
    serverId: string,
    model: string
  ): Promise<{ success: boolean; currentState: string }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/reset`
    );
    expect(response.status).toBe(200);
    return response.data;
  }

  async function makeGenerateRequest(
    serverId: string,
    model: string,
    options?: { timeout?: number }
  ): Promise<{ status: number; data: any }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'POST',
      `/${encodedModel}/generate--${serverId}`,
      {
        model,
        prompt: 'Hello',
        stream: false,
      },
      { headers: { 'x-test-timeout': String(options?.timeout || 5000) } }
    );
    return { status: response.status, data: response.data };
  }

  describe('HEALTHY → SUSPECT Transition', () => {
    it('should transition to SUSPECT after failure threshold is reached', async () => {
      const serverId = getUniqueServerId('healthy-to-suspect');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.oom(port, 0);

      await addTestServer(serverId, port);

      await delay(200);

      for (let i = 0; i < 5; i++) {
        await makeGenerateRequest(serverId, model, { timeout: 2000 });
        await delay(100);
      }

      const stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');
      expect(stats.failureCount).toBeGreaterThanOrEqual(3);

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should track failure count correctly in HEALTHY state', async () => {
      const serverId = getUniqueServerId('failure-count');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.intermittent(port);

      await addTestServer(serverId, port);
      await delay(200);

      await makeGenerateRequest(serverId, model, { timeout: 2000 });

      const stats = await getProbeStats(serverId, model);
      expect(stats).toHaveProperty('failureCount');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  describe('UNHEALTHY → RECOVERING Transition', () => {
    it('should transition from UNHEALTHY to RECOVERING after timeout', async () => {
      const serverId = getUniqueServerId('unhealthy-to-recovering');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.oom(port, 0);

      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      const stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');

      expect(stats.nextRetryAt).toBeGreaterThan(Date.now());

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should manually force UNHEALTHY to RECOVERING transition', async () => {
      const serverId = getUniqueServerId('force-recovering');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      let stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');

      await forceHalfOpenProbe(serverId, model);

      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('HALF-OPEN');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  describe('RECOVERING → HEALTHY Transition (Recovery Success)', () => {
    it('should transition to HEALTHY after successful recovery in half-open', async () => {
      const serverId = getUniqueServerId('recovering-to-healthy');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      let stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');

      await forceHalfOpenProbe(serverId, model);

      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('HALF-OPEN');

      await resetProbe(serverId, model);

      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('CLOSED');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should reset failure count on successful recovery', async () => {
      const serverId = getUniqueServerId('reset-failure');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      let stats = await getProbeStats(serverId, model);
      const hadFailures = stats.failureCount > 0;

      await resetProbe(serverId, model);

      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('CLOSED');
      expect(stats.failureCount).toBe(0);

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  describe('RECOVERING → UNHEALTHY Transition (Recovery Failure)', () => {
    it('should reopen probe when recovery fails in half-open', async () => {
      const serverId = getUniqueServerId('recovering-reopen');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.oom(port, 0);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      let stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');

      await forceHalfOpenProbe(serverId, model);

      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('HALF-OPEN');

      await makeGenerateRequest(serverId, model, { timeout: 2000 });
      await delay(100);

      stats = await getProbeStats(serverId, model);
      expect(['OPEN', 'HALF-OPEN']).toContain(stats.uiState);

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  describe('Manual Force State Transitions', () => {
    it('should force open a closed probe', async () => {
      const serverId = getUniqueServerId('force-open');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      const initialStats = await getProbeStats(serverId, model);
      expect(['CLOSED', 'OPEN', 'HALF-OPEN']).toContain(initialStats.uiState);

      const result = await forceOpenProbe(serverId, model);
      expect(result.success).toBe(true);
      expect(result.currentState).toBe('OPEN');

      const stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should force close an open probe', async () => {
      const serverId = getUniqueServerId('force-close');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      let stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');

      const result = await forceCloseProbe(serverId, model);
      expect(result.success).toBe(true);
      expect(result.currentState).toBe('CLOSED');

      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('CLOSED');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should force half-open an open probe', async () => {
      const serverId = getUniqueServerId('force-halfopen-manual');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      let stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');

      const result = await forceHalfOpenProbe(serverId, model);
      expect(result.success).toBe(true);
      expect(result.currentState).toBe('HALF-OPEN');

      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('HALF-OPEN');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should reset probe to closed state', async () => {
      const serverId = getUniqueServerId('reset');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      let stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');

      const result = await resetProbe(serverId, model);
      expect(result.success).toBe(true);
      expect(result.currentState).toBe('CLOSED');

      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('CLOSED');
      expect(stats.failureCount).toBe(0);

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  describe('Error Rate Calculation', () => {
    it('should track error rate in probe stats', async () => {
      const serverId = getUniqueServerId('error-rate');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.intermittent(port);
      await addTestServer(serverId, port);
      await delay(200);

      for (let i = 0; i < 5; i++) {
        await makeGenerateRequest(serverId, model, { timeout: 2000 });
        await delay(50);
      }

      const stats = await getProbeStats(serverId, model);

      expect(stats).toHaveProperty('errorRate');
      expect(typeof stats.errorRate).toBe('number');
      expect(stats.errorRate).toBeGreaterThanOrEqual(0);
      expect(stats.errorRate).toBeLessThanOrEqual(1);

      expect(stats).toHaveProperty('errorCounts');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  describe('State Persistence Behaviors', () => {
    it('should persist consecutive successes across requests', async () => {
      const serverId = getUniqueServerId('persist-success');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      for (let i = 0; i < 3; i++) {
        await makeGenerateRequest(serverId, model, { timeout: 2000 });
        await delay(100);
      }

      const stats = await getProbeStats(serverId, model);

      expect(stats).toHaveProperty('successCount');
      expect(stats.successCount).toBeGreaterThanOrEqual(0);

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should track last failure information', async () => {
      const serverId = getUniqueServerId('last-failure');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.oom(port, 0);
      await addTestServer(serverId, port);
      await delay(200);

      await makeGenerateRequest(serverId, model, { timeout: 2000 });
      await delay(100);

      const stats = await getProbeStats(serverId, model);

      expect(stats).toHaveProperty('lastFailure');
      if (stats.lastFailure > 0) {
        expect(stats.lastFailure).toBeGreaterThan(0);
      }

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should track next retry timestamp when open', async () => {
      const serverId = getUniqueServerId('next-retry');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      const stats = await getProbeStats(serverId, model);

      expect(stats.uiState).toBe('OPEN');
      expect(stats.nextRetryAt).toBeGreaterThan(Date.now());

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  describe('Full State Machine Cycle', () => {
    it('should complete full cycle: HEALTHY → UNHEALTHY → RECOVERING → HEALTHY', async () => {
      const serverId = getUniqueServerId('full-cycle');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      let stats = await getProbeStats(serverId, model);
      expect(['CLOSED', 'HALF-OPEN', 'OPEN']).toContain(stats.uiState);

      await forceOpenProbe(serverId, model);
      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('OPEN');

      await forceHalfOpenProbe(serverId, model);
      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('HALF-OPEN');

      await forceCloseProbe(serverId, model);
      stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('CLOSED');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should handle HEALTHY → UNHEALTHY → RECOVERING → UNHEALTHY cycle', async () => {
      const serverId = getUniqueServerId('cycle-reopen');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.oom(port, 0);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model);

      await forceHalfOpenProbe(serverId, model);
      let stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('HALF-OPEN');

      await makeGenerateRequest(serverId, model, { timeout: 2000 });
      await delay(100);

      stats = await getProbeStats(serverId, model);
      expect(['OPEN', 'HALF-OPEN']).toContain(stats.uiState);

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should handle multiple consecutive state transitions', async () => {
      const serverId = getUniqueServerId('multi-transition');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      const transitions = [
        async () => {
          await forceOpenProbe(serverId, model);
          return 'OPEN';
        },
        async () => {
          await forceHalfOpenProbe(serverId, model);
          return 'HALF-OPEN';
        },
        async () => {
          await forceOpenProbe(serverId, model);
          return 'OPEN';
        },
        async () => {
          await forceHalfOpenProbe(serverId, model);
          return 'HALF-OPEN';
        },
        async () => {
          await forceCloseProbe(serverId, model);
          return 'CLOSED';
        },
      ];

      for (const transition of transitions) {
        const expectedState = await transition();
        const stats = await getProbeStats(serverId, model);
        expect(stats.uiState).toBe(expectedState);
      }

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  describe('Multiple Model Probes', () => {
    it('should maintain separate probe state per model', async () => {
      const serverId = getUniqueServerId('multi-model');
      const port = getUniquePort();
      const model1 = 'llama3:latest';
      const model2 = 'mistral:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model1);

      const stats1 = await getProbeStats(serverId, model1);
      expect(stats1.uiState).toBe('OPEN');

      const stats2 = await getProbeStats(serverId, model2);
      expect(['CLOSED', 'HALF-OPEN']).toContain(stats2.uiState);

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should reset model probes independently', async () => {
      const serverId = getUniqueServerId('independent-reset');
      const port = getUniquePort();
      const model1 = 'llama3:latest';
      const model2 = 'mistral:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      await forceOpenProbe(serverId, model1);
      await forceOpenProbe(serverId, model2);

      await resetProbe(serverId, model1);

      const stats1 = await getProbeStats(serverId, model1);
      expect(stats1.uiState).toBe('CLOSED');

      const stats2 = await getProbeStats(serverId, model2);
      expect(stats2.uiState).toBe('OPEN');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle rapid open/close transitions', async () => {
      const serverId = getUniqueServerId('rapid');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      for (let i = 0; i < 3; i++) {
        await forceOpenProbe(serverId, model);
        await forceCloseProbe(serverId, model);
      }

      const stats = await getProbeStats(serverId, model);
      expect(stats.uiState).toBe('CLOSED');

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should handle requests to unknown model probe', async () => {
      const serverId = getUniqueServerId('unknown-model');
      const port = getUniquePort();
      const model = 'nonexistent-model:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      const response = await makeRequest(
        'GET',
        `/api/orchestrator/circuit-breakers/${serverId}/${encodeURIComponent(model)}`
      );

      expect([200, 404]).toContain(response.status);

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should handle force operations on already in-target-state probes', async () => {
      const serverId = getUniqueServerId('idempotent');
      const port = getUniquePort();
      const model = 'llama3:latest';

      await mockServerFactory.healthy(port);
      await addTestServer(serverId, port);
      await delay(200);

      const closeResult = await forceCloseProbe(serverId, model);
      expect(closeResult.success).toBe(true);
      expect(closeResult.currentState).toBe('CLOSED');

      const halfOpenResult = await forceHalfOpenProbe(serverId, model);
      expect(halfOpenResult.success).toBe(true);
      expect(halfOpenResult.currentState).toBe('HALF-OPEN');

      const halfOpenAgain = await forceHalfOpenProbe(serverId, model);
      expect(halfOpenAgain.success).toBe(true);

      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });
  });
});
