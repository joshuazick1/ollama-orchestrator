import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/orchestrator/orchestrator-instance.js');
vi.mock('../../src/orchestrator/test-server-capabilities.js');

import { testExistingServer } from '../../src/controllers/servers-controller.js';
import { getOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import { testServerCapabilities } from '../../src/orchestrator/test-server-capabilities.js';

describe('testExistingServer controller', () => {
  let mockOrchestrator: ReturnType<typeof vi.fn>;
  let mockTestServerCapabilities: ReturnType<typeof vi.fn>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockOrchestrator = {
      getServer: vi.fn(),
    };

    mockTestServerCapabilities = vi.fn();

    (getOrchestratorInstance as any).mockReturnValue(mockOrchestrator);
    (testServerCapabilities as any).mockImplementation(mockTestServerCapabilities);

    mockReq = {
      params: { id: 'server-1' },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  it('should return 404 when server not found', async () => {
    mockOrchestrator.getServer.mockReturnValue(undefined);

    await testExistingServer(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining('server-1'),
    });
  });

  it('should return 200 with full test result on success', async () => {
    const mockServer = {
      id: 'server-1',
      url: 'http://localhost:11434',
      apiKey: 'secret-key',
      models: ['llama3'],
    };
    mockOrchestrator.getServer.mockReturnValue(mockServer);

    const mockResult = {
      reachable: true,
      status: 'success',
      progress: 100,
      capabilities: {
        supportsOllama: true,
        supportsV1: true,
        supportsAnthropic: true,
        canListModels: true,
      },
      models: {
        ollama: ['llama3'],
        openai: [],
        merged: ['llama3'],
      },
      needsCustomModelList: false,
      suggestedConfig: {
        maxConcurrency: 4,
        requestTimeoutMs: 30000,
        supportsStreaming: true,
      },
      errors: [],
      durationMs: 150,
    };

    mockTestServerCapabilities.mockResolvedValue(mockResult);

    await testExistingServer(mockReq as Request, mockRes as Response);

    expect(mockTestServerCapabilities).toHaveBeenCalledWith('http://localhost:11434', {
      apiKey: 'secret-key',
    });
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: true,
      serverId: 'server-1',
      status: 'success',
      reachable: true,
      capabilities: mockResult.capabilities,
      models: mockResult.models,
      needsCustomModelList: false,
      suggestedConfig: mockResult.suggestedConfig,
      errors: [],
      durationMs: 150,
    });
  });

  it('should return 500 when testServerCapabilities throws', async () => {
    const mockServer = {
      id: 'server-1',
      url: 'http://localhost:11434',
      apiKey: undefined,
    };
    mockOrchestrator.getServer.mockReturnValue(mockServer);

    mockTestServerCapabilities.mockRejectedValue(new Error('Connection refused'));

    await testExistingServer(mockReq as Request, mockRes as Response);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'Connection refused',
    });
  });

  it('should call testServerCapabilities with server URL and API key', async () => {
    const mockServer = {
      id: 'server-1',
      url: 'http://localhost:11434',
      apiKey: 'my-secret-key',
    };
    mockOrchestrator.getServer.mockReturnValue(mockServer);
    mockTestServerCapabilities.mockResolvedValue({
      reachable: false,
      status: 'failed',
      progress: 0,
      capabilities: {
        supportsOllama: false,
        supportsV1: false,
        supportsAnthropic: false,
        canListModels: false,
      },
      models: { ollama: [], openai: [], merged: [] },
      needsCustomModelList: false,
      suggestedConfig: {
        maxConcurrency: 2,
        requestTimeoutMs: 60000,
        supportsStreaming: false,
      },
      errors: [{ endpoint: 'ollama_tags', reason: 'Connection refused' }],
      durationMs: 50,
    });

    await testExistingServer(mockReq as Request, mockRes as Response);

    expect(mockTestServerCapabilities).toHaveBeenCalledWith('http://localhost:11434', {
      apiKey: 'my-secret-key',
    });
  });
});
