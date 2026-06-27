import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  discoverModels,
  type DiscoverModelsOptions,
  type DiscoverModelsResult,
} from '../../../src/orchestrator/discover-models.js';

function createFetchMock() {
  return vi.spyOn(global, 'fetch');
}

describe('discoverModels', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns merged union when both endpoints succeed', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: 'llama3:8b' }, { name: 'mistral:7b' }] }),
        } as Response;
      }
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'gpt-4' }, { id: 'llama3:8b' }],
          }),
        } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(result.ollama).toEqual(['llama3:8b', 'mistral:7b']);
    expect(result.openai).toEqual(['gpt-4', 'llama3:8b']);
    expect(result.merged).toEqual(['gpt-4', 'llama3:8b', 'mistral:7b']);
    expect(result.needsCustomModelList).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it('returns ollama models and empty openai when only /api/tags succeeds', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: 'llama3:8b' }] }),
        } as Response;
      }
      if (url.includes('/v1/models')) {
        return {
          ok: false,
          status: 500,
        } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(result.ollama).toEqual(['llama3:8b']);
    expect(result.openai).toEqual([]);
    expect(result.merged).toEqual(['llama3:8b']);
    expect(result.needsCustomModelList).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].endpoint).toBe('/v1/models');
    expect(result.errors[0].status).toBe(500);
  });

  it('returns openai models and empty ollama when only /v1/models succeeds', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return {
          ok: false,
          status: 500,
        } as Response;
      }
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'gpt-4' }] }),
        } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(result.ollama).toEqual([]);
    expect(result.openai).toEqual(['gpt-4']);
    expect(result.merged).toEqual(['gpt-4']);
    expect(result.needsCustomModelList).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].endpoint).toBe('/api/tags');
  });

  it('sets needsCustomModelList=true when both endpoints fail', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      return { ok: false, status: 500 } as Response;
    });

    const result = await discoverModels('http://localhost:11434');

    expect(result.ollama).toEqual([]);
    expect(result.openai).toEqual([]);
    expect(result.merged).toEqual([]);
    expect(result.needsCustomModelList).toBe(true);
    expect(result.errors).toHaveLength(2);
  });

  it('captures 401 error from /api/tags', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return {
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ error: 'unauthorized' }),
        } as Response;
      }
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(
      result.errors.some(
        (e: { endpoint: string; status?: number }) => e.endpoint === '/api/tags' && e.status === 401
      )
    ).toBe(true);
  });

  it('captures 500 error from /v1/models as transient error', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [] }),
        } as Response;
      }
      if (url.includes('/v1/models')) {
        return {
          ok: false,
          status: 500,
        } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(
      result.errors.some(
        (e: { endpoint: string; status?: number }) =>
          e.endpoint === '/v1/models' && e.status === 500
      )
    ).toBe(true);
  });

  it('deduplicates models case-insensitively', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: 'llama3:8b' }] }),
        } as Response;
      }
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'llama3:8B' }] }),
        } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(result.merged).toEqual(['llama3:8b']);
    expect(result.merged).toHaveLength(1);
  });

  it('returns merged list sorted alphabetically', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: 'zzz-model' }, { name: 'aaa-model' }] }),
        } as Response;
      }
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'mmm-model' }, { id: 'nnn-model' }] }),
        } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(result.merged).toEqual(['aaa-model', 'mmm-model', 'nnn-model', 'zzz-model']);
  });

  it('parses Ollama /api/tags response correctly', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [
              { name: 'llama3:8b-instruct-q4_0' },
              { name: 'mistral:7b' },
              { name: 'codellama:13b' },
            ],
          }),
        } as Response;
      }
      if (url.includes('/v1/models')) {
        return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(result.ollama).toEqual(['llama3:8b-instruct-q4_0', 'mistral:7b', 'codellama:13b']);
  });

  it('parses OpenAI /v1/models response correctly', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return { ok: true, status: 200, json: async () => ({ models: [] }) } as Response;
      }
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'gpt-4-turbo' }, { id: 'gpt-3.5-turbo' }, { id: 'gpt-4o' }],
          }),
        } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(result.openai).toEqual(['gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4o']);
  });

  it('sets needsCustomModelList=true when both endpoints return empty', async () => {
    const mockFetch = createFetchMock();

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }
      if (url.includes('/v1/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response;
      }
      throw new Error('Unexpected URL');
    });

    const result = await discoverModels('http://localhost:11434');

    expect(result.ollama).toEqual([]);
    expect(result.openai).toEqual([]);
    expect(result.merged).toEqual([]);
    expect(result.needsCustomModelList).toBe(true);
  });

  it('sends Authorization Bearer header when apiKey is provided', async () => {
    const mockFetch = createFetchMock();
    let capturedHeaders: Headers | null = null;

    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes('/v1/models')) {
        capturedHeaders = new Headers(options?.headers as Record<string, string>);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'gpt-4' }] }),
        } as Response;
      }
      if (url.includes('/api/tags')) {
        return { ok: true, status: 200, json: async () => ({ models: [] }) } as Response;
      }
      throw new Error('Unexpected URL');
    });

    await discoverModels('http://localhost:11434', { apiKey: 'test-secret-key' });

    expect(capturedHeaders?.get('Authorization')).toBe('Bearer test-secret-key');
  });
});
