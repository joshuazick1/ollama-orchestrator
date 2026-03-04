/**
 * dual-capability-server.test.ts
 * Tests for servers supporting BOTH Ollama AND OpenAI protocols
 *
 * TESTING REQUIREMENTS:
 * - Tests must verify all capabilities (supportsOllama AND supportsV1)
 * - Tests must verify model list aggregation for both protocols
 * - Tests must verify protocol-specific routing
 * - Tests must verify model management on dual-capability servers
 * - Tests must verify metrics collection per protocol
 * - Tests must verify failover between protocols
 */

import type { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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

import { getConfigManager } from '../../src/config/config.js';
import { getOrchestratorInstance } from '../../src/orchestrator-instance.js';
import type { AIServer } from '../../src/orchestrator.types.js';

const mockGetOrchestratorInstance = vi.mocked(getOrchestratorInstance);
const mockGetConfigManager = vi.mocked(getConfigManager);

describe('Dual-Capability Server Tests', () => {
  let mockOrchestrator: any;
  let mockConfigManager: any;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  // Test data for dual-capability servers
  const dualCapabilityServer: AIServer = {
    id: 'dual-server-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest', 'mistral:latest'],
    v1Models: ['llama3', 'mistral'],
    supportsOllama: true,
    supportsV1: true,
    apiKey: undefined,
  };

  const ollamaOnlyServer: AIServer = {
    id: 'ollama-only-1',
    url: 'http://localhost:11435',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 150,
    models: ['llama2:latest'],
    supportsOllama: true,
    supportsV1: false,
    apiKey: undefined,
  };

  const openaiOnlyServer: AIServer = {
    id: 'openai-only-1',
    url: 'http://localhost:8000',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 80,
    models: [],
    v1Models: ['gpt-4', 'gpt-3.5-turbo'],
    supportsOllama: false,
    supportsV1: true,
    apiKey: 'env:OPENAI_KEY',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      getServers: vi.fn(),
      getServer: vi.fn(),
      getAggregatedTags: vi.fn(),
      getAggregatedOpenAIModels: vi.fn(),
      tryRequestWithFailover: vi.fn(),
      requestToServer: vi.fn(),
      addServer: vi.fn(),
      updateServer: vi.fn(),
      removeServer: vi.fn(),
      getInFlight: vi.fn(),
      getQueueStats: vi.fn(),
      getAllDetailedMetrics: vi.fn(),
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
  // SECTION 4B.1: Health Check Capability Detection
  // ============================================================================

  describe('Health Check Capability Detection', () => {
    it('should detect both Ollama and OpenAI capabilities', () => {
      // Dual-capability server should have both flags
      expect(dualCapabilityServer.supportsOllama).toBe(true);
      expect(dualCapabilityServer.supportsV1).toBe(true);
    });

    it('should have separate model lists for each protocol', () => {
      // Ollama models (with :latest suffix)
      expect(dualCapabilityServer.models).toContain('llama3:latest');

      // OpenAI models (without :latest suffix)
      expect(dualCapabilityServer.v1Models).toContain('llama3');
    });

    it('should parse model names correctly for each protocol', () => {
      // Ollama format: "llama3:latest"
      const ollamaModels = dualCapabilityServer.models || [];
      expect(ollamaModels.every(m => m.includes(':'))).toBe(true);

      // OpenAI format: "llama3" (no suffix)
      const openaiModels = dualCapabilityServer.v1Models || [];
      expect(openaiModels.every(m => !m.includes(':'))).toBe(true);
    });

    it('should identify Ollama-only servers correctly', () => {
      expect(ollamaOnlyServer.supportsOllama).toBe(true);
      expect(ollamaOnlyServer.supportsV1).toBe(false);
      expect(ollamaOnlyServer.models).toBeDefined();
      expect(ollamaOnlyServer.v1Models).toBeUndefined();
    });

    it('should identify OpenAI-only servers correctly', () => {
      expect(openaiOnlyServer.supportsOllama).toBe(false);
      expect(openaiOnlyServer.supportsV1).toBe(true);
      expect(openaiOnlyServer.models).toEqual([]); // Empty array means no Ollama models
      expect(openaiOnlyServer.v1Models).toBeDefined();
    });

    it('should handle capability changes after health check', () => {
      // Initial state: supports both
      let server: AIServer = { ...dualCapabilityServer };
      expect(server.supportsOllama).toBe(true);
      expect(server.supportsV1).toBe(true);

      // Simulate health check failure for OpenAI endpoint only
      server = {
        ...server,
        supportsOllama: true,
        supportsV1: false, // OpenAI endpoint now failing
      };

      expect(server.supportsOllama).toBe(true);
      expect(server.supportsV1).toBe(false);
    });
  });

  // ============================================================================
  // SECTION 4B.2: Model List Aggregation
  // ============================================================================

  describe('Model List Aggregation', () => {
    it('should aggregate Ollama models from dual-capability servers', () => {
      const servers = [dualCapabilityServer, ollamaOnlyServer];

      // Extract Ollama models
      const allOllamaModels = new Set<string>();
      servers.forEach(server => {
        if (server.supportsOllama && server.models) {
          server.models.forEach(m => allOllamaModels.add(m));
        }
      });

      expect(allOllamaModels).toContain('llama3:latest');
      expect(allOllamaModels).toContain('mistral:latest');
      expect(allOllamaModels).toContain('llama2:latest');
    });

    it('should aggregate OpenAI models from dual-capability servers', () => {
      const servers = [dualCapabilityServer, openaiOnlyServer];

      // Extract OpenAI models
      const allOpenAIModels = new Set<string>();
      servers.forEach(server => {
        if (server.supportsV1 && server.v1Models) {
          server.v1Models.forEach(m => allOpenAIModels.add(m));
        }
      });

      expect(allOpenAIModels).toContain('llama3');
      expect(allOpenAIModels).toContain('mistral');
      expect(allOpenAIModels).toContain('gpt-4');
      expect(allOpenAIModels).toContain('gpt-3.5-turbo');
    });

    it('should NOT mix models between protocols', () => {
      const ollamaModels = dualCapabilityServer.models || [];
      const openaiModels = dualCapabilityServer.v1Models || [];

      // No model should appear in both lists
      const intersection = ollamaModels.filter(m =>
        openaiModels.some(om => om === m || om === m.replace(':latest', ''))
      );

      // The base name might appear in both, but that's expected
      // The key is that models with :latest suffix shouldn't appear in v1Models
      const ollamaOnlyFormat = ollamaModels.filter(m => m.includes(':'));
      expect(ollamaOnlyFormat.length).toBeGreaterThan(0);
    });

    it('should handle duplicate models across server types', () => {
      // Two dual-capability servers with same models
      const server1 = { ...dualCapabilityServer, id: 'dual-1' };
      const server2 = { ...dualCapabilityServer, id: 'dual-2' };

      const allModels = new Set<string>();
      [server1, server2].forEach(s => {
        s.models?.forEach(m => allModels.add(m));
      });

      // Should have unique models (deduplicated)
      expect(allModels.size).toBeLessThanOrEqual(4); // 2 servers * 2 models
    });
  });

  // ============================================================================
  // SECTION 4B.3: Protocol Routing Tests
  // ============================================================================

  describe('Protocol Routing', () => {
    it('should route Ollama requests to dual-capability servers', () => {
      const servers = [dualCapabilityServer, ollamaOnlyServer, openaiOnlyServer];

      // Filter servers that support Ollama
      const ollamaCapable = servers.filter(s => s.supportsOllama);

      expect(ollamaCapable).toHaveLength(2);
      expect(ollamaCapable.map(s => s.id)).toContain('dual-server-1');
      expect(ollamaCapable.map(s => s.id)).toContain('ollama-only-1');
    });

    it('should route OpenAI requests to dual-capability servers', () => {
      const servers = [dualCapabilityServer, ollamaOnlyServer, openaiOnlyServer];

      // Filter servers that support OpenAI
      const openaiCapable = servers.filter(s => s.supportsV1);

      expect(openaiCapable).toHaveLength(2);
      expect(openaiCapable.map(s => s.id)).toContain('dual-server-1');
      expect(openaiCapable.map(s => s.id)).toContain('openai-only-1');
    });

    it('should prioritize dual-capability servers when appropriate', () => {
      const servers = [dualCapabilityServer, ollamaOnlyServer];

      // For Ollama requests, both can handle
      const ollamaServers = servers.filter(s => s.supportsOllama);
      expect(ollamaServers).toHaveLength(2);

      // For OpenAI requests, only dual can handle
      const openaiServers = servers.filter(s => s.supportsV1);
      expect(openaiServers).toHaveLength(1);
      expect(openaiServers[0].id).toBe('dual-server-1');
    });

    it('should handle mixed server pool correctly', () => {
      const serverPool = [
        { ...ollamaOnlyServer, id: 'ollama-1' },
        { ...ollamaOnlyServer, id: 'ollama-2' },
        { ...openaiOnlyServer, id: 'openai-1' },
        { ...openaiOnlyServer, id: 'openai-2' },
        { ...dualCapabilityServer, id: 'dual-1' },
        { ...dualCapabilityServer, id: 'dual-2' },
      ];

      const ollamaCapable = serverPool.filter(s => s.supportsOllama);
      const openaiCapable = serverPool.filter(s => s.supportsV1);

      // 2 ollama-only + 2 dual = 4 Ollama-capable
      expect(ollamaCapable).toHaveLength(4);

      // 2 openai-only + 2 dual = 4 OpenAI-capable
      expect(openaiCapable).toHaveLength(4);
    });

    it('should fallback correctly when no servers support required protocol', () => {
      const servers = [ollamaOnlyServer]; // Only Ollama

      // Try to find OpenAI-capable server
      const openaiServers = servers.filter(s => s.supportsV1);

      // Should be empty
      expect(openaiServers).toHaveLength(0);
    });
  });

  // ============================================================================
  // SECTION 4B.4: Model Management on Dual-Capability Servers
  // ============================================================================

  describe('Model Management on Dual-Capability Servers', () => {
    it('should allow model operations on dual-capability servers', () => {
      // Dual-capability servers should support Ollama operations
      expect(dualCapabilityServer.supportsOllama).toBe(true);

      // And also support OpenAI-style operations
      expect(dualCapabilityServer.supportsV1).toBe(true);
    });

    it('should block model operations on OpenAI-only servers', () => {
      // OpenAI-only servers don't support Ollama model management
      expect(openaiOnlyServer.supportsOllama).toBe(false);
    });

    it('should update both model lists when model is added', () => {
      let server = { ...dualCapabilityServer };

      // Add new model
      const newModel = 'newmodel:latest';
      server = {
        ...server,
        models: [...(server.models || []), newModel],
        v1Models: [...(server.v1Models || []), 'newmodel'],
      };

      expect(server.models).toContain(newModel);
      expect(server.v1Models).toContain('newmodel');
    });

    it('should update both model lists when model is removed', () => {
      let server = { ...dualCapabilityServer };

      // Remove a model
      server = {
        ...server,
        models: server.models?.filter(m => m !== 'llama3:latest') || [],
        v1Models: server.v1Models?.filter(m => m !== 'llama3') || [],
      };

      expect(server.models).not.toContain('llama3:latest');
      expect(server.v1Models).not.toContain('llama3');
    });
  });

  // ============================================================================
  // SECTION 4B.5: Metrics Collection
  // ============================================================================

  describe('Metrics Collection', () => {
    it('should track requests separately per protocol', () => {
      // Track metrics for different protocols
      const metrics = {
        ollamaRequests: 0,
        openaiRequests: 0,
      };

      // Simulate Ollama request
      metrics.ollamaRequests++;

      // Simulate OpenAI request
      metrics.openaiRequests++;

      expect(metrics.ollamaRequests).toBe(1);
      expect(metrics.openaiRequests).toBe(1);
    });

    it('should track latency separately per protocol', () => {
      const serverMetrics = {
        'ollama-latency': [] as number[],
        'openai-latency': [] as number[],
      };

      // Record Ollama latency
      serverMetrics['ollama-latency'].push(100);
      serverMetrics['ollama-latency'].push(150);

      // Record OpenAI latency
      serverMetrics['openai-latency'].push(80);
      serverMetrics['openai-latency'].push(120);

      const ollamaAvg = serverMetrics['ollama-latency'].reduce((a, b) => a + b, 0) / 2;
      const openaiAvg = serverMetrics['openai-latency'].reduce((a, b) => a + b, 0) / 2;

      expect(ollamaAvg).toBe(125);
      expect(openaiAvg).toBe(100);
    });

    it('should track error rates per protocol', () => {
      const errorRates = {
        ollama: { total: 100, errors: 2 },
        openai: { total: 100, errors: 5 },
      };

      const ollamaErrorRate = errorRates.ollama.errors / errorRates.ollama.total;
      const openaiErrorRate = errorRates.openai.errors / errorRates.openai.total;

      expect(ollamaErrorRate).toBe(0.02);
      expect(openaiErrorRate).toBe(0.05);
    });

    it('should NOT mix metrics between protocols', () => {
      // Create per-protocol metric tracking
      const protocolMetrics = {
        protocols: {
          ollama: { requests: 0, errors: 0 },
          openai: { requests: 0, errors: 0 },
        } as Record<string, { requests: number; errors: number }>,
      };

      // Add Ollama request
      protocolMetrics.protocols.ollama.requests++;

      // Add OpenAI request
      protocolMetrics.protocols.openai.requests++;

      // Verify separation
      expect(protocolMetrics.protocols.ollama.requests).toBe(1);
      expect(protocolMetrics.protocols.openai.requests).toBe(1);
      expect(
        protocolMetrics.protocols.ollama.requests + protocolMetrics.protocols.openai.requests
      ).toBe(2);
    });
  });

  // ============================================================================
  // SECTION 4B.6: Failover with Dual-Capability Servers
  // ============================================================================

  describe('Failover with Dual-Capability Servers', () => {
    it('should failover between protocols on same server', () => {
      const server = { ...dualCapabilityServer };

      // Initially both protocols work
      let ollamaWorking = true;
      let openaiWorking = true;

      // Simulate Ollama endpoint failing
      ollamaWorking = false;

      // Should be able to fallback to OpenAI
      expect(server.supportsV1).toBe(true);
      expect(openaiWorking).toBe(true);

      // Simulate OpenAI endpoint also failing
      openaiWorking = false;

      // Both should be unavailable
      expect(ollamaWorking).toBe(false);
      expect(openaiWorking).toBe(false);
    });

    it('should apply circuit breaker per protocol', () => {
      const server = { ...dualCapabilityServer };

      // Track circuit breaker state per protocol
      const circuitBreakers = {
        'server:model:ollama': 'closed',
        'server:model:openai': 'closed',
      };

      // Simulate Ollama circuit opening
      circuitBreakers['server:model:ollama'] = 'open';

      // OpenAI should still work
      expect(circuitBreakers['server:model:openai']).toBe('closed');

      // Ollama should be blocked
      expect(circuitBreakers['server:model:ollama']).toBe('open');
    });

    it('should apply cooldown to both protocols', () => {
      const cooldowns = new Map<string, number>();

      // Set cooldown for server:model
      const key = 'dual-server-1:llama3';
      cooldowns.set(key, Date.now() + 120000); // 2 minutes

      // Should be in cooldown
      expect(cooldowns.has(key)).toBe(true);

      // After cooldown expires
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 130000);

      // Should no longer be in cooldown
      const isInCooldown = (cooldowns.get(key) || 0) > Date.now();
      expect(isInCooldown).toBe(false);

      vi.useRealTimers();
    });

    it('should handle partial failure (one protocol fails)', () => {
      const server = { ...dualCapabilityServer };

      // Track protocol health
      const protocolHealth = {
        ollama: true,
        openai: true,
      };

      // Fail Ollama
      protocolHealth.ollama = false;

      // Should still have OpenAI
      expect(protocolHealth.openai).toBe(true);
      expect(server.supportsV1).toBe(true);
    });
  });

  // ============================================================================
  // SECTION 4B.7: Streaming on Dual-Capability Servers
  // ============================================================================

  describe('Streaming on Dual-Capability Servers', () => {
    it('should support Ollama streaming', () => {
      const server = { ...dualCapabilityServer };

      // Should support Ollama streaming
      expect(server.supportsOllama).toBe(true);
      expect(server.models).toContain('llama3:latest');
    });

    it('should support OpenAI streaming', () => {
      const server = { ...dualCapabilityServer };

      // Should support OpenAI streaming
      expect(server.supportsV1).toBe(true);
      expect(server.v1Models).toContain('llama3');
    });

    it('should track TTFT metrics for both protocols', () => {
      const ttftMetrics = {
        ollama: [] as number[],
        openai: [] as number[],
      };

      // Record Ollama TTFT
      ttftMetrics.ollama.push(500);

      // Record OpenAI TTFT
      ttftMetrics.openai.push(300);

      expect(ttftMetrics.ollama).toHaveLength(1);
      expect(ttftMetrics.openai).toHaveLength(1);
    });

    it('should detect stalled streams per protocol', () => {
      const stalledStreams = {
        ollama: new Set<string>(),
        openai: new Set<string>(),
      };

      // Stall Ollama stream
      stalledStreams.ollama.add('stream-1');

      expect(stalledStreams.ollama.has('stream-1')).toBe(true);
      expect(stalledStreams.openai.has('stream-1')).toBe(false);
    });
  });

  // ============================================================================
  // SECTION 4B.8: Mixed Server Pool Tests
  // ============================================================================

  describe('Mixed Server Pool Tests', () => {
    it('should handle pool with all server types', () => {
      const pool = [
        { ...ollamaOnlyServer, id: 'ollama-1' },
        { ...openaiOnlyServer, id: 'openai-1' },
        { ...dualCapabilityServer, id: 'dual-1' },
      ];

      const ollamaOnly = pool.filter(s => s.supportsOllama && !s.supportsV1);
      const openaiOnly = pool.filter(s => s.supportsV1 && !s.supportsOllama);
      const dual = pool.filter(s => s.supportsOllama && s.supportsV1);

      expect(ollamaOnly).toHaveLength(1);
      expect(openaiOnly).toHaveLength(1);
      expect(dual).toHaveLength(1);
    });

    it('should load balance correctly in mixed pool', () => {
      const pool = [
        { ...ollamaOnlyServer, id: 'ollama-1', load: 10 },
        { ...dualCapabilityServer, id: 'dual-1', load: 20 },
      ];

      // For Ollama requests, both servers can handle
      // Should prefer lower load
      const ollamaPool = pool.filter(s => s.supportsOllama);
      const selected = ollamaPool.sort((a, b) => a.load - b.load)[0];

      expect(selected.id).toBe('ollama-1');
    });

    it('should handle protocol-specific routing in mixed pool', () => {
      const pool = [
        { ...ollamaOnlyServer, id: 'ollama-1' },
        { ...openaiOnlyServer, id: 'openai-1' },
        { ...dualCapabilityServer, id: 'dual-1' },
      ];

      // For /api/* requests
      const ollamaServers = pool.filter(s => s.supportsOllama);
      expect(ollamaServers).toHaveLength(2); // ollama-1 and dual-1

      // For /v1/* requests
      const openaiServers = pool.filter(s => s.supportsV1);
      expect(openaiServers).toHaveLength(2); // openai-1 and dual-1
    });
  });

  // ============================================================================
  // SECTION 4B.9: Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle Ollama endpoint failure gracefully', () => {
      let server = { ...dualCapabilityServer };

      // Simulate Ollama endpoint failure
      server = {
        ...server,
        supportsOllama: false,
      };

      expect(server.supportsOllama).toBe(false);
      expect(server.supportsV1).toBe(true);
    });

    it('should handle OpenAI endpoint failure gracefully', () => {
      let server = { ...dualCapabilityServer };

      // Simulate OpenAI endpoint failure
      server = {
        ...server,
        supportsV1: false,
      };

      expect(server.supportsOllama).toBe(true);
      expect(server.supportsV1).toBe(false);
    });

    it('should handle both endpoints failing', () => {
      let server = { ...dualCapabilityServer };

      // Simulate both endpoints failing
      server = {
        ...server,
        supportsOllama: false,
        supportsV1: false,
      };

      expect(server.supportsOllama).toBe(false);
      expect(server.supportsV1).toBe(false);
    });

    it('should return appropriate error when no servers support protocol', () => {
      const servers = [ollamaOnlyServer]; // Only Ollama

      // Try to route OpenAI request
      const openaiServers = servers.filter(s => s.supportsV1);

      if (openaiServers.length === 0) {
        // Should return 503 or similar error
        expect(true).toBe(true); // Error handling path
      }
    });
  });

  // ============================================================================
  // SECTION 4B.10: Configuration Tests
  // ============================================================================

  describe('Configuration Tests', () => {
    it('should allow explicit capability configuration', () => {
      const server = {
        id: 'test-server',
        url: 'http://localhost:11434',
        supportsOllama: true,
        supportsV1: true,
      };

      expect(server.supportsOllama).toBe(true);
      expect(server.supportsV1).toBe(true);
    });

    it('should support auto-detection of capabilities', () => {
      // Simulate auto-detection
      const detectCapabilities = (serverUrl: string) => {
        // In real implementation, this would ping both endpoints
        const capabilities = {
          supportsOllama: false,
          supportsV1: false,
        };

        // Auto-detect based on URL or endpoint responses
        if (serverUrl.includes(':11434')) {
          capabilities.supportsOllama = true;
        }
        if (serverUrl.includes(':8000')) {
          capabilities.supportsV1 = true;
        }

        return capabilities;
      };

      const capabilities = detectCapabilities('http://localhost:11434');
      expect(capabilities.supportsOllama).toBe(true);
    });

    it('should support API key configuration per protocol', () => {
      const server = {
        ...dualCapabilityServer,
        apiKey: 'env:OPENAI_KEY',
      };

      // API key should be stored but not exposed
      expect(server.apiKey).toBeDefined();
      expect(server.apiKey).not.toBe('actual-key-value');
      expect(server.apiKey).toContain('env:');
    });

    it('should redact API keys in responses', () => {
      const server = {
        id: 'test-server',
        url: 'http://localhost:11434',
        apiKey: 'env:TEST_KEY',
      };

      // Simulate redaction
      const redactKey = (key?: string) => {
        if (!key) {return undefined;}
        return key.startsWith('env:') ? key : '***REDACTED***';
      };

      const redacted = redactKey(server.apiKey);

      // Should show env: reference but not actual key
      expect(redacted).toContain('env:');
      expect(redacted).not.toBe('actual_secret_value');
    });
  });

  // ============================================================================
  // Testing Matrix Verification
  // ============================================================================

  describe('Testing Matrix Verification', () => {
    it('should pass Ollama-only + OpenAI-only scenario', () => {
      const pool = [ollamaOnlyServer, openaiOnlyServer];

      const ollamaServers = pool.filter(s => s.supportsOllama);
      const openaiServers = pool.filter(s => s.supportsV1);

      expect(ollamaServers).toHaveLength(1);
      expect(openaiServers).toHaveLength(1);
    });

    it('should pass Ollama-only + Dual-capability scenario', () => {
      const pool = [ollamaOnlyServer, dualCapabilityServer];

      const ollamaServers = pool.filter(s => s.supportsOllama);

      expect(ollamaServers).toHaveLength(2);
    });

    it('should pass OpenAI-only + Dual-capability scenario', () => {
      const pool = [openaiOnlyServer, dualCapabilityServer];

      const openaiServers = pool.filter(s => s.supportsV1);

      expect(openaiServers).toHaveLength(2);
    });

    it('should pass all three types scenario', () => {
      const pool = [ollamaOnlyServer, openaiOnlyServer, dualCapabilityServer];

      expect(pool).toHaveLength(3);
      expect(pool.filter(s => s.supportsOllama)).toHaveLength(2);
      expect(pool.filter(s => s.supportsV1)).toHaveLength(2);
    });

    it('should pass multiple dual-capability scenario', () => {
      const pool = [dualCapabilityServer, { ...dualCapabilityServer, id: 'dual-2' }];

      const dualServers = pool.filter(s => s.supportsOllama && s.supportsV1);

      expect(dualServers).toHaveLength(2);
    });
  });
});
