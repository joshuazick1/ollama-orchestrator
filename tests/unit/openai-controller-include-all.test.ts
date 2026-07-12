/**
 * openai-controller-include-all.test.ts
 * Verifies the `?include_all=true` query parameter for /v1/models
 *
 * Bug context: The default /v1/models response applies a Pass-2 circuit-breaker
 * filter (hasAvailableServer) that hides models whose servers are in cooldown or
 * have open circuit breakers. Operators need a way to see the FULL fleet topology
 * for diagnostic purposes without breaking client compat.
 *
 * Fix: `getAggregatedOpenAIModels({includeAll: true})` skips the Pass-2 filter.
 * The Pass-1 `filterValidModels` security filter is NEVER bypassed.
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { handleListModels } from '../../src/controllers/openai-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';

vi.mock('../../src/orchestrator/orchestrator-instance.js');

describe('OpenAI Controller — include_all query param', () => {
  let mockOrchestrator: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrchestrator = {
      getAggregatedOpenAIModels: vi.fn(),
    };
    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);
    mockReq = { body: {}, params: {}, query: {}, headers: {} };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      writableEnded: false,
      headersSent: false,
    };
  });

  it('passes includeAll:false when include_all query param is absent (default behavior unchanged)', async () => {
    const mockModels = { object: 'list', data: [{ id: 'm1', object: 'model', created: 0, owned_by: 'a' }] };
    mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue(mockModels);
    mockReq.query = {};

    await handleListModels(mockReq as Request, mockRes as Response);

    expect(mockOrchestrator.getAggregatedOpenAIModels).toHaveBeenCalledWith({ includeAll: false });
    expect(mockRes.json).toHaveBeenCalledWith(mockModels);
  });

  it('passes includeAll:false when include_all="false"', async () => {
    mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue({ object: 'list', data: [] });
    mockReq.query = { include_all: 'false' };

    await handleListModels(mockReq as Request, mockRes as Response);

    expect(mockOrchestrator.getAggregatedOpenAIModels).toHaveBeenCalledWith({ includeAll: false });
  });

  it('passes includeAll:true when include_all="true"', async () => {
    // Simulate that include_all=true returns MORE models (Pass-2 filter skipped)
    const filteredModels = { object: 'list', data: [{ id: 'm1', object: 'model', created: 0, owned_by: 'a' }] };
    const includeAllModels = {
      object: 'list',
      data: [
        { id: 'm1', object: 'model', created: 0, owned_by: 'a' },
        { id: 'm2', object: 'model', created: 0, owned_by: 'b' },
        { id: 'm3', object: 'model', created: 0, owned_by: 'c' },
      ],
    };
    // First call returns filtered, second call returns includeAll
    mockOrchestrator.getAggregatedOpenAIModels
      .mockReturnValueOnce(filteredModels)
      .mockReturnValueOnce(includeAllModels);
    mockReq.query = {};

    await handleListModels(mockReq as Request, mockRes as Response);
    expect(mockRes.json).toHaveBeenLastCalledWith(filteredModels);
    expect(mockOrchestrator.getAggregatedOpenAIModels).toHaveBeenLastCalledWith({ includeAll: false });

    mockReq.query = { include_all: 'true' };
    await handleListModels(mockReq as Request, mockRes as Response);
    expect(mockRes.json).toHaveBeenLastCalledWith(includeAllModels);
    expect(mockOrchestrator.getAggregatedOpenAIModels).toHaveBeenLastCalledWith({ includeAll: true });

    // includeAll returned more models than default
    expect(includeAllModels.data.length).toBeGreaterThan(filteredModels.data.length);
  });

  it('treats include_all="anything-else" as false (strict string match)', async () => {
    mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue({ object: 'list', data: [] });

    mockReq.query = { include_all: 'TRUE' };
    await handleListModels(mockReq as Request, mockRes as Response);
    expect(mockOrchestrator.getAggregatedOpenAIModels).toHaveBeenLastCalledWith({ includeAll: false });

    mockReq.query = { include_all: '1' };
    await handleListModels(mockReq as Request, mockRes as Response);
    expect(mockOrchestrator.getAggregatedOpenAIModels).toHaveBeenLastCalledWith({ includeAll: false });
  });
});