import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { discoverModels } from '../../../src/orchestrator/discover-models.js';
import {
  probeExecutorNegative,
  type NegativeProbeResult,
} from '../../../src/orchestrator/probe-executor-negative.js';
import {
  testServerCapabilities,
  type TestConnectionResult,
} from '../../../src/orchestrator/test-server-capabilities.js';

vi.mock('../../../src/orchestrator/discover-models.js');
vi.mock('../../../src/orchestrator/probe-executor-negative.js');

describe('testServerCapabilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const createSuccessfulNegativeProbe = (durationMs = 50): NegativeProbeResult => ({
    success: true,
    capabilityConfirmed: true,
    modelNotFound: true,
    endpointAbsent: false,
    midStreamError: false,
    suspicious: false,
    networkError: false,
    timedOut: false,
    retryable: false,
    status: 404,
    body: '{"error":{"message":"model not found"}}',
    durationMs,
  });

  const createFailedNegativeProbe = (networkError = false): NegativeProbeResult => ({
    success: false,
    capabilityConfirmed: false,
    modelNotFound: false,
    endpointAbsent: false,
    midStreamError: false,
    suspicious: false,
    networkError,
    timedOut: false,
    retryable: networkError,
    durationMs: 50,
    error: networkError ? 'fetch failed' : undefined,
  });

  describe('all probes pass', () => {
    it('returns full TestConnectionResult with suggested config', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b', 'mistral:7b'],
        openai: ['gpt-4'],
        merged: ['gpt-4', 'llama3:8b', 'mistral:7b'],
        needsCustomModelList: false,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createSuccessfulNegativeProbe(50)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.reachable).toBe(true);
      expect(result.status).toBe('success');
      expect(result.capabilities.supportsOllama).toBe(true);
      expect(result.capabilities.supportsV1).toBe(true);
      expect(result.capabilities.supportsAnthropic).toBe(true);
      expect(result.capabilities.canListModels).toBe(true);
      expect(result.models.ollama).toEqual(['llama3:8b', 'mistral:7b']);
      expect(result.models.openai).toEqual(['gpt-4']);
      expect(result.models.merged).toEqual(['gpt-4', 'llama3:8b', 'mistral:7b']);
      expect(result.needsCustomModelList).toBe(false);
      expect(result.suggestedConfig.maxConcurrency).toBe(8);
      expect(result.suggestedConfig.requestTimeoutMs).toBe(10000);
      expect(result.suggestedConfig.supportsStreaming).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('server unreachable', () => {
    it('returns reachable=false, status=failed, empty models', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: [],
        merged: [],
        needsCustomModelList: true,
        errors: [
          { endpoint: '/api/tags', reason: 'network error' },
          { endpoint: '/v1/models', reason: 'network error' },
        ],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createFailedNegativeProbe(true)
      );

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.reachable).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.models.ollama).toEqual([]);
      expect(result.models.openai).toEqual([]);
      expect(result.models.merged).toEqual([]);
      expect(result.needsCustomModelList).toBe(true);
    });
  });

  describe('partial listing success', () => {
    it('only some admin endpoints work - returns partial capabilities, needsCustomModelList=true', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: [],
        merged: [],
        needsCustomModelList: true,
        errors: [
          { endpoint: '/api/tags', reason: 'request failed', status: 500 },
          { endpoint: '/v1/models', reason: 'request failed', status: 500 },
        ],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async tuple => {
        if (tuple.endpoint === 'ollama_tags' || tuple.endpoint === 'ollama_ps') {
          return createSuccessfulNegativeProbe(50);
        }
        return createFailedNegativeProbe(false);
      });

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.reachable).toBe(true);
      expect(result.status).toBe('partial');
      expect(result.models.ollama).toEqual([]);
      expect(result.models.openai).toEqual([]);
      expect(result.needsCustomModelList).toBe(true);
    });
  });

  describe('all listing fail', () => {
    it('returns empty models, needsCustomModelList=true', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: [],
        merged: [],
        needsCustomModelList: true,
        errors: [
          { endpoint: '/api/tags', reason: 'request failed', status: 500 },
          { endpoint: '/v1/models', reason: 'request failed', status: 500 },
        ],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createFailedNegativeProbe(false)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.models.ollama).toEqual([]);
      expect(result.models.openai).toEqual([]);
      expect(result.models.merged).toEqual([]);
      expect(result.needsCustomModelList).toBe(true);
    });
  });

  describe('suggestedConfig - fast server', () => {
    it('fast server (<100ms avg latency) → maxConcurrency=8, requestTimeoutMs=10000', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b'],
        openai: [],
        merged: ['llama3:8b'],
        needsCustomModelList: false,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createSuccessfulNegativeProbe(80)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.suggestedConfig.maxConcurrency).toBe(8);
      expect(result.suggestedConfig.requestTimeoutMs).toBe(10000);
    });
  });

  describe('suggestedConfig - slow server', () => {
    it('slow server (>1000ms avg latency) → maxConcurrency=2, requestTimeoutMs=60000', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b'],
        openai: [],
        merged: ['llama3:8b'],
        needsCustomModelList: false,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createSuccessfulNegativeProbe(1500)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.suggestedConfig.maxConcurrency).toBe(2);
      expect(result.suggestedConfig.requestTimeoutMs).toBe(60000);
    });
  });

  describe('suggestedConfig - streaming support', () => {
    it('streaming probe accepts stream:true → supportsStreaming=true', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b'],
        openai: [],
        merged: ['llama3:8b'],
        needsCustomModelList: false,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createSuccessfulNegativeProbe(50)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.suggestedConfig.supportsStreaming).toBe(true);
    });

    it('streaming probe returns 400 → supportsStreaming=false', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b'],
        openai: [],
        merged: ['llama3:8b'],
        needsCustomModelList: false,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createSuccessfulNegativeProbe(50)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.suggestedConfig.supportsStreaming).toBe(false);
    });
  });

  describe('durationMs', () => {
    it('returns durationMs ≥ 0', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: [],
        merged: [],
        needsCustomModelList: true,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createFailedNegativeProbe(false)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.durationMs).toBe('number');
    });

    it('durationMs is measured and returned', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: [],
        merged: [],
        needsCustomModelList: true,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createSuccessfulNegativeProbe(100)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.durationMs).toBe('number');
    });
  });

  describe('capabilities computation', () => {
    it('probes all 11 endpoints and merges into capabilities', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b'],
        openai: [],
        merged: ['llama3:8b'],
        needsCustomModelList: false,
        errors: [],
      });

      const probedEndpoints: string[] = [];
      vi.mocked(probeExecutorNegative).mockImplementation(async tuple => {
        probedEndpoints.push(tuple.endpoint);
        return createSuccessfulNegativeProbe(50);
      });

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      await testServerCapabilities('http://localhost:11434');

      expect(probedEndpoints).toContain('ollama_chat');
      expect(probedEndpoints).toContain('ollama_generate');
      expect(probedEndpoints).toContain('ollama_embeddings');
      expect(probedEndpoints).toContain('openai_chat');
      expect(probedEndpoints).toContain('openai_completions');
      expect(probedEndpoints).toContain('openai_embeddings');
      expect(probedEndpoints).toContain('anthropic_messages');
      expect(probedEndpoints).toContain('ollama_tags');
      expect(probedEndpoints).toContain('ollama_ps');
      expect(probedEndpoints).toContain('ollama_version');
      expect(probedEndpoints).toContain('openai_models');
      expect(probedEndpoints).toHaveLength(11);
    });

    it('supportsOllama=true when admin endpoints succeed', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b'],
        openai: [],
        merged: ['llama3:8b'],
        needsCustomModelList: false,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async tuple => {
        if (['ollama_tags', 'ollama_ps', 'ollama_version'].includes(tuple.endpoint)) {
          return createSuccessfulNegativeProbe(50);
        }
        return createFailedNegativeProbe(false);
      });

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.capabilities.supportsOllama).toBe(true);
    });

    it('supportsV1=true when openai_models succeeds', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: ['gpt-4'],
        merged: ['gpt-4'],
        needsCustomModelList: false,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async tuple => {
        if (tuple.endpoint === 'openai_models') {
          return createSuccessfulNegativeProbe(50);
        }
        return createFailedNegativeProbe(false);
      });

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.capabilities.supportsV1).toBe(true);
    });

    it('supportsAnthropic=true when anthropic_messages succeeds', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: [],
        merged: [],
        needsCustomModelList: true,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async tuple => {
        if (tuple.endpoint === 'anthropic_messages') {
          return createSuccessfulNegativeProbe(50);
        }
        return createFailedNegativeProbe(false);
      });

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.capabilities.supportsAnthropic).toBe(true);
    });

    it('canListModels=true when ollama OR openai listing succeeds', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b'],
        openai: [],
        merged: ['llama3:8b'],
        needsCustomModelList: false,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createFailedNegativeProbe(false)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.capabilities.canListModels).toBe(true);
    });
  });

  describe('progress tracking', () => {
    it('returns progress 0-100', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: [],
        merged: [],
        needsCustomModelList: true,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createFailedNegativeProbe(false)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.progress).toBeGreaterThanOrEqual(0);
      expect(result.progress).toBeLessThanOrEqual(100);
    });
  });

  describe('status computation', () => {
    it('status=success when all capabilities detected', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b'],
        openai: ['gpt-4'],
        merged: ['gpt-4', 'llama3:8b'],
        needsCustomModelList: false,
        errors: [],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createSuccessfulNegativeProbe(50)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.status).toBe('success');
    });

    it('status=partial when some probes fail', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: ['llama3:8b'],
        openai: [],
        merged: ['llama3:8b'],
        needsCustomModelList: false,
        errors: [{ endpoint: '/v1/models', reason: 'request failed', status: 500 }],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async tuple => {
        if (['ollama_tags', 'ollama_ps'].includes(tuple.endpoint)) {
          return createSuccessfulNegativeProbe(50);
        }
        return createFailedNegativeProbe(false);
      });

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.status).toBe('partial');
    });

    it('status=failed when no probes succeed', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: [],
        merged: [],
        needsCustomModelList: true,
        errors: [
          { endpoint: '/api/tags', reason: 'network error' },
          { endpoint: '/v1/models', reason: 'network error' },
        ],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async () =>
        createFailedNegativeProbe(true)
      );

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.status).toBe('failed');
    });
  });

  describe('errors collection', () => {
    it('collects errors from probeExecutorNegative', async () => {
      vi.mocked(discoverModels).mockResolvedValue({
        ollama: [],
        openai: [],
        merged: [],
        needsCustomModelList: true,
        errors: [
          { endpoint: '/api/tags', reason: 'network error' },
          { endpoint: '/v1/models', reason: 'network error' },
        ],
      });

      vi.mocked(probeExecutorNegative).mockImplementation(async tuple => ({
        success: false,
        capabilityConfirmed: false,
        modelNotFound: false,
        endpointAbsent: true,
        midStreamError: false,
        suspicious: false,
        networkError: false,
        timedOut: false,
        retryable: false,
        durationMs: 50,
        error: `endpoint ${tuple.endpoint} failed`,
        status: 404,
        body: 'Not Found',
      }));

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
      } as Response);

      const result = await testServerCapabilities('http://localhost:11434');

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
