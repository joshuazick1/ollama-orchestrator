import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { getConfigManager } from '../../src/config/config.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';

/**
 * Integration test verifying Layer A (permanent ban for 401/403/404) and Layer C
 * (extended cooldown for quota) inheritance in routing.ts.
 *
 * routing.ts delegates error handling to orchestrator.handleServerError() at lines 955
 * and 1185. This test verifies that calling handleServerError with the appropriate
 * error types correctly applies permanent bans and extended cooldowns.
 *
 * Fake fleet:
 * - server-401-1, server-401-2: return 401 (permanent auth ban)
 * - server-403: returns 403 (permanent auth ban)
 * - server-quota: returns quota 429 (extended cooldown)
 * - server-success: returns success (no ban)
 */

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock probe-orchestrator to avoid timer dependencies
vi.mock('../../src/probe/probe-orchestrator.js', () => ({
  ProbeOrchestrator: vi.fn().mockImplementation(() => ({
    canServe: vi.fn().mockReturnValue(true),
    recordLatency: vi.fn(),
    recordFailure: vi.fn(),
  })),
}));

describe('routing.ts Layer A and Layer C inheritance via handleServerError', () => {
  const CLOUD_MODEL = 'minimax-m3:cloud';

  const fakeFleet: AIServer[] = [
    {
      id: 'server-401-1',
      url: 'http://localhost:11450',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 100,
      models: [CLOUD_MODEL],
      supportsOllama: true,
      supportsV1: false,
    },
    {
      id: 'server-401-2',
      url: 'http://localhost:11451',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 100,
      models: [CLOUD_MODEL],
      supportsOllama: true,
      supportsV1: false,
    },
    {
      id: 'server-403',
      url: 'http://localhost:11452',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 100,
      models: [CLOUD_MODEL],
      supportsOllama: true,
      supportsV1: false,
    },
    {
      id: 'server-quota',
      url: 'http://localhost:11453',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 100,
      models: [CLOUD_MODEL],
      supportsOllama: true,
      supportsV1: false,
    },
    {
      id: 'server-success',
      url: 'http://localhost:11454',
      type: 'ollama',
      healthy: true,
      lastResponseTime: 100,
      models: [CLOUD_MODEL],
      supportsOllama: true,
      supportsV1: false,
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    getConfigManager().updateConfig({
      routing: { cloudModelNoCap: true, cloudModelMaxCandidates: 100 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Layer A: Permanent ban for 401/403/404', () => {
    it('should permanently ban server:model for HTTP 401 via handleServerError', async () => {
      const { getOrchestratorInstance, resetOrchestratorInstance } = await import(
        '../../src/orchestrator/orchestrator-instance.js'
      );

      resetOrchestratorInstance();
      const orchestrator = getOrchestratorInstance();

      for (const server of fakeFleet) {
        orchestrator.addServer(server as any);
      }

      const errors: Array<{ server: string; error: string; type?: string }> = [];

      orchestrator.handleServerError(
        fakeFleet[0], // server-401-1
        CLOUD_MODEL,
        'HTTP 401: unauthorized',
        'non-retryable',
        errors
      );

      const banManager = orchestrator.getBanManager();
      expect(banManager.isBanned('server-401-1', CLOUD_MODEL)).toBe(true);
      expect(banManager.isBanned('server-401-2', CLOUD_MODEL)).toBe(false);
    });

    it('should permanently ban server:model for HTTP 403 via handleServerError', async () => {
      const { getOrchestratorInstance, resetOrchestratorInstance } = await import(
        '../../src/orchestrator/orchestrator-instance.js'
      );

      resetOrchestratorInstance();
      const orchestrator = getOrchestratorInstance();

      orchestrator.addServer(fakeFleet[2] as any); // server-403

      const errors: Array<{ server: string; error: string; type?: string }> = [];

      orchestrator.handleServerError(
        fakeFleet[2], // server-403
        CLOUD_MODEL,
        'HTTP 403: forbidden',
        'non-retryable',
        errors
      );

      expect(orchestrator.getBanManager().isBanned('server-403', CLOUD_MODEL)).toBe(true);
    });

    it('should permanently ban multiple 401 servers', async () => {
      const { getOrchestratorInstance, resetOrchestratorInstance } = await import(
        '../../src/orchestrator/orchestrator-instance.js'
      );

      resetOrchestratorInstance();
      const orchestrator = getOrchestratorInstance();

      for (const server of fakeFleet) {
        orchestrator.addServer(server as any);
      }

      const errors1: Array<{ server: string; error: string; type?: string }> = [];
      orchestrator.handleServerError(
        fakeFleet[0], // server-401-1
        CLOUD_MODEL,
        'HTTP 401: unauthorized',
        'non-retryable',
        errors1
      );

      const errors2: Array<{ server: string; error: string; type?: string }> = [];
      orchestrator.handleServerError(
        fakeFleet[1], // server-401-2
        CLOUD_MODEL,
        'HTTP 401: unauthorized',
        'non-retryable',
        errors2
      );

      const banManager = orchestrator.getBanManager();
      expect(banManager.isBanned('server-401-1', CLOUD_MODEL)).toBe(true);
      expect(banManager.isBanned('server-401-2', CLOUD_MODEL)).toBe(true);
      expect(banManager.isBanned('server-success', CLOUD_MODEL)).toBe(false);
    });
  });

  describe('Layer C: Extended cooldown for quota exhaustion', () => {
    it('should apply extended cooldown for quota exhausted errors', async () => {
      const { getOrchestratorInstance, resetOrchestratorInstance } = await import(
        '../../src/orchestrator/orchestrator-instance.js'
      );

      resetOrchestratorInstance();
      const orchestrator = getOrchestratorInstance();

      orchestrator.addServer(fakeFleet[3] as any); // server-quota

      const quotaErrorMessage =
        'HTTP 429: you (usr_test123) have reached your daily usage limit, please upgrade';

      const errors: Array<{ server: string; error: string; type?: string }> = [];

      orchestrator.handleServerError(
        fakeFleet[3], // server-quota
        CLOUD_MODEL,
        quotaErrorMessage,
        'quotaExhausted',
        errors
      );

      const banManager = orchestrator.getBanManager();
      const expiry = banManager.getExtendedCooldownExpiry('server-quota', CLOUD_MODEL, 'usr_test123');
      expect(expiry).toBeDefined();
      expect(expiry).toBeGreaterThan(Date.now());
    });

    it('should not apply permanent ban for quota exhausted errors', async () => {
      const { getOrchestratorInstance, resetOrchestratorInstance } = await import(
        '../../src/orchestrator/orchestrator-instance.js'
      );

      resetOrchestratorInstance();
      const orchestrator = getOrchestratorInstance();

      orchestrator.addServer(fakeFleet[3] as any); // server-quota

      const quotaErrorMessage =
        'HTTP 429: you (usr_test456) have reached your hourly usage limit, please upgrade';

      const errors: Array<{ server: string; error: string; type?: string }> = [];

      orchestrator.handleServerError(
        fakeFleet[3],
        CLOUD_MODEL,
        quotaErrorMessage,
        'quotaExhausted',
        errors
      );

      // Quota exhaustion should NOT result in permanent ban
      expect(orchestrator.getBanManager().isBanned('server-quota', CLOUD_MODEL)).toBe(false);

      // But it should be in extended cooldown
      const expiry = orchestrator.getBanManager().getExtendedCooldownExpiry(
        'server-quota',
        CLOUD_MODEL,
        'usr_test456'
      );
      expect(expiry).toBeDefined();
      expect(expiry).toBeGreaterThan(Date.now());
    });
  });

  describe('Success server remains unbanned', () => {
    it('should not ban the success server', async () => {
      const { getOrchestratorInstance, resetOrchestratorInstance } = await import(
        '../../src/orchestrator/orchestrator-instance.js'
      );

      resetOrchestratorInstance();
      const orchestrator = getOrchestratorInstance();

      for (const server of fakeFleet) {
        orchestrator.addServer(server as any);
      }

      // Apply bans and cooldown to error servers
      const errors1: Array<{ server: string; error: string; type?: string }> = [];
      orchestrator.handleServerError(fakeFleet[0], CLOUD_MODEL, 'HTTP 401', 'non-retryable', errors1);

      const errors2: Array<{ server: string; error: string; type?: string }> = [];
      orchestrator.handleServerError(fakeFleet[1], CLOUD_MODEL, 'HTTP 401', 'non-retryable', errors2);

      const errors3: Array<{ server: string; error: string; type?: string }> = [];
      orchestrator.handleServerError(fakeFleet[2], CLOUD_MODEL, 'HTTP 403', 'non-retryable', errors3);

      const errors4: Array<{ server: string; error: string; type?: string }> = [];
      orchestrator.handleServerError(
        fakeFleet[3],
        CLOUD_MODEL,
        'HTTP 429: you (usr_test789) have reached your hourly usage limit, please upgrade',
        'quotaExhausted',
        errors4
      );

      // Verify state
      const banManager = orchestrator.getBanManager();
      expect(banManager.isBanned('server-401-1', CLOUD_MODEL)).toBe(true);
      expect(banManager.isBanned('server-401-2', CLOUD_MODEL)).toBe(true);
      expect(banManager.isBanned('server-403', CLOUD_MODEL)).toBe(true);
      expect(banManager.getExtendedCooldownExpiry('server-quota', CLOUD_MODEL, 'usr_test789')).toBeDefined();

      // Success server should NOT be banned
      expect(banManager.isBanned('server-success', CLOUD_MODEL)).toBe(false);
    });
  });
});
