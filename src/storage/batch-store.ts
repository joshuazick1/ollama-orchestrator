import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import type { BatchRequestCounts, BatchStatus, BatchTrackingRecord } from '../types/batch.types.js';
import { logger } from '../utils/logger.js';

const DEFAULT_BATCH_DB_PATH = './data/batches.db';

function getDefaultBatchDbPath(): string {
  const configPath = process.env.ORCHESTRATOR_STORAGE_PATH;
  if (configPath) {
    return path.join(configPath, 'batches.db');
  }
  return DEFAULT_BATCH_DB_PATH;
}

function ensureDir(dbPath: string): void {
  const dir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createBatchSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS batch_tracking (
      batch_id        TEXT PRIMARY KEY,
      status          TEXT NOT NULL DEFAULT 'in_progress',
      created_at      INTEGER NOT NULL,
      completed_at    INTEGER,
      expires_at      INTEGER,
      request_counts  TEXT NOT NULL,
      metadata        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_batch_status ON batch_tracking(status);
    CREATE INDEX IF NOT EXISTS idx_batch_created ON batch_tracking(created_at);
  `);
}

export class BatchStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? getDefaultBatchDbPath();
    ensureDir(resolvedPath);
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    createBatchSchema(this.db);
    logger.info(`[BatchStore] Opened SQLite database at ${resolvedPath}`);
  }

  close(): void {
    this.db.close();
    logger.info('[BatchStore] Database closed');
  }

  addBatch(batch: {
    batch_id: string;
    created_at: number;
    expires_at: number;
    metadata?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT INTO batch_tracking (batch_id, status, created_at, expires_at, request_counts, metadata)
         VALUES (?, 'in_progress', ?, ?, ?, ?)`
      )
      .run(
        batch.batch_id,
        batch.created_at,
        batch.expires_at,
        JSON.stringify({
          succeeded: 0,
          errored: 0,
          canceled: 0,
          expired: 0,
          processing: 0,
        }),
        batch.metadata ? JSON.stringify(batch.metadata) : null
      );
  }

  updateBatchStatus(
    batchId: string,
    status: BatchStatus,
    requestCounts?: BatchRequestCounts,
    completedAt?: number
  ): void {
    if (requestCounts !== undefined) {
      this.db
        .prepare(
          `UPDATE batch_tracking
           SET status = ?, request_counts = ?, completed_at = ?
           WHERE batch_id = ?`
        )
        .run(status, JSON.stringify(requestCounts), completedAt ?? null, batchId);
    } else {
      this.db
        .prepare(`UPDATE batch_tracking SET status = ? WHERE batch_id = ?`)
        .run(status, batchId);
    }
  }

  getBatch(batchId: string): BatchTrackingRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM batch_tracking WHERE batch_id = ?`).get(batchId) as
      | {
          batch_id: string;
          status: string;
          created_at: number;
          completed_at: number | null;
          expires_at: number | null;
          request_counts: string;
          metadata: string | null;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      batch_id: row.batch_id,
      status: row.status as BatchStatus,
      created_at: row.created_at,
      completed_at: row.completed_at,
      expires_at: row.expires_at,
      request_counts: JSON.parse(row.request_counts) as BatchRequestCounts,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    };
  }

  listBatches(limit = 100, offset = 0): BatchTrackingRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM batch_tracking ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as Array<{
      batch_id: string;
      status: string;
      created_at: number;
      completed_at: number | null;
      expires_at: number | null;
      request_counts: string;
      metadata: string | null;
    }>;

    return rows.map(row => ({
      batch_id: row.batch_id,
      status: row.status as BatchStatus,
      created_at: row.created_at,
      completed_at: row.completed_at,
      expires_at: row.expires_at,
      request_counts: JSON.parse(row.request_counts) as BatchRequestCounts,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    }));
  }

  deleteBatch(batchId: string): boolean {
    const result = this.db.prepare(`DELETE FROM batch_tracking WHERE batch_id = ?`).run(batchId);
    return result.changes > 0;
  }

  pruneExpiredBatches(): number {
    const now = Date.now();
    const result = this.db
      .prepare(`DELETE FROM batch_tracking WHERE expires_at IS NOT NULL AND expires_at < ?`)
      .run(now);
    return result.changes;
  }
}

let _instance: BatchStore | undefined;

export function getBatchStore(dbPath?: string): BatchStore {
  if (!_instance) {
    _instance = new BatchStore(dbPath);
  }
  return _instance;
}

export function setBatchStore(store: BatchStore): void {
  _instance = store;
}

export function resetBatchStore(): void {
  if (_instance) {
    try {
      _instance.close();
    } catch {
      // ignore errors during reset
    }
    _instance = undefined;
  }
}
