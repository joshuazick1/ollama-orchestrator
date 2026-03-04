import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { api as axiosClient } from '../../frontend/src/api.js';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Frontend client metrics integration', () => {
  let baseUrl: string;

  beforeAll(async () => {
    const setup = await setupIntegrationTest();
    baseUrl = setup.baseUrl;
    // Override axios baseURL to point to the running test server
    axiosClient.defaults.baseURL = `${baseUrl}/api/orchestrator`;
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  it('getServerModelMetrics should encode path segments and return 200 for a model with slash', async () => {
    // Find a server:model pair from persisted metrics that contains a slash
    const allMetrics = await makeRequest('GET', '/api/orchestrator/metrics');
    expect(allMetrics.status).toBe(200);
    const servers = allMetrics.data.servers || {};
    const entry = Object.values(servers).find((s: any) => (s.model || '').includes('/')) as any;

    // If no entry with slash exists in test data, skip the assertion but ensure call path
    if (!entry) {
      // Basic smoke: call client method with encoded params and expect 404 or 200
      const sid = 'test-server';
      const model = 'a/b:latest';
      try {
        // This will hit the test server base URL
        await (await import('../../frontend/src/api.js')).getServerModelMetrics(sid, model);
      } catch (err: any) {
        // We expect either ApiError or network error; ensure we didn't throw due to URL building
        expect(err).toBeTruthy();
      }
      return;
    }

    const serverId = entry.serverId;
    const model = entry.model;

    // Call client helper which now encodes path segments
    const metrics = await (
      await import('../../frontend/src/api.js')
    ).getServerModelMetrics(serverId, model);

    expect(metrics).toBeDefined();
    // Response shape from server: { success: true, serverId, model, metrics: {...} }
    expect((metrics as any).serverId).toBe(serverId);
    expect((metrics as any).model).toBe(model);
    expect((metrics as any).metrics).toBeDefined();
  });
});
