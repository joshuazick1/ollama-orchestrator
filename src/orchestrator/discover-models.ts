import { API_ENDPOINTS } from '../constants/api-endpoints.js';
import { httpProbeWithTimeout } from '../utils/http-probe-with-timeout.js';
import { logger } from '../utils/logger.js';

import { probeVLLMModels, isVLLMServer, type VLLMModelMeta } from './vllm-models.js';

export type DiscoverModelsOptions = {
  apiKey?: string;
  timeoutMs?: number;
};

export type DiscoverModelsResult = {
  ollama: string[];
  openai: string[];
  merged: string[];
  needsCustomModelList: boolean;
  errors: Array<{
    // eslint-disable-next-line no-restricted-syntax
    endpoint: '/api/tags' | '/v1/models';
    status?: number;
    reason: string;
  }>;
  vllmMetadata?: Record<string, VLLMModelMeta>;
  isVLLM?: boolean;
};

const DEFAULT_TIMEOUT_MS = 5000;

interface OllamaModel {
  name?: string;
  model?: string;
}

interface OllamaResponse {
  models?: OllamaModel[];
}

interface OpenAIModel {
  id?: string;
}

interface OpenAIResponse {
  data?: OpenAIModel[];
}

async function probeOllamaTags(
  serverUrl: string,
  timeoutMs: number
): Promise<{
  models: string[];
  // eslint-disable-next-line no-restricted-syntax
  error?: { endpoint: '/api/tags'; status?: number; reason: string };
}> {
  const url = `${serverUrl.replace(/\/$/, '')}${API_ENDPOINTS.OLLAMA.TAGS}`;
  const result = await httpProbeWithTimeout(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    timeoutMs,
  });

  if (result.aborted) {
    return {
      models: [],
      // eslint-disable-next-line no-restricted-syntax
      error: { endpoint: '/api/tags', reason: 'timeout' },
    };
  }

  if (!result.ok && result.status === 0) {
    return {
      models: [],
      // eslint-disable-next-line no-restricted-syntax
      error: { endpoint: '/api/tags', reason: 'network error' },
    };
  }

  if (!result.ok) {
    if (result.status === 401) {
      logger.error('Authentication error probing /api/tags', { status: result.status });
    }
    return {
      models: [],
      error: {
        // eslint-disable-next-line no-restricted-syntax
        endpoint: '/api/tags',
        status: result.status,
        reason: result.status === 401 ? 'unauthorized' : 'request failed',
      },
    };
  }

  let body: OllamaResponse = {};
  try {
    body = ((await result.response?.json()) ?? {}) as OllamaResponse;
  } catch {
    // eslint-disable-next-line no-restricted-syntax
    return { models: [], error: { endpoint: '/api/tags', reason: 'invalid JSON response' } };
  }

  const models: string[] = [];
  if (body.models && Array.isArray(body.models)) {
    for (const item of body.models) {
      const name = item.name || item.model;
      if (name && typeof name === 'string') {
        models.push(name);
      }
    }
  }

  return { models };
}

async function probeOpenAIModels(
  serverUrl: string,
  apiKey: string | undefined,
  timeoutMs: number
): Promise<{
  models: string[];
  // eslint-disable-next-line no-restricted-syntax
  error?: { endpoint: '/v1/models'; status?: number; reason: string };
}> {
  const url = `${serverUrl.replace(/\/$/, '')}${API_ENDPOINTS.OPENAI.MODELS}`;
  const result = await httpProbeWithTimeout(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    timeoutMs,
    apiKey,
  });

  if (result.aborted) {
    return {
      models: [],
      // eslint-disable-next-line no-restricted-syntax
      error: { endpoint: '/v1/models', reason: 'timeout' },
    };
  }

  if (!result.ok && result.status === 0) {
    return {
      models: [],
      // eslint-disable-next-line no-restricted-syntax
      error: { endpoint: '/v1/models', reason: 'network error' },
    };
  }

  if (!result.ok) {
    return {
      models: [],
      // eslint-disable-next-line no-restricted-syntax
      error: {
        endpoint: '/v1/models',
        status: result.status,
        reason: result.status === 401 ? 'unauthorized' : 'request failed',
      },
    };
  }

  let body: OpenAIResponse = {};
  try {
    body = ((await result.response?.json()) ?? {}) as OpenAIResponse;
  } catch {
    // eslint-disable-next-line no-restricted-syntax
    return { models: [], error: { endpoint: '/v1/models', reason: 'invalid JSON response' } };
  }

  const models: string[] = [];
  if (body.data && Array.isArray(body.data)) {
    for (const item of body.data) {
      const id = item.id;
      if (id && typeof id === 'string') {
        models.push(id);
      }
    }
  }

  return { models };
}

function dedupeAndSort(models: string[]): string[] {
  const seen = new Map<string, string>();
  for (const model of models) {
    const lower = model.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, model);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export async function discoverModels(
  serverUrl: string,
  options?: DiscoverModelsOptions
): Promise<DiscoverModelsResult> {
  const { apiKey, timeoutMs = DEFAULT_TIMEOUT_MS } = options ?? {};

  const [ollamaResult, openaiResult, vllmResult] = await Promise.all([
    probeOllamaTags(serverUrl, timeoutMs),
    probeOpenAIModels(serverUrl, apiKey, timeoutMs),
    isVLLMServer(serverUrl)
      ? probeVLLMModels(serverUrl, apiKey, timeoutMs)
      : Promise.resolve({ models: [], metadata: {}, isVLLM: false }),
  ]);

  const ollama = ollamaResult.models;
  const openai = openaiResult.models;

  const allModels = [...ollama, ...openai];
  const merged = dedupeAndSort(allModels);

  // eslint-disable-next-line no-restricted-syntax
  const errors: Array<{ endpoint: '/api/tags' | '/v1/models'; status?: number; reason: string }> =
    [];
  if (ollamaResult.error) {
    errors.push(ollamaResult.error);
  }
  if (openaiResult.error) {
    errors.push(openaiResult.error);
  }

  const needsCustomModelList = ollama.length === 0 && openai.length === 0;

  return {
    ollama,
    openai,
    merged,
    needsCustomModelList,
    errors,
    vllmMetadata: vllmResult.isVLLM ? vllmResult.metadata : undefined,
    isVLLM: vllmResult.isVLLM,
  };
}
