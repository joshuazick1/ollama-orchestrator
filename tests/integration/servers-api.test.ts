import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Servers API Integration', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  it('should add, get list, update, and delete a server', async () => {
    const serverId = 'integration-server-1';
    const data = { id: serverId, url: 'http://localhost:11460', type: 'ollama' };

    // Add
    const add = await makeRequest('POST', '/api/orchestrator/servers/add', data);
    expect(add.status).toBe(200);
    expect(add.data).toHaveProperty('id', serverId);

    // List
    const list = await makeRequest('GET', '/api/orchestrator/servers');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data.servers)).toBe(true);
    expect(list.data.servers.some((s: any) => s.id === serverId)).toBe(true);

    // Update
    const patch = await makeRequest('PATCH', `/api/orchestrator/servers/${serverId}`, {
      maxConcurrency: 8,
    });
    expect(patch.status).toBe(200);
    expect(patch.data).toHaveProperty('maxConcurrency', 8);

    // Delete
    const del = await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    expect(del.status).toBe(200);
  });
});
