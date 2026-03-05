import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock metrics-store before importing module under test
vi.mock('../../src/storage/metrics-store.js', () => {
  const mockStore = {
    getDecisions: vi.fn(),
    recordDecision: vi.fn(),
  } as any;
  return { getMetricsStore: () => mockStore, _mockStore: mockStore } as any;
});

describe('DecisionHistory mergeEvents & dedupe', () => {
  let DecisionHistory: any;
  let metricsStoreMod: any;

  beforeEach(async () => {
    const mod = await import('../../src/decision-history.js');
    DecisionHistory = mod.DecisionHistory;
    metricsStoreMod = await import('../../src/storage/metrics-store.js');
  });

  afterEach(() => {
    vi.useRealTimers();
    metricsStoreMod._mockStore.getDecisions.mockReset?.();
    metricsStoreMod._mockStore.recordDecision.mockReset?.();
  });

  it('deduplicates SQLite events by timestamp+selectedServerId+model and keeps newest-first ordering', async () => {
    vi.useFakeTimers();
    const now = 1650000000000;
    vi.setSystemTime(now);

    const dh = new DecisionHistory({ persistenceEnabled: false, maxEvents: 1000 });

    // record an in-memory decision (will use Date.now())
    const fakeServer = { id: 'srv-A' } as any;
    dh.recordDecision(
      'model-1',
      fakeServer,
      'algo-inmem',
      [
        {
          server: fakeServer,
          totalScore: 10,
          breakdown: { latencyScore: 10, successRateScore: 10, loadScore: 10, capacityScore: 10 },
          metrics: { percentiles: { p95: 100 }, successRate: 0.99, inFlight: 0, throughput: 1 },
        },
      ],
      'reason'
    );

    // prepare sqlite rows: one duplicate (same timestamp/model/selected_server) and one unique
    const sqliteRows = [
      {
        timestamp: now,
        model: 'model-1',
        selected_server: 'srv-A',
        algorithm: 'algo-sqlite-dup',
        selection_reason: 'r',
        total_score: 9,
        latency_score: 9,
        success_rate_score: 9,
        load_score: 9,
        capacity_score: 9,
        p95_latency: 120,
        success_rate: 0.95,
        in_flight: 1,
        throughput: 2,
      },
      {
        timestamp: now - 60000,
        model: 'model-2',
        selected_server: 'srv-B',
        algorithm: 'algo-sqlite-uniq',
        selection_reason: 'r',
        total_score: 5,
        latency_score: 5,
        success_rate_score: 5,
        load_score: 5,
        capacity_score: 5,
      },
    ];

    metricsStoreMod._mockStore.getDecisions.mockReturnValue(sqliteRows);

    // Request more than in-memory count to force SQLite supplementation
    const events = dh.getRecentEvents(10);

    // Build keys to assert dedupe behavior
    const key = (e: any) => `${e.timestamp}:${e.selectedServerId}:${e.model}`;
    const keys = events.map(key);

    // Expect two unique keys (in-memory duplicate removed in favor of in-memory record)
    expect(keys).toContain(`${now}:srv-A:model-1`);
    expect(keys).toContain(`${now - 60000}:srv-B:model-2`);
    expect(keys.length).toBe(2);

    // Ensure ordering newest-first
    expect(events[0].timestamp).toBe(now);
    expect(events[1].timestamp).toBe(now - 60000);

    // Ensure the in-memory event (algorithm) is preserved for the duplicate key
    const first = events.find((e: any) => e.selectedServerId === 'srv-A' && e.model === 'model-1');
    expect(first.algorithm).toBe('algo-inmem');

    vi.useRealTimers();
  });

  it('keeps both events if timestamps differ even slightly (dedupe is exact on timestamp)', async () => {
    vi.useFakeTimers();
    const now = 1650001000000;
    vi.setSystemTime(now);

    const dh = new DecisionHistory({ persistenceEnabled: false });

    const srv = { id: 'srv-X' } as any;
    // in-memory event at now
    dh.recordDecision(
      'mX',
      srv,
      'algo1',
      [
        {
          server: srv,
          totalScore: 1,
          breakdown: { latencyScore: 1, successRateScore: 1, loadScore: 1, capacityScore: 1 },
        },
      ],
      'r'
    );

    // sqlite row with a timestamp off by 1 ms -> should be considered distinct
    const sqliteRows = [
      {
        timestamp: now - 1,
        model: 'mX',
        selected_server: 'srv-X',
        algorithm: 'algo-sqlite',
        selection_reason: 'r',
        total_score: 2,
        latency_score: 2,
        success_rate_score: 2,
        load_score: 2,
        capacity_score: 2,
      },
    ];

    metricsStoreMod._mockStore.getDecisions.mockReturnValue(sqliteRows);

    const events = dh.getRecentEvents(10);
    // Expect both events because dedupe checks exact timestamp
    expect(
      events.filter((e: any) => e.model === 'mX' && e.selectedServerId === 'srv-X').length
    ).toBe(2);

    vi.useRealTimers();
  });
});
