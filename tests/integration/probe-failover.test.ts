import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Probe Admin Integration', () => {
  let baseUrl: string;

  beforeAll(async () => {
    const setup = await setupIntegrationTest();
    baseUrl = setup.baseUrl;
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  it('should allow forcing open, inspecting, and resetting a model probe', async () => {
    const serverId = 'cb-test-server';
    const model = 'test-model';

    const addResp = await makeRequest('POST', '/api/orchestrator/servers/add', {
      id: serverId,
      url: 'http://localhost:11450',
      type: 'ollama',
    });
    expect(addResp.status).toBe(200);

    const encodedModel = encodeURIComponent(model);

    const openResp = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/open`
    );
    expect(openResp.status).toBe(200);
    expect(openResp.data).toHaveProperty('success', true);
    expect(openResp.data.circuitBreaker).toBeDefined();
    expect(openResp.data.circuitBreaker.uiState).toBe('OPEN');

    const detailsResp = await makeRequest(
      'GET',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}`
    );
    expect(detailsResp.status).toBe(200);
    expect(detailsResp.data).toHaveProperty('tupleKey');
    expect(detailsResp.data.tupleKey).toBe(`${serverId}:${model}:ollama_chat`);
    expect(detailsResp.data).toHaveProperty('state');

    const serverModelResp = await makeRequest(
      'GET',
      `/api/orchestrator/servers/${serverId}/models/${encodedModel}/circuit-breaker`
    );
    expect(serverModelResp.status).toBe(200);
    expect(serverModelResp.data).toHaveProperty('circuitBreaker');
    expect(serverModelResp.data.circuitBreaker.uiState).toBe('OPEN');

    try {
      const resetResp = await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/reset`
      );
      expect(resetResp.status).toBe(200);
      expect(resetResp.data).toHaveProperty('currentState', 'CLOSED');

      const listResp = await makeRequest('GET', '/api/orchestrator/circuit-breakers');
      expect(listResp.status).toBe(200);
      expect(listResp.data).toHaveProperty('circuitBreakers');
      const found = (listResp.data.circuitBreakers as any[]).some(
        (b: any) => b.serverId === `${serverId}:${model}` || b.serverId === `${serverId}:${model}`
      );
      expect(found).toBe(true);
    } finally {
      const del = await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
      expect([200, 404]).toContain(del.status);
    }
  });
});
