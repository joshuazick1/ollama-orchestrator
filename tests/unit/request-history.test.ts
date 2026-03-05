import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock SQLite store used by RequestHistory Phase 2 reads
vi.mock('../../src/storage/metrics-store.js', () => {
  const mockStore = {
    getRequests: vi.fn(),
  };
  return { getMetricsStore: () => mockStore, _mockStore: mockStore };
});

import type { RequestContext, AIServer } from '../../src/orchestrator.types.js';
import { RequestHistory } from '../../src/request-history.js';
import * as metricsStoreMod from '../../src/storage/metrics-store.js';

// Access the underlying mock object exported by the module mock
const mockStore = (metricsStoreMod as unknown as { _mockStore: any })._mockStore;

describe('RequestHistory', () => {
  let history: RequestHistory;
  const mockServer: AIServer = {
    id: 'server-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
    maxConcurrency: 4,
  };

  function createMockContext(overrides: Partial<RequestContext> = {}): RequestContext {
    return {
      id: `req-${Date.now()}-${Math.random()}`,
      startTime: Date.now() - 1000,
      endTime: Date.now(),
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 500,
      serverId: 'server-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    history = new RequestHistory({
      maxRequestsPerServer: 1000,
      retentionHours: 1,
      enablePersistence: false,
    });
    // Reset SQLite mock to default empty
    vi.mocked(mockStore.getRequests).mockReset();
    vi.mocked(mockStore.getRequests).mockReturnValue([]);
  });

  describe('recordRequest', () => {
    it('should record a request', () => {
      const context = createMockContext();
      history.recordRequest(context);

      expect(history.getTotalRequestCount()).toBe(1);
    });

    it('should record request with queue wait time', () => {
      const context = createMockContext();
      history.recordRequest(context, 100);

      expect(history.getTotalRequestCount()).toBe(1);
    });

    it('should record failed request', () => {
      const context = createMockContext({ success: false, error: new Error('Test error') });
      history.recordRequest(context);

      expect(history.getTotalRequestCount()).toBe(1);
    });

    it('should record streaming request', () => {
      const context = createMockContext({ streaming: true });
      history.recordRequest(context);

      expect(history.getTotalRequestCount()).toBe(1);
    });
  });

  describe('getServerHistory', () => {
    it('should get server history', () => {
      history.recordRequest(createMockContext({ serverId: 'server-1' }));
      history.recordRequest(createMockContext({ serverId: 'server-1' }));
      history.recordRequest(createMockContext({ serverId: 'server-2' }));

      const server1History = history.getServerHistory('server-1');
      expect(server1History).toHaveLength(2);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        history.recordRequest(createMockContext({ serverId: 'server-1' }));
      }

      const server1History = history.getServerHistory('server-1', 3);
      expect(server1History).toHaveLength(3);
    });

    it('should handle offset', () => {
      for (let i = 0; i < 10; i++) {
        history.recordRequest(createMockContext({ serverId: 'server-1' }));
      }

      const server1History = history.getServerHistory('server-1', 5, 5);
      expect(server1History).toHaveLength(5);
    });

    it('should merge SQLite rows when available for server history', () => {
      // In-memory has 1 recent
      history.recordRequest(
        createMockContext({ id: 'inmem-1', serverId: 'server-sql', startTime: Date.now() - 1000 })
      );

      // SQLite has older rows (use any to avoid strict typing in test)
      const sqliteRow: any = {
        id: 'sql-1',
        parent_request_id: null,
        is_retry: 0,
        timestamp: Date.now() - 1000 * 60 * 60 * 24 * 3, // 3 days ago
        server_id: 'server-sql',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: 0,
        success: 1,
        duration_ms: 400,
        error_type: null,
        error_message: null,
        tokens_prompt: null,
        tokens_generated: null,
        tokens_per_second: null,
        ttft_ms: null,
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
        hour_of_day: 12,
        day_of_week: 2,
        date_str: '2026-03-01',
      };

      vi.mocked(mockStore.getRequests).mockReturnValue([sqliteRow]);

      const merged = history.getServerHistory('server-sql', 10);
      expect(merged.find((r: any) => r.id === 'sql-1')).toBeDefined();
      expect(merged.find((r: any) => r.id === 'inmem-1')).toBeDefined();
    });
  });

  describe('Phase 2 SQLite supplement', () => {
    it('getAllRequests should merge with SQLite rows', () => {
      history.recordRequest(createMockContext({ id: 'inmem-all-1' }));
      const sqliteRow: any = {
        id: 'sql-all-1',
        parent_request_id: null,
        is_retry: 0,
        timestamp: Date.now() - 1000 * 60 * 60 * 24 * 5,
        server_id: 'server-x',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: 0,
        success: 1,
        duration_ms: 300,
        error_type: null,
        error_message: null,
        tokens_prompt: null,
        tokens_generated: null,
        tokens_per_second: null,
        ttft_ms: null,
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
        hour_of_day: 12,
        day_of_week: 3,
        date_str: '2026-02-27',
      };

      vi.mocked(mockStore.getRequests).mockReturnValue([sqliteRow]);
      const all = history.getAllRequests(10);
      expect(all.find((r: any) => r.id === 'sql-all-1')).toBeDefined();
      expect(all.find((r: any) => r.id === 'inmem-all-1')).toBeDefined();
    });

    it('getServerStats should pull from SQLite when hours > 24', () => {
      // No in-memory rows for this server
      const sqliteRow: any = {
        id: 'sql-stats-1',
        parent_request_id: null,
        is_retry: 0,
        timestamp: Date.now() - 1000 * 60 * 60 * 24 * 10,
        server_id: 'server-stats',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: 0,
        success: 1,
        duration_ms: 250,
        error_type: null,
        error_message: null,
        tokens_prompt: null,
        tokens_generated: null,
        tokens_per_second: null,
        ttft_ms: null,
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
        hour_of_day: 12,
        day_of_week: 3,
        date_str: '2026-02-21',
      };

      vi.mocked(mockStore.getRequests).mockReturnValue([sqliteRow]);
      const stats = history.getServerStats('server-stats', 240); // 240 hours = 10 days
      expect(stats.totalRequests).toBeGreaterThanOrEqual(1);
    });

    it('searchRequests should fetch older rows from SQLite when startTime < 24h ago', () => {
      const oldStart = Date.now() - 1000 * 60 * 60 * 24 * 4; // 4 days ago
      const sqliteRow: any = {
        id: 'sql-search-1',
        parent_request_id: null,
        is_retry: 0,
        timestamp: Date.now() - 1000 * 60 * 60 * 24 * 3,
        server_id: 'server-search',
        model: 'llama3:latest',
        endpoint: 'generate',
        streaming: 0,
        success: 0,
        duration_ms: 1200,
        error_type: 'timeout',
        error_message: 'timed out',
        tokens_prompt: null,
        tokens_generated: null,
        tokens_per_second: null,
        ttft_ms: null,
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
        hour_of_day: 12,
        day_of_week: 2,
        date_str: '2026-02-24',
      };

      vi.mocked(mockStore.getRequests).mockReturnValue([sqliteRow]);

      const results = history.searchRequests({ startTime: oldStart, success: false, limit: 10 });
      expect(results.find((r: any) => r.id === 'sql-search-1')).toBeDefined();
    });
  });

  describe('getServerStats', () => {
    it('should get server stats', () => {
      history.recordRequest(createMockContext({ serverId: 'server-1', success: true }));
      history.recordRequest(createMockContext({ serverId: 'server-1', success: true }));
      history.recordRequest(createMockContext({ serverId: 'server-1', success: false }));

      const stats = history.getServerStats('server-1', 1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.successfulRequests).toBe(2);
      expect(stats.failedRequests).toBe(1);
    });

    it('should return zero for unknown server', () => {
      const stats = history.getServerStats('unknown-server', 1);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('getServerIds', () => {
    it('should return all server IDs', () => {
      history.recordRequest(createMockContext({ serverId: 'server-1' }));
      history.recordRequest(createMockContext({ serverId: 'server-2' }));

      const serverIds = history.getServerIds();
      expect(serverIds).toContain('server-1');
      expect(serverIds).toContain('server-2');
    });

    it('should return empty for no requests', () => {
      const serverIds = history.getServerIds();
      expect(serverIds).toHaveLength(0);
    });
  });

  describe('getTotalRequestCount', () => {
    it('should return total count', () => {
      history.recordRequest(createMockContext());
      history.recordRequest(createMockContext());

      expect(history.getTotalRequestCount()).toBe(2);
    });
  });

  describe('clearServerHistory', () => {
    it('should clear server history', () => {
      history.recordRequest(createMockContext({ serverId: 'server-1' }));
      history.recordRequest(createMockContext({ serverId: 'server-2' }));

      history.clearServerHistory('server-1');

      expect(history.getServerHistory('server-1')).toHaveLength(0);
      expect(history.getServerHistory('server-2')).toHaveLength(1);
    });
  });

  describe('clearAllHistory', () => {
    it('should clear all history', () => {
      history.recordRequest(createMockContext());
      history.recordRequest(createMockContext());

      history.clearAllHistory();

      expect(history.getTotalRequestCount()).toBe(0);
    });
  });
});
