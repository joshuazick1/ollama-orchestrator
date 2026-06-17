/**
 * Capability Detection Integration Tests
 *
 * Tests the full stack: probe executor + soft-revoke + scheduler + mock server.
 * Exercises the capability detection system using T7 mock server variants
 * (modelNotFound, notSupported, rateLimitedOnInvalid, html404).
 *
 * These tests verify:
 * - Auto-revoke after N consecutive failures
 * - Immediate auto-revoke on endpoint-absent
 * - Recovery via positive probe
 * - 429 rate-limit handling
 * - Mid-stream error detection
 * - Suspicious 200 (no validation) tolerance
 * - Mixed server scenarios
 */

import http from 'http';
import { AddressInfo } from 'net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeExecutorNegative } from '../../src/orchestrator/probe-executor-negative.js';
import { EndpointRegistry } from '../../src/probe/endpoint-registry.js';
import type { ProbeEndpoint } from '../../src/probe/types.js';
import { mockServerFactory } from '../utils/mock-server-factory.js';

interface MockServerHandle {
  port: number;
  close: () => Promise<void>;
}

const INFERENCE_ENDPOINTS: ProbeEndpoint[] = [
  'ollama_chat',
  'ollama_generate',
  'ollama_embeddings',
  'openai_chat',
  'openai_completions',
  'openai_embeddings',
  'anthropic_messages',
];

function getServerPort(server: http.Server): number {
  const address = server.address() as AddressInfo;
  return address.port;
}

function createMidStreamErrorServer(port: number): http.Server {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write('{"error":{"message":"context length exceeded","type":"invalid_request_error"}}\n');
    res.end();
  });
  return server;
}

function createMixedMockServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url || '';

    if (url === '/v1/messages') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('404 page not found');
      return;
    }

    if (url === '/api/chat') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: 'hi' } }));
      return;
    }

    if (url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'llama3',
          choices: [{ message: { role: 'assistant', content: 'hi' } }],
        })
      );
      return;
    }

    const inferenceEndpoints = [
      '/api/generate',
      '/api/embeddings',
      '/v1/completions',
      '/v1/embeddings',
    ];
    if (inferenceEndpoints.some(ep => url.startsWith(ep))) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'llama3', response: 'ok' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success' }));
  });
  return server;
}

function createAll404Server(port: number): http.Server {
  return http.createServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('404 page not found');
  });
}

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

async function runConsecutiveProbes(
  serverId: string,
  serverUrl: string,
  registry: EndpointRegistry,
  cycles: number,
  consecutiveFailureThreshold = 3,
  apiKey?: string
): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await runCapabilityProbeOnce(
      serverId,
      serverUrl,
      registry,
      apiKey,
      consecutiveFailureThreshold
    );
  }
}

describe('Capability Detection Integration', () => {
  vi.mock('../../src/utils/logger.js', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

  describe('Scenario 1: Auto-revoke after N consecutive failures', () => {
    it('should soft-revoke all endpoints after 3 consecutive failure cycles', async () => {
      const server = createAll404Server(0);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-mnf';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        await runConsecutiveProbes(serverId, serverUrl, registry, 3, 3);

        const activeEndpoints = registry.getActiveEndpoints(serverId, 'llama3');
        expect(activeEndpoints).toEqual([]);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should auto-revoke with threshold=2 after 2 cycles', async () => {
      const server = createAll404Server(0);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-thresh2';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        await runConsecutiveProbes(serverId, serverUrl, registry, 2, 2);

        const activeEndpoints = registry.getActiveEndpoints(serverId, 'llama3');
        expect(activeEndpoints).toEqual([]);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  describe('Scenario 2: Auto-revoke on endpoint-absent (immediate)', () => {
    it('should immediately soft-revoke endpoint on first 404 HTML response', async () => {
      const server = createAll404Server(0);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-notsupp';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        const activeEndpoints = registry.getActiveEndpoints(serverId, 'llama3');
        expect(activeEndpoints).toEqual([]);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should immediately revoke when html404 mock returns 404 HTML for all endpoints', async () => {
      const mockServer = await mockServerFactory.html404(0);
      const port = getServerPort(mockServer);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-html404';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        const activeEndpoints = registry.getActiveEndpoints(serverId, 'llama3');
        expect(activeEndpoints).toEqual([]);
      } finally {
        await new Promise<void>(resolve => mockServer.close(() => resolve()));
      }
    });
  });

  describe('Scenario 3: Recovery via positive probe', () => {
    it('should re-confirm endpoint when mock server becomes healthy after being soft-revoked', async () => {
      const server = createAll404Server(0);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-recovery';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        await runCapabilityProbeOnce(serverId, serverUrl, registry);
        const activeEndpoints = registry.getActiveEndpoints(serverId, 'llama3');
        expect(activeEndpoints).toEqual([]);

        const caps = registry.getCapabilities(serverId);
        expect(caps.size).toBe(7);
        for (const [, cap] of caps) {
          expect(cap.confirmed).toBe(false);
          expect(cap.declared).toBe(true);
        }
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }

      const healthyServer = await mockServerFactory.healthy(0);
      const healthyPort = getServerPort(healthyServer);
      const healthyUrl = `http://127.0.0.1:${healthyPort}`;

      try {
        const registry2 = new EndpointRegistry();
        const serverId2 = 'test-srv-recovery-healthy';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry2.declare(serverId2, endpoint);
          registry2.confirm(serverId2, endpoint);
          registry2.softRevoke(serverId2, endpoint);
        }

        let activeEndpoints = registry2.getActiveEndpoints(serverId2, 'llama3');
        expect(activeEndpoints).toEqual([]);

        await runCapabilityProbeOnce(serverId2, healthyUrl, registry2);

        activeEndpoints = registry2.getActiveEndpoints(serverId2, 'llama3');
        expect(activeEndpoints.length).toBe(2); // only Ollama endpoints succeed with mockServerFactory.healthy
      } finally {
        await new Promise<void>(resolve => healthyServer.close(() => resolve()));
      }
    });

    it('should reset consecutiveFailures on successful confirm', async () => {
      const mockServer = await mockServerFactory.healthy(0);
      const port = getServerPort(mockServer);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-reset';

        registry.declare(serverId, 'ollama_chat');
        registry.confirm(serverId, 'ollama_chat');

        registry.recordFailure(serverId, 'ollama_chat', 5);
        registry.recordFailure(serverId, 'ollama_chat', 5);
        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(2);

        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(0);
        expect(registry.getCapabilities(serverId).get('ollama_chat')?.confirmed).toBe(true);
      } finally {
        await new Promise<void>(resolve => mockServer.close(() => resolve()));
      }
    });
  });

  describe('Scenario 4: 429 rate-limit handling', () => {
    it('should not auto-revoke on 429 rate-limit response', async () => {
      const mockServer = await mockServerFactory.rateLimitedOnInvalid(0);
      const port = getServerPort(mockServer);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-429';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        await runCapabilityProbeOnce(serverId, serverUrl, registry);
        await runCapabilityProbeOnce(serverId, serverUrl, registry);
        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        const caps = registry.getCapabilities(serverId);
        for (const [, cap] of caps) {
          expect(cap.confirmed).toBe(true);
        }

        const activeEndpoints = registry.getActiveEndpoints(serverId, 'llama3');
        expect(activeEndpoints.length).toBe(5);
      } finally {
        await new Promise<void>(resolve => mockServer.close(() => resolve()));
      }
    });

    it('should return retryable=true and retryAfterMs for 429 responses', async () => {
      const mockServer = await mockServerFactory.rateLimitedOnInvalid(0);
      const port = getServerPort(mockServer);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv', model: 'llama3', endpoint: 'ollama_chat' },
          { serverUrl, timeoutMs: 5000 }
        );

        expect(result.status).toBe(429);
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBeDefined();
        expect(result.retryAfterMs).toBeGreaterThan(0);
      } finally {
        await new Promise<void>(resolve => mockServer.close(() => resolve()));
      }
    });
  });

  describe('Scenario 5: Mid-stream error detection', () => {
    it('should detect mid-stream NDJSON error and record failure', async () => {
      const server = createMidStreamErrorServer(0);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-midstream';

        registry.declare(serverId, 'ollama_chat');
        registry.confirm(serverId, 'ollama_chat');

        const result = await probeExecutorNegative(
          { serverId, model: 'llama3', endpoint: 'ollama_chat' },
          { serverUrl, timeoutMs: 5000 }
        );

        expect(result.midStreamError).toBe(true);
        expect(result.capabilityConfirmed).toBe(true);

        registry.recordFailure(serverId, 'ollama_chat', 3);
        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(1);
        expect(registry.getCapabilities(serverId).get('ollama_chat')?.confirmed).toBe(true);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should auto-revoke after 3 consecutive mid-stream errors', async () => {
      const server = createMidStreamErrorServer(0);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-midstream-3x';

        registry.declare(serverId, 'ollama_chat');
        registry.confirm(serverId, 'ollama_chat');

        for (let i = 0; i < 3; i++) {
          const result = await probeExecutorNegative(
            { serverId, model: 'llama3', endpoint: 'ollama_chat' },
            { serverUrl, timeoutMs: 5000 }
          );
          expect(result.midStreamError).toBe(true);
          registry.recordFailure(serverId, 'ollama_chat', 3);
        }

        const cap = registry.getCapabilities(serverId).get('ollama_chat');
        expect(cap?.confirmed).toBe(false);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  describe('Scenario 6: Suspicious 200 (no validation) tolerance', () => {
    it('should not revoke endpoint on suspicious 200 response', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ model: '__neg_probe__', response: 'valid response' }));
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-suspicious';

        registry.declare(serverId, 'ollama_chat');
        registry.confirm(serverId, 'ollama_chat');

        for (let i = 0; i < 5; i++) {
          await runCapabilityProbeOnce(serverId, serverUrl, registry);
        }

        const cap = registry.getCapabilities(serverId).get('ollama_chat');
        expect(cap?.confirmed).toBe(true);
        expect(registry.getConsecutiveFailures(serverId, 'ollama_chat')).toBe(0);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('should set suspicious=true when server returns 200 for invalid model', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: 'ok' }));
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const result = await probeExecutorNegative(
          { serverId: 'srv', model: 'llama3', endpoint: 'ollama_chat' },
          { serverUrl, timeoutMs: 5000 }
        );

        expect(result.suspicious).toBe(true);
        expect(result.retryable).toBe(false);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  describe('Scenario 7: Mixed server (some endpoints work, some dont)', () => {
    it('should only revoke unsupported endpoint, keep others confirmed', async () => {
      const server = createMixedMockServer(0);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry = new EndpointRegistry();
        const serverId = 'test-srv-mixed';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry.declare(serverId, endpoint);
          registry.confirm(serverId, endpoint);
        }

        await runCapabilityProbeOnce(serverId, serverUrl, registry);

        const anthropicCap = registry.getCapabilities(serverId).get('anthropic_messages');
        expect(anthropicCap?.confirmed).toBe(false);

        const otherEndpoints = INFERENCE_ENDPOINTS.filter(e => e !== 'anthropic_messages');
        for (const endpoint of otherEndpoints) {
          const cap = registry.getCapabilities(serverId).get(endpoint);
          expect(cap?.confirmed).toBe(true);
        }

        const active = registry.getActiveEndpoints(serverId, 'llama3');
        expect(active).not.toContain('anthropic_messages');
        expect(active.length).toBe(4);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  describe('Scenario 8: WAL persistence (soft-revoked state survival)', () => {
    it('should preserve soft-revoked state across registry instances', async () => {
      const server = createAll404Server(0);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = getServerPort(server);
      const serverUrl = `http://127.0.0.1:${port}`;

      try {
        const registry1 = new EndpointRegistry();
        const serverId = 'test-srv-wal';

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry1.declare(serverId, endpoint);
          registry1.confirm(serverId, endpoint);
        }

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry1.softRevoke(serverId, endpoint);
        }

        const caps1 = registry1.getCapabilities(serverId);
        expect(caps1.size).toBe(7);
        for (const [, cap] of caps1) {
          expect(cap.confirmed).toBe(false);
          expect(cap.declared).toBe(true);
        }

        const registry2 = new EndpointRegistry();

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry2.declare(serverId, endpoint);
        }

        for (const endpoint of INFERENCE_ENDPOINTS) {
          registry2.softRevoke(serverId, endpoint);
        }

        const caps2 = registry2.getCapabilities(serverId);
        expect(caps2.size).toBe(7);
        for (const [, cap] of caps2) {
          expect(cap.confirmed).toBe(false);
          expect(cap.declared).toBe(true);
        }

        const active = registry2.getActiveEndpoints(serverId, 'llama3');
        expect(active).toEqual([]);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });
});
