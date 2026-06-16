import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { createDiverseMockServer, cleanupMockServers } from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';

let serverCounter = 0;
const getUniqueServerId = (prefix = 'recovering') => `${prefix}-${Date.now()}-${++serverCounter}`;
const getUniquePort = (base = 14150) => base + (Date.now() % 1000) + ++serverCounter;

describe('Server.recovering state flag', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await cleanupMockServers();
    await teardownIntegrationTest();
  });

  beforeEach(async () => {
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

  function getServerFromOrchestrator(serverId: string): any {
    const orch = getOrchestratorInstance();
    return orch.getServer(serverId);
  }

  async function forceOpenProbe(serverId: string, model: string): Promise<void> {
    const encodedModel = encodeURIComponent(model);
    await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/open`
    );
  }

  async function forceCloseProbe(serverId: string, model: string): Promise<void> {
    const encodedModel = encodeURIComponent(model);
    await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/close`
    );
  }

  async function getProbeStats(
    serverId: string,
    model: string
  ): Promise<{ state: string; uiState: string; failureCount: number }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'GET',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}`
    );
    return response.data;
  }

  it('should set server.recovering = true when health check passes but probe is open', async () => {
    const serverId = getUniqueServerId('srv-recovering');
    const port = getUniquePort();
    const model = 'llama3.1:8b';

    const mockServer = await createDiverseMockServer(port, {
      '/api/tags': {
        status: 200,
        body: { models: [{ name: model, size: 5e9, digest: 'sha123' }] },
      },
      '/api/generate': { status: 200, body: { response: 'test', done: true } },
    });

    try {
      await addTestServer(serverId, port);

      const serverBefore = getServerFromOrchestrator(serverId);
      expect(serverBefore).toBeDefined();
      expect(serverBefore.healthy).toBe(true);

      await forceOpenProbe(serverId, model);

      const cbBefore = await getProbeStats(serverId, model);
      expect(cbBefore.uiState).toBe('OPEN');

      await makeRequest('POST', '/api/orchestrator/health-check');

      await delay(200);

      const serverAfter = getServerFromOrchestrator(serverId);

      expect(serverAfter.healthy).toBe(true);
      expect(serverAfter.recovering).toBe(true);
    } finally {
      await mockServer.close();
    }
  });

  it('should set server.recovering = false when probe transitions to closed', async () => {
    const serverId = getUniqueServerId('srv-recovering-cb-close');
    const port = getUniquePort();
    const model = 'llama3.1:8b';

    const mockServer = await createDiverseMockServer(port, {
      '/api/tags': {
        status: 200,
        body: { models: [{ name: model, size: 5e9, digest: 'sha123' }] },
      },
      '/api/generate': { status: 200, body: { response: 'test', done: true } },
    });

    try {
      await addTestServer(serverId, port);

      const orch = getOrchestratorInstance();
      const server = orch.getServer(serverId);
      expect(server).toBeDefined();

      server.recovering = true;

      await forceCloseProbe(serverId, model);

      await delay(100);

      const serverAfter = getServerFromOrchestrator(serverId);
      expect(serverAfter.recovering).toBe(false);
    } finally {
      await mockServer.close();
    }
  });

  it('should set server.recovering = false when server becomes unhealthy', async () => {
    const serverId = getUniqueServerId('srv-unhealthy-recovering');
    const port = getUniquePort();
    const model = 'llama3.1:8b';

    let healthCheckCount = 0;
    const mockServer = await createDiverseMockServer(port, {
      '/api/tags': () => {
        healthCheckCount++;
        if (healthCheckCount > 1) {
          return { status: 500, body: { error: 'Service unavailable' } };
        }
        return { status: 200, body: { models: [{ name: model, size: 5e9, digest: 'sha123' }] } };
      },
      '/api/generate': { status: 200, body: { response: 'test', done: true } },
    });

    try {
      await addTestServer(serverId, port);

      const orch = getOrchestratorInstance();
      const server = orch.getServer(serverId);
      expect(server).toBeDefined();
      server.recovering = true;

      await makeRequest('POST', '/api/orchestrator/health-check');

      await delay(200);

      const serverAfter = getServerFromOrchestrator(serverId);

      expect(serverAfter.healthy).toBe(false);
      expect(serverAfter.recovering).toBe(false);
    } finally {
      await mockServer.close();
    }
  });

  it('should include recovering flag in GET /api/orchestrator/servers response', async () => {
    const serverId = getUniqueServerId('srv-api-response');
    const port = getUniquePort();
    const model = 'llama3.1:8b';

    const mockServer = await createDiverseMockServer(port, {
      '/api/tags': {
        status: 200,
        body: { models: [{ name: model, size: 5e9, digest: 'sha123' }] },
      },
      '/api/generate': { status: 200, body: { response: 'test', done: true } },
    });

    try {
      await addTestServer(serverId, port);

      const response = await makeRequest('GET', '/api/orchestrator/servers');
      expect(response.status).toBe(200);

      const serverInfo = response.data.servers.find((s: any) => s.id === serverId);
      expect(serverInfo).toBeDefined();

      expect(serverInfo).toHaveProperty('recovering');
      expect(typeof serverInfo.recovering).toBe('boolean');
    } finally {
      await mockServer.close();
    }
  });
});
