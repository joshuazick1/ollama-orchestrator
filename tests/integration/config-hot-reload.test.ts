/**
 * config-hot-reload.test.ts
 * Integration tests for config hot-reload functionality
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:5100';

describe('Config Hot-Reload', () => {
  let serviceReachable = false;
  let originalConfig: Record<string, unknown> | null = null;

  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE_URL}/health/ready`);
      serviceReachable = res.ok;
    } catch {
      serviceReachable = false;
    }
    if (!serviceReachable) {
      console.warn(`Orchestrator not reachable at ${BASE_URL} - skipping integration tests`);
    }

    if (serviceReachable) {
      try {
        const res = await fetch(`${BASE_URL}/api/orchestrator/config`);
        if (res.ok) {
          const data = await res.json();
          originalConfig = data.config;
        }
      } catch {
        originalConfig = null;
      }
    }
  });

  afterAll(async () => {
    if (serviceReachable && originalConfig) {
      try {
        await fetch(`${BASE_URL}/api/orchestrator/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(originalConfig),
        });
      } catch {
        // Restore failed, best effort
      }
    }
  });

  describe.skipIf(!serviceReachable)('Rate limit hot-reload', () => {
    it('PATCH security.rateLimitMax takes effect on next request', async () => {
      const getConfigRes = await fetch(`${BASE_URL}/api/orchestrator/config`);
      const beforeConfig = await getConfigRes.json();
      const originalRateLimit = beforeConfig.config.security?.rateLimitMax ?? 100;

      const newRateLimit = originalRateLimit + 50;
      const patchRes = await fetch(`${BASE_URL}/api/orchestrator/config/security`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rateLimitMax: newRateLimit }),
      });

      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.success).toBe(true);

      const getAfterRes = await fetch(`${BASE_URL}/api/orchestrator/config`);
      const afterConfig = await getAfterRes.json();
      expect(afterConfig.config.security?.rateLimitMax).toBe(newRateLimit);
    });
  });

  describe.skipIf(!serviceReachable)('Log level hot-reload', () => {
    it('PATCH logLevel takes effect immediately', async () => {
      const getConfigRes = await fetch(`${BASE_URL}/api/orchestrator/config`);
      const beforeConfig = await getConfigRes.json();
      const originalLogLevel = beforeConfig.config.logLevel ?? 'info';

      const newLogLevel = originalLogLevel === 'debug' ? 'info' : 'debug';
      const patchRes = await fetch(`${BASE_URL}/api/orchestrator/config/logLevel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logLevel: newLogLevel }),
      });

      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.success).toBe(true);
      expect(patchData.config.logLevel).toBe(newLogLevel);

      const getAfterRes = await fetch(`${BASE_URL}/api/orchestrator/config`);
      const afterConfig = await getAfterRes.json();
      expect(afterConfig.config.logLevel).toBe(newLogLevel);
    });
  });

  describe.skipIf(!serviceReachable)('Auth hot-reload', () => {
    it('PATCH security.apiKeys updates requireAuth keys', async () => {
      const getConfigRes = await fetch(`${BASE_URL}/api/orchestrator/config`);
      const beforeConfig = await getConfigRes.json();
      const originalApiKeys = beforeConfig.config.security?.apiKeys ?? [];

      const newApiKeys = ['test-key-1', 'test-key-2'];
      const patchRes = await fetch(`${BASE_URL}/api/orchestrator/config/security`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeys: newApiKeys }),
      });

      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.success).toBe(true);

      const getAfterRes = await fetch(`${BASE_URL}/api/orchestrator/config`);
      const afterConfig = await getAfterRes.json();
      expect(afterConfig.config.security?.apiKeys).toEqual(newApiKeys);
    });
  });

  describe.skipIf(!serviceReachable)('PATCH endpoint expansion', () => {
    const previouslyRejectedSections = [
      'anthropic',
      'healthCheck',
      'tags',
      'retry',
      'modelManager',
      'circuitBreaker',
      'loadBalancer',
      'streaming',
      'metrics',
      'persistencePath',
      'configReloadIntervalMs',
    ];

    it.each(previouslyRejectedSections)('accepts PATCH on %s', async section => {
      const res = await fetch(`${BASE_URL}/api/orchestrator/config/${section}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.section).toBe(section);
    });

    it('rejects PATCH on servers (has dedicated endpoints)', async () => {
      const res = await fetch(`${BASE_URL}/api/orchestrator/config/servers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid configuration section');
    });
  });

  describe.skipIf(!serviceReachable)('Reload from env', () => {
    it('POST reload-from-env returns success with config', async () => {
      const res = await fetch(`${BASE_URL}/api/orchestrator/config/reload-from-env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Configuration reloaded from environment');
      expect(data.config).toBeDefined();
    });
  });
});
