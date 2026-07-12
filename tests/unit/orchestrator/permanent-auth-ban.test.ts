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

describe('handleServerError - non-retryable permanent auth ban', () => {
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

  it('should permanently ban server on HTTP 401 unauthorized', () => {
    const server = createServer({ id: 'auth-server-401', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      'HTTP 401: unauthorized',
      'non-retryable',
      errors
    );

    expect(orchestrator['banManager'].isBanned('auth-server-401', 'llama3')).toBe(true);
  });

  it('should permanently ban server on HTTP 403 forbidden', () => {
    const server = createServer({ id: 'auth-server-403', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      'HTTP 403: forbidden',
      'non-retryable',
      errors
    );

    expect(orchestrator['banManager'].isBanned('auth-server-403', 'llama3')).toBe(true);
  });

  it('should permanently ban server on HTTP 404 not found', () => {
    const server = createServer({ id: 'auth-server-404', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      'HTTP 404: not found',
      'non-retryable',
      errors
    );

    expect(orchestrator['banManager'].isBanned('auth-server-404', 'llama3')).toBe(true);
  });

  it('should permanently ban server on unauthorized (api_error) message', () => {
    const server = createServer({ id: 'auth-server-api', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      'unauthorized (api_error)',
      'non-retryable',
      errors
    );

    expect(orchestrator['banManager'].isBanned('auth-server-api', 'llama3')).toBe(true);
  });

  it('should permanently ban server on cloud is disabled message', () => {
    const server = createServer({ id: 'auth-server-cloud', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      'cloud is disabled',
      'non-retryable',
      errors
    );

    expect(orchestrator['banManager'].isBanned('auth-server-cloud', 'llama3')).toBe(true);
  });

  it('should permanently ban server on model not found message', () => {
    const server = createServer({ id: 'auth-server-modelnf', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      'model not found',
      'non-retryable',
      errors
    );

    expect(orchestrator['banManager'].isBanned('auth-server-modelnf', 'llama3')).toBe(true);
  });

  it('should permanently ban via memory-error branch for requires more memory', () => {
    const server = createServer({ id: 'mem-server', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      'non-retryable: requires more system memory',
      'non-retryable',
      errors
    );

    expect(orchestrator['banManager'].isBanned('mem-server', 'llama3')).toBe(true);
  });

  it('should use 2-min cooldown for non-specific non-retryable error (not banned)', () => {
    const server = createServer({ id: 'generic-server', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](
      server,
      'llama3',
      'server low disk space',
      'non-retryable',
      errors
    );

    expect(orchestrator['banManager'].isBanned('generic-server', 'llama3')).toBe(false);
    expect(orchestrator.isInCooldown('generic-server', 'llama3')).toBe(true);
  });

  it('should not mark server unhealthy for auth errors', () => {
    const server = createServer({ id: 'auth-server-health', models: ['llama3'] });
    server.healthy = true;
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](server, 'llama3', 'HTTP 401: unauthorized', 'non-retryable', errors);

    expect(server.healthy).toBe(true);
  });

  it('should record failure in all auth-ban paths', () => {
    const server = createServer({ id: 'auth-server-rec', models: ['llama3'] });
    orchestrator.addServer(server);

    const errors: Array<{ server: string; error: string; type?: string }> = [];
    orchestrator['handleServerError'](server, 'llama3', 'HTTP 401: unauthorized', 'non-retryable', errors);

    expect(errors).toContainEqual(
      expect.objectContaining({
        server: 'auth-server-rec',
        type: 'non-retryable',
      })
    );
  });
});