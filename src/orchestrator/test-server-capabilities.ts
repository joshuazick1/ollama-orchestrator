import { API_ENDPOINTS } from '../constants/api-endpoints.js';

import { discoverModels, type DiscoverModelsResult } from './discover-models.js';
import {
  probeExecutorNegative,
  type NegativeProbeResult,
  type Endpoint,
} from './probe-executor-negative.js';

export type TestServerCapabilitiesOptions = {
  apiKey?: string;
  timeoutMs?: number;
};

export type SuggestedConfig = {
  maxConcurrency: number;
  requestTimeoutMs: number;
  supportsStreaming: boolean;
};

export type TestConnectionResult = {
  reachable: boolean;
  status: 'success' | 'partial' | 'failed' | 'running';
  progress: number;
  capabilities: {
    supportsOllama: boolean;
    supportsV1: boolean;
    supportsAnthropic: boolean;
    canListModels: boolean;
  };
  models: {
    ollama: string[];
    openai: string[];
    merged: string[];
  };
  needsCustomModelList: boolean;
  suggestedConfig: SuggestedConfig;
  errors: Array<{ endpoint: string; reason: string; status?: number }>;
  durationMs: number;
};

const DEFAULT_TIMEOUT_MS = 5000;

const ALL_ENDPOINTS: Endpoint[] = [
  'ollama_chat',
  'ollama_generate',
  'ollama_embeddings',
  'openai_chat',
  'openai_completions',
  'openai_embeddings',
  'anthropic_messages',
  'ollama_tags',
  'ollama_ps',
  'ollama_version',
  'openai_models',
];

const ADMIN_ENDPOINTS: readonly Endpoint[] = [
  'ollama_tags',
  'ollama_ps',
  'ollama_version',
  'openai_models',
];

async function probeStreamingSupport(
  serverUrl: string,
  apiKey?: string,
  timeoutMs?: number
): Promise<boolean> {
  const url = `${serverUrl.replace(/\/$/, '')}${API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS}`;
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: '__probe__',
        messages: [{ role: 'user', content: 'probe' }],
        stream: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.status !== 400;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

function computeCapabilities(
  probeResults: NegativeProbeResult[],
  discoverResult: DiscoverModelsResult
): TestConnectionResult['capabilities'] {
  const successfulAdminProbes = probeResults.filter(
    (r, i) => r.capabilityConfirmed && ADMIN_ENDPOINTS.includes(ALL_ENDPOINTS[i])
  );

  const openaiModelsProbe = probeResults[ALL_ENDPOINTS.indexOf('openai_models')];
  const anthropicProbe = probeResults[ALL_ENDPOINTS.indexOf('anthropic_messages')];

  return {
    supportsOllama: successfulAdminProbes.length > 0,
    supportsV1: openaiModelsProbe?.capabilityConfirmed ?? false,
    supportsAnthropic: anthropicProbe?.capabilityConfirmed ?? false,
    canListModels: discoverResult.ollama.length > 0 || discoverResult.openai.length > 0,
  };
}

function computeSuggestedConfig(avgLatencyMs: number, supportsStreaming: boolean): SuggestedConfig {
  if (avgLatencyMs < 100) {
    return {
      maxConcurrency: 8,
      requestTimeoutMs: 10000,
      supportsStreaming,
    };
  }
  if (avgLatencyMs <= 1000) {
    return {
      maxConcurrency: 4,
      requestTimeoutMs: 30000,
      supportsStreaming,
    };
  }
  return {
    maxConcurrency: 2,
    requestTimeoutMs: 60000,
    supportsStreaming,
  };
}

function computeStatus(
  reachable: boolean,
  capabilities: TestConnectionResult['capabilities']
): TestConnectionResult['status'] {
  if (!reachable) {
    return 'failed';
  }
  const { supportsOllama, supportsV1, supportsAnthropic, canListModels } = capabilities;
  const allSupported = supportsOllama && supportsV1 && supportsAnthropic && canListModels;
  const anySupported = supportsOllama || supportsV1 || supportsAnthropic || canListModels;

  if (allSupported) {
    return 'success';
  }
  if (anySupported) {
    return 'partial';
  }
  return 'failed';
}

export async function testServerCapabilities(
  serverUrl: string,
  options?: TestServerCapabilitiesOptions
): Promise<TestConnectionResult> {
  const startTime = Date.now();
  const { apiKey, timeoutMs = DEFAULT_TIMEOUT_MS } = options ?? {};

  const [discoverResult, streamingSupport] = await Promise.all([
    discoverModels(serverUrl, { apiKey, timeoutMs }),
    probeStreamingSupport(serverUrl, apiKey, timeoutMs),
  ]);

  const probePromises = ALL_ENDPOINTS.map(endpoint =>
    probeExecutorNegative(
      { serverId: '__test__', model: '__probe__', endpoint },
      { serverUrl, apiKey, timeoutMs }
    )
  );

  const probeResults = await Promise.all(probePromises);

  const latencies = probeResults
    .filter(r => r.durationMs !== undefined)
    .map(r => r.durationMs as number);

  const avgLatency =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  const capabilities = computeCapabilities(probeResults, discoverResult);

  const anySuccess = probeResults.some(r => r.success) || discoverResult.merged.length > 0;
  const reachable = anySuccess;

  const errors: Array<{ endpoint: string; reason: string; status?: number }> = [
    ...discoverResult.errors,
  ];

  probeResults.forEach((result, index) => {
    if (!result.success && result.error) {
      errors.push({
        endpoint: ALL_ENDPOINTS[index],
        reason: result.error,
        status: result.status,
      });
    }
  });

  const suggestedConfig = computeSuggestedConfig(avgLatency, streamingSupport);
  const status = computeStatus(reachable, capabilities);
  const durationMs = Date.now() - startTime;

  const progress = reachable ? (status === 'success' ? 100 : 50) : 0;

  return {
    reachable,
    status,
    progress,
    capabilities,
    models: {
      ollama: discoverResult.ollama,
      openai: discoverResult.openai,
      merged: discoverResult.merged,
    },
    needsCustomModelList: discoverResult.needsCustomModelList,
    suggestedConfig,
    errors,
    durationMs,
  };
}
