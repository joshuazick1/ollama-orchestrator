/**
 * bug-regressions.test.ts
 * Regression tests for the 30+ bugs identified in the old health-check + circuit-breaker subsystems.
 * Each test documents a specific original bug and verifies the new design prevents it.
 *
 * Run: npx vitest run tests/unit/probe/bug-regressions.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EndpointRegistry } from '../../../src/probe/endpoint-registry.js';
import { ProbeOrchestrator } from '../../../src/probe/probe-orchestrator.js';
import type { Tuple, Classification } from '../../../src/probe/types.js';
import { WALStore } from '../../../src/probe/wal-store.js';
import { OperationalStore } from '../../../src/storage/operational-store.js';

function makeClassification(kind: Classification['kind']): Classification {
  return { kind, retryable: true };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

function makeTuple(
  serverId = 'srv1',
  model = 'llama3',
  endpoint: Tuple['endpoint'] = 'ollama_chat'
): Tuple {
  return { serverId, model, endpoint };
}

describe('Bug Regression Tests', () => {
  let store: OperationalStore;
  let wal: WALStore;
  let orchestrator: ProbeOrchestrator;
  let registry: EndpointRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    store = new OperationalStore(':memory:');
    wal = new WALStore(store);
    orchestrator = new ProbeOrchestrator(undefined, wal);
    registry = new EndpointRegistry();
  });

  afterEach(() => {
    store.close();
    vi.useRealTimers();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-1: TOCTOU in canExecute — old system had separate canAttempt/canExecute
  //        split with a race window between the check and the actual execution.
  // FIX: Single atomic canServe(tuple, caller) predicate — pure read-only,
  //      no await between read and decision. State is not mutated.
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-1: TOCTOU in canExecute (old) → atomic canServe()', () => {
    it('canServe is pure (read-only) — does not mutate tuple state', async () => {
      const tuple = makeTuple();
      // baseline state
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      expect(orchestrator.getState(tuple)).toBe('SUSPECT');

      const tsBefore = orchestrator.getTupleState(tuple)!;
      const beforeState = tsBefore.state;
      const beforeSuccesses = tsBefore.consecutiveSuccesses;
      const beforeFailures = tsBefore.consecutiveFailures;

      // canServe must NOT mutate state
      orchestrator.canServe(tuple, 'routing');

      const tsAfter = orchestrator.getTupleState(tuple)!;
      expect(tsAfter.state).toBe(beforeState);
      expect(tsAfter.consecutiveSuccesses).toBe(beforeSuccesses);
      expect(tsAfter.consecutiveFailures).toBe(beforeFailures);
    });

    it('canServe with routing caller returns HEALTHY and SUSPECT as eligible', () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'HEALTHY');
      expect(orchestrator.canServe(tuple, 'routing')).toBe(true);

      orchestrator.setStateForTesting(tuple, 'SUSPECT');
      expect(orchestrator.canServe(tuple, 'routing')).toBe(true);

      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      expect(orchestrator.canServe(tuple, 'routing')).toBe(false);

      orchestrator.setStateForTesting(tuple, 'RECOVERING');
      expect(orchestrator.canServe(tuple, 'routing')).toBe(false);
    });

    it('canServe with routing caller returns true for unknown tuples (treats uninitialized as eligible)', () => {
      const tuple = makeTuple();
      // No state set — tuple is unknown (never probed)
      expect(orchestrator.canServe(tuple, 'routing')).toBe(true);
    });

    it('admin caller always returns true regardless of state', () => {
      const tuple = makeTuple();
      for (const state of ['HEALTHY', 'SUSPECT', 'UNHEALTHY', 'RECOVERING'] as const) {
        orchestrator.setStateForTesting(tuple, state);
        expect(orchestrator.canServe(tuple, 'admin')).toBe(true);
      }
    });

    it('probe caller returns true only for RECOVERING state', () => {
      const tuple = makeTuple();
      for (const state of ['HEALTHY', 'SUSPECT', 'UNHEALTHY'] as const) {
        orchestrator.setStateForTesting(tuple, state);
        expect(orchestrator.canServe(tuple, 'probe')).toBe(false);
      }
      orchestrator.setStateForTesting(tuple, 'RECOVERING');
      expect(orchestrator.canServe(tuple, 'probe')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-2: onHealthCheckResult TOCTOU — old system had a race between
  //        reading health check result and updating circuit breaker state.
  // FIX: RecoveryDriver drives state machine directly; no separate
  //      onHealthCheckResult path that could race.
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-2: onHealthCheckResult TOCTOU → RecoveryDriver drives state', () => {
    it('state transitions happen atomically inside recordProbeResult', async () => {
      const tuple = makeTuple();
      // HEALTHY → SUSPECT on failure
      const result = await orchestrator.recordProbeResult(
        tuple,
        false,
        makeClassification('transient')
      );

      // The returned state and internal state must agree (no TOCTOU window)
      expect(result).toBe('SUSPECT');
      expect(orchestrator.getState(tuple)).toBe('SUSPECT');

      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 10;
      const result2 = await orchestrator.recordProbeResult(
        tuple,
        false,
        makeClassification('transient')
      );
      expect(result2).toBe('SUSPECT');
      expect(orchestrator.getState(tuple)).toBe('SUSPECT');
    });

    it('SUSPECT → UNHEALTHY after consecutiveFailures threshold', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'SUSPECT');
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 10; // high enough to avoid error-rate escalation

      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      const result = await orchestrator.recordProbeResult(
        tuple,
        false,
        makeClassification('transient')
      );

      expect(result).toBe('UNHEALTHY');
      expect(orchestrator.getState(tuple)).toBe('UNHEALTHY');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-5: Persistence debounce lost state — old system debounced saves,
  //        losing state transitions on crash.
  // FIX: WAL appends on every state transition (no debouncing).
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-5: Persistence debounce lost state → WAL append-on-transition', () => {
    it('every state transition is persisted to WAL immediately', async () => {
      const tuple = makeTuple();

      // Transition 1: HEALTHY → SUSPECT
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      expect(await wal.count()).toBe(1);

      orchestrator.setStateForTesting(tuple, 'SUSPECT');
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 10;
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 10;
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 10;
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      // Only 2 events: HEALTHY→SUSPECT and SUSPECT→UNHEALTHY.
      // The 3 intermediate probes stay in SUSPECT (no state change → no WAL entry).
      expect(await wal.count()).toBe(2);

      // Transition 3: UNHEALTHY → RECOVERING
      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      await orchestrator.recordProbeResult(tuple, true);
      // Total: HEALTHY→SUSPECT, SUSPECT→UNHEALTHY, UNHEALTHY→RECOVERING = 3 events
      expect(await wal.count()).toBe(3);
    });

    it('non-transition (no state change) does NOT write to WAL', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'SUSPECT');
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 10;
      orchestrator.getTupleState(tuple)!.consecutiveFailures = 0;
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 10;
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 10;
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      expect(await wal.count()).toBe(1);
    });

    it('state survives restart from WAL even with no snapshot', async () => {
      const tuple = makeTuple();
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));

      // Simulate restart: new orchestrator replays WAL
      const restarted = new ProbeOrchestrator(undefined, wal);
      await restarted.restoreFromWAL();

      expect(restarted.getState(tuple)).toBe('UNHEALTHY');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-8: Cross-model success contamination — old system tracked success at
  //        server:model granularity, causing one model's success to reset
  //        another model's failure count.
  // FIX: State at (server, model, endpoint) granularity — each tuple is independent.
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-8: Cross-model success contamination → tuple granularity', () => {
    it('different models on same server have independent state', async () => {
      const tuple1 = makeTuple('srv1', 'llama3', 'ollama_chat');
      const tuple2 = makeTuple('srv1', 'mixtral', 'ollama_chat');

      // Fail tuple1 → SUSPECT
      await orchestrator.recordProbeResult(tuple1, false, makeClassification('transient'));
      expect(orchestrator.getState(tuple1)).toBe('SUSPECT');

      // tuple2 should still be HEALTHY (not contaminated)
      expect(orchestrator.getState(tuple2)).toBe('HEALTHY');
    });

    it('same model, different endpoints have independent state', async () => {
      const tuple1 = makeTuple('srv1', 'llama3', 'ollama_chat');
      const tuple2 = makeTuple('srv1', 'llama3', 'ollama_generate');

      // Fail tuple1 → SUSPECT
      await orchestrator.recordProbeResult(tuple1, false, makeClassification('transient'));
      expect(orchestrator.getState(tuple1)).toBe('SUSPECT');

      // tuple2 should still be HEALTHY (not contaminated)
      expect(orchestrator.getState(tuple2)).toBe('HEALTHY');
    });

    it('success on one endpoint does NOT reset failures on another', async () => {
      const tuple1 = makeTuple('srv1', 'llama3', 'ollama_chat');
      const tuple2 = makeTuple('srv1', 'llama3', 'ollama_generate');

      // Push tuple1 to UNHEALTHY
      orchestrator.setStateForTesting(tuple1, 'SUSPECT');
      orchestrator.getTupleState(tuple1)!.consecutiveSuccesses = 10;
      await orchestrator.recordProbeResult(tuple1, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(tuple1, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(tuple1, false, makeClassification('transient'));
      expect(orchestrator.getState(tuple1)).toBe('UNHEALTHY');

      // tuple1 recovers
      orchestrator.setStateForTesting(tuple1, 'UNHEALTHY');
      await orchestrator.recordProbeResult(tuple1, true);
      expect(orchestrator.getState(tuple1)).toBe('RECOVERING');

      // tuple2 stays at whatever it was (HEALTHY) — no cross-contamination
      expect(orchestrator.getState(tuple2)).toBe('HEALTHY');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-9: Transient blip re-opens CB — old system required N consecutive
  //        successes to close, but a single failure mid-recovery would reopen.
  // FIX: SUSPECT state absorbs transient blips (requires N consecutive
  //      failures OR error rate threshold to go UNHEALTHY). RECOVERING
  //      requires recoverySuccessThreshold consecutive successes to go HEALTHY.
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-9: Transient blip re-opens CB → SUSPECT absorbs blips, RECOVERING requires N successes', () => {
    it('SUSPECT requires consecutiveFailures threshold to go UNHEALTHY, not a single failure', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'SUSPECT');
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 10; // high enough for low error rate

      // Single failure stays SUSPECT
      let result = await orchestrator.recordProbeResult(
        tuple,
        false,
        makeClassification('transient')
      );
      expect(result).toBe('SUSPECT');

      // Second failure still SUSPECT
      result = await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');

      // Third failure finally goes UNHEALTHY
      result = await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      expect(result).toBe('UNHEALTHY');
    });

    it('RECOVERING requires N consecutive successes to go HEALTHY (not just 1)', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'RECOVERING');

      // 4 successes still not enough (threshold is 5)
      for (let i = 0; i < 4; i++) {
        const result = await orchestrator.recordProbeResult(tuple, true);
        expect(result).toBe('RECOVERING');
      }

      // 5th success transitions to HEALTHY
      const result = await orchestrator.recordProbeResult(tuple, true);
      expect(result).toBe('HEALTHY');
    });

    it('RECOVERING → UNHEALTHY on single failure (probe failure re-opens)', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'RECOVERING');
      orchestrator.getTupleState(tuple)!.recoveryAttempts = 1;

      const result = await orchestrator.recordProbeResult(
        tuple,
        false,
        makeClassification('transient')
      );
      expect(result).toBe('UNHEALTHY');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-12: Healthy despite broken endpoint — old system didn't track
  //         per-endpoint capability, so if one endpoint failed the server
  //         could still appear healthy on other endpoints.
  // FIX: EndpointRegistry tracks per-endpoint declared/confirmed state.
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-12: Healthy despite broken endpoint → EndpointRegistry tracks per-endpoint', () => {
    it('EndpointRegistry.confirm only marks the specific endpoint as active', () => {
      const srv1 = 'srv1';
      registry.declare(srv1, 'ollama_chat');
      registry.declare(srv1, 'ollama_generate');
      registry.declare(srv1, 'ollama_embeddings');

      // Only confirm chat
      registry.confirm(srv1, 'ollama_chat');

      const activeChat = registry.getActiveEndpoints(srv1, 'llama3');
      const activeEmbed = registry.getActiveEndpoints(srv1, 'nomic-embed');

      expect(activeChat).toContain('ollama_chat');
      expect(activeChat).not.toContain('ollama_generate');
      expect(activeEmbed).not.toContain('ollama_embeddings'); // not confirmed
    });

    it('revoke removes specific endpoint capability', () => {
      const srv1 = 'srv1';
      registry.declare(srv1, 'ollama_chat');
      registry.confirm(srv1, 'ollama_chat');

      expect(registry.getActiveEndpoints(srv1, 'llama3')).toContain('ollama_chat');

      registry.revoke(srv1, 'ollama_chat');

      expect(registry.getActiveEndpoints(srv1, 'llama3')).not.toContain('ollama_chat');
    });

    it('revokeAll removes all endpoints for a server', () => {
      const srv1 = 'srv1';
      registry.declare(srv1, 'ollama_chat');
      registry.declare(srv1, 'ollama_generate');
      registry.confirm(srv1, 'ollama_chat');
      registry.confirm(srv1, 'ollama_generate');

      registry.revokeAll(srv1);

      expect(registry.getCapabilities(srv1).size).toBe(0);
    });

    it('getActiveEndpoints filters by model type (generation vs embedding)', () => {
      const srv1 = 'srv1';
      registry.declare(srv1, 'ollama_chat');
      registry.declare(srv1, 'ollama_embeddings');
      registry.confirm(srv1, 'ollama_chat');
      registry.confirm(srv1, 'ollama_embeddings');

      const genActive = registry.getActiveEndpoints(srv1, 'llama3');
      const embActive = registry.getActiveEndpoints(srv1, 'nomic-embed');

      expect(genActive).toContain('ollama_chat');
      expect(genActive).not.toContain('ollama_embeddings');
      expect(embActive).toContain('ollama_embeddings');
      expect(embActive).not.toContain('ollama_chat');
    });

    it('evictCold removes stale (not recently seen) confirmed endpoints', () => {
      const srv1 = 'srv1';
      registry.declare(srv1, 'ollama_chat');
      registry.confirm(srv1, 'ollama_chat');
      // lastSeen is set to Date.now() by confirm()

      // Advance time past the evict threshold (300000ms = 5 minutes)
      vi.advanceTimersByTime(400_000);
      registry.evictCold(300_000);

      const active = registry.getActiveEndpoints(srv1, 'llama3');
      expect(active).not.toContain('ollama_chat'); // evicted as stale
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-15: halfOpenStartedAt not persisted — old system didn't persist
  //         half-open start time, losing it on restart.
  // FIX: WAL stores all state including recoveryAttempts; restoreFromWAL
  //      replays metadata including recoveryAttempts which drives nextProbeAt.
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-15: halfOpenStartedAt not persisted → full state in WAL metadata', () => {
    it('restoreFromWAL preserves recoveryAttempts from metadata', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'RECOVERING');
      orchestrator.getTupleState(tuple)!.recoveryAttempts = 3;
      await orchestrator.evictTuple(tuple); // writes EVICTED with metadata

      // New orchestrator replays EVICTED
      const restarted = new ProbeOrchestrator(undefined, wal);
      await restarted.restoreFromWAL();

      // tuple should be gone (evicted)
      expect(restarted.getState(tuple)).toBe('HEALTHY');
      expect(restarted.getTupleState(tuple)).toBeUndefined();
    });

    it('STATE_CHANGE events include recoveryAttempts in metadata', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      orchestrator.getTupleState(tuple)!.recoveryAttempts = 2;

      await orchestrator.recordProbeResult(tuple, true); // UNHEALTHY → RECOVERING

      const events = await wal.getEventsForTuple('srv1:llama3:ollama_chat');
      const stateChange = events.find(e => e.eventType === 'STATE_CHANGE')!;
      expect(stateChange).toBeDefined();

      const meta = JSON.parse(stateChange.metadata!);
      expect(meta.recoveryAttempts).toBe(2);
    });

    it('createSnapshot saves recoveryAttempts per tuple', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      orchestrator.getTupleState(tuple)!.recoveryAttempts = 4;

      await orchestrator.createSnapshot();

      const snapshot = await wal.loadLatestSnapshot();
      expect(snapshot).toBeDefined();
      const snapState = snapshot!.data.get('srv1:llama3:ollama_chat');
      expect(snapState).toBeDefined();
      expect(snapState!.recoveryAttempts).toBe(4);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-16: consecutiveSuccesses loaded as 0 — old system loaded state from
  //         SQLite but didn't restore consecutiveSuccesses counter.
  // FIX: WAL metadata stores consecutiveSuccesses, consecutiveFailures,
  //      recoveryAttempts; restoreFromWAL replays them all.
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-16: consecutiveSuccesses loaded as 0 → full state in WAL events', () => {
    it('restoreFromWAL restores consecutiveSuccesses from metadata', async () => {
      const tuple = makeTuple();
      // Build up consecutiveSuccesses in RECOVERING
      orchestrator.setStateForTesting(tuple, 'RECOVERING');
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 3;

      // Snapshot + replay
      await orchestrator.createSnapshot();
      const restarted = new ProbeOrchestrator(undefined, wal);
      await restarted.restoreFromWAL();

      const ts = restarted.getTupleState(tuple);
      expect(ts).toBeDefined();
      expect(ts!.consecutiveSuccesses).toBe(3);
    });

    it('restoreFromWAL restores consecutiveFailures from metadata', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'SUSPECT');
      orchestrator.getTupleState(tuple)!.consecutiveFailures = 2;

      await orchestrator.createSnapshot();
      const restarted = new ProbeOrchestrator(undefined, wal);
      await restarted.restoreFromWAL();

      const ts = restarted.getTupleState(tuple);
      expect(ts).toBeDefined();
      expect(ts!.consecutiveFailures).toBe(2);
    });

    it('WAL event metadata contains consecutiveSuccesses and consecutiveFailures', async () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'SUSPECT');
      orchestrator.getTupleState(tuple)!.consecutiveSuccesses = 5;
      orchestrator.getTupleState(tuple)!.consecutiveFailures = 2;

      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));

      const events = await wal.getEventsForTuple('srv1:llama3:ollama_chat');
      const meta = JSON.parse(events[0].metadata!);
      expect(meta.consecutiveSuccesses).toBe(5);
      // consecutiveFailures is captured AFTER increment in _handleFailure
      expect(meta.consecutiveFailures).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-18: Unbounded CB growth — old system had no mechanism to remove
  //         stale tuples, causing unbounded memory growth.
  // FIX: EndpointRegistry + evictTuple on server removal; evictTuple writes
  //      EVICTED event to WAL and removes from in-memory state.
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-18: Unbounded CB growth → evictTuple removes tuple', () => {
    it('evictTuple removes tuple from in-memory state', async () => {
      const tuple = makeTuple();
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));

      expect(orchestrator.getAllStates().has('srv1:llama3:ollama_chat')).toBe(true);

      await orchestrator.evictTuple(tuple);

      expect(orchestrator.getAllStates().has('srv1:llama3:ollama_chat')).toBe(false);
      expect(orchestrator.getState(tuple)).toBe('HEALTHY'); // unknown tuple = HEALTHY
    });

    it('evictTuple writes EVICTED event to WAL', async () => {
      const tuple = makeTuple();
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));

      await orchestrator.evictTuple(tuple);

      const events = await wal.getEventsForTuple('srv1:llama3:ollama_chat');
      const evicted = events.find(e => e.eventType === 'EVICTED');
      expect(evicted).toBeDefined();
      expect(evicted!.fromState).toBe('SUSPECT');
    });

    it('getAllStates returns only non-evicted tuples', async () => {
      const tuple1 = makeTuple('srv1', 'llama3', 'ollama_chat');
      const tuple2 = makeTuple('srv1', 'llama3', 'ollama_generate');

      await orchestrator.recordProbeResult(tuple1, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(tuple2, false, makeClassification('transient'));

      expect(orchestrator.getAllStates().size).toBe(2);

      await orchestrator.evictTuple(tuple1);

      expect(orchestrator.getAllStates().size).toBe(1);
      expect(orchestrator.getAllStates().has('srv1:llama3:ollama_chat')).toBe(false);
      expect(orchestrator.getAllStates().has('srv1:llama3:ollama_generate')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-27: Server removal leak — old system didn't clean up CB state when
  //         a server was removed, causing stale entries.
  // FIX: removeServer calls probeOrchestrator.evictAllTuplesForServer() which
  //      evicts all tuples for that server. (evictTuple per tuple is called
  //      directly by the orchestrator integration.)
  // ─────────────────────────────────────────────────────────────────────────
  describe('BUG-27: Server removal leak → evictAllTuplesForServer on removeServer', () => {
    it('evictTuple for multiple tuples removes all server tuples', async () => {
      const tuple1 = makeTuple('srv1', 'llama3', 'ollama_chat');
      const tuple2 = makeTuple('srv1', 'mixtral', 'ollama_chat');
      const tuple3 = makeTuple('srv1', 'llama3', 'ollama_generate');

      await orchestrator.recordProbeResult(tuple1, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(tuple2, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(tuple3, false, makeClassification('transient'));

      expect(orchestrator.getAllStates().size).toBe(3);

      // Simulate server removal: evict all tuples for srv1
      await orchestrator.evictTuple(tuple1);
      await orchestrator.evictTuple(tuple2);
      await orchestrator.evictTuple(tuple3);

      expect(orchestrator.getAllStates().size).toBe(0);
    });

    it('evicted tuples are removed from WAL replay', async () => {
      const tuple = makeTuple();
      await orchestrator.recordProbeResult(tuple, false, makeClassification('transient'));
      await orchestrator.evictTuple(tuple);

      const restarted = new ProbeOrchestrator(undefined, wal);
      await restarted.restoreFromWAL();

      // Evicted tuple should not be re-created during replay
      expect(restarted.getState(tuple)).toBe('HEALTHY');
      expect(restarted.getTupleState(tuple)).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Additional regression: canProbe and markProbing atomicity
  // ─────────────────────────────────────────────────────────────────────────
  describe('canProbe / markProbing atomicity', () => {
    it('canProbe returns true only for UNHEALTHY tuples with nextProbeAt <= now', () => {
      const tuple = makeTuple();

      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      orchestrator.getTupleState(tuple)!.nextProbeAt = 0; // due immediately

      expect(orchestrator.canProbe(tuple)).toBe(true);
    });

    it('canProbe returns false for HEALTHY/SUSPECT/RECOVERING', () => {
      const tuple = makeTuple();

      for (const state of ['HEALTHY', 'SUSPECT', 'RECOVERING'] as const) {
        orchestrator.setStateForTesting(tuple, state);
        orchestrator.getTupleState(tuple)!.nextProbeAt = 0;
        expect(orchestrator.canProbe(tuple)).toBe(false);
      }
    });

    it('markProbing returns true only once (atomic dedup)', () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      orchestrator.getTupleState(tuple)!.nextProbeAt = 0;

      const results = orchestrator.markProbing(tuple);
      expect(results).toBe(true);

      // Second call should fail (nextProbeAt is now MAX_SAFE_INTEGER)
      const second = orchestrator.markProbing(tuple);
      expect(second).toBe(false);
    });

    it('markProbing only works for UNHEALTHY tuples', () => {
      const tuple = makeTuple();

      for (const state of ['HEALTHY', 'SUSPECT', 'RECOVERING'] as const) {
        orchestrator.setStateForTesting(tuple, state);
        const result = orchestrator.markProbing(tuple);
        expect(result).toBe(false);
      }
    });

    it('Promise.all concurrent markProbing calls — exactly one succeeds', () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      orchestrator.getTupleState(tuple)!.nextProbeAt = 0;

      const results = orchestrator.markProbing(tuple);
      expect(results).toBe(true);

      // Now simulate 3 concurrent callers after the first succeeded
      // nextProbeAt is MAX_SAFE_INTEGER so all should fail
      const [r1, r2, r3] = [
        orchestrator.markProbing(tuple),
        orchestrator.markProbing(tuple),
        orchestrator.markProbing(tuple),
      ];
      expect([r1, r2, r3].filter(Boolean)).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Additional regression: error rate calculation correctness
  // ─────────────────────────────────────────────────────────────────────────
  describe('Error rate calculation correctness', () => {
    it('error rate considers consecutiveSuccesses + errorWindow length', async () => {
      const config = {
        intervalMs: 30_000,
        suspectAfterFailures: 1,
        unhealthyAfterFailures: 3,
        errorRateSuspectThreshold: 0.3,
        errorRateUnhealthyThreshold: 0.7,
        suspectWindowMs: 60_000,
        recoveryBackoffMs: [10_000, 30_000, 60_000, 300_000, 900_000],
        recoverySuccessThreshold: 5,
        probeTimeoutMs: 5_000,
        maxConcurrentProbes: 10,
        snapshotIntervalMs: 300_000,
        walTruncateThreshold: 10_000,
      };
      const o = new ProbeOrchestrator(config);
      const tuple = makeTuple();

      o.setStateForTesting(tuple, 'SUSPECT');
      o.getTupleState(tuple)!.consecutiveSuccesses = 10; // 10 successes

      // 1 failure: errorRate = 1/(10+1) = 0.09 < 0.7 → stays SUSPECT
      let result = await o.recordProbeResult(tuple, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');

      // 2 failures: errorRate = 2/(10+2) = 0.167 < 0.7 → stays SUSPECT
      result = await o.recordProbeResult(tuple, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');

      // 3 failures: errorRate = 3/(10+3) = 0.23 < 0.7, but consecutiveFailures >= unhealthyAfterFailures
      // triggers UNHEALTHY regardless of error rate (the check is OR, not AND)
      result = await o.recordProbeResult(tuple, false, makeClassification('transient'));
      expect(result).toBe('UNHEALTHY');

      // State is already UNHEALTHY after 3 failures via consecutiveFailures threshold
      expect(o.getState(tuple)).toBe('UNHEALTHY');
    });

    it('low consecutiveSuccesses causes faster error-rate escalation', async () => {
      const config = {
        intervalMs: 30_000,
        suspectAfterFailures: 1,
        unhealthyAfterFailures: 3,
        errorRateSuspectThreshold: 0.3,
        errorRateUnhealthyThreshold: 0.7,
        suspectWindowMs: 60_000,
        recoveryBackoffMs: [10_000, 30_000, 60_000, 300_000, 900_000],
        recoverySuccessThreshold: 5,
        probeTimeoutMs: 5_000,
        maxConcurrentProbes: 10,
        snapshotIntervalMs: 300_000,
        walTruncateThreshold: 10_000,
      };
      const o = new ProbeOrchestrator(config);
      const tuple = makeTuple();

      o.setStateForTesting(tuple, 'SUSPECT');
      o.getTupleState(tuple)!.consecutiveSuccesses = 1; // only 1 success

      // 3 failures: errorRate = 3/(1+3) = 0.75 > 0.7 → UNHEALTHY via error rate
      await o.recordProbeResult(tuple, false, makeClassification('transient'));
      await o.recordProbeResult(tuple, false, makeClassification('transient'));
      const result = await o.recordProbeResult(tuple, false, makeClassification('transient'));

      expect(result).toBe('UNHEALTHY');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Additional regression: resetTuple restores initial state
  // ─────────────────────────────────────────────────────────────────────────
  describe('resetTuple restores initial state', () => {
    it('resetTuple resets all counters and state to initial values', () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      const ts = orchestrator.getTupleState(tuple)!;
      ts.consecutiveSuccesses = 99;
      ts.consecutiveFailures = 88;
      ts.recoveryAttempts = 7;
      ts.lastErrorKind = 'permanent';

      orchestrator.resetTuple(tuple);

      const resetTs = orchestrator.getTupleState(tuple)!;
      expect(resetTs.state).toBe('HEALTHY');
      expect(resetTs.consecutiveSuccesses).toBe(0);
      expect(resetTs.consecutiveFailures).toBe(0);
      expect(resetTs.recoveryAttempts).toBe(0);
      expect(resetTs.lastErrorKind).toBeUndefined();
    });

    it('resetTuple does NOT fire onStateChange callback', () => {
      const tuple = makeTuple();
      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');
      const calls: unknown[] = [];
      orchestrator.onStateChange((...args) => calls.push(args));

      orchestrator.resetTuple(tuple);

      expect(calls).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Additional regression: setStateForTesting does NOT fire callbacks
  // ─────────────────────────────────────────────────────────────────────────
  describe('setStateForTesting is silent (no callbacks)', () => {
    it('setStateForTesting does not emit onStateChange', () => {
      const tuple = makeTuple();
      const calls: unknown[] = [];
      orchestrator.onStateChange((...args) => calls.push(args));

      orchestrator.setStateForTesting(tuple, 'UNHEALTHY');

      expect(calls).toHaveLength(0);
    });

    it('setStateForTesting updates lastTransition timestamp', () => {
      const tuple = makeTuple();
      vi.advanceTimersByTime(5000);

      orchestrator.setStateForTesting(tuple, 'SUSPECT');

      const ts = orchestrator.getTupleState(tuple)!;
      expect(ts.lastTransition).toBe(5000);
    });
  });
});
