/**
 * API Integration Tests
 * Tests full HTTP endpoints with real server
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('API Integration Tests', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/health');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data).toHaveProperty('status');
      expect(response.data).toHaveProperty('uptime');
      expect(response.data).toHaveProperty('version');
      expect(response.data).toHaveProperty('servers');
    });
  });

  describe('Server Management', () => {
    it('should get empty servers list initially', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/servers');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.servers).toEqual([]);
      expect(response.data.count).toBe(0);
    });

    it('should add a server', async () => {
      const serverData = {
        id: 'test-server',
        url: 'http://localhost:11434',
        type: 'ollama',
      };

      const response = await makeRequest('POST', '/api/orchestrator/servers/add', serverData);

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data).toHaveProperty('id', 'test-server');
      expect(response.data).toHaveProperty('url', 'http://localhost:11434');
    });

    it('should get servers list with added server', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/servers');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.servers)).toBe(true);
      expect(response.data.servers).toHaveLength(1);
      expect(response.data.servers[0]).toHaveProperty('id', 'test-server');
    });

    it('should get stats', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/stats');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.stats).toHaveProperty('totalServers');
      expect(response.data.stats).toHaveProperty('healthyServers');
      expect(response.data.stats).toHaveProperty('totalModels');
      expect(response.data.stats).toHaveProperty('inFlightRequests');
    });
  });

  describe('Configuration', () => {
    it('should get configuration', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/config');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.config).toHaveProperty('queue');
      expect(response.data.config).toHaveProperty('healthCheck');
      expect(response.data.config).toHaveProperty('servers');
    });

    it('should get configuration schema', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/config/schema');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.schema).toHaveProperty('type', 'object');
      expect(response.data.schema).toHaveProperty('properties');
    });
  });

  describe('Queue Management', () => {
    it('should get queue status', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/queue');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.queue).toHaveProperty('currentSize');
      expect(response.data.queue).toHaveProperty('maxSize');
      expect(response.data.queue).toHaveProperty('totalQueued');
    });

    it('should pause and resume queue', async () => {
      // Pause queue
      let response = await makeRequest('POST', '/api/orchestrator/queue/pause');
      expect(response.status).toBe(200);

      expect(response.data.success).toBe(true);
      expect(response.data.paused).toBe(true);

      // Resume queue
      response = await makeRequest('POST', '/api/orchestrator/queue/resume');
      expect(response.status).toBe(200);

      expect(response.data.success).toBe(true);
      expect(response.data.paused).toBe(false);
    });
  });

  describe('Metrics', () => {
    it('should get metrics', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/metrics');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('global');
      expect(response.data).toHaveProperty('servers');
    });

    it('should get Prometheus metrics', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/metrics/prometheus');

      expect(response.status).toBe(200);
      expect(typeof response.data).toBe('string');
      // Should contain Prometheus format metrics
      expect(response.data).toContain('# HELP');
    });
  });

  describe('Ollama-Compatible Endpoints', () => {
    it('should get version', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/version');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('version');
    });

    it('should get tags (may fail without servers)', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/tags');

      // Either 200 with empty results or 500 if no servers
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('Analytics', () => {
    it('should get analytics summary', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/summary');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.summary).toHaveProperty('totalRequests');
      expect(response.data.summary).toHaveProperty('errorRate');
      expect(response.data.summary).toHaveProperty('avgLatency');
    });

    it('should get top models', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/top-models');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.models)).toBe(true);
    });

    it('should get error analysis', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/errors');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data).toHaveProperty('byType');
    });
  });

  describe('Model Management', () => {
    it('should get all models status', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/models/status');

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data).toHaveProperty('summary');
    });

    it('should get warmup recommendations', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/models/recommendations');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.recommendations)).toBe(true);
    });

    it('should get idle models', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/models/idle');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.models)).toBe(true);
    });
  });
});
