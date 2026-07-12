/**
 * availability-controller.test.ts
 * Verifies GET /v1/models/availability endpoint behavior.
 *
 * The endpoint exposes per-server availability + alternatives so chronicle's
 * LLMClient can make informed fallback decisions without burning retry budget.
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getModelAvailability } from '../../src/controllers/availability-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { findAlternatives } from '../../src/utils/alternative-model-resolver.js';

vi.mock('../../src/orchestrator/orchestrator-instance.js');
vi.mock('../../src/utils/alternative-model-resolver.js');

describe('availability-controller', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrchestrator = {
      getModelMap: vi.fn(),
      getProbeOrchestrator: vi.fn(),
      getServers: vi.fn(),
      getBanManager: vi.fn(),
      getMetricsAggregator: vi.fn(),
    };
    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);

    mockReq = { body: {}, params: {}, query: {}, headers: {} };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  function setupHealthyMock(modelName: string, serverIds: string[]) {
    mockOrchestrator.getModelMap.mockReturnValue({ [modelName]: serverIds });
    mockOrchestrator.getProbeOrchestrator.mockReturnValue({
      getAllStates: () => new Map(serverIds.map(id => [`${id}|${modelName}|ollama_chat`, {
        state: 'HEALTHY', lastProbeAt: Date.now(), latencyMs: 100,
      }])),
    });
    mockOrchestrator.getServers.mockReturnValue(serverIds.map(id => ({ id })));
    mockOrchestrator.getBanManager.mockReturnValue({
      getCooldownStatus: () => ({ remainingMs: 0 }),
    });
    mockOrchestrator.getMetricsAggregator.mockReturnValue({
      getMetrics: () => ({ percentiles: { p95: 245 }, successRate: 0.998 }),
    });
  }

  it('returns fully healthy model with available: true', () => {
    const MODEL = 'qwen2.5:7b-instruct-q4_K_M';
    setupHealthyMock(MODEL, ['srv-1', 'srv-2']);
    mockReq.query = { model: MODEL };

    getModelAvailability(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        model: MODEL,
        available: true,
        servers: expect.arrayContaining([
          expect.objectContaining({ id: 'srv-1', isAvailable: true }),
          expect.objectContaining({ id: 'srv-2', isAvailable: true }),
        ]),
      })
    );
    expect(mockRes.status).not.toHaveBeenCalledWith(404);
  });

  it('returns 404 when model is not registered', () => {
    mockOrchestrator.getModelMap.mockReturnValue({});
    mockOrchestrator.getProbeOrchestrator.mockReturnValue({ getAllStates: () => new Map() });
    mockOrchestrator.getServers.mockReturnValue([]);
    mockOrchestrator.getBanManager.mockReturnValue({ getCooldownStatus: () => ({ remainingMs: 0 }) });
    mockOrchestrator.getMetricsAggregator.mockReturnValue({ getMetrics: () => null });
    mockReq.query = { model: 'unknown-model' };

    getModelAvailability(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('not registered') }) })
    );
  });

  it('returns 400 when model query param is missing', () => {
    mockReq.query = {};

    getModelAvailability(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: 'Model name is required' }) })
    );
  });

  it('returns mixed states with cooldownRemainingMs when partially in cooldown', () => {
    const MODEL = 'qwen2.5:7b-instruct-q4_K_M';
    mockOrchestrator.getModelMap.mockReturnValue({ [MODEL]: ['srv-1', 'srv-2'] });
    mockOrchestrator.getProbeOrchestrator.mockReturnValue({
      getAllStates: () => new Map([
        [`srv-1|${MODEL}|ollama_chat`, { state: 'HEALTHY', lastProbeAt: Date.now(), latencyMs: 100 }],
      ]),
    });
    mockOrchestrator.getServers.mockReturnValue([{ id: 'srv-1' }, { id: 'srv-2' }]);
    mockOrchestrator.getBanManager.mockReturnValue({
      getCooldownStatus: (serverId: string) =>
        serverId === 'srv-2' ? { remainingMs: 120000 } : { remainingMs: 0 },
    });
    mockOrchestrator.getMetricsAggregator.mockReturnValue({ getMetrics: () => null });
    mockReq.query = { model: MODEL };

    getModelAvailability(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        model: MODEL,
        available: true, // srv-1 is healthy
        servers: expect.arrayContaining([
          expect.objectContaining({ id: 'srv-2', cooldownRemainingMs: 120000, isAvailable: false }),
          expect.objectContaining({ id: 'srv-1', isAvailable: true }),
        ]),
      })
    );
  });

  it('returns recommended alternative when all servers are unavailable', () => {
    const MODEL = 'qwen2.5:7b-instruct-q4_K_M';
    const ALT_MODEL = 'qwen3:8b-q4_K_M';
    mockOrchestrator.getModelMap.mockReturnValue({ [MODEL]: ['srv-1'], [ALT_MODEL]: ['srv-2'] });
    mockOrchestrator.getProbeOrchestrator.mockReturnValue({
      getAllStates: () => new Map(),
    });
    mockOrchestrator.getServers.mockReturnValue([{ id: 'srv-1' }, { id: 'srv-2' }]);
    mockOrchestrator.getBanManager.mockReturnValue({
      getCooldownStatus: (serverId: string, m: string) =>
        m === MODEL ? { remainingMs: 60000 } : { remainingMs: 0 },
    });
    mockOrchestrator.getMetricsAggregator.mockReturnValue({ getMetrics: () => null });

    vi.mocked(findAlternatives).mockReturnValue([
      { model: ALT_MODEL, similarity: 'same-family', available: true },
    ]);

    mockReq.query = { model: MODEL };

    getModelAvailability(mockReq as Request, mockRes as Response);

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        model: MODEL,
        available: false,
        recommended: expect.objectContaining({ model: ALT_MODEL }),
      })
    );
  });
});
