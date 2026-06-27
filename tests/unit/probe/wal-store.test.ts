import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WALStore } from '../../../src/probe/wal-store.js';
import { OperationalStore } from '../../../src/storage/operational-store.js';

describe('WALStore', () => {
  let store: OperationalStore;
  let wal: WALStore;

  beforeEach(() => {
    store = new OperationalStore(':memory:');
    wal = new WALStore(store);
  });

  afterEach(() => {
    store.close();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Append then replay returns events in order
  // ─────────────────────────────────────────────────────────────────────────────

  it('replay returns events in insertion order', async () => {
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'HEALTHY',
      toState: 'SUSPECT',
      reason: '1 failure',
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'SUSPECT',
      toState: 'UNHEALTHY',
      reason: '3 failures',
      metadata: null,
    });

    const events: number[] = [];
    for await (const event of wal.replay()) {
      events.push(event.id);
    }

    expect(events).toEqual([1, 2, 3]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: getEventsForTuple returns only events for that tuple
  // ─────────────────────────────────────────────────────────────────────────────

  it('getEventsForTuple returns only events for that tuple', async () => {
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv2:modelB',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'HEALTHY',
      toState: 'SUSPECT',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv3:modelC',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: null,
      metadata: null,
    });

    const events = await wal.getEventsForTuple('srv1:modelA');

    expect(events).toHaveLength(2);
    expect(events.every(e => e.tupleKey === 'srv1:modelA')).toBe(true);
    expect(events.map(e => e.id)).toEqual([1, 3]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: saveSnapshot + loadLatestSnapshot roundtrip
  // ─────────────────────────────────────────────────────────────────────────────

  it('saveSnapshot + loadLatestSnapshot roundtrips correctly', async () => {
    const state = new Map<
      string,
      {
        state: string;
        consecutiveSuccesses: number;
        consecutiveFailures: number;
        lastTransition: number;
        recoveryAttempts: number;
      }
    >();
    state.set('srv1:modelA', {
      state: 'HEALTHY',
      consecutiveSuccesses: 10,
      consecutiveFailures: 0,
      lastTransition: 1000,
      recoveryAttempts: 0,
    });
    state.set('srv2:modelB', {
      state: 'SUSPECT',
      consecutiveSuccesses: 2,
      consecutiveFailures: 1,
      lastTransition: 2000,
      recoveryAttempts: 0,
    });

    await wal.saveSnapshot(state);
    const loaded = await wal.loadLatestSnapshot();

    expect(loaded).not.toBeNull();
    expect(loaded!.data.get('srv1:modelA')?.state).toBe('HEALTHY');
    expect(loaded!.data.get('srv1:modelA')?.consecutiveSuccesses).toBe(10);
    expect(loaded!.data.get('srv2:modelB')?.state).toBe('SUSPECT');
    expect(loaded!.data.get('srv2:modelB')?.consecutiveFailures).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Truncate removes events with id < beforeId
  // ─────────────────────────────────────────────────────────────────────────────

  it('truncate removes events with id < beforeId', async () => {
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'HEALTHY',
      toState: 'SUSPECT',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'SUSPECT',
      toState: 'UNHEALTHY',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'UNHEALTHY',
      toState: 'RECOVERING',
      reason: null,
      metadata: null,
    });

    const deleted = await wal.truncate(3);

    expect(deleted).toBe(2);

    const events: number[] = [];
    for await (const event of wal.replay()) {
      events.push(event.id);
    }
    expect(events).toEqual([3, 4]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5: getEventsAfter returns events newer than timestamp
  // ─────────────────────────────────────────────────────────────────────────────

  it('getEventsAfter returns events newer than timestamp', async () => {
    const before = Date.now();
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'HEALTHY',
      toState: 'SUSPECT',
      reason: null,
      metadata: null,
    });

    const events = await wal.getEventsAfter(before);
    expect(events).toHaveLength(2);

    // Use a timestamp in the future - should return 0 events
    const farFuture = Date.now() + 10000;
    const eventsAfterFuture = await wal.getEventsAfter(farFuture);
    expect(eventsAfterFuture).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 6: Count returns total event count
  // ─────────────────────────────────────────────────────────────────────────────

  it('count returns total event count', async () => {
    expect(await wal.count()).toBe(0);

    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'HEALTHY',
      toState: 'SUSPECT',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'SUSPECT',
      toState: 'UNHEALTHY',
      reason: null,
      metadata: null,
    });

    expect(await wal.count()).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 7: Concurrent appends preserve all events (no lost writes)
  // ─────────────────────────────────────────────────────────────────────────────

  it('concurrent appends preserve all events', async () => {
    const appends = Array.from({ length: 20 }, (_, i) =>
      wal.append({
        tupleKey: `srv${i % 4}:model${i % 3}`,
        eventType: 'TRANSITION',
        fromState: null,
        toState: 'HEALTHY',
        reason: null,
        metadata: null,
      })
    );

    await Promise.all(appends);

    const count = await wal.count();
    expect(count).toBe(20);

    const allEvents: number[] = [];
    for await (const event of wal.replay()) {
      allEvents.push(event.id);
    }
    expect(allEvents).toHaveLength(20);
    expect(allEvents.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 8: Append returns event with id and createdAt populated
  // ─────────────────────────────────────────────────────────────────────────────

  it('append returns event with id and createdAt populated', async () => {
    const event = await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: 'initial',
      metadata: '{"key":"value"}',
    });

    expect(event.id).toBe(1);
    expect(event.createdAt).toBeGreaterThan(0);
    expect(event.tupleKey).toBe('srv1:modelA');
    expect(event.eventType).toBe('TRANSITION');
    expect(event.fromState).toBeNull();
    expect(event.toState).toBe('HEALTHY');
    expect(event.reason).toBe('initial');
    expect(event.metadata).toBe('{"key":"value"}');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Additional: replayForTuple streams only that tuple's events
  // ─────────────────────────────────────────────────────────────────────────────

  it('replayForTuple streams only that tuple events in order', async () => {
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv2:modelB',
      eventType: 'TRANSITION',
      fromState: null,
      toState: 'HEALTHY',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'HEALTHY',
      toState: 'SUSPECT',
      reason: null,
      metadata: null,
    });
    await wal.append({
      tupleKey: 'srv1:modelA',
      eventType: 'TRANSITION',
      fromState: 'SUSPECT',
      toState: 'UNHEALTHY',
      reason: null,
      metadata: null,
    });

    const events: number[] = [];
    for await (const event of wal.replayForTuple('srv1:modelA')) {
      events.push(event.id);
    }

    expect(events).toEqual([1, 3, 4]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Additional: loadLatestSnapshot returns null when no snapshots
  // ─────────────────────────────────────────────────────────────────────────────

  it('loadLatestSnapshot returns null when no snapshots', async () => {
    const snapshot = await wal.loadLatestSnapshot();
    expect(snapshot).toBeNull();
  });
});
