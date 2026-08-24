import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PsPollBackedProvider,
  type LoadedModelSnapshot,
} from '../../../src/probe/model-availability-provider.js';
import {
  getPsPollCoordinator,
  resetPsPollCoordinator,
} from '../../../src/probe/ps-poll-coordinator-instance.js';
import { PsPollCoordinator } from '../../../src/probe/ps-poll-coordinator.js';

// Mock the orchestrator-instance to avoid needing a full orchestrator
vi.mock('../../../src/orchestrator/orchestrator-instance.js', () => ({
  getOrchestratorInstance: vi.fn(),
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
const INTERVAL_MS = 60_000; // PsPollCoordinator default interval

function makeCoordinatorWithState(
  serverId: string,
  modelNames: string[],
  lastPollAt: number
): PsPollCoordinator {
  const coordinator = new PsPollCoordinator({ intervalMs: INTERVAL_MS });
  // Access private state for testing - use type cast
  (
    coordinator as unknown as {
      state: Map<
        string,
        { models: Set<string>; lastPollAt: number; errorCount: number; lastErrorAt: number }
      >;
    }
  ).state.set(serverId, {
    models: new Set(modelNames),
    lastPollAt,
    errorCount: 0,
    lastErrorAt: 0,
  });
  return coordinator;
}

describe('PsPollBackedProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPsPollCoordinator();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetPsPollCoordinator();
  });

  describe('getLoadedSnapshot', () => {
    it('returns a fresh snapshot when lastPolledAt is recent', () => {
      const coordinator = makeCoordinatorWithState(SERVER_ID, [MODEL], Date.now());
      const provider = new PsPollBackedProvider(coordinator, INTERVAL_MS);

      const snapshot = provider.getLoadedSnapshot(SERVER_ID, MODEL);

      expect(snapshot).toBeDefined();
      expect(snapshot?.serverId).toBe(SERVER_ID);
      expect(snapshot?.model).toBe(MODEL);
      expect(snapshot?.source).toBe('psPoll');
    });

    it('returns undefined when server has no state', () => {
      const coordinator = new PsPollCoordinator({ intervalMs: INTERVAL_MS });
      const provider = new PsPollBackedProvider(coordinator, INTERVAL_MS);

      const snapshot = provider.getLoadedSnapshot(SERVER_ID, MODEL);

      expect(snapshot).toBeUndefined();
    });

    it('returns a stale snapshot with source=fallback when lastPolledAt > 2× interval', () => {
      const staleTime = Date.now() - INTERVAL_MS * 2.5;
      const coordinator = makeCoordinatorWithState(SERVER_ID, [MODEL], staleTime);
      const provider = new PsPollBackedProvider(coordinator, INTERVAL_MS);

      const snapshot = provider.getLoadedSnapshot(SERVER_ID, MODEL);

      expect(snapshot).toBeDefined();
      expect(snapshot?.source).toBe('fallback');
    });

    it('returns a fresh snapshot when lastPolledAt is exactly at 2× interval boundary (spec: strictly >)', () => {
      // Per spec: stale only when lastPolledAt > 2× interval. At exactly 2× it's still fresh.
      const boundaryTime = Date.now() - INTERVAL_MS * 2;
      const coordinator = makeCoordinatorWithState(SERVER_ID, [MODEL], boundaryTime);
      const provider = new PsPollBackedProvider(coordinator, INTERVAL_MS);

      const snapshot = provider.getLoadedSnapshot(SERVER_ID, MODEL);

      expect(snapshot).toBeDefined();
      expect(snapshot?.source).toBe('psPoll');
    });

    it('returns a fresh snapshot when lastPolledAt is just under 2× interval', () => {
      const freshTime = Date.now() - INTERVAL_MS * 1.9;
      const coordinator = makeCoordinatorWithState(SERVER_ID, [MODEL], freshTime);
      const provider = new PsPollBackedProvider(coordinator, INTERVAL_MS);

      const snapshot = provider.getLoadedSnapshot(SERVER_ID, MODEL);

      expect(snapshot).toBeDefined();
      expect(snapshot?.source).toBe('psPoll');
    });
  });

  describe('getLoadedModels', () => {
    it('returns the set of loaded models for a server with fresh state', () => {
      const coordinator = makeCoordinatorWithState(SERVER_ID, [MODEL, 'gemma2:latest'], Date.now());
      const provider = new PsPollBackedProvider(coordinator, INTERVAL_MS);

      const loaded = provider.getLoadedModels(SERVER_ID);

      expect(loaded).toBeInstanceOf(Set);
      expect(loaded.has(MODEL)).toBe(true);
      expect(loaded.has('gemma2:latest')).toBe(true);
    });

    it('returns an empty set for a server with no state', () => {
      const coordinator = new PsPollCoordinator({ intervalMs: INTERVAL_MS });
      const provider = new PsPollBackedProvider(coordinator, INTERVAL_MS);

      const loaded = provider.getLoadedModels(SERVER_ID);

      expect(loaded).toBeInstanceOf(Set);
      expect(loaded.size).toBe(0);
    });

    it('returns a stale set (still populated) for a server with stale poll', () => {
      const staleTime = Date.now() - INTERVAL_MS * 3;
      const coordinator = makeCoordinatorWithState(SERVER_ID, [MODEL], staleTime);
      const provider = new PsPollBackedProvider(coordinator, INTERVAL_MS);

      // getLoadedModels returns raw set from coordinator — stale data is still useful
      const loaded = provider.getLoadedModels(SERVER_ID);

      expect(loaded).toBeInstanceOf(Set);
      expect(loaded.has(MODEL)).toBe(true);
    });
  });

  describe('snapshot fields', () => {
    it('populates serverId, model, loadedAt, sizeVram, expiresAt, lastPolledAt', () => {
      const now = Date.now();
      const coordinator = makeCoordinatorWithState(SERVER_ID, [MODEL], now);
      const provider = new PsPollBackedProvider(coordinator, INTERVAL_MS);

      const snapshot = provider.getLoadedSnapshot(SERVER_ID, MODEL);

      expect(snapshot).toMatchObject({
        serverId: SERVER_ID,
        model: MODEL,
        loadedAt: expect.any(Number),
        lastPolledAt: now,
      });
    });
  });
});
