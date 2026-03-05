import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock metrics-store before importing the module under test
vi.mock('../../src/storage/metrics-store.js', () => {
  const mockStore = {
    getRequests: vi.fn(),
  } as any;
  return { getMetricsStore: () => mockStore, _mockStore: mockStore } as any;
});

describe('RequestHistory merge & dedupe', () => {
  let RequestHistory: any;
  let metricsStoreMod: any;

  beforeEach(async () => {
    // Dynamic import so vi.mock above takes effect
    const mod = await import('../../src/request-history.js');
    RequestHistory = mod.RequestHistory;
    metricsStoreMod = await import('../../src/storage/metrics-store.js');
  });

  afterEach(() => {
    vi.useRealTimers();
    // reset mock implementations
    metricsStoreMod._mockStore.getRequests.mockReset?.();
  });

  it('deduplicates SQLite rows by id and preserves newest-first ordering', async () => {
    vi.useFakeTimers();
    const now = 1620000000000;
    vi.setSystemTime(now);

    const rh = new RequestHistory({ enablePersistence: false, retentionHours: 24 });

    // create an in-memory request
    const inMemCtx: any = {
      id: 'inmem-1',
      startTime: now,
      serverId: 'srv1',
      model: 'm1',
      endpoint: '/v1/test',
      streaming: false,
      duration: 100,
      success: true,
    };
    rh.recordRequest(inMemCtx);

    // SQLite returns one duplicate (same id) and one new row
    const sqliteRows = [
      {
        id: 'inmem-1',
        timestamp: now - 10000,
        server_id: 'srv1',
        model: 'm1',
        endpoint: '/v1/test',
        streaming: 0,
        duration_ms: 120,
        success: 1,
      },
      {
        id: 'sqlite-1',
        timestamp: now - 20000,
        server_id: 'srv2',
        model: 'm2',
        endpoint: '/v1/other',
        streaming: 0,
        duration_ms: 50,
        success: 1,
      },
    ];

    metricsStoreMod._mockStore.getRequests.mockReturnValue(sqliteRows);

    const results = rh.getAllRequests(10, 0);

    // Expect two unique entries: the in-memory one and the sqlite unique one
    expect(results.map((r: any) => r.id)).toEqual(['inmem-1', 'sqlite-1']);

    vi.useRealTimers();
  });

  it('applies endpoint filter to SQLite rows when searching older windows', async () => {
    vi.useFakeTimers();
    const now = 1620003600000;
    vi.setSystemTime(now);

    const rh = new RequestHistory({ enablePersistence: false, retentionHours: 24 });

    // in-memory request (different endpoint)
    rh.recordRequest({
      id: 'a',
      startTime: now,
      serverId: 's1',
      model: 'm1',
      endpoint: '/v1/x',
      streaming: false,
      duration: 10,
      success: true,
    } as any);

    // SQLite returns rows where one matches the endpoint filter
    const sqliteRows = [
      {
        id: 'b',
        timestamp: now - 1000000,
        server_id: 's2',
        model: 'm1',
        endpoint: '/v1/target',
        streaming: 0,
        duration_ms: 30,
        success: 1,
      },
      {
        id: 'c',
        timestamp: now - 2000000,
        server_id: 's3',
        model: 'm1',
        endpoint: '/v1/x',
        streaming: 0,
        duration_ms: 40,
        success: 1,
      },
    ];

    metricsStoreMod._mockStore.getRequests.mockReturnValue(sqliteRows);

    // Search with startTime older than 24h to force SQLite merge; use endpoint filter
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const results = rh.searchRequests({
      startTime: oneDayAgo - 1000 * 60,
      endpoint: '/v1/target',
      limit: 10,
    });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('b');

    vi.useRealTimers();
  });
});
