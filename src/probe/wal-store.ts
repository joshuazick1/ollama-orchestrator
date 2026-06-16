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

  async append(event: Omit<ProbeEvent, 'id' | 'createdAt'>): Promise<ProbeEvent> {
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

  async *replay(): AsyncIterable<ProbeEvent> {
    const rows = this.store
      .prepare(`SELECT * FROM probe_state_wal ORDER BY id ASC`)
      .all() as WalRow[];

    for (const row of rows) {
      yield this.rowToEvent(row);
    }
  }

  async *replayForTuple(tupleKey: string): AsyncIterable<ProbeEvent> {
    const rows = this.store
      .prepare(`SELECT * FROM probe_state_wal WHERE tuple_key = ? ORDER BY id ASC`)
      .all(tupleKey) as WalRow[];

    for (const row of rows) {
      yield this.rowToEvent(row);
    }
  }

  async getEventsForTuple(tupleKey: string): Promise<ProbeEvent[]> {
    const rows = this.store
      .prepare(`SELECT * FROM probe_state_wal WHERE tuple_key = ? ORDER BY id ASC`)
      .all(tupleKey) as WalRow[];

    return rows.map(r => this.rowToEvent(r));
  }

  async loadLatestSnapshot(): Promise<Snapshot | null> {
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

  async saveSnapshot(state: Map<TupleKey, TupleSnapshotState>): Promise<void> {
    this.store.transaction(() => {
      this.store
        .prepare(`INSERT INTO probe_state_snapshots (snapshot_data, created_at) VALUES (?, ?)`)
        .run(JSON.stringify(Object.fromEntries(state)), Date.now());
    });
  }

  async truncate(beforeId: number): Promise<number> {
    const result = this.store.prepare(`DELETE FROM probe_state_wal WHERE id < ?`).run(beforeId);

    return result.changes;
  }

  async count(): Promise<number> {
    const row = this.store.prepare(`SELECT COUNT(*) as cnt FROM probe_state_wal`).get() as {
      cnt: number;
    };

    return row.cnt;
  }

  async getEventsAfter(timestamp: number): Promise<ProbeEvent[]> {
    const rows = this.store
      .prepare(`SELECT * FROM probe_state_wal WHERE created_at >= ? ORDER BY id ASC`)
      .all(timestamp) as WalRow[];

    return rows.map(r => this.rowToEvent(r));
  }

  /**
   * Get all probe events for a given serverId (all models, all endpoints).
   * Uses the index on tuple_key for efficient prefix matching.
   */
  async getEventsForServerId(serverId: string): Promise<ProbeEvent[]> {
    const rows = this.store
      .prepare(
        `SELECT * FROM probe_state_wal WHERE tuple_key LIKE ? || ':' || ? || ':%' ORDER BY id ASC`
      )
      .all(serverId, '%') as WalRow[];

    return rows.map(r => this.rowToEvent(r));
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
