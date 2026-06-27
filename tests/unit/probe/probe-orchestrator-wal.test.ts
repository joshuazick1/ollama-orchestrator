import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ProbeOrchestrator } from '../../../src/probe/probe-orchestrator.js';
import type { Tuple, Classification } from '../../../src/probe/types.js';
import { WALStore } from '../../../src/probe/wal-store.js';
import { OperationalStore } from '../../../src/storage/operational-store.js';

const TUPLE: Tuple = { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' };
const TUPLE2: Tuple = { serverId: 'srv2', model: 'llama3', endpoint: 'ollama_chat' };

function makeClassification(kind: Classification['kind']): Classification {
  return { kind, retryable: true };
}

describe('ProbeOrchestrator WAL Integration', () => {
  let store: OperationalStore;
  let wal: WALStore;
  let orchestrator: ProbeOrchestrator;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    store = new OperationalStore(':memory:');
    wal = new WALStore(store);
    orchestrator = new ProbeOrchestrator(undefined, wal);
  });

  afterEach(() => {
    store.close();
    vi.useRealTimers();
  });

  describe('WAL append on state transitions', () => {
    it('appends STATE_CHANGE event on HEALTHY -> SUSPECT transition', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));

      const count = await wal.count();
      expect(count).toBe(1);

      const events = await wal.getEventsForTuple('srv1:llama3:ollama_chat');
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('STATE_CHANGE');
      expect(events[0].fromState).toBe('HEALTHY');
      expect(events[0].toState).toBe('SUSPECT');
      expect(events[0].reason).toContain('failure');
    });

    it('appends STATE_CHANGE event on SUSPECT -> UNHEALTHY transition', async () => {
      orchestrator.setStateForTesting(TUPLE, 'SUSPECT');
      orchestrator.getTupleState(TUPLE)!.consecutiveSuccesses = 10;

      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));

      const events = await wal.getEventsForTuple('srv1:llama3:ollama_chat');
      const lastEvent = events[events.length - 1];
      expect(lastEvent.eventType).toBe('STATE_CHANGE');
      expect(lastEvent.fromState).toBe('SUSPECT');
      expect(lastEvent.toState).toBe('UNHEALTHY');
    });

    it('appends STATE_CHANGE event on UNHEALTHY -> RECOVERING transition', async () => {
      orchestrator.setStateForTesting(TUPLE, 'UNHEALTHY');

      await orchestrator.recordProbeResult(TUPLE, true);

      const events = await wal.getEventsForTuple('srv1:llama3:ollama_chat');
      const lastEvent = events[events.length - 1];
      expect(lastEvent.eventType).toBe('STATE_CHANGE');
      expect(lastEvent.fromState).toBe('UNHEALTHY');
      expect(lastEvent.toState).toBe('RECOVERING');
    });

    it('does NOT append event when state does not change', async () => {
      orchestrator.setStateForTesting(TUPLE, 'SUSPECT');
      orchestrator.getTupleState(TUPLE)!.consecutiveSuccesses = 10;

      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));

      const count = await wal.count();
      expect(count).toBe(0);
    });

    it('appends EVICTED event on evictTuple', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));

      await orchestrator.evictTuple(TUPLE);

      const events = await wal.getEventsForTuple('srv1:llama3:ollama_chat');
      const evictedEvent = events.find(e => e.eventType === 'EVICTED');
      expect(evictedEvent).toBeDefined();
      expect(evictedEvent!.fromState).toBe('SUSPECT');
      expect(evictedEvent!.toState).toBeNull();
      expect(evictedEvent!.reason).toBe('evictTuple');
    });

    it('metadata includes consecutiveSuccesses, consecutiveFailures, recoveryAttempts', async () => {
      orchestrator.setStateForTesting(TUPLE, 'UNHEALTHY');
      orchestrator.getTupleState(TUPLE)!.recoveryAttempts = 2;

      await orchestrator.recordProbeResult(TUPLE, true);

      const events = await wal.getEventsForTuple('srv1:llama3:ollama_chat');
      const event = events[0];
      expect(event.metadata).toBeTruthy();

      const meta = JSON.parse(event.metadata!);
      expect(meta.consecutiveSuccesses).toBe(1);
      expect(meta.consecutiveFailures).toBe(0);
      expect(meta.recoveryAttempts).toBe(2);
    });

    it('multiple tuples have independent WAL events', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE2, false, makeClassification('transient'));

      const events1 = await wal.getEventsForTuple('srv1:llama3:ollama_chat');
      const events2 = await wal.getEventsForTuple('srv2:llama3:ollama_chat');

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0].tupleKey).toBe('srv1:llama3:ollama_chat');
      expect(events2[0].tupleKey).toBe('srv2:llama3:ollama_chat');
    });
  });

  describe('restoreFromWAL', () => {
    it('rebuilds state from WAL events', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));

      const newOrchestrator = new ProbeOrchestrator(undefined, wal);
      await newOrchestrator.restoreFromWAL();

      expect(newOrchestrator.getState(TUPLE)).toBe('UNHEALTHY');
      const ts = newOrchestrator.getTupleState(TUPLE);
      expect(ts).toBeDefined();
    });

    it('replays events in order', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));

      orchestrator.setStateForTesting(TUPLE, 'SUSPECT');
      orchestrator.getTupleState(TUPLE)!.consecutiveSuccesses = 10;
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));

      const newOrchestrator = new ProbeOrchestrator(undefined, wal);
      await newOrchestrator.restoreFromWAL();

      expect(newOrchestrator.getState(TUPLE)).toBe('UNHEALTHY');
    });

    it('handles EVICTED events during replay', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.evictTuple(TUPLE);

      const newOrchestrator = new ProbeOrchestrator(undefined, wal);
      await newOrchestrator.restoreFromWAL();

      expect(newOrchestrator.getState(TUPLE)).toBe('HEALTHY');
      expect(newOrchestrator.getTupleState(TUPLE)).toBeUndefined();
    });
  });

  describe('createSnapshot and restoreFromWAL with snapshot', () => {
    it('createSnapshot saves state to WAL', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));

      await orchestrator.createSnapshot();

      const snapshot = await wal.loadLatestSnapshot();
      expect(snapshot).toBeDefined();
      expect(snapshot!.data.has('srv1:llama3:ollama_chat')).toBe(true);

      const snapState = snapshot!.data.get('srv1:llama3:ollama_chat')!;
      expect(snapState.state).toBe('UNHEALTHY');
    });

    it('restoreFromWAL uses snapshot and replays events after snapshot', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));

      await orchestrator.createSnapshot();

      await orchestrator.recordProbeResult(TUPLE, true);
      await orchestrator.recordProbeResult(TUPLE, true);
      await orchestrator.recordProbeResult(TUPLE, true);
      await orchestrator.recordProbeResult(TUPLE, true);
      await orchestrator.recordProbeResult(TUPLE, true);

      const newOrchestrator = new ProbeOrchestrator(undefined, wal);
      await newOrchestrator.restoreFromWAL();

      expect(newOrchestrator.getState(TUPLE)).toBe('HEALTHY');
    });

    it('snapshot+replay produces identical state', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, true);
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, true);

      await orchestrator.createSnapshot();

      const originalState = orchestrator.getState(TUPLE);
      const originalTs = orchestrator.getTupleState(TUPLE);

      const newOrchestrator = new ProbeOrchestrator(undefined, wal);
      await newOrchestrator.restoreFromWAL();

      expect(newOrchestrator.getState(TUPLE)).toBe(originalState);
      expect(newOrchestrator.getTupleState(TUPLE)?.consecutiveSuccesses).toBe(
        originalTs?.consecutiveSuccesses
      );
      expect(newOrchestrator.getTupleState(TUPLE)?.consecutiveFailures).toBe(
        originalTs?.consecutiveFailures
      );
    });
  });

  describe('no WAL (null wal)', () => {
    it('works without WAL (null constructor argument)', () => {
      const o = new ProbeOrchestrator(undefined, null);
      expect(o.getState(TUPLE)).toBe('HEALTHY');
    });

    it('recordProbeResult works without WAL', async () => {
      const o = new ProbeOrchestrator(undefined, null);
      const result = await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      expect(result).toBe('SUSPECT');
    });

    it('evictTuple works without WAL', async () => {
      const o = new ProbeOrchestrator(undefined, null);
      await o.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await o.evictTuple(TUPLE);
      expect(o.getState(TUPLE)).toBe('HEALTHY');
    });

    it('restoreFromWAL is no-op without WAL', async () => {
      const o = new ProbeOrchestrator(undefined, null);
      await o.restoreFromWAL();
      expect(o.getState(TUPLE)).toBe('HEALTHY');
    });

    it('createSnapshot is no-op without WAL', async () => {
      const o = new ProbeOrchestrator(undefined, null);
      await o.createSnapshot();
    });
  });

  describe('crash recovery', () => {
    it('state survives across multiple recordProbeResult calls', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE, true);

      const newOrchestrator = new ProbeOrchestrator(undefined, wal);
      await newOrchestrator.restoreFromWAL();

      const ts = newOrchestrator.getTupleState(TUPLE);
      expect(ts).toBeDefined();
      expect(ts!.consecutiveSuccesses).toBe(1);
      expect(ts!.consecutiveFailures).toBe(0);
      expect(ts!.state).toBe('RECOVERING');
    });

    it('all tuples recovered independently', async () => {
      await orchestrator.recordProbeResult(TUPLE, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE2, false, makeClassification('transient'));
      await orchestrator.recordProbeResult(TUPLE2, false, makeClassification('transient'));

      const newOrchestrator = new ProbeOrchestrator(undefined, wal);
      await newOrchestrator.restoreFromWAL();

      expect(newOrchestrator.getState(TUPLE)).toBe('SUSPECT');
      expect(newOrchestrator.getState(TUPLE2)).toBe('UNHEALTHY');
    });
  });
});
