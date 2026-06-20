/**
 * analytics-circuit-breakers.test.ts
 * Unit tests for circuit breaker analytics endpoint
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('../../src/orchestrator/orchestrator-instance.js');

import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { getCircuitBreakerAnalytics } from '../../src/controllers/analytics-controller.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);

describe('getCircuitBreakerAnalytics', () => {
  let mockOrchestrator: any;
  let mockProbeOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: Mock;
  let statusMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProbeOrchestrator = {
      getAllStates: vi.fn(),
    };

    mockOrchestrator = {
      getProbeOrchestrator: vi.fn().mockReturnValue(mockProbeOrchestrator),
    };
    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);

    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnThis();

    mockReq = {};
    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
  });

  it('should return all zeros when no states exist', () => {
    mockProbeOrchestrator.getAllStates.mockReturnValue(new Map());

    getCircuitBreakerAnalytics(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      byState: { OPEN: 0, CLOSED: 0, HALF_OPEN: 0, UNKNOWN: 0 },
      total: 0,
      topBreakers: [],
    });
  });

  it('should correctly aggregate byState counts from probe states', () => {
    const states = new Map([
      [
        'srv1:llama3:ollama_chat',
        { state: 'HEALTHY', consecutiveFailures: 0, lastTransition: 1000 },
      ],
      [
        'srv2:llama3:ollama_chat',
        { state: 'HEALTHY', consecutiveFailures: 2, lastTransition: 2000 },
      ],
      [
        'srv3:llama3:ollama_chat',
        { state: 'UNHEALTHY', consecutiveFailures: 10, lastTransition: 3000 },
      ],
      [
        'srv4:llama3:ollama_chat',
        { state: 'SUSPECT', consecutiveFailures: 3, lastTransition: 4000 },
      ],
      [
        'srv5:llama3:ollama_chat',
        { state: 'RECOVERING', consecutiveFailures: 5, lastTransition: 5000 },
      ],
    ]);
    mockProbeOrchestrator.getAllStates.mockReturnValue(states);

    getCircuitBreakerAnalytics(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(200);
    const result = jsonMock.mock.calls[0][0];
    expect(result.total).toBe(5);
    expect(result.byState.OPEN).toBe(1);
    expect(result.byState.CLOSED).toBe(2);
    expect(result.byState.HALF_OPEN).toBe(2);
    expect(
      result.byState.OPEN +
        result.byState.CLOSED +
        result.byState.HALF_OPEN +
        result.byState.UNKNOWN
    ).toBe(result.total);
  });

  it('should return top breakers sorted by failureCount descending', () => {
    const states = new Map([
      [
        'srv1:model-a:ollama_chat',
        { state: 'HEALTHY', consecutiveFailures: 5, lastTransition: 100 },
      ],
      [
        'srv2:model-b:ollama_chat',
        { state: 'UNHEALTHY', consecutiveFailures: 100, lastTransition: 200 },
      ],
      [
        'srv3:model-c:ollama_chat',
        { state: 'SUSPECT', consecutiveFailures: 50, lastTransition: 300 },
      ],
      [
        'srv4:model-d:ollama_chat',
        { state: 'HEALTHY', consecutiveFailures: 10, lastTransition: 400 },
      ],
      [
        'srv5:model-e:ollama_chat',
        { state: 'RECOVERING', consecutiveFailures: 25, lastTransition: 500 },
      ],
    ]);
    mockProbeOrchestrator.getAllStates.mockReturnValue(states);

    getCircuitBreakerAnalytics(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(200);
    const result = jsonMock.mock.calls[0][0];
    expect(result.topBreakers).toHaveLength(5);
    expect(result.topBreakers[0].serverId).toBe('srv2');
    expect(result.topBreakers[0].failureCount).toBe(100);
    expect(result.topBreakers[1].failureCount).toBe(50);
    expect(result.topBreakers[2].failureCount).toBe(25);
    expect(result.topBreakers[3].failureCount).toBe(10);
    expect(result.topBreakers[4].failureCount).toBe(5);
    for (let i = 0; i < result.topBreakers.length - 1; i++) {
      expect(result.topBreakers[i].failureCount).toBeGreaterThanOrEqual(
        result.topBreakers[i + 1].failureCount
      );
    }
  });

  it('should limit topBreakers to 10 items', () => {
    const states = new Map<string, any>();
    for (let i = 0; i < 20; i++) {
      states.set(`srv${i}:model${i}:ollama_chat`, {
        state: 'UNHEALTHY',
        consecutiveFailures: 100 - i,
        lastTransition: i * 100,
      });
    }
    mockProbeOrchestrator.getAllStates.mockReturnValue(states);

    getCircuitBreakerAnalytics(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(200);
    const result = jsonMock.mock.calls[0][0];
    expect(result.topBreakers).toHaveLength(10);
    expect(result.total).toBe(20);
  });

  it('should include serverId, model, state, failureCount, and lastFailure in each breaker', () => {
    const states = new Map([
      [
        'srv1:my-model:ollama_chat',
        { state: 'UNHEALTHY', consecutiveFailures: 42, lastTransition: 1234567890 },
      ],
    ]);
    mockProbeOrchestrator.getAllStates.mockReturnValue(states);

    getCircuitBreakerAnalytics(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(200);
    const result = jsonMock.mock.calls[0][0];
    expect(result.topBreakers[0]).toEqual({
      serverId: 'srv1',
      model: 'my-model',
      state: 'OPEN',
      failureCount: 42,
      lastFailure: 1234567890,
    });
  });

  it('should handle probe state to UI state mapping correctly', () => {
    const states = new Map([
      ['srv1:llama3:ollama_chat', { state: 'HEALTHY', consecutiveFailures: 0, lastTransition: 0 }],
      ['srv2:llama3:ollama_chat', { state: 'SUSPECT', consecutiveFailures: 0, lastTransition: 0 }],
      [
        'srv3:llama3:ollama_chat',
        { state: 'UNHEALTHY', consecutiveFailures: 0, lastTransition: 0 },
      ],
      [
        'srv4:llama3:ollama_chat',
        { state: 'RECOVERING', consecutiveFailures: 0, lastTransition: 0 },
      ],
    ]);
    mockProbeOrchestrator.getAllStates.mockReturnValue(states);

    getCircuitBreakerAnalytics(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(200);
    const result = jsonMock.mock.calls[0][0];
    expect(result.byState.CLOSED).toBe(1);
    expect(result.byState.HALF_OPEN).toBe(2);
    expect(result.byState.OPEN).toBe(1);
  });

  it('should return 500 on error', () => {
    mockProbeOrchestrator.getAllStates.mockImplementation(() => {
      throw new Error('Probe orchestrator error');
    });

    getCircuitBreakerAnalytics(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Failed to get circuit breaker analytics',
      })
    );
  });
});
