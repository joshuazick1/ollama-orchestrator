import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Capability Probe Endpoint Integration', () => {
  const testServerId = 'probe-test-server';
  const mockPort = 11499;

  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  it('POST /api/orchestrator/servers/:id/capability-probe returns 404 for unknown server', async () => {
    const response = await makeRequest(
      'POST',
      `/api/orchestrator/servers/unknown-server/capability-probe`
    );
    expect(response.status).toBe(404);
    expect(response.data.success).toBe(false);
  });

  it('POST /api/orchestrator/servers/:id/capability-probe triggers probe and returns cycle result', async () => {
    await makeRequest('POST', '/api/orchestrator/servers/add', {
      id: testServerId,
      url: `http://localhost:${mockPort}`,
      type: 'ollama',
    });

    const response = await makeRequest(
      'POST',
      `/api/orchestrator/servers/${testServerId}/capability-probe`
    );
    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
    expect(response.data).toHaveProperty('serverId', testServerId);
    expect(response.data).toHaveProperty('confirmed');
    expect(response.data).toHaveProperty('revoked');
    expect(response.data).toHaveProperty('rateLimited');
    expect(response.data).toHaveProperty('errors');
    expect(Array.isArray(response.data.errors)).toBe(true);
  });
});
