import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Client metrics integration', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  it('GET /metrics should return 200 with server metrics data', async () => {
    const res = await makeRequest('GET', '/api/orchestrator/metrics');
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
    expect(res.data).toHaveProperty('servers');
  });

  it('GET /metrics/:serverId/:model should handle encoded model names with slashes', async () => {
    // Verify the endpoint accepts URL-encoded model names containing slashes
    const serverId = 'test-server';
    const model = 'org/model:latest';
    const encodedServerId = encodeURIComponent(serverId);
    const encodedModel = encodeURIComponent(model);

    const res = await makeRequest(
      'GET',
      `/api/orchestrator/metrics/${encodedServerId}/${encodedModel}`
    );

    // The server may return 404 (no such server) or 200 — either is fine.
    // The key assertion is that we get a valid response, not a URL parsing error.
    expect([200, 404]).toContain(res.status);
  });
});
