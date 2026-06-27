import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Health and Metrics Endpoints', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  describe('GET /health', () => {
    it('should return 200 with health status', async () => {
      const resp = await makeRequest('GET', '/health');
      expect(resp.status).toBe(200);
      expect(resp.data).toHaveProperty('status', 'ok');
      expect(resp.data).toHaveProperty('uptime');
      expect(typeof resp.data.uptime).toBe('number');
      expect(resp.data).toHaveProperty('timestamp');
      expect(resp.data).toHaveProperty('orchestrator');
    });

    it('should return valid ISO timestamp', async () => {
      const resp = await makeRequest('GET', '/health');
      const timestamp = new Date(resp.data.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it('should return orchestrator stats object', async () => {
      const resp = await makeRequest('GET', '/health');
      expect(resp.data.orchestrator).toBeDefined();
      expect(typeof resp.data.orchestrator).toBe('object');
    });
  });

  describe('GET /health/live', () => {
    it('should always return 200 for liveness probe', async () => {
      const resp = await makeRequest('GET', '/health/live');
      expect(resp.status).toBe(200);
      expect(resp.data).toHaveProperty('status', 'ok');
    });

    it('should return simple JSON structure', async () => {
      const resp = await makeRequest('GET', '/health/live');
      expect(Object.keys(resp.data)).toEqual(['status']);
    });
  });

  describe('GET /health/ready', () => {
    it('should return 503 when no healthy servers are available', async () => {
      const resp = await makeRequest('GET', '/health/ready');
      expect(resp.status).toBe(503);
      expect(resp.data).toHaveProperty('status', 'not_ready');
      expect(resp.data).toHaveProperty('reason', 'No healthy servers available');
      expect(resp.data).toHaveProperty('totalServers');
    });
  });

  describe('GET /metrics', () => {
    it('should return 200 with Prometheus text format', async () => {
      const resp = await makeRequest('GET', '/metrics');
      expect(resp.status).toBe(200);
      expect(typeof resp.data).toBe('string');
      expect(resp.data).toContain('# HELP');
      expect(resp.data).toContain('# TYPE');
    });

    it('should return text/plain content for Prometheus format', async () => {
      const resp = await makeRequest('GET', '/metrics');
      expect(resp.status).toBe(200);
      const text = resp.data as string;
      expect(text).toMatch(/^# HELP/);
    });
  });

  describe('GET /api/orchestrator/metrics/prometheus', () => {
    it('should return Prometheus format metrics', async () => {
      const resp = await makeRequest('GET', '/api/orchestrator/metrics/prometheus');
      expect(resp.status).toBe(200);
      expect(typeof resp.data).toBe('string');
      expect(resp.data).toContain('# HELP');
    }, 30000);

    it('should contain orchestrator metrics', async () => {
      const resp = await makeRequest('GET', '/api/orchestrator/metrics/prometheus');
      expect(resp.status).toBe(200);
      const text = resp.data as string;
      expect(text).toMatch(/ollama_orchestrator|# HELP ollama_/);
    }, 30000);
  });
});
