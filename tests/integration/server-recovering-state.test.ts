/**
 * Server Recovering State Flag Integration Tests
 *
 * Tests the explicit `server.recovering` flag that tracks when a server is
 * healthy but its circuit breaker is not yet closed (recovering from open state).
 *
 * This replaces the implicit multi-source-of-truth query:
 *   OLD: server.healthy && CB state === half-open
 *   NEW: server.recovering === true
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';


import { cleanupMockServers } from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';

import { setupIntegrationTest, teardownIntegrationTest, getOrchestrator } from './setup.js';

let serverCounter = 0;
const getUniqueServerId = (prefix = 'recovering') => `${prefix}-${Date.now()}-${++serverCounter}`;
const getUniquePort = (base = 14150) => base + (Date.now() % 1000) + ++serverCounter;

describe('Server.recovering state flag', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await cleanupMockServers();
    await teardownIntegrationTest();
  });

  beforeEach(async () => {
    await cleanupMockServers();
    await delay(50);
  });

  /**
   * Helper to add a test server to the orchestrator
   */
  async function addTestServer(serverId: string, port: number): Promise<void> {
    const response = await makeRequest('POST', '/api/orchestrator/servers/add', {
      id: serverId,
      url: `http://localhost:${port}`,
      type: 'ollama',
    });
    expect(response.status).toBe(200);
  }

  /**
   * Helper to get server info from the orchestrator directly
   */
  function getServerFromOrchestrator(serverId: string): any {
    const orch = getOrchestrator();
    return orch.getServer(serverId);
  }

  /**
   * Helper to force open a circuit breaker
   */
  async function forceOpenCircuitBreaker(serverId: string, model: string): Promise<void> {
    const encodedModel = encodeURIComponent(model);
    await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/open`
    );
  }

  /**
   * Helper to force close a circuit breaker
   */
  async function forceCloseCircuitBreaker(serverId: string, model: string): Promise<void> {
    const encodedModel = encodeURIComponent(model);
    await makeRequest(
      'POST',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}/close`
    );
  }

  /**
   * Helper to get circuit breaker stats
   */
  async function getCircuitBreakerStats(
    serverId: string,
    model: string
  ): Promise<{ state: string; failureCount: number }> {
    const encodedModel = encodeURIComponent(model);
    const response = await makeRequest(
      'GET',
      `/api/orchestrator/circuit-breakers/${serverId}/${encodedModel}`
    );
    return response.data.stats;
  }

  // ========================================================================
  // Test: recovering flag set when health check passes but CB is open
  // ========================================================================
  it('should set server.recovering = true when health check passes but CB is open', async () => {
    const serverId = getUniqueServerId('srv-recovering');
    const port = getUniquePort();
    const model = 'llama3.1:8b';

    // Create mock server that passes health check
    const mockServer = await createDiverseMockServer(port, {
      '/api/tags': {
        status: 200,
        body: { models: [{ name: model, size: 5e9, digest: 'sha123' }] },
      },
      '/api/generate': { status: 200, body: { response: 'test', done: true } },
    });

    try {
      // Add server to orchestrator
      await addTestServer(serverId, port);

      // Verify server is healthy and recovering is false initially
      const serverBefore = getServerFromOrchestrator(serverId);
      expect(serverBefore).toBeDefined();
      expect(serverBefore.healthy).toBe(true);
      expect(serverBefore.recovering).toBe(false);

      // Force open the circuit breaker for this server:model
      await forceOpenCircuitBreaker(serverId, model);

      // CB should now be open
      const cbBefore = await getCircuitBreakerStats(serverId, model);
      expect(cbBefore.state).toBe('OPEN');

      // Trigger a health check by calling updateAllStatus
      await makeRequest('POST', '/api/orchestrator/health-check');

      // Give time for health check to complete
      await delay(200);

      // Get the server state directly from orchestrator
      const serverAfter = getServerFromOrchestrator(serverId);

      // Server should be healthy (health check passed)
      expect(serverAfter.healthy).toBe(true);

      // recovering should be true because health check passed but CB was open
      // (the CB was force-closed but recovering flag tracks this transition state)
      expect(serverAfter.recovering).toBe(true);
    } finally {
      await mockServer.close();
    }
  });

  // ========================================================================
  // Test: recovering flag cleared when CB transitions to closed
  // ========================================================================
  it('should set server.recovering = false when CB transitions to closed', async () => {
    const serverId = getUniqueServerId('srv-recovering-cb-close');
    const port = getUniquePort();
    const model = 'llama3.1:8b';

    // Create mock server
    const mockServer = await createDiverseMockServer(port, {
      '/api/tags': {
        status: 200,
        body: { models: [{ name: model, size: 5e9, digest: 'sha123' }] },
      },
      '/api/generate': { status: 200, body: { response: 'test', done: true } },
    });

    try {
      // Add server
      await addTestServer(serverId, port);

      // Get server and manually set recovering to true (simulating recovery scenario)
      const orch = getOrchestrator();
      const server = orch.getServer(serverId);
      expect(server).toBeDefined();

      // Simulate: health check passed but CB was open (recovering state)
      server.recovering = true;

      // Force close the circuit breaker
      await forceCloseCircuitBreaker(serverId, model);

      // Give time for state transition
      await delay(100);

      // Verify recovering is now false
      const serverAfter = getServerFromOrchestrator(serverId);
      expect(serverAfter.recovering).toBe(false);
    } finally {
      await mockServer.close();
    }
  });

  // ========================================================================
  // Test: recovering flag cleared when server becomes unhealthy
  // ========================================================================
  it('should set server.recovering = false when server becomes unhealthy', async () => {
    const serverId = getUniqueServerId('srv-unhealthy-recovering');
    const port = getUniquePort();
    const model = 'llama3.1:8b';

    // Create mock server that initially passes then fails health checks
    let healthCheckCount = 0;
    const mockServer = await createDiverseMockServer(port, {
      '/api/tags': () => {
        healthCheckCount++;
        // Fail health check on second attempt
        if (healthCheckCount > 1) {
          return { status: 500, body: { error: 'Service unavailable' } };
        }
        return { status: 200, body: { models: [{ name: model, size: 5e9, digest: 'sha123' }] } };
      },
      '/api/generate': { status: 200, body: { response: 'test', done: true } },
    });

    try {
      // Add server
      await addTestServer(serverId, port);

      // Set recovering to true (simulating recovery in progress)
      const orch = getOrchestrator();
      const server = orch.getServer(serverId);
      expect(server).toBeDefined();
      server.recovering = true;

      // Trigger health check that will fail
      await makeRequest('POST', '/api/orchestrator/health-check');

      // Give time for health check to complete and state to update
      await delay(200);

      // Get updated server state
      const serverAfter = getServerFromOrchestrator(serverId);

      // Server should now be unhealthy
      expect(serverAfter.healthy).toBe(false);

      // recovering should be false because server is unhealthy
      expect(serverAfter.recovering).toBe(false);
    } finally {
      await mockServer.close();
    }
  });

  // ========================================================================
  // Test: recovering flag included in servers API response
  // ========================================================================
  it('should include recovering flag in GET /api/orchestrator/servers response', async () => {
    const serverId = getUniqueServerId('srv-api-response');
    const port = getUniquePort();
    const model = 'llama3.1:8b';

    // Create mock server
    const mockServer = await createDiverseMockServer(port, {
      '/api/tags': {
        status: 200,
        body: { models: [{ name: model, size: 5e9, digest: 'sha123' }] },
      },
      '/api/generate': { status: 200, body: { response: 'test', done: true } },
    });

    try {
      // Add server
      await addTestServer(serverId, port);

      // Get servers list
      const response = await makeRequest('GET', '/api/orchestrator/servers');
      expect(response.status).toBe(200);

      const serverInfo = response.data.servers.find((s: any) => s.id === serverId);
      expect(serverInfo).toBeDefined();

      // The recovering field should be present in the response
      expect(serverInfo).toHaveProperty('recovering');
      expect(typeof serverInfo.recovering).toBe('boolean');
    } finally {
      await mockServer.close();
    }
  });
});
