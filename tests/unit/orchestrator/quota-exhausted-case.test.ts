import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/storage/operational-store.js', () => ({
  getOperationalStore: () => ({
    addBan: vi.fn(),
    removeBan: vi.fn(),
    removeServerBans: vi.fn().mockReturnValue(0),
    removeModelBans: vi.fn().mockReturnValue(0),
    clearAllBans: vi.fn(),
    getActiveBans: vi.fn().mockReturnValue([]),
    runStartupMigrations: vi.fn(),
    close: vi.fn(),
    getAllTimeouts: vi.fn().mockReturnValue({}),
    saveTimeout: vi.fn(),
    getTimeout: vi.fn().mockReturnValue(undefined),
    saveCircuitBreakerState: vi.fn(),
    getCircuitBreakerState: vi.fn().mockReturnValue(undefined),
    getAllCircuitBreakerStates: vi.fn().mockReturnValue([]),
    recordCBTransition: vi.fn(),
    getCBTransitions: vi.fn().mockReturnValue([]),
    saveProbeTupleState: vi.fn(),
    getProbeTupleState: vi.fn().mockReturnValue(undefined),
    getAllProbeStates: vi.fn().mockReturnValue([]),
    deleteProbeTupleState: vi.fn(),
    deleteAllProbeStatesForServer: vi.fn().mockReturnValue(0),
    saveMetricsSnapshot: vi.fn(),
    getMetricsSnapshot: vi.fn().mockReturnValue(undefined),
    getAllMetricsSnapshots: vi.fn().mockReturnValue([]),
    recordRecoveryFailure: vi.fn(),
    getRecoveryFailures: vi.fn().mockReturnValue([]),
    recordMetricsSummary: vi.fn(),
    getMetricsSummaries: vi.fn().mockReturnValue([]),
    getLatestMetricsSummary: vi.fn().mockReturnValue(undefined),
    getQuarantinedServers: vi.fn().mockReturnValue([]),
    deleteQuarantine: vi.fn(),
    updateQuarantineCleanCycles: vi.fn(),
    cleanupStaleState: vi.fn(),
    transaction: vi.fn((fn: unknown) => fn()),
    prepare: vi.fn((query: string) => {
      if (query.includes('RETURNING')) {
        return {
          get: vi.fn().mockReturnValue({
            id: 1,
            tuple_key: '',
            event_type: '',
            from_state: null,
            to_state: null,
            reason: null,
            metadata: null,
            created_at: Date.now(),
          }),
          all: vi.fn().mockReturnValue([]),
          run: vi.fn().mockReturnValue({ changes: 0 }),
        };
      }
      return {
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn().mockReturnValue({ changes: 0 }),
      };
    }),
  }),
  initOperationalStore: vi.fn(),
}));

vi.mock('../../../src/utils/quarantine-pool.js', () => ({
  getQuarantinePool: vi.fn().mockReturnValue({
    quarantine: vi.fn(),
    unquarantine: vi.fn(),
    isQuarantined: vi.fn().mockReturnValue(false),
    getEntry: vi.fn().mockReturnValue(undefined),
    recordCleanCycle: vi.fn().mockReturnValue(0),
    resetCleanCycles: vi.fn(),
  }),
}));

import { AIOrchestrator } from '../../../src/orchestrator/orchestrator.js';
import { resetInFlightManager } from '../../../src/utils/in-flight-manager.js';
import { createServer } from '../../fixtures/factories.js';

const WRAPPED_QUOTA_MSG =
  'HTTP 429: 429 Too Many Requests: you (test-user_123) have reached your weekly usage limit, please upgrade your plan at https://ollama.com/pricing (api_error)';

describe('handleServerError - quotaExhausted', () => {
  let orchestrator: AIOrchestrator;

  beforeEach(() => {
    vi.useFakeTimers();
    resetInFlightManager();
    orchestrator = new AIOrchestrator(undefined, undefined, {
      enabled: false,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxConcurrentChecks: 10,
      retryAttempts: 2,
      retryDelayMs: 1000,
      recoveryIntervalMs: 60000,
      failureThreshold: 3,
      successThreshold: 2,
      backoffMultiplier: 1.5,
    });
  });

  it('should mark extended cooldown when quota message is parseable', () => {
    const server = createServer({ id: 'quota-server-1', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      WRAPPED_QUOTA_MSG,
      'quotaExhausted',
      errors
    );

    expect(orchestrator['banManager'].isInExtendedCooldown('quota-server-1', 'llama3', 'test-user_123')).toBe(true);
  });

  it('should not mark server unhealthy for quotaExhausted', () => {
    const server = createServer({ id: 'quota-server-2', models: ['llama3'] });
    server.healthy = true;
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](server, 'llama3', WRAPPED_QUOTA_MSG, 'quotaExhausted', errors);

    expect(server.healthy).toBe(true);
  });

  it('should fall back to rate-limit semantics when message is unparseable', () => {
    const server = createServer({ id: 'quota-server-3', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      'HTTP 429: some unrelated rate limit message',
      'quotaExhausted',
      errors
    );

    expect(orchestrator['banManager'].isInExtendedCooldown('quota-server-3', 'llama3', 'test-user_123')).toBe(false);
    expect(orchestrator.isInCooldown('quota-server-3', 'llama3')).toBe(true);
  });

  it('should record failure in all quotaExhausted paths', () => {
    const server = createServer({ id: 'quota-server-4', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](server, 'llama3', WRAPPED_QUOTA_MSG, 'quotaExhausted', errors);

    expect(errors).toContainEqual(
      expect.objectContaining({
        server: 'quota-server-4',
        type: 'quotaExhausted',
      })
    );
  });
});