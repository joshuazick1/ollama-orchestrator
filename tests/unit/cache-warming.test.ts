import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/storage/metrics-store.js', () => {
  const mockStore = {
    getDecisions: vi.fn().mockReturnValue([]),
    getFailoverAttempts: vi.fn().mockReturnValue([]),
    getRequests: vi.fn().mockReturnValue([]),
    recordDecision: vi.fn(),
    recordRequest: vi.fn(),
    recordFailover: vi.fn(),
  };
  return { getMetricsStore: () => mockStore, _mockStore: mockStore };
});

import { DecisionHistory } from '../../src/decision-history.js';
import { RequestHistory } from '../../src/request-history.js';
import type { DecisionRow, FailoverAttemptRow, RequestRow } from '../../src/storage/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { _mockStore: mockStore } = (await import('../../src/storage/metrics-store.js')) as any;

function makeDecisionRow(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: Math.floor(Math.random() * 100000),
    timestamp: Date.now(),
    model: 'llama3',
    selected_server: 'server-1',
    algorithm: 'weighted',
    selection_reason: 'best_score',
    candidate_count: 1,
    total_score: 0.85,
    latency_score: 0.9,
    success_rate_score: 0.8,
    load_score: 0.7,
    capacity_score: 0.6,
    cb_score: null,
    timeout_score: null,
    throughput_score: null,
    vram_score: null,
    p95_latency: 150,
    success_rate: 0.95,
    in_flight: 2,
    throughput: 10,
    hour_of_day: 14,
    day_of_week: 3,
    ...overrides,
  };
}

function makeFailoverRow(overrides: Partial<FailoverAttemptRow> = {}): FailoverAttemptRow {
  return {
    id: Math.floor(Math.random() * 100000),
    timestamp: Date.now(),
    request_id: `req-${Math.random().toString(36).slice(2, 8)}`,
    model: 'llama3',
    phase: 1,
    server_id: 'server-1',
    result: 'success',
    error_type: null,
    latency_ms: 200,
    ...overrides,
  };
}

function makeRequestRow(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: `req-${Math.random().toString(36).slice(2, 8)}`,
    parent_request_id: null,
    is_retry: 0,
    timestamp: Date.now(),
    server_id: 'server-1',
    model: 'llama3',
    endpoint: '/api/chat',
    streaming: 0,
    success: 1,
    duration_ms: 500,
    error_type: null,
    error_message: null,
    tokens_prompt: 100,
    tokens_generated: 50,
    tokens_per_second: 25,
    ttft_ms: 80,
    streaming_duration_ms: null,
    chunk_count: null,
    total_bytes: null,
    max_chunk_gap_ms: null,
    avg_chunk_size: null,
    eval_duration: null,
    prompt_eval_duration: null,
    total_duration: null,
    load_duration: null,
    is_cold_start: 0,
    queue_wait_ms: null,
    hour_of_day: 14,
    day_of_week: 3,
    date_str: '2026-04-03',
    ...overrides,
  };
}

describe('Cache warming from SQLite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DecisionHistory.loadFromSQLite()', () => {
    let history: DecisionHistory;

    beforeEach(() => {
      history = new DecisionHistory({ maxEvents: 1000, persistenceEnabled: false });
    });

    afterEach(() => {
      history.stop();
    });

    it('populates events from SQLite rows', () => {
      const rows = [makeDecisionRow({ model: 'llama3' }), makeDecisionRow({ model: 'codellama' })];
      mockStore.getDecisions.mockReturnValue(rows);
      mockStore.getFailoverAttempts.mockReturnValue([]);

      history.loadFromSQLite(24);

      const events = history.getRecentEvents(100);
      expect(events.length).toBe(2);
      expect(events.some((e: { model: string }) => e.model === 'llama3')).toBe(true);
      expect(events.some((e: { model: string }) => e.model === 'codellama')).toBe(true);
    });

    it('populates failover attempts from SQLite rows', () => {
      mockStore.getDecisions.mockReturnValue([]);
      const now = Date.now();
      const failoverRows = [
        makeFailoverRow({ timestamp: now - 1000, result: 'failure', error_type: 'timeout' }),
        makeFailoverRow({ timestamp: now - 2000, result: 'success' }),
      ];
      mockStore.getFailoverAttempts.mockReturnValue(failoverRows);

      history.loadFromSQLite(24);

      const attempts = history.getRecentFailoverAttempts(100);
      expect(attempts.length).toBe(2);
      expect(attempts.some((a: { result: string }) => a.result === 'failure')).toBe(true);
    });

    it('deduplicates events that already exist in memory', () => {
      const now = Date.now();
      const rows = [
        makeDecisionRow({ timestamp: now, model: 'llama3', selected_server: 'server-1' }),
      ];
      mockStore.getDecisions.mockReturnValue(rows);
      mockStore.getFailoverAttempts.mockReturnValue([]);

      history.loadFromSQLite(24);
      const countAfterFirst = history.getRecentEvents(1000).length;

      mockStore.getDecisions.mockReturnValue(rows);
      history.loadFromSQLite(24);
      const countAfterSecond = history.getRecentEvents(1000).length;

      expect(countAfterSecond).toBe(countAfterFirst);
    });

    it('respects maxEvents limit', () => {
      const smallHistory = new DecisionHistory({ maxEvents: 5, persistenceEnabled: false });
      const rows = Array.from({ length: 20 }, (_, i) =>
        makeDecisionRow({ id: i, timestamp: Date.now() - i * 1000 })
      );
      mockStore.getDecisions.mockReturnValue(rows);
      mockStore.getFailoverAttempts.mockReturnValue([]);

      smallHistory.loadFromSQLite(24);

      mockStore.getDecisions.mockReturnValue([]);
      expect(smallHistory.getRecentEvents(100).length).toBeLessThanOrEqual(5);
      smallHistory.stop();
    });

    it('handles MetricsStore errors gracefully', () => {
      mockStore.getDecisions.mockImplementation(() => {
        throw new Error('DB corrupted');
      });

      expect(() => history.loadFromSQLite(24)).not.toThrow();
      expect(history.getRecentEvents(100).length).toBe(0);
    });

    it('passes startTime cutoff based on hours parameter', () => {
      mockStore.getDecisions.mockReturnValue([]);
      mockStore.getFailoverAttempts.mockReturnValue([]);

      const beforeCall = Date.now();
      history.loadFromSQLite(48);

      const call = mockStore.getDecisions.mock.calls[0][0];
      expect(call.startTime).toBeGreaterThanOrEqual(beforeCall - 48 * 60 * 60 * 1000 - 100);
      expect(call.startTime).toBeLessThanOrEqual(Date.now() - 48 * 60 * 60 * 1000 + 100);
    });
  });

  describe('RequestHistory.loadFromSQLite()', () => {
    let requestHistory: RequestHistory;

    beforeEach(() => {
      requestHistory = new RequestHistory({
        maxRequestsPerServer: 100,
        enablePersistence: false,
      });
    });

    afterEach(() => {
      requestHistory.stop();
    });

    it('populates requests grouped by serverId', () => {
      const rows = [
        makeRequestRow({ server_id: 'server-1', id: 'r1' }),
        makeRequestRow({ server_id: 'server-1', id: 'r2' }),
        makeRequestRow({ server_id: 'server-2', id: 'r3' }),
      ];
      mockStore.getRequests.mockReturnValue(rows);

      requestHistory.loadFromSQLite(24);

      mockStore.getRequests.mockReturnValue([]);
      const s1Records = requestHistory.getServerHistory('server-1', 1000);
      const s2Records = requestHistory.getServerHistory('server-2', 1000);
      expect(s1Records.length).toBe(2);
      expect(s2Records.length).toBe(1);
    });

    it('deduplicates requests already in memory', () => {
      const rows = [makeRequestRow({ server_id: 'server-1', id: 'dup-1' })];
      mockStore.getRequests.mockReturnValue(rows);

      requestHistory.loadFromSQLite(24);
      const countAfterFirst = requestHistory.getServerHistory('server-1', 1000).length;

      mockStore.getRequests.mockReturnValue(rows);
      requestHistory.loadFromSQLite(24);
      const countAfterSecond = requestHistory.getServerHistory('server-1', 1000).length;

      expect(countAfterSecond).toBe(countAfterFirst);
    });

    it('respects maxRequestsPerServer limit', () => {
      const smallHistory = new RequestHistory({
        maxRequestsPerServer: 3,
        enablePersistence: false,
      });
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeRequestRow({ server_id: 'server-1', id: `r-${i}`, timestamp: Date.now() - i * 1000 })
      );
      mockStore.getRequests.mockReturnValue(rows);

      smallHistory.loadFromSQLite(24);

      mockStore.getRequests.mockReturnValue([]);
      expect(smallHistory.getServerHistory('server-1', 1000).length).toBeLessThanOrEqual(3);
      smallHistory.stop();
    });

    it('handles MetricsStore errors gracefully', () => {
      mockStore.getRequests.mockImplementation(() => {
        throw new Error('DB corrupted');
      });

      expect(() => requestHistory.loadFromSQLite(24)).not.toThrow();
    });

    it('returns early when no SQLite records exist', () => {
      mockStore.getRequests.mockReturnValue([]);

      requestHistory.loadFromSQLite(24);

      expect(requestHistory.getServerHistory('server-1', 1000).length).toBe(0);
    });
  });
});
