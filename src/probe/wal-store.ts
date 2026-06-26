import type { OperationalStore } from '../storage/operational-store.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type TupleKey = string;

export interface TupleSnapshotState {
  state: string;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  lastTransition: number;
  recoveryAttempts: number;
}

export interface TupleFullState {
  tupleKey: string;
  serverId: string;
  model: string;
  endpoint: string;
  state: string;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  errorWindow: number[];
  lastTransition: number;
  lastProbeAt: number;
  nextProbeAt: number;
  recoveryAttempts: number;
  lastErrorKind: string | undefined;
}

export interface Snapshot {
  id: number;
  createdAt: number;
  data: Map<TupleKey, TupleSnapshotState>;
}

export interface ProbeEvent {
  id: number;
  tupleKey: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  reason: string | null;
  metadata: string | null;
  createdAt: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Row types (internal SQLite mapping)
// ──────────────────────────────────────────────────────────────────────────────

interface WalRow {
  id: number;
  tuple_key: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  reason: string | null;
  metadata: string | null;
  created_at: number;
}

interface SnapshotRow {
  id: number;
  snapshot_data: string | null;
  created_at: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// WALStore
// ──────────────────────────────────────────────────────────────────────────────

export class WALStore {
  constructor(private store: OperationalStore) {}

  append(event: Omit<ProbeEvent, 'id' | 'createdAt'>): ProbeEvent {
    const createdAt = Date.now();
    const row = this.store.transaction(
      () =>
        this.store
          .prepare(
            `INSERT INTO probe_state_wal (tuple_key, event_type, from_state, to_state, reason, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             RETURNING *`
          )
          .get(
            event.tupleKey,
            event.eventType,
            event.fromState ?? null,
            event.toState ?? null,
            event.reason ?? null,
            event.metadata ?? null,
            createdAt
          ) as WalRow
    );

    return {
      id: row.id,
      tupleKey: row.tuple_key,
      eventType: row.event_type,
      fromState: row.from_state,
      toState: row.to_state,
      reason: row.reason,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }

  *replay(): Iterable<ProbeEvent> {
    const rows = this.store
      .prepare(`SELECT * FROM probe_state_wal ORDER BY id ASC`)
      .all() as WalRow[];

    for (const row of rows) {
      yield this.rowToEvent(row);
    }
  }

  *replayForTuple(tupleKey: string): Iterable<ProbeEvent> {
    const rows = this.store
      .prepare(`SELECT * FROM probe_state_wal WHERE tuple_key = ? ORDER BY id ASC`)
      .all(tupleKey) as WalRow[];

    for (const row of rows) {
      yield this.rowToEvent(row);
    }
  }

  getEventsForTuple(tupleKey: string): ProbeEvent[] {
    const rows = this.store
      .prepare(`SELECT * FROM probe_state_wal WHERE tuple_key = ? ORDER BY id ASC`)
      .all(tupleKey) as WalRow[];

    return rows.map(r => this.rowToEvent(r));
  }

  loadLatestSnapshot(): Snapshot | null {
    const row = this.store
      .prepare(`SELECT * FROM probe_state_snapshots ORDER BY id DESC LIMIT 1`)
      .get() as SnapshotRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      createdAt: row.created_at,
      data: row.snapshot_data ? new Map(Object.entries(JSON.parse(row.snapshot_data))) : new Map(),
    };
  }

  saveSnapshot(state: Map<TupleKey, TupleSnapshotState>): void {
    this.store.transaction(() => {
      this.store
        .prepare(`INSERT INTO probe_state_snapshots (snapshot_data, created_at) VALUES (?, ?)`)
        .run(JSON.stringify(Object.fromEntries(state)), Date.now());
    });
  }

  truncate(beforeId: number): number {
    const result = this.store.prepare(`DELETE FROM probe_state_wal WHERE id < ?`).run(beforeId);

    return result.changes;
  }

  count(): number {
    const row = this.store.prepare(`SELECT COUNT(*) as cnt FROM probe_state_wal`).get() as {
      cnt: number;
    };

    return row.cnt;
  }

  getEventsAfter(timestamp: number): ProbeEvent[] {
    const rows = this.store
      .prepare(`SELECT * FROM probe_state_wal WHERE created_at >= ? ORDER BY id ASC`)
      .all(timestamp) as WalRow[];

    return rows.map(r => this.rowToEvent(r));
  }

  /**
   * Get all probe events for a given serverId (all models, all endpoints).
   * Uses the index on tuple_key for efficient prefix matching.
   */
  getEventsForServerId(serverId: string): ProbeEvent[] {
    const rows = this.store
      .prepare(
        `SELECT * FROM probe_state_wal WHERE tuple_key LIKE ? || ':' || ? || ':%' ORDER BY id ASC`
      )
      .all(serverId, '%') as WalRow[];

    return rows.map(r => this.rowToEvent(r));
  }

  saveProbeTupleState(state: TupleFullState): void {
    this.store.saveProbeTupleState(state.tupleKey, state.serverId, state.model, state.endpoint, {
      state: state.state,
      consecutiveSuccesses: state.consecutiveSuccesses,
      consecutiveFailures: state.consecutiveFailures,
      errorWindow: state.errorWindow,
      lastTransition: state.lastTransition,
      lastProbeAt: state.lastProbeAt,
      nextProbeAt: state.nextProbeAt,
      recoveryAttempts: state.recoveryAttempts,
      lastErrorKind: state.lastErrorKind,
    });
  }

  getProbeTupleState(tupleKey: string): TupleFullState | undefined {
    const row = this.store.getProbeTupleState(tupleKey);
    if (!row) {
      return undefined;
    }
    return {
      tupleKey: row.tupleKey,
      serverId: row.serverId,
      model: row.model,
      endpoint: row.endpoint,
      state: row.state,
      consecutiveSuccesses: row.consecutiveSuccesses,
      consecutiveFailures: row.consecutiveFailures,
      errorWindow: row.errorWindow,
      lastTransition: row.lastTransition ?? 0,
      lastProbeAt: row.lastProbeAt ?? 0,
      nextProbeAt: row.nextProbeAt ?? 0,
      recoveryAttempts: row.recoveryAttempts,
      lastErrorKind: row.lastErrorKind ?? undefined,
    };
  }

  getAllProbeStates(): TupleFullState[] {
    const rows = this.store.getAllProbeStates();
    return rows.map(r => ({
      tupleKey: r.tupleKey,
      serverId: r.serverId,
      model: r.model,
      endpoint: r.endpoint,
      state: r.state,
      consecutiveSuccesses: r.consecutiveSuccesses,
      consecutiveFailures: r.consecutiveFailures,
      errorWindow: r.errorWindow,
      lastTransition: r.lastTransition ?? 0,
      lastProbeAt: r.lastProbeAt ?? 0,
      nextProbeAt: r.nextProbeAt ?? 0,
      recoveryAttempts: r.recoveryAttempts,
      lastErrorKind: r.lastErrorKind ?? undefined,
    }));
  }

  deleteProbeTupleState(tupleKey: string): void {
    this.store.deleteProbeTupleState(tupleKey);
  }

  deleteAllProbeStatesForServer(serverId: string): number {
    return this.store.deleteAllProbeStatesForServer(serverId);
  }

  private rowToEvent(row: WalRow): ProbeEvent {
    return {
      id: row.id,
      tupleKey: row.tuple_key,
      eventType: row.event_type,
      fromState: row.from_state,
      toState: row.to_state,
      reason: row.reason,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }
}
