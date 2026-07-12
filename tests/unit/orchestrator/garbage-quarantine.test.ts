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
    getAllTimeouts: vi.fn().mockReturnValue({}),
    getQuarantinedServers: vi.fn().mockReturnValue([]),
    runStartupMigrations: vi.fn(),
    close: vi.fn(),
    quarantineServer: vi.fn(),
    deleteQuarantine: vi.fn(),
    updateQuarantineCleanCycles: vi.fn(),
  }),
  initOperationalStore: vi.fn(),
}));

vi.mock('../../../src/utils/quarantine-pool.js', () => ({
  getQuarantinePool: vi.fn(),
}));

import { AIOrchestrator } from '../../../src/orchestrator/orchestrator.js';
import { resetInFlightManager } from '../../../src/utils/in-flight-manager.js';
import { getQuarantinePool } from '../../../src/utils/quarantine-pool.js';

const mockGetQuarantinePool = vi.mocked(getQuarantinePool);

describe('Garbage Quarantine Integration', () => {
  let mockPool: ReturnType<typeof createMockPool>;
  let orchestrator: AIOrchestrator;

  function createMockPool() {
    const entries = new Map<string, { serverId: string; reason: string; consecutiveCleanCycles: number }>();
    return {
      quarantine: vi.fn((serverId: string, reason: string) => {
        entries.set(serverId, { serverId, reason, consecutiveCleanCycles: 0 });
      }),
      unquarantine: vi.fn((serverId: string) => entries.delete(serverId)),
      isQuarantined: vi.fn((serverId: string) => entries.has(serverId)),
      getEntry: vi.fn((serverId: string) => entries.get(serverId)),
      recordCleanCycle: vi.fn((serverId: string) => {
        const entry = entries.get(serverId);
        if (!entry) {
          return 0;
        }
        entry.consecutiveCleanCycles += 1;
        return entry.consecutiveCleanCycles;
      }),
      resetCleanCycles: vi.fn((serverId: string) => {
        const entry = entries.get(serverId);
        if (entry) {
          entry.consecutiveCleanCycles = 0;
        }
      }),
      _entries: entries,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    resetInFlightManager();
    mockPool = createMockPool();
    mockGetQuarantinePool.mockReturnValue(mockPool as any);
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

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('recordGarbageResponse', () => {
    it('quarantines server with reason garbage-response when response is garbage (cjk-overrun)', () => {
      const serverId = 'test-server-1';
      const garbageResponse = '这是关于机器人的故事。'.repeat(10);
      const prompt = 'Write a short story about a robot.';

      const result = orchestrator.recordGarbageResponse(serverId, garbageResponse, prompt, 'qwen3.5');

      expect(result.isGarbage).toBe(true);
      expect(result.signals).toContain('cjk-overrun');
      expect(mockPool.quarantine).toHaveBeenCalledWith(
        serverId,
        'garbage-response',
        expect.objectContaining({
          signals: expect.arrayContaining(['cjk-overrun']),
          confidence: expect.any(Number),
          evidence: expect.any(String),
          model: 'qwen3.5',
        }),
        false
      );
    });

    it('quarantines server with reason garbage-response when response has high-profanity', () => {
      const serverId = 'test-server-2';
      const garbageResponse = 'fuck shit damn hell bullshit'.repeat(5);

      const result = orchestrator.recordGarbageResponse(serverId, garbageResponse, null, 'llama3');

      expect(result.isGarbage).toBe(true);
      expect(result.signals).toContain('high-profanity');
      expect(mockPool.quarantine).toHaveBeenCalledWith(
        serverId,
        'garbage-response',
        expect.objectContaining({
          signals: expect.arrayContaining(['high-profanity']),
          model: 'llama3',
        }),
        false
      );
    });

    it('does NOT quarantine server when response is normal', () => {
      const serverId = 'test-server-3';
      const normalResponse = 'The quick brown fox jumps over the lazy dog. This is a perfectly normal response that should not trigger any garbage detection signals.';

      const result = orchestrator.recordGarbageResponse(serverId, normalResponse, null, 'llama3');

      expect(result.isGarbage).toBe(false);
      expect(result.signals).toHaveLength(0);
      expect(mockPool.quarantine).not.toHaveBeenCalled();
    });

    it('server is marked as quarantined after garbage detection fires', () => {
      const serverId = 'test-server-4';
      const garbageResponse = '这是一段关于机器人的中文故事。'.repeat(8);

      orchestrator.recordGarbageResponse(serverId, garbageResponse, 'Write about robots', 'qwen3.5');

      expect(mockPool.isQuarantined(serverId)).toBe(true);
      expect(mockPool.getEntry(serverId)).toMatchObject({
        serverId,
        reason: 'garbage-response',
      });
    });
  });

  describe('recordCleanCycle on quarantined server', () => {
    it('increments consecutiveCleanCycles when recordCleanCycle is called on quarantined server', () => {
      const serverId = 'test-server-5';
      const garbageResponse = '这是关于机器人的故事。'.repeat(10);

      orchestrator.recordGarbageResponse(serverId, garbageResponse, 'Write a story', 'qwen3.5');
      expect(mockPool.getEntry(serverId)).toMatchObject({ consecutiveCleanCycles: 0 });

      mockPool.recordCleanCycle(serverId);
      expect(mockPool.getEntry(serverId)).toMatchObject({ consecutiveCleanCycles: 1 });

      mockPool.recordCleanCycle(serverId);
      expect(mockPool.getEntry(serverId)).toMatchObject({ consecutiveCleanCycles: 2 });
    });

    it('returns 0 when recordCleanCycle is called on non-quarantined server', () => {
      const serverId = 'never-quarantined';
      const cycles = mockPool.recordCleanCycle(serverId);
      expect(cycles).toBe(0);
    });
  });
});