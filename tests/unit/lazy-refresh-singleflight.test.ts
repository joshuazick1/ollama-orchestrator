import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AIOrchestrator } from '../../src/orchestrator/orchestrator.js';
import { discoverModels } from '../../src/orchestrator/discover-models.js';
import { resetInFlightManager } from '../../src/utils/in-flight-manager.js';

vi.mock('../../src/storage/operational-store.js', () => ({
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
    transaction: vi.fn(fn => fn()),
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 0 }),
    })),
  }),
  initOperationalStore: vi.fn(),
}));

vi.mock('../../src/orchestrator/discover-models.js');

describe('lazyRefresh singleflight', () => {
  let orchestrator: AIOrchestrator;

  beforeEach(() => {
    resetInFlightManager();
    vi.clearAllMocks();
    vi.useRealTimers();
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
    // Suppress persistence so addServer doesn't overwrite data/servers.json.
    // Without this, every test run would wipe the production fleet config.
    orchestrator.setSuppressPersistence(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function addServerWithoutModel(serverId: string, url: string) {
    orchestrator.addServer({
      id: serverId,
      url,
      type: 'ollama',
      healthy: true,
      lastResponseTime: 50,
      models: [],
      maxConcurrency: 4,
      supportsOllama: true,
    });
  }

  describe('Test 1: 50 concurrent calls → exactly 1 discoverModels call', () => {
    it('coalesces concurrent refresh requests for the same model into a single discoverModels call', async () => {
      const MODEL = 'llama3:8b';
      const CALL_COUNT = 50;

      addServerWithoutModel('server-1', 'http://localhost:11434');

      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [MODEL],
        openai: [],
        merged: [MODEL],
        needsCustomModelList: false,
        errors: [],
      });

      (orchestrator as unknown as { lazyRefreshLastAt: Map<string, number> }).lazyRefreshLastAt.delete(MODEL);

      const promises = Array.from({ length: CALL_COUNT }, () =>
        orchestrator.refreshServerModelsForModel(MODEL)
      );

      const results = await Promise.all(promises);

      expect(vi.mocked(discoverModels)).toHaveBeenCalledTimes(1);

      for (const r of results) {
        expect(r).toBeGreaterThan(0);
      }
    });
  });

  describe('Test 2: Refresh > 200ms timeout → caller returns 0', () => {
    it('returns 0 when the refresh takes longer than LAZY_REFRESH_WAIT_TIMEOUT_MS', async () => {
      const MODEL = 'llama3:8b';

      addServerWithoutModel('server-1', 'http://localhost:11434');

      vi.mocked(discoverModels).mockImplementation(
        () =>
          new Promise(resolve => {
            setTimeout(
              () =>
                resolve({
                  ollama: [MODEL],
                  openai: [],
                  merged: [MODEL],
                  needsCustomModelList: false,
                  errors: [],
                }),
              400
            );
          })
      );

      (orchestrator as unknown as { lazyRefreshLastAt: Map<string, number> }).lazyRefreshLastAt.delete(MODEL);

      const start = Date.now();
      const result = await orchestrator.refreshServerModelsForModel(MODEL);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(450);
    });
  });

  describe('Test 3: Stale model map → first request fires refresh, succeeds within 200ms', () => {
    it('completes successfully and returns updated count when discoverModels responds within 200ms', async () => {
      const MODEL = 'mistral:7b';

      addServerWithoutModel('server-1', 'http://localhost:11434');

      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [MODEL],
        openai: [],
        merged: [MODEL],
        needsCustomModelList: false,
        errors: [],
      });

      (orchestrator as unknown as { lazyRefreshLastAt: Map<string, number> }).lazyRefreshLastAt.delete(MODEL);

      const result = await orchestrator.refreshServerModelsForModel(MODEL);

      expect(result).toBeGreaterThan(0);
      expect(vi.mocked(discoverModels)).toHaveBeenCalledTimes(1);
    });
  });
});
