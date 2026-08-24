/**
 * operational-store-v9-migration.test.ts
 * Tests for V9 schema migration: adds decision_id to requests and request_id to decisions.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applySchema, CURRENT_SCHEMA_VERSION } from '../../src/storage/schema.js';

describe('OperationalStore V9 Migration', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  function tableInfo(table: string) {
    return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
      dflt_value: unknown;
    }>;
  }

  function indexesFor(table: string) {
    return db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name LIKE 'idx_%'`
      )
      .all(table) as Array<{ name: string }>;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Fresh database: version 0 → V9
  // ─────────────────────────────────────────────────────────────────────────────

  describe('fresh database (version 0)', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      db.pragma('journal_mode = WAL');
      applySchema(db);
    });

    it('CURRENT_SCHEMA_VERSION is 9', () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(9);
    });

    it('user_version is set to 9 after applySchema', () => {
      const version = db.pragma('user_version', { simple: true });
      expect(version).toBe(9);
    });

    // ── decisions.request_id ──────────────────────────────────────────────────

    it('decisions table has request_id column', () => {
      const cols = tableInfo('decisions').map(c => c.name);
      expect(cols).toContain('request_id');
    });

    it('decisions.request_id is TEXT', () => {
      const col = tableInfo('decisions').find(c => c.name === 'request_id');
      expect(col?.type).toBe('TEXT');
    });

    it('decisions.request_id is nullable', () => {
      const col = tableInfo('decisions').find(c => c.name === 'request_id');
      expect(col?.notnull).toBe(0);
    });

    it('decisions has idx_decisions_request_id index', () => {
      const idxs = indexesFor('decisions');
      expect(idxs.some(i => i.name === 'idx_decisions_request_id')).toBe(true);
    });

    // ── requests.decision_id ─────────────────────────────────────────────────

    it('requests table has decision_id column', () => {
      const cols = tableInfo('requests').map(c => c.name);
      expect(cols).toContain('decision_id');
    });

    it('requests.decision_id is TEXT', () => {
      const col = tableInfo('requests').find(c => c.name === 'decision_id');
      expect(col?.type).toBe('TEXT');
    });

    it('requests.decision_id is nullable', () => {
      const col = tableInfo('requests').find(c => c.name === 'decision_id');
      expect(col?.notnull).toBe(0);
    });

    it('requests has idx_requests_decision_id index', () => {
      const idxs = indexesFor('requests');
      expect(idxs.some(i => i.name === 'idx_requests_decision_id')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Legacy upgrade: version 7 → 9 (migrations 8 and 9 applied)
  // Build a true v7-only database (not the full fresh schema) by constructing
  // the tables manually without the V9 columns, then set user_version=7 so that
  // applySchema() will run only migrations 8 and 9.
  // ─────────────────────────────────────────────────────────────────────────────

  describe('legacy upgrade from version 7', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      db.pragma('journal_mode = WAL');
      db.exec(`
        CREATE TABLE requests (
          id TEXT PRIMARY KEY, parent_request_id TEXT, is_retry INTEGER NOT NULL DEFAULT 0,
          timestamp INTEGER NOT NULL, server_id TEXT NOT NULL, model TEXT NOT NULL,
          endpoint TEXT NOT NULL, streaming INTEGER NOT NULL DEFAULT 0,
          success INTEGER NOT NULL, duration_ms REAL, error_type TEXT, error_message TEXT,
          tokens_prompt INTEGER, tokens_generated INTEGER, tokens_per_second REAL,
          ttft_ms REAL, streaming_duration_ms REAL, chunk_count INTEGER, total_bytes INTEGER,
          max_chunk_gap_ms REAL, avg_chunk_size REAL,
          eval_duration INTEGER, prompt_eval_duration INTEGER, total_duration INTEGER,
          load_duration INTEGER, is_cold_start INTEGER NOT NULL DEFAULT 0,
          queue_wait_ms REAL, is_probe INTEGER NOT NULL DEFAULT 0,
          hour_of_day INTEGER NOT NULL, day_of_week INTEGER NOT NULL, date_str TEXT NOT NULL
        );
        CREATE TABLE decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL,
          model TEXT NOT NULL, selected_server TEXT NOT NULL, algorithm TEXT NOT NULL,
          selection_reason TEXT, candidate_count INTEGER NOT NULL,
          total_score REAL, latency_score REAL, success_rate_score REAL, load_score REAL,
          capacity_score REAL, cb_score REAL, timeout_score REAL, throughput_score REAL,
          vram_score REAL, p95_latency REAL, success_rate REAL, in_flight INTEGER,
          throughput REAL, hour_of_day INTEGER NOT NULL, day_of_week INTEGER NOT NULL
        );
        CREATE TABLE decision_candidates (
          decision_id INTEGER NOT NULL, server_id TEXT NOT NULL,
          total_score REAL, latency_score REAL, success_rate_score REAL, load_score REAL,
          capacity_score REAL, p95_latency REAL, success_rate REAL, in_flight INTEGER,
          throughput REAL, PRIMARY KEY (decision_id, server_id)
        );
        CREATE TABLE failover_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL,
          request_id TEXT NOT NULL, model TEXT NOT NULL, phase INTEGER NOT NULL,
          server_id TEXT NOT NULL, result TEXT NOT NULL, error_type TEXT, latency_ms REAL
        );
      `);
      db.pragma('user_version = 7');
    });

    it('re-applying migrations upgrades to 9 and adds both columns', () => {
      applySchema(db);
      expect(db.pragma('user_version', { simple: true })).toBe(9);

      const decisionCols = tableInfo('decisions').map(c => c.name);
      expect(decisionCols).toContain('request_id');

      const requestCols = tableInfo('requests').map(c => c.name);
      expect(requestCols).toContain('decision_id');
    });

    it('migration is idempotent — running twice does not throw', () => {
      applySchema(db);
      expect(() => applySchema(db)).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Column defaults: both nullable means existing rows get NULL (safe)
  // Same true-v7 approach to avoid schema+migration collision.
  // ─────────────────────────────────────────────────────────────────────────────

  describe('existing rows remain readable after migration', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      db.pragma('journal_mode = WAL');
      db.exec(`
        CREATE TABLE requests (
          id TEXT PRIMARY KEY, parent_request_id TEXT, is_retry INTEGER NOT NULL DEFAULT 0,
          timestamp INTEGER NOT NULL, server_id TEXT NOT NULL, model TEXT NOT NULL,
          endpoint TEXT NOT NULL, streaming INTEGER NOT NULL DEFAULT 0,
          success INTEGER NOT NULL, duration_ms REAL, error_type TEXT, error_message TEXT,
          tokens_prompt INTEGER, tokens_generated INTEGER, tokens_per_second REAL,
          ttft_ms REAL, streaming_duration_ms REAL, chunk_count INTEGER, total_bytes INTEGER,
          max_chunk_gap_ms REAL, avg_chunk_size REAL,
          eval_duration INTEGER, prompt_eval_duration INTEGER, total_duration INTEGER,
          load_duration INTEGER, is_cold_start INTEGER NOT NULL DEFAULT 0,
          queue_wait_ms REAL, is_probe INTEGER NOT NULL DEFAULT 0,
          hour_of_day INTEGER NOT NULL, day_of_week INTEGER NOT NULL, date_str TEXT NOT NULL
        );
        CREATE TABLE decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL,
          model TEXT NOT NULL, selected_server TEXT NOT NULL, algorithm TEXT NOT NULL,
          selection_reason TEXT, candidate_count INTEGER NOT NULL,
          total_score REAL, latency_score REAL, success_rate_score REAL, load_score REAL,
          capacity_score REAL, cb_score REAL, timeout_score REAL, throughput_score REAL,
          vram_score REAL, p95_latency REAL, success_rate REAL, in_flight INTEGER,
          throughput REAL, hour_of_day INTEGER NOT NULL, day_of_week INTEGER NOT NULL
        );
        CREATE TABLE decision_candidates (
          decision_id INTEGER NOT NULL, server_id TEXT NOT NULL,
          total_score REAL, latency_score REAL, success_rate_score REAL, load_score REAL,
          capacity_score REAL, p95_latency REAL, success_rate REAL, in_flight INTEGER,
          throughput REAL, PRIMARY KEY (decision_id, server_id)
        );
        CREATE TABLE failover_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL,
          request_id TEXT NOT NULL, model TEXT NOT NULL, phase INTEGER NOT NULL,
          server_id TEXT NOT NULL, result TEXT NOT NULL, error_type TEXT, latency_ms REAL
        );
      `);
      db.pragma('user_version = 7');
      db.prepare(
        `INSERT INTO decisions
           (timestamp, model, selected_server, algorithm, selection_reason,
            candidate_count, hour_of_day, day_of_week)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(Date.now(), 'llama3', 'srv-1', 'weighted', 'best_score', 1, 12, 3);
      db.exec(
        `INSERT INTO requests
         (id, parent_request_id, is_retry, timestamp, server_id, model, endpoint,
          streaming, success, hour_of_day, day_of_week, date_str)
         VALUES
         ('req-legacy-1', NULL, 0, ${Date.now()}, 'srv-1', 'llama3', 'chat',
          0, 1, 12, 3, '2025-01-01')`
      );
    });

    it('pre-existing decision rows are still readable after upgrade', () => {
      applySchema(db);
      const row = db
        .prepare('SELECT timestamp, model, selected_server FROM decisions LIMIT 1')
        .get() as { timestamp: number; model: string; selected_server: string };
      expect(row.model).toBe('llama3');
      expect(row.selected_server).toBe('srv-1');
    });

    it('pre-existing request rows are still readable after upgrade', () => {
      applySchema(db);
      const row = db
        .prepare('SELECT id, server_id, model, success FROM requests LIMIT 1')
        .get() as { id: string; server_id: string; model: string; success: number };
      expect(row.id).toBe('req-legacy-1');
      expect(row.model).toBe('llama3');
    });

    it('newly inserted rows can use the new columns', () => {
      applySchema(db);
      db.prepare(
        `INSERT INTO decisions
         (timestamp, model, selected_server, algorithm, selection_reason,
          candidate_count, hour_of_day, day_of_week, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(Date.now(), 'llama3', 'srv-2', 'weighted', 'best_score', 1, 12, 3, 'req-999');
      const row = db
        .prepare('SELECT request_id FROM decisions WHERE request_id=?')
        .get('req-999') as { request_id: string } | undefined;
      expect(row?.request_id).toBe('req-999');
    });
  });
});
