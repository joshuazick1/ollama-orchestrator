import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIOrchestrator } from '../../../src/orchestrator/orchestrator.js';
import type { ProbeOrchestrator } from '../../../src/probe/probe-orchestrator.js';
import { resetPsPollCoordinator } from '../../../src/probe/ps-poll-coordinator-instance.js';
import { getQuarantinePool, type QuarantineEntry } from '../../../src/utils/quarantine-pool.js';

// Mock dependencies
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
    transaction: vi.fn((fn: (t: unknown) => unknown) => fn({})),
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn().mockReturnValue({ changes: 0 }),
    })),
  }),
  initOperationalStore: vi.fn(),
}));

vi.mock('../../../src/probe/ps-poll-coordinator-instance.js', () => ({
  getPsPollCoordinator: vi.fn(),
  resetPsPollCoordinator: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const MODEL = 'llama3:latest';
const SERVER_ID = 'test-server';

function createOrchestrator(): AIOrchestrator {
  return new AIOrchestrator(undefined, undefined, {
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
}

describe('AIOrchestrator isServerModelEligible', () => {
  let orchestrator: AIOrchestrator;
  let mockProbeOrchestrator: ProbeOrchestrator;

  beforeEach(() => {
    resetPsPollCoordinator();
    orchestrator = createOrchestrator();
    orchestrator.addServer({
      id: SERVER_ID,
      url: 'http://127.0.0.1:7000',
      type: 'ollama' as const,
      healthy: true,
      models: [MODEL],
      lastResponseTime: 100,
    });

    // Mock the probe orchestrator on the orchestrator
    mockProbeOrchestrator = {
      canServe: vi.fn().mockReturnValue(true),
    } as unknown as ProbeOrchestrator;

    // Clear quarantine pool singleton to ensure test isolation
    const qpool = getQuarantinePool() as unknown as { entries: Map<string, QuarantineEntry> };
    qpool.entries.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetPsPollCoordinator();
  });

  describe('gate aggregation', () => {
    it('returns eligible=true when all gates pass', async () => {
      // Inject mock probe orchestrator
      Object.defineProperty(orchestrator, 'probeOrchestrator', {
        value: mockProbeOrchestrator,
        writable: true,
      });

      const result = orchestrator.isServerModelEligible(SERVER_ID, MODEL);

      expect(result.eligible).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('returns eligible=false with reason when server is unhealthy', async () => {
      Object.defineProperty(orchestrator, 'probeOrchestrator', {
        value: mockProbeOrchestrator,
        writable: true,
      });

      // Mark server unhealthy
      const server = orchestrator.getServer(SERVER_ID);
      if (server) {
        server.healthy = false;
      }

      const result = orchestrator.isServerModelEligible(SERVER_ID, MODEL);

      expect(result.eligible).toBe(false);
      expect(result.reasons.some(r => r.includes('unhealthy'))).toBe(true);
    });

    it('returns eligible=false with reason when canServe returns false', async () => {
      mockProbeOrchestrator.canServe = vi.fn().mockReturnValue(false);
      Object.defineProperty(orchestrator, 'probeOrchestrator', {
        value: mockProbeOrchestrator,
        writable: true,
      });

      const result = orchestrator.isServerModelEligible(SERVER_ID, MODEL);

      expect(result.eligible).toBe(false);
      expect(result.reasons.some(r => r.includes('probe') || r.includes('canServe'))).toBe(true);
    });

    it('returns eligible=false with reason when server is banned', async () => {
      Object.defineProperty(orchestrator, 'probeOrchestrator', {
        value: mockProbeOrchestrator,
        writable: true,
      });

      // Add a ban
      orchestrator.getBanManager().addBan(SERVER_ID, MODEL);

      const result = orchestrator.isServerModelEligible(SERVER_ID, MODEL);

      expect(result.eligible).toBe(false);
      expect(result.reasons.some(r => r.includes('ban'))).toBe(true);
    });

    it('returns eligible=false with reason when server is quarantined', async () => {
      Object.defineProperty(orchestrator, 'probeOrchestrator', {
        value: mockProbeOrchestrator,
        writable: true,
      });

      // Quarantine the server (singleton already cleared in beforeEach)
      getQuarantinePool().quarantine(SERVER_ID, 'test quarantine');

      const result = orchestrator.isServerModelEligible(SERVER_ID, MODEL);

      expect(result.eligible).toBe(false);
      expect(result.reasons.some(r => r.includes('quarantine'))).toBe(true);
    });

    it('aggregates multiple failure reasons', async () => {
      mockProbeOrchestrator.canServe = vi.fn().mockReturnValue(false);
      Object.defineProperty(orchestrator, 'probeOrchestrator', {
        value: mockProbeOrchestrator,
        writable: true,
      });

      const server = orchestrator.getServer(SERVER_ID);
      if (server) {
        server.healthy = false;
      }
      orchestrator.getBanManager().addBan(SERVER_ID, MODEL);

      const result = orchestrator.isServerModelEligible(SERVER_ID, MODEL);

      expect(result.eligible).toBe(false);
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('optional endpoint parameter', () => {
    it('accepts an optional endpoint parameter', async () => {
      Object.defineProperty(orchestrator, 'probeOrchestrator', {
        value: mockProbeOrchestrator,
        writable: true,
      });

      const result = orchestrator.isServerModelEligible(SERVER_ID, MODEL, 'ollama_chat');

      expect(result.eligible).toBe(true);
      expect(mockProbeOrchestrator.canServe).toHaveBeenCalled();
    });
  });

  describe('model availability provider integration', () => {
    it('considers model availability source in eligibility', async () => {
      // The provider should be consulted when all other gates pass
      Object.defineProperty(orchestrator, 'probeOrchestrator', {
        value: mockProbeOrchestrator,
        writable: true,
      });

      const result = orchestrator.isServerModelEligible(SERVER_ID, MODEL);

      // If no model availability provider is set, the default should be psPoll-backed
      // and since there's no state for this server, it falls back gracefully
      expect(result.eligible).toBe(true);
    });
  });
});
