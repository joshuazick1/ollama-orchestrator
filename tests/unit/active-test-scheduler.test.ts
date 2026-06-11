/**
 * active-test-scheduler.test.ts
 * Tests for the ActiveTestScheduler class — specifically the
 * detectAndExpediteFullOutages() method and general scheduling behaviour.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { ActiveTestScheduler } from '../../src/active-test-scheduler.js';
import type {
  CircuitBreakerRegistry,
  CircuitBreakerStats,
} from '../../src/circuit-breaker/circuit-breaker.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';
import { probeCoordinator } from '../../src/utils/probe-coordinator.js';

/* ---------- helpers ---------- */

function makeServer(id: string, models: string[]): AIServer {
  return {
    id,
    url: `http://${id}:11434`,
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models,
    maxConcurrency: 4,
  };
}

function makeOpenCBStats(nextRetryAt: number): CircuitBreakerStats {
  return {
    state: 'open',
    failureCount: 5,
    successCount: 0,
    lastFailure: Date.now(),
    lastSuccess: 0,
    nextRetryAt,
    errorRate: 1.0,
    errorCounts: {} as CircuitBreakerStats['errorCounts'],
    consecutiveSuccesses: 0,
    halfOpenStartedAt: 0,
  };
}

function makeClosedCBStats(): CircuitBreakerStats {
  return {
    state: 'closed',
    failureCount: 0,
    successCount: 10,
    lastFailure: 0,
    lastSuccess: Date.now(),
    nextRetryAt: 0,
    errorRate: 0,
    errorCounts: {} as CircuitBreakerStats['errorCounts'],
    consecutiveSuccesses: 10,
    halfOpenStartedAt: 0,
  };
}

function makeRegistry(stats: Record<string, CircuitBreakerStats>): CircuitBreakerRegistry {
  return {
    getAllStats: vi.fn(() => stats),
  } as unknown as CircuitBreakerRegistry;
}

/* ---------- tests ---------- */

describe('ActiveTestScheduler', () => {
  let servers: AIServer[];
  let runActiveTests: ReturnType<
    typeof vi.fn<
      (
        server: AIServer
      ) => Promise<Array<{ model: string; success: boolean; duration: number; error?: string }>>
    >
  >;
  let registry: CircuitBreakerRegistry;
  let scheduler: ActiveTestScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    probeCoordinator.reset();
    servers = [
      makeServer('s1', ['llama3:latest', 'codellama:latest']),
      makeServer('s2', ['llama3:latest']),
      makeServer('s3', ['codellama:latest']),
    ];

    runActiveTests = vi
      .fn<
        (
          server: AIServer
        ) => Promise<Array<{ model: string; success: boolean; duration: number; error?: string }>>
      >()
      .mockResolvedValue([]);
    registry = makeRegistry({});
    scheduler = new ActiveTestScheduler(registry, () => servers, runActiveTests);
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /* ---------- start / stop ---------- */

  describe('start / stop', () => {
    it('should be a no-op when started twice', () => {
      scheduler.start();
      scheduler.start(); // idempotent
      scheduler.stop();
    });

    it('should be a no-op when stopped without starting', () => {
      scheduler.stop(); // no throw
    });
  });

  /* ---------- detectAndExpediteFullOutages ---------- */

  describe('detectAndExpediteFullOutages', () => {
    const now = 1_700_000_000_000;

    it('should trigger immediate test when ALL servers for a model have open CBs', () => {
      // llama3:latest is hosted by s1 and s2 — both open
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
        's2:llama3:latest': makeOpenCBStats(now + 10_000), // closer to recovery
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);

      // Should pick s2 (earliest nextRetryAt) and trigger test
      expect(runActiveTests).toHaveBeenCalledTimes(1);
      expect(runActiveTests).toHaveBeenCalledWith(servers[1]); // s2
    });

    it('should NOT trigger when only some servers for a model have open CBs', () => {
      // llama3:latest is hosted by s1 and s2 — only s1 is open
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);

      expect(runActiveTests).not.toHaveBeenCalled();
    });

    it('should NOT trigger for server-level breakers (no colon in name)', () => {
      // Server-level breaker — should be ignored
      const allStats: Record<string, CircuitBreakerStats> = {
        s1: makeOpenCBStats(now + 30_000),
        s2: makeOpenCBStats(now + 10_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);

      expect(runActiveTests).not.toHaveBeenCalled();
    });

    it('should respect cooldown and NOT trigger again within PRIORITY_COOLDOWN_MS', () => {
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
        's2:llama3:latest': makeOpenCBStats(now + 10_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();

      // First trigger — should fire
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);
      expect(runActiveTests).toHaveBeenCalledTimes(1);

      // Second trigger at now + 5s — within cooldown, should NOT fire
      runActiveTests.mockClear();
      scheduler.detectAndExpediteFullOutages(now + 5_000, allStats, servers, serverById);
      expect(runActiveTests).not.toHaveBeenCalled();

      // Third trigger at now + 11s — past cooldown, should fire again
      runActiveTests.mockClear();
      scheduler.detectAndExpediteFullOutages(now + 11_000, allStats, servers, serverById);
      expect(runActiveTests).toHaveBeenCalledTimes(1);
    });

    it('should clear cooldown when model partially recovers', () => {
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
        's2:llama3:latest': makeOpenCBStats(now + 10_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();

      // First trigger — sets cooldown
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);
      expect(runActiveTests).toHaveBeenCalledTimes(1);

      // Partial recovery — only s1 still open
      runActiveTests.mockClear();
      const partialStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
      };
      scheduler.detectAndExpediteFullOutages(now + 2_000, partialStats, servers, serverById);
      expect(runActiveTests).not.toHaveBeenCalled(); // not full outage

      // Full outage returns — cooldown was cleared, so should fire immediately
      runActiveTests.mockClear();
      scheduler.detectAndExpediteFullOutages(now + 3_000, allStats, servers, serverById);
      expect(runActiveTests).toHaveBeenCalledTimes(1);
    });

    it('should pick the server with earliest nextRetryAt', () => {
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:codellama:latest': makeOpenCBStats(now + 5_000), // earliest
        's3:codellama:latest': makeOpenCBStats(now + 60_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);

      expect(runActiveTests).toHaveBeenCalledTimes(1);
      expect(runActiveTests).toHaveBeenCalledWith(servers[0]); // s1 — codellama hosted by s1 and s3
    });

    it('should handle multiple models with full outage independently', () => {
      // Both llama3 (s1,s2) and codellama (s1,s3) fully outaged
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
        's2:llama3:latest': makeOpenCBStats(now + 10_000),
        's1:codellama:latest': makeOpenCBStats(now + 5_000),
        's3:codellama:latest': makeOpenCBStats(now + 60_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);

      // Should trigger tests for both models
      expect(runActiveTests).toHaveBeenCalledTimes(2);
      // s2 for llama3, s1 for codellama
      const calledServerIds = runActiveTests.mock.calls.map((call: [AIServer]) => call[0].id);
      expect(calledServerIds).toContain('s2'); // llama3 — s2 has earlier retry
      expect(calledServerIds).toContain('s1'); // codellama — s1 has earlier retry
    });

    it('should cancel existing scheduled timer when expediting', () => {
      // Use a stat where only ONE server has a model open — so poll schedules a
      // timer but does NOT trigger full-outage detection (not all servers open).
      // Then we add a second open CB and call detectAndExpediteFullOutages manually.
      const partialStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 60_000), // far in future → timer scheduled, not yet fired
      };
      const fullOutageStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 60_000),
        's2:llama3:latest': makeOpenCBStats(now + 10_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      // Start with only s1 open → poll schedules timer for s1:llama3:latest but no full outage
      const partialRegistry = makeRegistry(partialStats);
      const fullScheduler = new ActiveTestScheduler(partialRegistry, () => servers, runActiveTests);
      fullScheduler.start();

      // Advance to trigger poll — schedules timer for s1:llama3:latest (60s away)
      vi.advanceTimersByTime(1000);
      expect(runActiveTests).not.toHaveBeenCalled(); // timer hasn't fired yet

      // Now full outage detected — should cancel the pending timer and trigger immediately
      fullScheduler.detectAndExpediteFullOutages(now, fullOutageStats, servers, serverById);

      expect(runActiveTests).toHaveBeenCalledTimes(1);
      expect(runActiveTests).toHaveBeenCalledWith(servers[1]); // s2 (earliest retry)

      fullScheduler.stop();
    });

    it('should skip models with no known hosting servers', () => {
      // CB is open for a model that no server claims to host
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:mystery-model': makeOpenCBStats(now + 10_000),
        's2:mystery-model': makeOpenCBStats(now + 20_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);

      expect(runActiveTests).not.toHaveBeenCalled();
    });

    it('should skip breakers for unknown server IDs', () => {
      const allStats: Record<string, CircuitBreakerStats> = {
        'unknown-server:llama3:latest': makeOpenCBStats(now + 10_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);

      expect(runActiveTests).not.toHaveBeenCalled();
    });

    it('should ignore closed circuit breakers in outage detection', () => {
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
        's2:llama3:latest': makeClosedCBStats(), // closed — not outaged
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);

      expect(runActiveTests).not.toHaveBeenCalled();
    });

    it('should clean up stale cooldowns for models no longer tracked', () => {
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
        's2:llama3:latest': makeOpenCBStats(now + 10_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      scheduler.start();

      // Trigger to set cooldown for llama3
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);
      expect(runActiveTests).toHaveBeenCalledTimes(1);

      // Now call with empty stats — cooldown for llama3 should be cleaned up
      runActiveTests.mockClear();
      scheduler.detectAndExpediteFullOutages(now + 1_000, {}, servers, serverById);

      // Call again with the original stats after cooldown would have still been active
      // but since it was cleaned, it should trigger
      runActiveTests.mockClear();
      scheduler.detectAndExpediteFullOutages(now + 2_000, allStats, servers, serverById);
      expect(runActiveTests).toHaveBeenCalledTimes(1);
    });

    it('should not trigger when scheduler is stopped', () => {
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
        's2:llama3:latest': makeOpenCBStats(now + 10_000),
      };
      const serverById = new Map(servers.map(s => [s.id, s]));

      // Don't start the scheduler — triggerTest checks isRunning
      scheduler.detectAndExpediteFullOutages(now, allStats, servers, serverById);

      // triggerTest should bail because isRunning is false
      expect(runActiveTests).not.toHaveBeenCalled();
    });
  });

  /* ---------- poll integration ---------- */

  describe('poll integration', () => {
    it('should schedule recovery tests for open breakers after poll interval', () => {
      const now = Date.now();
      const statsMap: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 500), // fires in 500ms
      };
      (registry.getAllStats as ReturnType<typeof vi.fn>).mockReturnValue(statsMap);

      scheduler.start();

      // First poll at 1s
      vi.advanceTimersByTime(1000);

      // Timer should fire at now + 500ms, but since we advanced 1s it already passed
      // The scheduled timer fires immediately (delay = max(0, nextRetryAt - now))
      // Let the setTimeout fire
      vi.advanceTimersByTime(100);

      expect(runActiveTests).toHaveBeenCalledWith(servers[0]); // s1
    });

    it('should not re-schedule if timer already exists for a breaker', () => {
      const now = Date.now();
      const statsMap: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 60_000),
      };
      (registry.getAllStats as ReturnType<typeof vi.fn>).mockReturnValue(statsMap);

      scheduler.start();

      // Two polls — should only schedule once
      vi.advanceTimersByTime(1000);
      vi.advanceTimersByTime(1000);

      // The timer hasn't fired yet (60s away), so no tests triggered
      expect(runActiveTests).not.toHaveBeenCalled();
    });

    it('should prune timers for breakers that are no longer open', () => {
      const now = Date.now();
      const openStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 60_000),
      };
      const closedStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeClosedCBStats(),
      };

      // First poll: breaker is open → schedules timer
      (registry.getAllStats as ReturnType<typeof vi.fn>).mockReturnValue(openStats);
      scheduler.start();
      vi.advanceTimersByTime(1000);

      // Second poll: breaker is now closed → timer should be pruned
      (registry.getAllStats as ReturnType<typeof vi.fn>).mockReturnValue(closedStats);
      vi.advanceTimersByTime(1000);

      // Advance past the original timer — should NOT fire because it was pruned
      vi.advanceTimersByTime(60_000);
      expect(runActiveTests).not.toHaveBeenCalled();
    });

    it('should call detectAndExpediteFullOutages during poll', () => {
      const now = Date.now();
      // Full outage: both servers for llama3 have open CBs
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
        's2:llama3:latest': makeOpenCBStats(now + 10_000),
      };
      (registry.getAllStats as ReturnType<typeof vi.fn>).mockReturnValue(allStats);

      scheduler.start();

      // First poll triggers outage detection
      vi.advanceTimersByTime(1000);

      // Should have triggered immediate test for s2 (earliest retry)
      expect(runActiveTests).toHaveBeenCalledWith(servers[1]); // s2
    });
  });

  /* ---------- stop cleanup ---------- */

  describe('stop cleanup', () => {
    it('should clear all scheduled timers on stop', () => {
      const now = Date.now();
      // Only one server per model open → no full outage → poll schedules timers without triggering tests
      const statsMap: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 60_000),
        's3:codellama:latest': makeOpenCBStats(now + 60_000),
      };
      (registry.getAllStats as ReturnType<typeof vi.fn>).mockReturnValue(statsMap);

      scheduler.start();
      vi.advanceTimersByTime(1000);
      expect(runActiveTests).not.toHaveBeenCalled();

      scheduler.stop();

      vi.advanceTimersByTime(120_000);
      expect(runActiveTests).not.toHaveBeenCalled();
    });

    it('should clear priority cooldowns on stop', () => {
      const now = Date.now();
      const allStats: Record<string, CircuitBreakerStats> = {
        's1:llama3:latest': makeOpenCBStats(now + 30_000),
        's2:llama3:latest': makeOpenCBStats(now + 10_000),
      };
      (registry.getAllStats as ReturnType<typeof vi.fn>).mockReturnValue(allStats);

      scheduler.start();
      vi.advanceTimersByTime(1000); // triggers outage detection
      expect(runActiveTests).toHaveBeenCalledTimes(1);

      scheduler.stop();

      // Restart and poll again — cooldowns should have been cleared so it triggers again
      runActiveTests.mockClear();
      (registry.getAllStats as ReturnType<typeof vi.fn>).mockReturnValue(allStats);

      const scheduler2 = new ActiveTestScheduler(registry, () => servers, runActiveTests);
      scheduler2.start();
      vi.advanceTimersByTime(1000);
      expect(runActiveTests).toHaveBeenCalled();
      scheduler2.stop();
    });
  });
});
