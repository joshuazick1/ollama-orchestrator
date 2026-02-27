import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Circuit Breaker Admin Integration', () => {
  let baseUrl: string;

  beforeAll(async () => {
    const setup = await setupIntegrationTest();
    baseUrl = setup.baseUrl;
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  it('should allow forcing open, inspecting, and resetting a model circuit breaker', async () => {
    const serverId = 'cb-test-server';
    const model = 'test-model';

    // Add a server first
    const addResp = await makeRequest('POST', '/api/orchestrator/servers/add', {
      id: serverId,
      url: 'http://localhost:11450',
      type: 'ollama',
    });
    expect(addResp.status).toBe(200);

    const encodedModel = encodeURIComponent(model);

    // Force-open the model circuit breaker
    const openResp = await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/open`
    );
    expect(openResp.status).toBe(200);
    expect(openResp.data).toHaveProperty('success', true);
    expect(openResp.data.circuitBreaker).toBeDefined();
    expect(openResp.data.circuitBreaker.state).toBe('OPEN');

    // Get breaker details via the admin endpoint
    const detailsResp = await makeRequest(
      'GET',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}`
    );
    expect(detailsResp.status).toBe(200);
    expect(detailsResp.data).toHaveProperty('key');
    expect(detailsResp.data.key).toBe(`${serverId}:${model}`);
    expect(detailsResp.data).toHaveProperty('stats');

    // Also inspect via the per-server model endpoint
    const serverModelResp = await makeRequest(
      'GET',
      `/api/orchestrator/servers/${serverId}/models/${encodedModel}/circuit-breaker`
    );
    expect(serverModelResp.status).toBe(200);
    expect(serverModelResp.data).toHaveProperty('circuitBreaker');
    expect(serverModelResp.data.circuitBreaker.state).toBe('OPEN');

    try {
      // Reset the breaker
      const resetResp = await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/reset`
      );
      expect(resetResp.status).toBe(200);
      expect(resetResp.data).toHaveProperty('currentState', 'closed');

      // Ensure the breaker shows up in the global list
      const listResp = await makeRequest('GET', '/api/orchestrator/circuit-breakers');
      expect(listResp.status).toBe(200);
      expect(listResp.data).toHaveProperty('circuitBreakers');
      const found = (listResp.data.circuitBreakers as any[]).some(
        (b: any) => b.serverId === `${serverId}:${model}` || b.serverId === `${serverId}:${model}`
      );
      expect(found).toBe(true);
    } finally {
      // Cleanup: remove the test server so other tests are not impacted
      const del = await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
      expect([200, 404]).toContain(del.status);
    }
  });
});
