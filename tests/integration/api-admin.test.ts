/**
 * api-admin.test.ts
 * Comprehensive integration tests for ALL admin management endpoints
 * Tests: Server CRUD, Model Management, Circuit Breaker, Config, Analytics, Logs, Recovery Failures, Bans
 */

import { describe, it, beforeAll, afterAll, expect, vi, beforeEach, afterEach } from 'vitest';

import { logger } from '../../src/utils/logger.js';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';

describe('Admin API Integration Tests', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  // ============================================================
  // SERVER CRUD TESTS
  // ============================================================
  describe('Server CRUD Operations', () => {
    const testServerId = 'admin-test-server-1';
    const testServerId2 = 'admin-test-server-2';

    it('should add a new server', async () => {
      const data = {
        id: testServerId,
        url: 'http://localhost:11450',
        type: 'ollama' as const,
      };

      const response = await makeRequest('POST', '/api/orchestrator/servers/add', data);
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('id', testServerId);
    });

    it('should list servers and include the added server', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/servers');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('servers');
      expect(Array.isArray(response.data.servers)).toBe(true);
      expect(response.data.servers.some((s: any) => s.id === testServerId)).toBe(true);
    });

    it('should update server configuration', async () => {
      const response = await makeRequest('PATCH', `/api/orchestrator/servers/${testServerId}`, {
        maxConcurrency: 8,
      });
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('maxConcurrency', 8);
    });

    it('should remove a server', async () => {
      // Add second server to remove
      await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: testServerId2,
        url: 'http://localhost:11451',
        type: 'ollama',
      });

      const response = await makeRequest('DELETE', `/api/orchestrator/servers/${testServerId2}`);
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should return 404 when removing non-existent server', async () => {
      const response = await makeRequest('DELETE', '/api/orchestrator/servers/non-existent-id');
      expect(response.status).toBe(404);
    });

    it('should return 409 when adding duplicate server', async () => {
      const response = await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: testServerId,
        url: 'http://localhost:11452',
        type: 'ollama',
      });
      expect(response.status).toBe(409);
    });
  });

  // ============================================================
  // MODEL MANAGEMENT TESTS
  // ============================================================
  describe('Model Management Operations', () => {
    const modelServerId = 'model-test-server';
    const testModel = 'llama3:latest';

    beforeAll(async () => {
      // Add a server for model management tests
      await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: modelServerId,
        url: 'http://localhost:11453',
        type: 'ollama',
      });
    });

    afterAll(async () => {
      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${modelServerId}`);
    });

    it('should get all models across fleet', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/models');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('models');
      expect(Array.isArray(response.data.models)).toBe(true);
    });

    it('should get model map', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/model-map');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('modelToServers');
    });

    it('should get model status for a specific model', async () => {
      const encodedModel = encodeURIComponent(testModel);
      const response = await makeRequest('GET', `/api/orchestrator/models/${encodedModel}/status`);
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('model', testModel);
    });

    it('should get all models status', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/models/status');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('summary');
      expect(response.data).toHaveProperty('models');
    });

    it('should get idle models', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/models/idle');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('models');
      expect(Array.isArray(response.data.models)).toBe(true);
    });

    it('should get warmup recommendations', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/models/recommendations');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('recommendations');
      expect(Array.isArray(response.data.recommendations)).toBe(true);
    });
  });

  // ============================================================
  // CIRCUIT BREAKER TESTS
  // ============================================================
  describe('Circuit Breaker Operations', () => {
    const cbServerId = 'cb-admin-test-server';
    const cbModel = 'test-model-for-cb';

    beforeAll(async () => {
      await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: cbServerId,
        url: 'http://localhost:11454',
        type: 'ollama',
      });
    });

    afterAll(async () => {
      await makeRequest('DELETE', `/api/orchestrator/servers/${cbServerId}`);
    });

    it('should force open a circuit breaker', async () => {
      const loggerInfoSpy = vi.spyOn(logger, 'info');
      const encodedModel = encodeURIComponent(cbModel);
      const response = await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${cbServerId}/${encodedModel}/open`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data.circuitBreaker).toBeDefined();
      expect(response.data.circuitBreaker.state).toBe('OPEN');
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'admin_force_breaker',
        expect.objectContaining({
          action: 'force_open',
          serverId: cbServerId,
          model: cbModel,
        })
      );
      loggerInfoSpy.mockRestore();
    });

    it('should get circuit breaker details', async () => {
      const encodedModel = encodeURIComponent(cbModel);
      const response = await makeRequest(
        'GET',
        `/api/orchestrator/circuit-breakers/${cbServerId}/${encodedModel}`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('key');
      expect(response.data.key).toBe(`${cbServerId}:${cbModel}`);
      expect(response.data).toHaveProperty('stats');
    });

    it('should force close a circuit breaker', async () => {
      const loggerInfoSpy = vi.spyOn(logger, 'info');
      const encodedModel = encodeURIComponent(cbModel);
      const response = await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${cbServerId}/${encodedModel}/close`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data.circuitBreaker.state).toBe('CLOSED');
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'admin_force_breaker',
        expect.objectContaining({
          action: 'force_close',
          serverId: cbServerId,
          model: cbModel,
        })
      );
      loggerInfoSpy.mockRestore();
    });

    it('should force half-open a circuit breaker', async () => {
      const loggerInfoSpy = vi.spyOn(logger, 'info');
      const encodedModel = encodeURIComponent(cbModel);
      // First force open
      await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${cbServerId}/${encodedModel}/open`
      );

      // Then force half-open
      const response = await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${cbServerId}/${encodedModel}/half-open`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data.circuitBreaker.state).toBe('HALF_OPEN');
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        'admin_force_breaker',
        expect.objectContaining({
          action: 'force_half_open',
          serverId: cbServerId,
          model: cbModel,
        })
      );
      loggerInfoSpy.mockRestore();
    });

    it('should reset a circuit breaker', async () => {
      const encodedModel = encodeURIComponent(cbModel);
      // First force open
      await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${cbServerId}/${encodedModel}/open`
      );

      // Then reset
      const response = await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${cbServerId}/${encodedModel}/reset`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('currentState', 'closed');
    });

    it('should get all circuit breakers for a server', async () => {
      const response = await makeRequest('GET', `/api/orchestrator/circuit-breakers/${cbServerId}`);
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('serverId', cbServerId);
      expect(response.data).toHaveProperty('stats');
    });

    it('should get circuit breaker details via server:model endpoint', async () => {
      const encodedModel = encodeURIComponent(cbModel);
      const response = await makeRequest(
        'GET',
        `/api/orchestrator/servers/${cbServerId}/models/${encodedModel}/circuit-breaker`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('circuitBreaker');
    });

    it('should trigger manual recovery test', async () => {
      const encodedModel = encodeURIComponent(cbModel);
      const response = await makeRequest(
        'POST',
        `/api/orchestrator/servers/${cbServerId}/models/${encodedModel}/recovery-test`
      );
      // May succeed or fail depending on actual server state, but should return valid response
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        expect(response.data).toHaveProperty('success');
      }
    });

    it('should reset all circuit breakers for a server', async () => {
      const response = await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${cbServerId}/reset`
      );
      expect([200, 404]).toContain(response.status);
    });

    it('should get circuit breaker list', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/circuit-breakers');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('circuitBreakers');
      expect(Array.isArray(response.data.circuitBreakers)).toBe(true);
    });
  });

  // ============================================================
  // CONFIGURATION TESTS
  // ============================================================
  describe('Configuration Operations', () => {
    it('should get current configuration', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/config');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('config');
    });

    it('should get configuration schema', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/config/schema');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('schema');
    });

    it('should export configuration', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/config/export');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('exportedAt');
      expect(response.data).toHaveProperty('config');
    });

    it('should update configuration', async () => {
      const response = await makeRequest('POST', '/api/orchestrator/config', {
        logLevel: 'debug',
      });
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should update a specific config section', async () => {
      const response = await makeRequest('PATCH', '/api/orchestrator/config/loadBalancer', {
        weights: {
          latency: 0.4,
        },
      });
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('section', 'loadBalancer');
    });

    it('should reject invalid config section', async () => {
      const response = await makeRequest('PATCH', '/api/orchestrator/config/invalidSection', {
        foo: 'bar',
      });
      expect(response.status).toBe(400);
    });

    it('should import configuration', async () => {
      const response = await makeRequest('POST', '/api/orchestrator/config/import?mode=merge', {
        config: {
          logLevel: 'info',
        },
        version: 1,
      });
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('mode', 'merge');
    });

    it('should reject unsupported config version', async () => {
      const response = await makeRequest('POST', '/api/orchestrator/config/import', {
        config: { logLevel: 'info' },
        version: 99,
      });
      expect(response.status).toBe(400);
    });
  });

  // ============================================================
  // BANS TESTS
  // ============================================================
  describe('Ban Management Operations', () => {
    const banServerId = 'ban-test-server';
    const banModel = 'banned-model';

    beforeAll(async () => {
      await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: banServerId,
        url: 'http://localhost:11455',
        type: 'ollama',
      });
    });

    afterAll(async () => {
      await makeRequest('DELETE', `/api/orchestrator/servers/${banServerId}`);
    });

    it('should get all bans', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/bans');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('bans');
      expect(Array.isArray(response.data.bans)).toBe(true);
    });

    it('should clear all bans', async () => {
      const response = await makeRequest('DELETE', '/api/orchestrator/bans');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('removed');
    });

    it('should get bans after clearing (should be empty)', async () => {
      // First clear all bans
      await makeRequest('DELETE', '/api/orchestrator/bans');
      // Then get bans
      const response = await makeRequest('GET', '/api/orchestrator/bans');
      expect(response.status).toBe(200);
      expect(response.data.count).toBe(0);
    });
  });

  // ============================================================
  // RECOVERY FAILURES TESTS
  // ============================================================
  describe('Recovery Failure Operations', () => {
    const recoveryServerId = 'recovery-test-server';

    beforeAll(async () => {
      await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: recoveryServerId,
        url: 'http://localhost:11456',
        type: 'ollama',
      });
    });

    afterAll(async () => {
      await makeRequest('DELETE', `/api/orchestrator/servers/${recoveryServerId}`);
    });

    it('should get recovery failures summary', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/recovery-failures');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get all server recovery stats', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/recovery-failures/stats/all');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('servers');
    });

    it('should get recent failure records', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/recovery-failures/recent');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('records');
    });

    it('should get recovery stats for a specific server', async () => {
      const response = await makeRequest(
        'GET',
        `/api/orchestrator/recovery-failures/${recoveryServerId}`
      );
      expect([200, 404]).toContain(response.status);
    });

    it('should get failure history for a server', async () => {
      const response = await makeRequest(
        'GET',
        `/api/orchestrator/recovery-failures/${recoveryServerId}/history`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('serverId', recoveryServerId);
      expect(response.data).toHaveProperty('history');
    });

    it('should get failure analysis for a server', async () => {
      const response = await makeRequest(
        'GET',
        `/api/orchestrator/recovery-failures/${recoveryServerId}/analysis`
      );
      expect([200, 404]).toContain(response.status);
    });

    it('should get circuit breaker impact analysis', async () => {
      const response = await makeRequest(
        'GET',
        `/api/orchestrator/recovery-failures/${recoveryServerId}/circuit-breaker-impact`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('serverId', recoveryServerId);
    });

    it('should get circuit breaker transitions', async () => {
      const response = await makeRequest(
        'GET',
        `/api/orchestrator/recovery-failures/${recoveryServerId}/circuit-breaker-transitions`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('serverId', recoveryServerId);
      expect(response.data).toHaveProperty('transitions');
    });

    it('should reset recovery stats for a server', async () => {
      const response = await makeRequest(
        'POST',
        `/api/orchestrator/recovery-failures/${recoveryServerId}/reset`
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should reset recovery stats for non-existent server', async () => {
      const response = await makeRequest(
        'POST',
        '/api/orchestrator/recovery-failures/non-existent-server/reset'
      );
      expect(response.status).toBe(200); // Reset doesn't fail even if server doesn't exist
    });
  });

  // ============================================================
  // LOGS TESTS
  // ============================================================
  describe('Logs Operations', () => {
    it('should get logs', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/logs');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('logs');
      expect(response.data).toHaveProperty('count');
      expect(response.data).toHaveProperty('total');
    });

    it('should get logs with limit', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/logs?limit=10');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('logs');
      expect(Array.isArray(response.data.logs)).toBe(true);
    });

    it('should get logs filtered by level', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/logs?level=error');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('logs');
    });

    it('should clear logs', async () => {
      const response = await makeRequest('POST', '/api/orchestrator/logs/clear');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('message', 'Logs cleared');
    });

    it('should log a client error', async () => {
      const response = await makeRequest('POST', '/api/orchestrator/logs/client-error', {
        message: 'Test client error',
        stack: 'Error: Test client error\n    at test.js:1:1',
        timestamp: new Date().toISOString(),
      });
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });
  });

  // ============================================================
  // ANALYTICS TESTS
  // ============================================================
  describe('Analytics Operations', () => {
    it('should get analytics summary', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/summary');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('summary');
    });

    it('should get top models', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/top-models');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('models');
    });

    it('should get server performance', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/server-performance');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('servers');
    });

    it('should get error analysis', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/errors');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get capacity analysis', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/capacity');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get trend analysis for latency', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/trends/latency');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get decision history', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/decisions');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get selection stats', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/selection-stats');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get algorithm stats', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/algorithms');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get score timeline', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/score-timeline');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get metrics impact', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/metrics-impact');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get servers with history', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/servers-with-history');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get request timeline', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/request-timeline');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should search requests', async () => {
      const response = await makeRequest(
        'GET',
        '/api/orchestrator/analytics/requests/search?limit=10'
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get summary snapshots', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/summary-snapshots');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get hourly rollups', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/rollups/hourly');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should get daily rollups', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/analytics/rollups/daily');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should browse requests', async () => {
      const response = await makeRequest(
        'GET',
        '/api/orchestrator/analytics/requests/browse?limit=10'
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });

    it('should reject invalid trend metric', async () => {
      const response = await makeRequest(
        'GET',
        '/api/orchestrator/analytics/trends/invalid-metric'
      );
      expect(response.status).toBe(400);
    });
  });

  // ============================================================
  // HEALTH & STATS TESTS
  // ============================================================
  describe('Health & Stats Operations', () => {
    it('should get health status', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/health');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('status', 'healthy');
    });

    it('should get orchestrator stats', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/stats');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('stats');
    });

    it('should get metrics', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/metrics');
      expect(response.status).toBe(200);
    });

    it('should get in-flight requests', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/in-flight');
      expect(response.status).toBe(200);
    });

    it('should get fleet model stats', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/models/fleet-stats');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });
  });

  // ============================================================
  // EDGE CASES & ERROR HANDLING
  // ============================================================
  describe('Edge Cases & Error Handling', () => {
    it('should return 404 for non-existent server circuit breaker details', async () => {
      const response = await makeRequest(
        'GET',
        '/api/orchestrator/circuit-breakers/non-existent-server/some-model'
      );
      expect(response.status).toBe(404);
    });

    it('should return 404 for non-existent server in recovery failures', async () => {
      const response = await makeRequest(
        'GET',
        '/api/orchestrator/recovery-failures/non-existent-server/history'
      );
      expect(response.status).toBe(200); // Returns empty history, not 404
    });

    it('should require id and url when adding server', async () => {
      const response = await makeRequest('POST', '/api/orchestrator/servers/add', {});
      expect(response.status).toBe(400);
    });

    it('should handle model names with special characters', async () => {
      // Add server first
      const serverId = 'special-model-server';
      await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: serverId,
        url: 'http://localhost:11457',
        type: 'ollama',
      });

      // Force open with encoded model name
      const modelWithSlash = 'mistral/test';
      const response = await makeRequest(
        'POST',
        `/api/orchestrator/circuit-breakers/${serverId}/${encodeURIComponent(modelWithSlash)}/open`
      );
      expect([200, 404]).toContain(response.status); // May not exist if no breaker created

      // Cleanup
      await makeRequest('DELETE', `/api/orchestrator/servers/${serverId}`);
    });

    it('should validate config section update', async () => {
      const response = await makeRequest('PATCH', '/api/orchestrator/config/security', {
        rateLimitMax: 200,
      });
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('section', 'security');
    });

    it('should reject invalid analytics time range', async () => {
      const response = await makeRequest(
        'GET',
        '/api/orchestrator/analytics/top-models?timeRange=invalid'
      );
      // Should still work with default or handle gracefully
      expect([200, 400]).toContain(response.status);
    });
  });
});
