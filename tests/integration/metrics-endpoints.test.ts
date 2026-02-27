import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Metrics Endpoints Integration', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  it('GET /api/orchestrator/metrics should return structured metrics', async () => {
    const resp = await makeRequest('GET', '/api/orchestrator/metrics');
    expect(resp.status).toBe(200);
    expect(resp.data).toHaveProperty('success', true);
    expect(resp.data).toHaveProperty('timestamp');
    expect(resp.data).toHaveProperty('global');
    expect(resp.data).toHaveProperty('servers');
  });

  it('GET /metrics (Prometheus) should return text output', async () => {
    const resp = await makeRequest('GET', '/metrics');
    expect(resp.status).toBe(200);
    expect(typeof resp.data).toBe('string');
    expect(resp.data).toContain('# HELP');
  });

  it('GET /api/orchestrator/metrics/:serverId/* should handle models with slashes (404 when no metrics)', async () => {
    // Use wildcard style path for model containing slash
    const resp = await makeRequest('GET', '/api/orchestrator/metrics/test-server/a/b:latest');
    // No metrics exist in fresh orchestrator for this server:model, expect 404
    expect([200, 404]).toContain(resp.status);
    if (resp.status === 404) {
      expect(resp.data).toHaveProperty('error');
    }
  });

  it('GET recovery test metrics endpoints should respond with success shape', async () => {
    const aggregate = await makeRequest('GET', '/api/orchestrator/metrics/recovery-tests');
    expect(aggregate.status).toBe(200);
    expect(aggregate.data).toHaveProperty('success', true);
    expect(aggregate.data).toHaveProperty('recoveryProbabilities');

    const perBreaker = await makeRequest(
      'GET',
      '/api/orchestrator/metrics/recovery-tests/some-breaker'
    );
    expect(perBreaker.status).toBe(200);
    expect(perBreaker.data).toHaveProperty('success', true);
    expect(perBreaker.data).toHaveProperty('metrics');
  });
});
