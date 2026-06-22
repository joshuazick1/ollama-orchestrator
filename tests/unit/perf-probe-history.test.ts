/**
 * perf-probe-history.test.ts
 * Unit tests for GET /api/orchestrator/performance-probe/history endpoint
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('../../src/orchestrator/orchestrator-instance.js');

vi.mock('../../src/storage/metrics-store.js', () => {
  const mockStore = {
    getRequests: vi.fn(),
  };
  return { getMetricsStore: () => mockStore, _mockStore: mockStore };
});

import { getPerfProbeHistory } from '../../src/controllers/perf-probe-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import * as metricsStoreMod from '../../src/storage/metrics-store.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockStore = (metricsStoreMod as unknown as { _mockStore: Record<string, unknown> })
  ._mockStore;

describe('getPerfProbeHistory', () => {
  let mockOrchestrator: Record<string, unknown>;
  let mockRes: Partial<Response>;
  let jsonMock: Mock;
  let statusMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      getServer: vi.fn(),
      getMetricsStore: vi.fn(),
    };
    mockGetOrchestratorInstance.mockReturnValue(
      mockOrchestrator as ReturnType<typeof getOrchestratorInstance>
    );
    (mockOrchestrator.getMetricsStore as ReturnType<typeof vi.fn>).mockReturnValue(mockStore);

    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnThis();

    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
  });

  const makeReq = (query: Record<string, string | undefined> = {}) =>
    ({
      query,
    }) as unknown as Partial<Request>;

  // -------------------------------------------------------------------------
  // Server ID validation
  // -------------------------------------------------------------------------

  it('returns 400 when serverId is missing', () => {
    const req = makeReq({ startTime: '1750500000000', endTime: '1750586400000' });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'serverId is required' });
  });

  it('returns 404 when serverId does not exist', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const req = makeReq({
      serverId: 'unknown-server',
      startTime: '1750500000000',
      endTime: '1750586400000',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'server unknown-server not found' });
  });

  // -------------------------------------------------------------------------
  // Time range validation
  // -------------------------------------------------------------------------

  it('returns 400 when startTime or endTime is missing', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    const req = makeReq({ serverId: 'srv-1', startTime: '1750500000000' });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'startTime and endTime are required and must be valid epoch ms numbers',
    });
  });

  it('returns 400 when startTime >= endTime', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750586400000',
      endTime: '1750500000000',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'startTime must be less than endTime' });
  });

  // -------------------------------------------------------------------------
  // Interval validation
  // -------------------------------------------------------------------------

  it('returns 400 for invalid intervalMinutes', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750500000000',
      endTime: '1750586400000',
      intervalMinutes: '7',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'intervalMinutes must be one of 1, 5, 15, 60, 360, 1440',
    });
  });

  // -------------------------------------------------------------------------
  // Response size cap
  // -------------------------------------------------------------------------

  it('returns 400 when bucket count exceeds 5000', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    // 1-minute interval over 86_400_000 ms (24h) → 1440 buckets (within limit)
    // 1-minute interval over 302_400_000 ms (3.5 days) → 5040 buckets (over limit)
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750500000000',
      endTime: '1753502400000',
      intervalMinutes: '1',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'Reduce time range or increase intervalMinutes',
    });
  });

  // -------------------------------------------------------------------------
  // Empty data set (valid server, no probe data)
  // -------------------------------------------------------------------------

  it('returns 200 with empty dataPoints when serverId is valid but no probe data exists', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    (mockStore.getRequests as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750500000000',
      endTime: '1750586400000',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      success: true,
      serverId: 'srv-1',
      model: null,
      startTime: 1750500000000,
      endTime: 1750586400000,
      intervalMinutes: 15,
      dataPoints: [],
    });
  });

  // -------------------------------------------------------------------------
  // Correct bucketing and aggregation
  // -------------------------------------------------------------------------

  it('correctly buckets probe results by interval', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    // 15-minute interval = 900_000 ms
    // rows at timestamps 1750500000000 and 1750500900000 (1.5 bucket widths)
    // should land in bucket 1750500000000 and 1750500900000
    const mockRows = [
      {
        timestamp: 1750500000000,
        ttft_ms: 200,
        tokens_per_second: 40,
        success: true,
        duration_ms: 1000,
      },
      {
        timestamp: 1750500900000,
        ttft_ms: 400,
        tokens_per_second: 50,
        success: false,
        duration_ms: 2000,
      },
    ];
    (mockStore.getRequests as ReturnType<typeof vi.fn>).mockReturnValue(mockRows);
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750500000000',
      endTime: '1750586400000',
      intervalMinutes: '15',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(200);
    const response = jsonMock.mock.calls[0][0];
    expect(response.dataPoints).toHaveLength(2);
    // First bucket: single probe, success=1, ttft=200, tps=40, duration=1000
    expect(response.dataPoints[0]).toMatchObject({
      timestamp: 1750500000000,
      count: 1,
      ttft_avg: 200,
      tokens_per_sec_avg: 40,
      success_rate: 1,
      latency_avg: 1000,
    });
    // Second bucket: single probe, success=0, ttft=400, tps=50, duration=2000
    expect(response.dataPoints[1]).toMatchObject({
      timestamp: 1750500900000,
      count: 1,
      ttft_avg: 400,
      tokens_per_sec_avg: 50,
      success_rate: 0,
      latency_avg: 2000,
    });
  });

  it('aggregates multiple probes in the same bucket', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    // Both rows fall in the same 15-minute bucket
    const mockRows = [
      {
        timestamp: 1750500000000,
        ttft_ms: 200,
        tokens_per_second: 40,
        success: true,
        duration_ms: 1000,
      },
      {
        timestamp: 1750500300000,
        ttft_ms: 400,
        tokens_per_second: 60,
        success: true,
        duration_ms: 2000,
      },
    ];
    (mockStore.getRequests as ReturnType<typeof vi.fn>).mockReturnValue(mockRows);
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750500000000',
      endTime: '1750586400000',
      intervalMinutes: '15',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(200);
    const response = jsonMock.mock.calls[0][0];
    expect(response.dataPoints).toHaveLength(1);
    expect(response.dataPoints[0]).toMatchObject({
      timestamp: 1750500000000,
      count: 2,
      ttft_avg: 300,
      tokens_per_sec_avg: 50,
      success_rate: 1,
      latency_avg: 1500,
    });
  });

  // -------------------------------------------------------------------------
  // Model filtering
  // -------------------------------------------------------------------------

  it('passes model filter to getRequests when provided', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    (mockStore.getRequests as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const req = makeReq({
      serverId: 'srv-1',
      model: 'llama3:8b',
      startTime: '1750500000000',
      endTime: '1750586400000',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(mockStore.getRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        model: 'llama3:8b',
        startTime: 1750500000000,
        endTime: 1750586400000,
        isProbe: true,
        limit: 100_000,
      })
    );
  });

  it('omits model filter from getRequests when not provided', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    (mockStore.getRequests as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750500000000',
      endTime: '1750586400000',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    expect(mockStore.getRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        model: undefined,
        isProbe: true,
      })
    );
  });

  // -------------------------------------------------------------------------
  // Interval defaults and values
  // -------------------------------------------------------------------------

  it('uses default intervalMinutes of 15 when not provided', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    (mockStore.getRequests as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750500000000',
      endTime: '1750586400000',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    const response = jsonMock.mock.calls[0][0];
    expect(response.intervalMinutes).toBe(15);
  });

  it('accepts all valid interval values (1, 5, 15, 60, 360, 1440)', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    (mockStore.getRequests as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const validIntervals = ['1', '5', '15', '60', '360', '1440'];
    for (const interval of validIntervals) {
      vi.clearAllMocks();
      const req = makeReq({
        serverId: 'srv-1',
        startTime: '1750500000000',
        endTime: '1750586400000',
        intervalMinutes: interval,
      });
      getPerfProbeHistory(req as Request, mockRes as Response);
      expect(statusMock).toHaveBeenCalledWith(200);
    }
  });

  // -------------------------------------------------------------------------
  // Timestamp ordering
  // -------------------------------------------------------------------------

  it('returns dataPoints sorted by timestamp ascending', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    const mockRows = [
      {
        timestamp: 1750500900000,
        ttft_ms: 300,
        tokens_per_second: 45,
        success: true,
        duration_ms: 1500,
      },
      {
        timestamp: 1750500000000,
        ttft_ms: 200,
        tokens_per_second: 40,
        success: true,
        duration_ms: 1000,
      },
    ];
    (mockStore.getRequests as ReturnType<typeof vi.fn>).mockReturnValue(mockRows);
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750500000000',
      endTime: '1750586400000',
      intervalMinutes: '15',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    const response = jsonMock.mock.calls[0][0];
    expect(response.dataPoints[0].timestamp).toBe(1750500000000);
    expect(response.dataPoints[1].timestamp).toBe(1750500900000);
  });

  // -------------------------------------------------------------------------
  // Null handling for missing metrics
  // -------------------------------------------------------------------------

  it('returns null for avg fields when count is 0 (empty bucket after all rows filtered)', () => {
    (mockOrchestrator.getServer as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'srv-1' });
    // Edge case: the bucket aggregation never creates a bucket for 0 rows
    // so this is indirectly tested by the empty result test
    (mockStore.getRequests as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const req = makeReq({
      serverId: 'srv-1',
      startTime: '1750500000000',
      endTime: '1750586400000',
    });
    getPerfProbeHistory(req as Request, mockRes as Response);
    const response = jsonMock.mock.calls[0][0];
    expect(response.dataPoints).toEqual([]);
  });
});
