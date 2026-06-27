/**
 * metrics-controller-recovery.test.ts
 * Tests for recovery metrics endpoints using WAL event queries
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../../src/orchestrator/orchestrator-instance.js');

const mockGetOperationalStore = vi.fn();

vi.mock('../../src/storage/operational-store.js', async () => {
  const actual = await vi.importActual('../../src/storage/operational-store.js');
  return {
    ...(actual as any),
    getOperationalStore: () => mockGetOperationalStore(),
  };
});

import {
  getRecoveryTestMetrics,
  getBreakerRecoveryMetrics,
} from '../../src/controllers/metrics-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { WALStore } from '../../src/probe/wal-store.js';
import { OperationalStore } from '../../src/storage/operational-store.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);

describe('metricsController recovery metrics', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let store: OperationalStore;
  let wal: WALStore;

  beforeEach(() => {
    vi.clearAllMocks();

    store = new OperationalStore(':memory:');
    wal = new WALStore(store);
    mockGetOperationalStore.mockReturnValue(store);

    mockOrchestrator = {
      exportMetrics: vi.fn(),
      getDetailedMetrics: vi.fn(),
    };
    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);

    mockReq = { params: {} };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  afterEach(() => {
    store.close();
  });

  describe('getRecoveryTestMetrics', () => {
    it('returns zero counts when no recovery events exist', async () => {
      await getRecoveryTestMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.aggregate.totalRecoveryAttempts).toBe(0);
      expect(response.aggregate.totalRecoverySuccesses).toBe(0);
      expect(response.aggregate.totalRecoveryFailures).toBe(0);
      expect(response.aggregate.successRate).toBe(0);
      expect(response.recoveryProbabilities).toEqual({});
    });

    it('counts recovery attempts, successes, and failures from WAL events', async () => {
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'HEALTHY',
        toState: 'SUSPECT',
        reason: '1 failure',
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'SUSPECT',
        toState: 'UNHEALTHY',
        reason: '3 failures',
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'UNHEALTHY',
        toState: 'RECOVERING',
        reason: 'recovery started',
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'RECOVERING',
        toState: 'HEALTHY',
        reason: 'recovery succeeded',
        metadata: null,
      });

      await getRecoveryTestMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.aggregate.totalRecoveryAttempts).toBe(1);
      expect(response.aggregate.totalRecoverySuccesses).toBe(1);
      expect(response.aggregate.totalRecoveryFailures).toBe(0);
      expect(response.aggregate.successRate).toBe(1);
      expect(response.recoveryProbabilities['srv1:llama3']).toBe(1);
    });

    it('calculates success rate correctly with multiple recoveries', async () => {
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'UNHEALTHY',
        toState: 'RECOVERING',
        reason: null,
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'RECOVERING',
        toState: 'UNHEALTHY',
        reason: null,
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'UNHEALTHY',
        toState: 'RECOVERING',
        reason: null,
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'RECOVERING',
        toState: 'HEALTHY',
        reason: null,
        metadata: null,
      });

      await getRecoveryTestMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.aggregate.totalRecoveryAttempts).toBe(2);
      expect(response.aggregate.totalRecoverySuccesses).toBe(1);
      expect(response.aggregate.totalRecoveryFailures).toBe(1);
      expect(response.aggregate.successRate).toBe(0.5);
    });

    it('handles errors gracefully', async () => {
      mockGetOperationalStore.mockReturnValueOnce(() => {
        throw new Error('Store error');
      });

      await getRecoveryTestMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.error).toBe('Failed to get recovery test metrics');
      expect(response.details).toBeTruthy();
    });
  });

  describe('getBreakerRecoveryMetrics', () => {
    it('returns empty recovery events when no events for breaker', async () => {
      mockReq = { params: { breakerName: 'srv1:llama3' } };
      await getBreakerRecoveryMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.breakerName).toBe('srv1:llama3');
      expect(response.recoveryEvents).toEqual([]);
      expect(response.recoveryProbability).toBe(-1);
    });

    it('returns chronological recovery events for a specific breaker', async () => {
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'UNHEALTHY',
        toState: 'RECOVERING',
        reason: 'recovery started',
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'RECOVERING',
        toState: 'HEALTHY',
        reason: 'recovery succeeded',
        metadata: null,
      });

      mockReq = { params: { breakerName: 'srv1:llama3' } };
      await getBreakerRecoveryMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.recoveryEvents).toHaveLength(2);
      expect(response.recoveryEvents[0].fromState).toBe('UNHEALTHY');
      expect(response.recoveryEvents[0].toState).toBe('RECOVERING');
      expect(response.recoveryEvents[1].fromState).toBe('RECOVERING');
      expect(response.recoveryEvents[1].toState).toBe('HEALTHY');
      expect(response.recoveryProbability).toBe(1);
      expect(response.totalRecoveryAttempts).toBe(1);
      expect(response.totalRecoverySuccesses).toBe(1);
    });

    it('calculates probability correctly for failed recovery', async () => {
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'UNHEALTHY',
        toState: 'RECOVERING',
        reason: null,
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'RECOVERING',
        toState: 'UNHEALTHY',
        reason: null,
        metadata: null,
      });

      mockReq = { params: { breakerName: 'srv1:llama3' } };
      await getBreakerRecoveryMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.recoveryEvents).toHaveLength(2);
      expect(response.recoveryProbability).toBe(0);
      expect(response.totalRecoveryAttempts).toBe(1);
      expect(response.totalRecoverySuccesses).toBe(0);
    });

    it('ignores non-recovery events (other state transitions)', async () => {
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'HEALTHY',
        toState: 'SUSPECT',
        reason: null,
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'SUSPECT',
        toState: 'UNHEALTHY',
        reason: null,
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'UNHEALTHY',
        toState: 'RECOVERING',
        reason: null,
        metadata: null,
      });

      mockReq = { params: { breakerName: 'srv1:llama3' } };
      await getBreakerRecoveryMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.recoveryEvents).toHaveLength(1);
      expect(response.recoveryEvents[0].toState).toBe('RECOVERING');
    });

    it('only returns events for the specified breaker', async () => {
      await wal.append({
        tupleKey: 'srv1:llama3',
        eventType: 'TRANSITION',
        fromState: 'UNHEALTHY',
        toState: 'RECOVERING',
        reason: null,
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv2:llama3',
        eventType: 'TRANSITION',
        fromState: 'UNHEALTHY',
        toState: 'RECOVERING',
        reason: null,
        metadata: null,
      });
      await wal.append({
        tupleKey: 'srv2:llama3',
        eventType: 'TRANSITION',
        fromState: 'RECOVERING',
        toState: 'HEALTHY',
        reason: null,
        metadata: null,
      });

      mockReq = { params: { breakerName: 'srv1:llama3' } };
      await getBreakerRecoveryMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.recoveryEvents).toHaveLength(1);
      expect(response.breakerName).toBe('srv1:llama3');
    });

    it('handles decodeURIComponent for breaker names with special chars', async () => {
      await wal.append({
        tupleKey: 'srv1:llama3.1:8b',
        eventType: 'TRANSITION',
        fromState: 'UNHEALTHY',
        toState: 'RECOVERING',
        reason: null,
        metadata: null,
      });

      mockReq = { params: { breakerName: 'srv1:llama3.1%3A8b' } };
      await getBreakerRecoveryMetrics(mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const response = mockRes.json.mock.calls[0][0];
      expect(response.breakerName).toBe('srv1:llama3.1:8b');
    });
  });
});
