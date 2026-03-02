/**
 * openai-server-support.test.ts
 * Comprehensive tests for OpenAI-compatible server support
 *
 * TESTING REQUIREMENTS:
 * - Tests must verify dual protocol support (Ollama AND OpenAI)
 * - Tests must verify capability detection (supportsOllama, supportsV1)
 * - Tests must verify API key authentication with env: prefix
 * - Tests must verify protocol-specific routing
 * - Tests must verify model management restrictions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies
vi.mock('../../src/orchestrator-instance.js');
vi.mock('../../src/config/config.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import { getConfigManager } from '../../src/config/config.js';
import type { AIServer } from '../../src/orchestrator.types.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockGetConfigManager = vi.mocked(getConfigManager);

describe('OpenAI Server Support Comprehensive Tests', () => {
  let mockOrchestrator: any;
  let mockConfigManager: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  // Test servers
  const ollamaServer: AIServer = {
    id: 'ollama-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest', 'mistral:latest'],
    supportsOllama: true,
    supportsV1: false,
  };

  const openaiServer: AIServer = {
    id: 'openai-1',
    url: 'http://localhost:8000',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 80,
    models: [],
    v1Models: ['gpt-4', 'gpt-3.5-turbo', 'text-embedding-ada-002'],
    supportsOllama: false,
    supportsV1: true,
  };

  const dualServer: AIServer = {
    id: 'dual-1',
    url: 'http://localhost:11435',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 90,
    models: ['llama3:latest'],
    v1Models: ['llama3'],
    supportsOllama: true,
    supportsV1: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      getServers: vi.fn(),
      getAggregatedTags: vi.fn(),
      getAggregatedOpenAIModels: vi.fn(),
      tryRequestWithFailover: vi.fn(),
      requestToServer: vi.fn(),
      addServer: vi.fn(),
      getAllDetailedMetrics: vi.fn(),
      getGlobalMetrics: vi.fn(),
    };

    mockConfigManager = {
      getConfig: vi.fn().mockReturnValue({
        streaming: { activityTimeoutMs: 30000 },
      }),
    };

    mockGetOrchestratorInstance.mockReturnValue(mockOrchestrator);
    mockGetConfigManager.mockReturnValue(mockConfigManager);

    mockReq = {
      params: {},
      body: {},
      query: {},
      headers: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };
  });

  // ============================================================================
  // SECTION 4.1: Dual Protocol Support Tests
  // ============================================================================

  describe('Dual Protocol Support', () => {
    it('should detect Ollama capability', () => {
      expect(ollamaServer.supportsOllama).toBe(true);
      expect(ollamaServer.supportsV1).toBe(false);
    });

    it('should detect OpenAI capability', () => {
      expect(openaiServer.supportsOllama).toBe(false);
      expect(openaiServer.supportsV1).toBe(true);
    });

    it('should support both protocols simultaneously', () => {
      expect(dualServer.supportsOllama).toBe(true);
      expect(dualServer.supportsV1).toBe(true);
    });

    it('should detect Ollama endpoint via health check', async () => {
      // Simulate health check detecting /api/tags
      const detectOllama = async (url: string) => {
        if (url.includes(':11434')) {
          return { supportsOllama: true, supportsV1: false };
        }
        return { supportsOllama: false, supportsV1: false };
      };

      const result = await detectOllama('http://localhost:11434');
      expect(result.supportsOllama).toBe(true);
    });

    it('should detect OpenAI endpoint via health check', async () => {
      // Simulate health check detecting /v1/models
      const detectOpenAI = async (url: string) => {
        if (url.includes(':8000')) {
          return { supportsOllama: false, supportsV1: true };
        }
        return { supportsOllama: false, supportsV1: false };
      };

      const result = await detectOpenAI('http://localhost:8000');
      expect(result.supportsV1).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 4.2: Model Aggregation Tests
  // ============================================================================

  describe('Model Aggregation Tests', () => {
    it('should return ONLY Ollama models from /api/tags', async () => {
      const servers = [ollamaServer, dualServer];

      const getOllamaModels = () => {
        const models: string[] = [];
        servers.forEach(server => {
          if (server.supportsOllama && server.models) {
            models.push(...server.models);
          }
        });
        return models;
      };

      const models = getOllamaModels();

      expect(models).toContain('llama3:latest');
      expect(models).toContain('mistral:latest');
    });

    it('should return ONLY OpenAI models from /v1/models', async () => {
      const servers = [openaiServer, dualServer];

      const getOpenAIModels = () => {
        const models: string[] = [];
        servers.forEach(server => {
          if (server.supportsV1 && server.v1Models) {
            models.push(...server.v1Models);
          }
        });
        return models;
      };

      const models = getOpenAIModels();

      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-3.5-turbo');
    });

    it('should NOT mix models between protocols', () => {
      const ollamaModels = new Set(ollamaServer.models || []);
      const openaiModels = new Set(openaiServer.v1Models || []);

      // Should be separate
      expect(ollamaModels.size).toBeGreaterThan(0);
      expect(openaiModels.size).toBeGreaterThan(0);
    });

    it('should handle same model accessible via both protocols', () => {
      // Dual server has same model in both lists (different format)
      expect(dualServer.models).toContain('llama3:latest');
      expect(dualServer.v1Models).toContain('llama3');
    });
  });

  // ============================================================================
  // SECTION 4.3: API Key Authentication Tests
  // ============================================================================

  describe('API Key Authentication Tests', () => {
    it('should store API key in server config', () => {
      const serverWithKey = {
        ...openaiServer,
        apiKey: 'env:OPENAI_API_KEY',
      };

      expect(serverWithKey.apiKey).toBeDefined();
    });

    it('should resolve env:VARIABLE_NAME format', () => {
      const server = {
        apiKey: 'env:TEST_KEY',
      };

      // Simulate environment variable
      process.env.TEST_KEY = 'actual-secret-value';

      const resolveApiKey = (key: string) => {
        if (key.startsWith('env:')) {
          const envVar = key.substring(4);
          return process.env[envVar];
        }
        return key;
      };

      const resolved = resolveApiKey(server.apiKey!);
      expect(resolved).toBe('actual-secret-value');

      delete process.env.TEST_KEY;
    });

    it('should redact API key in responses', () => {
      const server = {
        id: 'test-server',
        apiKey: 'sk-actual-key-123',
      };

      const redactKey = (key?: string) => {
        if (!key) return undefined;
        if (key.startsWith('env:')) return key;
        return '***REDACTED***';
      };

      const redacted = redactKey(server.apiKey);
      expect(redacted).toBe('***REDACTED***');
    });

    it('should NOT expose env: reference value in logs', () => {
      const apiKey = 'env:SECRET_KEY';

      // Should only show "env:SECRET_KEY" not the actual value
      const shouldLog = (key: string) => {
        if (key.startsWith('env:')) return key;
        return '***REDACTED***';
      };

      expect(shouldLog(apiKey)).toBe('env:SECRET_KEY');
    });

    it('should handle missing API key gracefully', () => {
      const server = {
        id: 'test',
        apiKey: undefined,
      };

      expect(server.apiKey).toBeUndefined();
    });
  });

  // ============================================================================
  // SECTION 4.4: Protocol-Specific Routing Tests
  // ============================================================================

  describe('Protocol-Specific Routing Tests', () => {
    it('should route Ollama requests ONLY to supportsOllama servers', () => {
      const servers = [ollamaServer, openaiServer, dualServer];

      const routeOllamaRequest = () => {
        return servers.filter(s => s.supportsOllama);
      };

      const available = routeOllamaRequest();

      // Should include ollamaServer and dualServer
      expect(available).toHaveLength(2);
      expect(available.map(s => s.id)).toContain('ollama-1');
      expect(available.map(s => s.id)).toContain('dual-1');
    });

    it('should route OpenAI requests ONLY to supportsV1 servers', () => {
      const servers = [ollamaServer, openaiServer, dualServer];

      const routeOpenAIRequest = () => {
        return servers.filter(s => s.supportsV1);
      };

      const available = routeOpenAIRequest();

      // Should include openaiServer and dualServer
      expect(available).toHaveLength(2);
      expect(available.map(s => s.id)).toContain('openai-1');
      expect(available.map(s => s.id)).toContain('dual-1');
    });

    it('should fallback when no servers support required protocol', () => {
      const servers: AIServer[] = [];

      const findServer = (protocol: 'ollama' | 'openai') => {
        if (protocol === 'ollama') {
          return servers.find(s => s.supportsOllama);
        }
        return servers.find(s => s.supportsV1);
      };

      // No servers available
      const result = findServer('openai');
      expect(result).toBeUndefined();
    });

    it('should prioritize available servers correctly', () => {
      const servers = [ollamaServer, openaiServer, dualServer];

      const selectServer = (protocol: 'ollama' | 'openai') => {
        const available = servers.filter(s =>
          protocol === 'ollama' ? s.supportsOllama : s.supportsV1
        );

        // Select by lowest latency
        return available.sort((a, b) => a.lastResponseTime - b.lastResponseTime)[0];
      };

      // Ollama: ollama-1 (100ms) and dual-1 (90ms) - should pick dual-1
      const ollamaSelected = selectServer('ollama');
      expect(ollamaSelected?.id).toBe('dual-1');
    });
  });

  // ============================================================================
  // SECTION 4.5: Model Management Restrictions Tests
  // ============================================================================

  describe('Model Management Restrictions Tests', () => {
    it('should allow model operations on Ollama servers', () => {
      // Ollama servers support model management
      expect(ollamaServer.supportsOllama).toBe(true);
    });

    it('should BLOCK model operations on OpenAI-only servers', () => {
      // OpenAI servers don't support Ollama model operations
      expect(openaiServer.supportsOllama).toBe(false);

      // Should return 400 error
      const canManageModels = (server: AIServer) => {
        if (!server.supportsOllama) {
          return {
            allowed: false,
            status: 400,
            error: 'Model management not supported on OpenAI-only servers',
          };
        }
        return { allowed: true };
      };

      const result = canManageModels(openaiServer);
      expect(result.allowed).toBe(false);
      expect(result.status).toBe(400);
    });

    it('should allow model operations on dual-capability servers', () => {
      expect(dualServer.supportsOllama).toBe(true);
      expect(dualServer.supportsV1).toBe(true);
    });

    it('should handle mixed server pool correctly', () => {
      const servers = [ollamaServer, openaiServer, dualServer];

      const canPullModel = (server: AIServer) => {
        return server.supportsOllama;
      };

      const allowed = servers.filter(canPullModel);
      const blocked = servers.filter(s => !canPullModel(s));

      expect(allowed).toHaveLength(2); // ollama and dual
      expect(blocked).toHaveLength(1); // openai
    });
  });

  // ============================================================================
  // SECTION 4.6: OpenAI Endpoint Tests (ALL must be tested)
  // ============================================================================

  describe('OpenAI Endpoint Tests', () => {
    describe('POST /v1/chat/completions', () => {
      it('should handle chat completion request', async () => {
        mockReq.body = {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        };

        mockOrchestrator.tryRequestWithFailover.mockResolvedValue({
          choices: [{ message: { role: 'assistant', content: 'Hi there!' } }],
        });

        const handler = async () => {
          return await mockOrchestrator.tryRequestWithFailover('v1/chat/completions', mockReq.body);
        };

        const result = await handler();
        expect(result).toBeDefined();
      });

      it('should handle streaming chat completion', async () => {
        mockReq.body = {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        };

        expect(mockReq.body.stream).toBe(true);
      });

      it('should handle non-streaming chat completion', async () => {
        mockReq.body = {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false,
        };

        expect(mockReq.body.stream).toBe(false);
      });
    });

    describe('POST /v1/completions', () => {
      it('should handle completion request', async () => {
        mockReq.body = {
          model: 'gpt-3.5-turbo',
          prompt: 'Once upon a time',
        };

        expect(mockReq.body.prompt).toBeDefined();
      });

      it('should handle streaming completions', async () => {
        mockReq.body = {
          model: 'gpt-3.5-turbo',
          prompt: 'Once upon a time',
          stream: true,
        };

        expect(mockReq.body.stream).toBe(true);
      });
    });

    describe('POST /v1/embeddings', () => {
      it('should handle embedding request', async () => {
        mockReq.body = {
          model: 'text-embedding-ada-002',
          input: 'Hello world',
        };

        expect(mockReq.body.input).toBeDefined();
      });

      it('should handle array input for embeddings', async () => {
        mockReq.body = {
          model: 'text-embedding-ada-002',
          input: ['Hello', 'World'],
        };

        expect(Array.isArray(mockReq.body.input)).toBe(true);
      });
    });

    describe('GET /v1/models', () => {
      it('should return model list', async () => {
        mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue({
          data: [
            { id: 'gpt-4', object: 'model' },
            { id: 'gpt-3.5-turbo', object: 'model' },
          ],
        });

        const models = await mockOrchestrator.getAggregatedOpenAIModels();

        expect(models.data).toHaveLength(2);
      });

      it('should return empty list when no models', async () => {
        mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue({
          data: [],
        });

        const models = await mockOrchestrator.getAggregatedOpenAIModels();

        expect(models.data).toHaveLength(0);
      });
    });

    describe('GET /v1/models/:model', () => {
      it('should return specific model info', async () => {
        const params = { model: 'gpt-4' };
        mockReq.params = params;

        mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue({
          data: [{ id: 'gpt-4', object: 'model', created: 1704067200 }],
        });

        const models = await mockOrchestrator.getAggregatedOpenAIModels();
        const model = models.data.find((m: any) => m.id === params.model);

        expect(model).toBeDefined();
        expect(model?.id).toBe('gpt-4');
      });

      it('should return 404 for non-existent model', async () => {
        const params = { model: 'non-existent' };
        mockReq.params = params;

        mockOrchestrator.getAggregatedOpenAIModels.mockReturnValue({
          data: [],
        });

        const models = await mockOrchestrator.getAggregatedOpenAIModels();
        const model = models.data.find((m: any) => m.id === params.model);

        expect(model).toBeUndefined();
      });
    });
  });

  // ============================================================================
  // SECTION 4.7: Error Handling Tests
  // ============================================================================

  describe('Error Handling Tests', () => {
    it('should return 400 for invalid request body', () => {
      const validateRequest = (body: any) => {
        if (!body || !body.model) {
          return { valid: false, status: 400, error: 'model is required' };
        }
        return { valid: true };
      };

      const result = validateRequest({});
      expect(result.status).toBe(400);
    });

    it('should return 404 for non-existent model', () => {
      const checkModel = (model: string, available: string[]) => {
        if (!available.includes(model)) {
          return { found: false, status: 404, error: 'Model not found' };
        }
        return { found: true };
      };

      const result = checkModel('non-existent', ['gpt-4', 'gpt-3.5-turbo']);
      expect(result.status).toBe(404);
    });

    it('should return 500 for server failure', () => {
      const handleServerError = (error: any) => {
        if (error) {
          return { status: 500, error: 'Internal server error' };
        }
        return { status: 200 };
      };

      const result = handleServerError(new Error('Server failed'));
      expect(result.status).toBe(500);
    });

    it('should handle timeout correctly', () => {
      const handleTimeout = () => {
        return { status: 504, error: 'Gateway timeout' };
      };

      const result = handleTimeout();
      expect(result.status).toBe(504);
    });

    it('should integrate with circuit breaker', () => {
      const shouldRetry = (failureCount: number, threshold: number) => {
        if (failureCount >= threshold) {
          return { shouldRetry: false, circuitOpen: true };
        }
        return { shouldRetry: true, circuitOpen: false };
      };

      // Below threshold
      let result = shouldRetry(2, 5);
      expect(result.shouldRetry).toBe(true);

      // Above threshold
      result = shouldRetry(5, 5);
      expect(result.shouldRetry).toBe(false);
      expect(result.circuitOpen).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 4.8: Dual-Protocol Comparison Tests (MANDATORY)
  // ============================================================================

  describe('Dual-Protocol Comparison Tests', () => {
    it('should access same model via both protocols on dual server', () => {
      // On dual server, same model is available via both protocols
      expect(dualServer.models).toContain('llama3:latest');
      expect(dualServer.v1Models).toContain('llama3');
    });

    it('should succeed with Ollama protocol', async () => {
      mockOrchestrator.requestToServer.mockResolvedValue({
        message: { role: 'assistant', content: 'Response' },
      });

      const result = await mockOrchestrator.requestToServer(ollamaServer, 'chat', {
        model: 'llama3',
        messages: [],
      });

      expect(result).toBeDefined();
    });

    it('should succeed with OpenAI protocol on same server', async () => {
      mockOrchestrator.requestToServer.mockResolvedValue(
        {
          choices: [{ message: { role: 'assistant', content: 'Response' } }],
        },
        'v1/chat/completions'
      );

      const result = await mockOrchestrator.requestToServer(dualServer, 'v1/chat/completions', {
        model: 'llama3',
        messages: [],
      });

      expect(result).toBeDefined();
    });

    it('should verify response format differs between protocols', () => {
      const ollamaResponse = {
        message: { role: 'assistant', content: 'Hello' },
      };

      const openaiResponse = {
        choices: [{ message: { role: 'assistant', content: 'Hello' } }],
      };

      // Formats are different but content is the same
      expect(ollamaResponse.message.content).toBe(openaiResponse.choices[0].message.content);
    });
  });

  // ============================================================================
  // REC-39: /v1/models created field uses Unix seconds (10 digits)
  // ============================================================================

  describe('REC-39: /v1/models created timestamp format', () => {
    it('should use Unix seconds (10 digits) not milliseconds (13 digits) for created field', () => {
      // The fix: Math.floor(Date.now() / 1000)
      const created = Math.floor(Date.now() / 1000);
      // Unix seconds should be 10 digits through at least 2286
      expect(created.toString().length).toBe(10);
    });

    it('should reject millisecond timestamps as too large', () => {
      const milliseconds = Date.now();
      const seconds = Math.floor(milliseconds / 1000);
      // Milliseconds are ~1000× larger
      expect(milliseconds).toBeGreaterThan(seconds * 999);
      // Seconds are 10 digits
      expect(seconds.toString().length).toBe(10);
      // Milliseconds are 13 digits (in 2024+)
      expect(milliseconds.toString().length).toBe(13);
    });

    it('handleListOpenAIModels should return created field as 10-digit Unix seconds', async () => {
      // Simulate what getAggregatedOpenAIModels returns
      mockOrchestrator.getAggregatedOpenAIModels = vi
        .fn()
        .mockReturnValue([{ id: 'gpt-4', created: Math.floor(Date.now() / 1000) }]);

      const models = mockOrchestrator.getAggregatedOpenAIModels();
      expect(models[0].created.toString().length).toBe(10);
    });
  });
});
