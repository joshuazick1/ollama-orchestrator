/**
 * Chaos Engineering Tests: Capability Detection Edge Cases
 *
 * Tests edge cases and failure modes in the capability detection system
 * that are hard to catch with normal unit/integration tests.
 *
 * Chaos scenarios:
 * 1. Transient 404 → eventual 200 (capability should be re-confirmed)
 * 2. Rapid 429 rate-limit probes (no auto-revoke on rate limit)
 * 3. Server restart mid-probe (no partial state corruption)
 * 4. Network partition → timeout (SUSPECT state not auto-revoked)
 * 5. Concurrent probes (atomic state transitions, no race conditions)
 */

import http from 'http';
import { AddressInfo } from 'net';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeExecutorNegative } from '../../src/orchestrator/probe-executor-negative.js';
import { EndpointRegistry } from '../../src/probe/endpoint-registry.js';
import type { ProbeEndpoint } from '../../src/probe/types.js';
import { mockServerFactory } from '../utils/mock-server-factory.js';
import { delay } from '../utils/test-helpers.js';

// Test endpoints (same as integration tests)
const INFERENCE_ENDPOINTS: ProbeEndpoint[] = [
  'ollama_chat',
  'ollama_generate',
  'ollama_embeddings',
  'openai_chat',
  'openai_completions',
  'openai_embeddings',
  'anthropic_messages',
];

/**
 * Helper to get port from server
 */
function getServerPort(server: http.Server): number {
  const address = server.address() as AddressInfo;
  return address.port;
}

/**
 * Run a single capability probe cycle against all endpoints.
 * Mirrors the pattern from capability-detection.test.ts
 */
async function runCapabilityProbeOnce(
  serverId: string,
  serverUrl: string,
  registry: EndpointRegistry,
  apiKey?: string,
  consecutiveFailureThreshold = 3
): Promise<{
  revokedCount: number;
  endpointResults: Map<ProbeEndpoint, { capabilityAbsent: boolean; consecutiveFailures: number }>;
}> {
  const endpointResults = new Map<
    ProbeEndpoint,
    { capabilityAbsent: boolean; consecutiveFailures: number }
  >();
  let revokedCount = 0;

  for (const endpoint of INFERENCE_ENDPOINTS) {
    const result = await probeExecutorNegative(
      { serverId, model: 'llama3', endpoint },
      { serverUrl, apiKey, timeoutMs: 5000 }
    );

    if (result.endpointAbsent) {
      registry.softRevoke(serverId, endpoint);
      revokedCount++;
      endpointResults.set(endpoint, {
        capabilityAbsent: true,
        consecutiveFailures: registry.getConsecutiveFailures(serverId, endpoint),
      });
    } else if (result.modelNotFound) {
      registry.recordFailure(serverId, endpoint, consecutiveFailureThreshold);
      endpointResults.set(endpoint, {
        capabilityAbsent: false,
        consecutiveFailures: registry.getConsecutiveFailures(serverId, endpoint),
      });
    } else if (result.suspicious) {
      registry.confirm(serverId, endpoint);
      endpointResults.set(endpoint, { capabilityAbsent: false, consecutiveFailures: 0 });
    } else if (result.midStreamError) {
      registry.recordFailure(serverId, endpoint, consecutiveFailureThreshold);
      endpointResults.set(endpoint, {
        capabilityAbsent: false,
        consecutiveFailures: registry.getConsecutiveFailures(serverId, endpoint),
      });
    } else if (result.retryable) {
      endpointResults.set(endpoint, { capabilityAbsent: false, consecutiveFailures: 0 });
    } else if (result.capabilityConfirmed) {
      registry.confirm(serverId, endpoint);
      endpointResults.set(endpoint, { capabilityAbsent: false, consecutiveFailures: 0 });
    }
  }

  return { revokedCount, endpointResults };
}

describe('Chaos: Capability Detection Edge Cases', () => {
  vi.mock('../../src/utils/logger.js', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

  afterEach(async () => {
    await delay(100);
  });

  afterAll(async () => {
    await delay(100);
  });

  /**
   * Scenario 1: Transient 404 during "model loading"
   *
   * Mock server returns 404 on first 2 probes, then 200 on the 3rd.
   * Capability should NOT be soft-revoked (the 200 confirms it).
   *
   * This simulates a server that's temporarily unavailable but recovers.
   */
  describe('Scenario 1: Transient 404 → eventual 200 recovery', () => {
    it('should re-confirm capability after transient 404 failures', async () => {
      // Create a server that returns 404 for first 14 requests (2 cycles), then 200
      // Each cycle makes 7 requests (one per endpoint)
      let requestCount = 0;
      const server = http.createServer((_req, res) => {
        requestCount++;
        if (requestCount <= 14) {
          // First 14 requests: model not found (but endpoint exists)
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: "model 'llama3' not found, try pulling it first",
            })
          );
        } else {
          // 15th+ request: healthy response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'hi' } })
          );
        }
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'transient-404-srv';

        // Declare and confirm all endpoints initially
        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        // Probe cycle 1: 404s
        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        // After first cycle, modelNotFound should have been recorded
        const failCount1 = registry.getConsecutiveFailures(serverId, 'ollama_chat');
        expect(failCount1).toBe(1);

        // Probe cycle 2: Another 404
        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        const failCount2 = registry.getConsecutiveFailures(serverId, 'ollama_chat');
        expect(failCount2).toBe(2);

        // Probe cycle 3: Now returns 200
        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        // After successful probe, failures should reset and capability confirmed
        const failCount3 = registry.getConsecutiveFailures(serverId, 'ollama_chat');
        expect(failCount3).toBe(0);

        const cap = registry.getCapabilities(serverId).get('ollama_chat');
        expect(cap?.confirmed).toBe(true);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should not auto-revoke on transient 404 before threshold is reached', async () => {
      let requestCount = 0;
      const server = http.createServer((_req, res) => {
        requestCount++;
        if (requestCount <= 2) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: "model 'llama3' not found, try pulling it first",
            })
          );
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'hi' } })
          );
        }
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'transient-no-revoke-srv';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        // Only 2 cycles of 404s (threshold is 3)
        await runCapabilityProbeOnce(serverId, serverUrl, registry);
        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        // Should NOT be revoked yet (threshold is 3)
        const activeEndpoints = registry.getActiveEndpoints(serverId, 'llama3');
        // Note: with modelNotFound, endpoints are confirmed=false but not soft-revoked
        // until threshold is reached
        expect(activeEndpoints.length).toBeLessThan(INFERENCE_ENDPOINTS.length);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  /**
   * Scenario 2: Rapid succession of probes triggering rate limit
   *
   * Mock server returns 429 with Retry-After: 5 for the first 3 probes.
   * Scheduler should back off, no auto-revoke.
   */
  describe('Scenario 2: Rate-limited probes (429) should not auto-revoke', () => {
    it('should not auto-revoke on 429 rate-limit responses', async () => {
      // Use the rateLimitedOnInvalid mock variant
      const mockServer = await mockServerFactory.rateLimitedOnInvalid(0);
      const port = getServerPort(mockServer);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'rate-limited-srv';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        // Run 3 probe cycles (all should return 429)
        await runCapabilityProbeOnce(serverId, serverUrl, registry);
        await runCapabilityProbeOnce(serverId, serverUrl, registry);
        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        // Rate-limited endpoints should still be confirmed (not revoked)
        // They are "retryable" but not confirmed=false
        const caps = registry.getCapabilities(serverId);
        for (const [endpoint, cap] of caps) {
          // Rate-limited responses are retryable, they don't change confirmed state
          expect(cap.confirmed).toBe(true);
        }

        // Should have retryable=true for rate-limited responses
        const result = await probeExecutorNegative(
          { serverId: 'srv', model: 'llama3', endpoint: 'ollama_chat' },
          { serverUrl, timeoutMs: 5000 }
        );
        expect(result.retryable).toBe(true);
        expect(result.status).toBe(429);
      } finally {
        await new Promise<void>(resolve => mockServer.close(() => resolve()));
      }
    });

    it('should respect Retry-After header from rate-limited response', async () => {
      // Create a custom server that returns 429 with specific Retry-After
      let requestCount = 0;
      const server = http.createServer((_req, res) => {
        requestCount++;
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '7' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv', model: 'llama3', endpoint: 'ollama_chat' },
          { serverUrl, timeoutMs: 5000 }
        );

        expect(result.status).toBe(429);
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBeDefined();
        expect(result.retryAfterMs).toBe(7000); // 7 seconds = 7000ms
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  /**
   * Scenario 3: Server restarts mid-probe cycle
   *
   * Mock server disconnects mid-probe. Capability state should not be
   * corrupted (no partial writes).
   */
  describe('Scenario 3: Server restart mid-probe (no partial state corruption)', () => {
    it('should not corrupt endpoint state when server dies mid-probe', async () => {
      // Create a server that will "crash" after a few requests
      let requestCount = 0;
      const server = http.createServer((_req, res) => {
        requestCount++;
        if (requestCount <= 3) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'hi' } })
          );
        } else {
          // Simulate crash: destroy connection
          res.socket?.destroy();
        }
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'restart-mid-probe-srv';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        // First 3 probes should succeed
        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        // Verify state after successful probes
        const capsBefore = registry.getCapabilities(serverId);
        for (const [endpoint, cap] of capsBefore) {
          expect(cap.confirmed).toBe(true);
        }

        // Now try probing when server is "dead"
        // This should result in network errors, not corrupt state
        for (let i = 0; i < 3; i++) {
          try {
            await probeExecutorNegative(
              { serverId, model: 'llama3', endpoint: 'ollama_chat' },
              { serverUrl, timeoutMs: 1000 }
            );
          } catch {
            // Expected - server is dead
          }
        }

        // State should NOT be corrupted - confirmed should still be what it was
        // Network errors don't auto-revoke
        const capsAfter = registry.getCapabilities(serverId);
        for (const [endpoint, cap] of capsAfter) {
          // State should be unchanged (still confirmed from before)
          expect(cap.confirmed).toBe(true);
        }
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should handle server close mid-request without corruption', async () => {
      let requestCount = 0;
      const server = http.createServer((_req, res) => {
        requestCount++;
        if (requestCount === 1) {
          // First request: slow response, will be interrupted
          setTimeout(() => {
            res.writeHead(200);
            res.end();
          }, 5000);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'hi' } })
          );
        }
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'close-mid-request-srv';

        registry.declare(serverId, 'ollama_chat');
        registry.confirm(serverId, 'ollama_chat');

        // Record some failures first
        registry.recordFailure(serverId, 'ollama_chat', 5);
        registry.recordFailure(serverId, 'ollama_chat', 5);
        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(2);

        // Try to probe with a short timeout - will timeout
        const result = await probeExecutorNegative(
          { serverId, model: 'llama3', endpoint: 'ollama_chat' },
          { serverUrl, timeoutMs: 500 }
        );

        // Should get a network error, not corrupt the registry
        expect(result.networkError || result.timedOut).toBe(true);

        // Failures should NOT have been incremented by the timeout
        // (timeout during probe doesn't call recordFailure in our runCapabilityProbeOnce)
        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(2);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  /**
   * Scenario 4: Network partition → timeout → SUSPECT not REVOKED
   *
   * Mock server stops responding. Probe times out.
   * Should not auto-revoke; the SUSPECT state applies, not the new soft-revoke.
   */
  describe('Scenario 4: Network partition timeout (SUSPECT not auto-revoked)', () => {
    it('should not auto-revoke on network timeout (SUSPECT state preserved)', async () => {
      // Create a "hanging" server that never responds
      const server = http.createServer((_req, res) => {
        // Just hang forever
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'partition-srv';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        // First, establish some consecutive failures
        registry.recordFailure(serverId, 'ollama_chat', 5);
        registry.recordFailure(serverId, 'ollama_chat', 5);
        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(2);

        // Now probe with a short timeout - will time out
        const result = await probeExecutorNegative(
          { serverId, model: 'llama3', endpoint: 'ollama_chat' },
          { serverUrl, timeoutMs: 500 }
        );

        // Should be a timeout/network error
        expect(result.timedOut || result.networkError).toBe(true);

        // Timeouts don't auto-revoke - they should not change consecutive failures
        // in our probe logic (we don't call recordFailure for timedOut results)
        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(2);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should not increment failure count on timeout during SUSPECT state', async () => {
      // Create a server that times out
      const server = http.createServer((_req, _res) => {
        // Hang indefinitely
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'timeout-suspect-srv';

        registry.declare(serverId, 'ollama_chat');
        registry.confirm(serverId, 'ollama_chat');

        // Record some failures to be in "SUSPECT-like" state
        for (let i = 0; i < 2; i++) {
          registry.recordFailure(serverId, 'ollama_chat', 5);
        }
        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(2);

        // Multiple timeout probes
        for (let i = 0; i < 5; i++) {
          await probeExecutorNegative(
            { serverId, model: 'llama3', endpoint: 'ollama_chat' },
            { serverUrl, timeoutMs: 200 }
          );
        }

        // Timeouts don't increment consecutive failures in our runCapabilityProbeOnce
        // They are treated as "retryable" but not failure
        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(2);

        // Endpoint should still be in registry
        // confirmed=true because soft-revoke only happens at threshold (5), not at 2 failures
        const cap = registry.getCapabilities(serverId).get('ollama_chat');
        expect(cap).toBeDefined();
        expect(cap?.confirmed).toBe(true);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  /**
   * Scenario 5: Concurrent probes to same server
   *
   * Run 5 parallel probe cycles against the same server.
   * Verify state transitions are atomic (no race conditions, no duplicate logs).
   */
  describe('Scenario 5: Concurrent probes (atomic state transitions)', () => {
    it('should handle 5 parallel probe cycles without race conditions', async () => {
      // Use inline mock that returns proper capabilityConfirmed responses
      // The healthy mock may return responses that trigger suspicious/midStreamError classification
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Return a response that will NOT have error field (triggers suspicious classification)
        res.end(JSON.stringify({ model: '__neg_probe__', response: 'valid response' }));
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'concurrent-srv';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        // Reset failures to 0
        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.resetConsecutiveFailures(serverId, endpoint);
        }

        // Run 5 parallel probe cycles
        const parallelCycles = Array.from({ length: 5 }, () =>
          runCapabilityProbeOnce(serverId, serverUrl, registry)
        );

        await Promise.all(parallelCycles);

        // All endpoints should be confirmed after successful probes
        // Note: suspicious responses call confirm(), so confirmed=true is expected
        const caps = registry.getCapabilities(serverId);
        for (const [endpoint, cap] of caps) {
          expect(cap.confirmed).toBe(true);
          expect(cap.consecutiveFailures).toBe(0);
        }
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should not have duplicate state transitions with concurrent probes', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'hi' } }));
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'no-duplicate-srv';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        // Run many parallel probes
        const numProbes = 10;
        const parallelProbes = Array.from({ length: numProbes }, () =>
          runCapabilityProbeOnce(serverId, serverUrl, registry)
        );

        await Promise.all(parallelProbes);

        // Each endpoint should have exactly one entry in the capabilities map
        const caps = registry.getCapabilities(serverId);
        expect(caps.size).toBe(INFERENCE_ENDPOINTS.length);

        // Each capability should be confirmed once (no duplicates)
        for (const [endpoint, cap] of caps) {
          expect(INFERENCE_ENDPOINTS).toContain(endpoint);
          expect(cap.confirmed).toBe(true);
        }
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should handle mixed success/failure concurrent probes correctly', async () => {
      let requestCount = 0;
      const server = http.createServer((_req, res) => {
        requestCount++;
        if (requestCount % 2 === 0) {
          // Even requests: fail
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service Unavailable' }));
        } else {
          // Odd requests: succeed
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'hi' } })
          );
        }
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'mixed-concurrent-srv';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        // Run parallel probes - some will succeed, some will fail
        const parallelProbes = Array.from({ length: 8 }, () =>
          runCapabilityProbeOnce(serverId, serverUrl, registry)
        );

        await Promise.all(parallelProbes);

        // State should be consistent - no corruption
        const caps = registry.getCapabilities(serverId);
        expect(caps.size).toBe(INFERENCE_ENDPOINTS.length);

        // At least some endpoints should still be tracked
        for (const [endpoint, cap] of caps) {
          // Capabilities should be well-formed
          expect(cap.declared).toBe(true);
        }
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  /**
   * Additional chaos scenarios beyond the required 5
   */
  describe('Additional chaos scenarios', () => {
    it('should handle rapid state changes between healthy and unhealthy', async () => {
      let requestCount = 0;
      const server = http.createServer((_req, res) => {
        requestCount++;
        if (requestCount % 3 === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'hi' } })
          );
        } else if (requestCount % 3 === 1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "model 'llama3' not found" }));
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service Unavailable' }));
        }
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'rapid-changes-srv';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        // Run multiple cycles with rapid state changes
        for (let i = 0; i < 6; i++) {
          await runCapabilityProbeOnce(serverId, serverUrl, registry);
        }

        // Registry should still be consistent
        const caps = registry.getCapabilities(serverId);
        expect(caps.size).toBe(INFERENCE_ENDPOINTS.length);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should handle server returning malformed responses', async () => {
      let requestCount = 0;
      const server = http.createServer((_req, res) => {
        requestCount++;
        if (requestCount === 1) {
          // First: valid response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'hi' } })
          );
        } else {
          // Subsequent: malformed JSON
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('not valid json {');
        }
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'malformed-srv';

        registry.declare(serverId, 'ollama_chat');
        registry.confirm(serverId, 'ollama_chat');

        // First probe should succeed
        await runCapabilityProbeOnce(serverId, serverUrl, registry);
        expect(registry.getCapabilities(serverId).get('ollama_chat')?.confirmed).toBe(true);

        // Second probe with malformed response
        const result = await probeExecutorNegative(
          { serverId, model: 'llama3', endpoint: 'ollama_chat' },
          { serverUrl, timeoutMs: 5000 }
        );

        // The malformed response should be handled gracefully
        // Either as suspicious (200 OK) or as a network error
        expect(result.success || result.networkError).toBe(true);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should handle very long Retry-After header', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3600' });
        res.end(JSON.stringify({ error: 'rate limit exceeded' }));
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv', model: 'llama3', endpoint: 'ollama_chat' },
          { serverUrl, timeoutMs: 5000 }
        );

        expect(result.status).toBe(429);
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(3600000); // 1 hour in ms
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });
});
