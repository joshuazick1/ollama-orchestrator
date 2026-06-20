/**
 * circuit-breakers-bystate.test.ts
 * Tests for byState aggregation in getCircuitBreakers.
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { getCircuitBreakers } from '../../src/controllers/servers-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { ProbeOrchestrator } from '../../src/probe/probe-orchestrator.js';
import { DEFAULT_PROBE_CONFIG } from '../../src/probe/types.js';

vi.mock('../../src/orchestrator/orchestrator-instance.js');
vi.mock('../../src/utils/logger.js');

describe('getCircuitBreakers byState aggregation', () => {
  let mockOrchestrator: any;
  let mockProbeOrchestrator: ProbeOrchestrator;
  let mockEndpointRegistry: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockProbeOrchestrator = new ProbeOrchestrator(DEFAULT_PROBE_CONFIG, null);

    mockEndpointRegistry = {
      getActiveEndpoints: vi.fn().mockReturnValue(['ollama_chat']),
      isEmbeddingModel: vi.fn().mockReturnValue(false),
    };

    mockOrchestrator = {
      getProbeOrchestrator: vi.fn().mockReturnValue(mockProbeOrchestrator),
      getEndpointRegistry: vi.fn().mockReturnValue(mockEndpointRegistry),
      getLBScoreForServerModel: vi.fn().mockReturnValue(null),
    };

    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);

    mockReq = {
      params: {},
      user: { id: 'test-admin' },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should include byState with all 4 keys even when array is empty', () => {
    getCircuitBreakers(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    const response = (mockRes.json as any).mock.calls[0][0];
    expect(response.byState).toEqual({ OPEN: 0, CLOSED: 0, HALF_OPEN: 0, UNKNOWN: 0 });
    expect(response.circuitBreakers).toHaveLength(0);
  });

  it('should count all CLOSED breakers correctly', () => {
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
      'HEALTHY'
    );
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv2', model: 'mistral', endpoint: 'ollama_chat' },
      'HEALTHY'
    );
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv3', model: 'gemma', endpoint: 'ollama_chat' },
      'HEALTHY'
    );

    getCircuitBreakers(mockReq as Request, mockRes as Response);

    const response = (mockRes.json as any).mock.calls[0][0];
    expect(response.byState).toEqual({ OPEN: 0, CLOSED: 3, HALF_OPEN: 0, UNKNOWN: 0 });
    expect(response.circuitBreakers).toHaveLength(3);
  });

  it('should count mixed states correctly and sum equals total', () => {
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
      'HEALTHY' // CLOSED
    );
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv2', model: 'mistral', endpoint: 'ollama_chat' },
      'UNHEALTHY' // OPEN
    );
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv3', model: 'gemma', endpoint: 'ollama_chat' },
      'RECOVERING' // HALF-OPEN
    );
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv4', model: 'phi3', endpoint: 'ollama_chat' },
      'SUSPECT' // HALF-OPEN
    );
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv5', model: 'qwen', endpoint: 'ollama_chat' },
      'HEALTHY' // CLOSED
    );

    getCircuitBreakers(mockReq as Request, mockRes as Response);

    const response = (mockRes.json as any).mock.calls[0][0];
    expect(response.byState.OPEN).toBe(1);
    expect(response.byState.CLOSED).toBe(2);
    expect(response.byState.HALF_OPEN).toBe(2);
    expect(response.byState.UNKNOWN).toBe(0);
    expect(
      response.byState.OPEN +
        response.byState.CLOSED +
        response.byState.HALF_OPEN +
        response.byState.UNKNOWN
    ).toBe(5);
    expect(response.circuitBreakers).toHaveLength(5);
  });

  it('should map HEALTHY→CLOSED, UNHEALTHY→OPEN, RECOVERING/SUSPECT→HALF-OPEN', () => {
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
      'HEALTHY'
    );
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv2', model: 'mistral', endpoint: 'ollama_chat' },
      'UNHEALTHY'
    );
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv3', model: 'gemma', endpoint: 'ollama_chat' },
      'RECOVERING'
    );
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv4', model: 'phi3', endpoint: 'ollama_chat' },
      'SUSPECT'
    );

    getCircuitBreakers(mockReq as Request, mockRes as Response);

    const response = (mockRes.json as any).mock.calls[0][0];
    expect(response.byState).toEqual({ OPEN: 1, CLOSED: 1, HALF_OPEN: 2, UNKNOWN: 0 });
    // Verify individual uiState values
    const breakers = response.circuitBreakers as Array<{ serverId: string; uiState: string }>;
    const srv1 = breakers.find(b => b.serverId === 'srv1');
    const srv2 = breakers.find(b => b.serverId === 'srv2');
    const srv3 = breakers.find(b => b.serverId === 'srv3');
    const srv4 = breakers.find(b => b.serverId === 'srv4');
    expect(srv1?.uiState).toBe('CLOSED');
    expect(srv2?.uiState).toBe('OPEN');
    expect(srv3?.uiState).toBe('HALF-OPEN');
    expect(srv4?.uiState).toBe('HALF-OPEN');
  });

  it('should include byState at top level alongside circuitBreakers', () => {
    mockProbeOrchestrator.setStateForTesting(
      { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' },
      'HEALTHY'
    );

    getCircuitBreakers(mockReq as Request, mockRes as Response);

    const response = (mockRes.json as any).mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response).toHaveProperty('circuitBreakers');
    expect(response).toHaveProperty('byState');
    expect(Array.isArray(response.circuitBreakers)).toBe(true);
    expect(typeof response.byState).toBe('object');
    expect(response.byState).toHaveProperty('OPEN');
    expect(response.byState).toHaveProperty('CLOSED');
    expect(response.byState).toHaveProperty('HALF_OPEN');
    expect(response.byState).toHaveProperty('UNKNOWN');
  });
});
