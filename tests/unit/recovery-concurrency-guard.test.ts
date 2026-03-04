/**
 * REC-13: Cross-path concurrency guard tests for RecoveryTestCoordinator
 *
 * Ensures that performCoordinatedRecoveryTest and runActiveTests cannot
 * both run for the same server simultaneously.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { CircuitBreaker } from '../../src/circuit-breaker.js';
import {
  RecoveryTestCoordinator,
  resetRecoveryTestCoordinator,
} from '../../src/recovery-test-coordinator.js';

// Minimal fake circuit breaker used in tests
function makeBreaker(name: string, state: 'open' | 'half-open' | 'closed' = 'half-open') {
  const cb = {
    _name: name,
    _state: state,
    getState: () => cb._state,
    getStats: () => ({
      halfOpenStartedAt: Date.now() - 1000,
      activeTestsInProgress: 0,
    }),
    getConfig: () => ({ halfOpenTimeout: 300_000 }),
    canExecute: () => cb._state !== 'open',
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    startActiveTest: vi.fn(),
    endActiveTest: vi.fn(),
    get name() {
      return cb._name;
    },
  };
  // Expose `name` as a non-enumerable own property the coordinator reads via `(breaker as any).name`
  Object.defineProperty(cb, 'name', { value: name, writable: true });
  return cb as unknown as CircuitBreaker;
}

describe('RecoveryTestCoordinator – cross-path concurrency guard (REC-13)', () => {
  let coordinator: RecoveryTestCoordinator;

  beforeEach(() => {
    resetRecoveryTestCoordinator();
    coordinator = new RecoveryTestCoordinator({ serverCooldownMs: 0 });

    // Provide a fake server URL so network calls don't actually happen
    coordinator.setServerUrlProvider(serverId => `http://fake-${serverId}:11434`);
    coordinator.setInFlightProvider(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('performCoordinatedRecoveryTest', () => {
    it('returns false immediately when the same server is already marked active', async () => {
      // Directly simulate the state where a concurrent test holds the lock for 'srv-abc'
      const activeServers = (coordinator as any).activeServers as Set<string>;
      activeServers.add('srv-abc');

      const serverBreaker = makeBreaker('srv-abc');
      const result = await coordinator.performCoordinatedRecoveryTest(serverBreaker);

      expect(result).toBe(false);
    });

    it('allows a test to attempt when no concurrent test is active (result depends on connectivity)', async () => {
      // When no lock is held, performCoordinatedRecoveryTest is allowed to proceed.
      // The result (true/false) depends on the server being reachable; in a unit test
      // context without a real server we just verify it completes (i.e., does not return
      // early due to the concurrency guard).
      const activeServers = (coordinator as any).activeServers as Set<string>;
      // Confirm the lock is not held before calling
      expect(activeServers.has('srv-def')).toBe(false);

      const serverBreaker = makeBreaker('srv-def');
      // Call and await – it will fail (no real server) but must NOT be rejected
      const result = await coordinator.performCoordinatedRecoveryTest(serverBreaker);
      // Guard did NOT fire (returns false only due to network error, not guard)
      // The lock must also be released regardless of outcome
      expect(activeServers.has('srv-def')).toBe(false);
      // result is either true or false – just confirm it's a boolean
      expect(typeof result).toBe('boolean');
    });

    it('releases the lock after completion regardless of outcome', async () => {
      const serverBreaker = makeBreaker('srv-def2');
      const activeServers = (coordinator as any).activeServers as Set<string>;

      await coordinator.performCoordinatedRecoveryTest(serverBreaker);
      // Lock must be released after completion
      expect(activeServers.has('srv-def2')).toBe(false);
    });
  });

  describe('runActiveTests', () => {
    it('returns empty array when the server is already marked active (simulating concurrent performCoordinatedRecoveryTest)', async () => {
      // Directly manipulate the private activeServers set to simulate the state
      // where performCoordinatedRecoveryTest has acquired the lock for 'srv-ghi'.
      // This is the canonical unit-test approach when ESM named-import spying is unreliable.
      const activeServers = (coordinator as any).activeServers as Set<string>;
      activeServers.add('srv-ghi');

      const serverBreaker = makeBreaker('srv-ghi');
      const results = await coordinator.runActiveTests('srv-ghi', [{ breaker: serverBreaker }]);

      // Guard must fire immediately and return empty results
      expect(results).toEqual([]);

      // Lock should still be held (we added it, not the coordinator)
      expect(activeServers.has('srv-ghi')).toBe(true);
    });

    it('releases the lock after runActiveTests completes so subsequent calls can proceed', async () => {
      const serverBreaker = makeBreaker('srv-jkl');
      const activeServers = (coordinator as any).activeServers as Set<string>;

      await coordinator.runActiveTests('srv-jkl', [{ breaker: serverBreaker }]);

      // After completion the lock must be released
      expect(activeServers.has('srv-jkl')).toBe(false);
    });

    it('processes tests when no concurrent test is active (network failure expected without real server)', async () => {
      const serverBreaker = makeBreaker('srv-jkl');
      const activeServers = (coordinator as any).activeServers as Set<string>;

      // No lock held before call
      expect(activeServers.has('srv-jkl')).toBe(false);

      const results = await coordinator.runActiveTests('srv-jkl', [{ breaker: serverBreaker }]);

      // One result must be present (the guard did not fire)
      expect(results.length).toBe(1);
      // Lock must be released
      expect(activeServers.has('srv-jkl')).toBe(false);
    });
  });
});
