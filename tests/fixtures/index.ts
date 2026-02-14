/**
 * Test fixtures for Ollama Orchestrator
 * Mock data for servers, models, and responses
 */

import type { AIServer } from '../../src/orchestrator.types';

// Re-export real API responses for realistic testing
export {
  realApiTagsResponse,
  realApiGenerateResponse,
  realApiChatResponse,
  realApiEmbeddingsResponse,
  realApiVersionResponse,
  realApiPsResponse,
  realErrorResponses,
} from './real-responses.js';

// Mock server configurations
export const mockServers = {
  healthy: {
    id: 'server-1',
    url: 'http://localhost:11434',
    type: 'ollama' as const,
    healthy: true,
    lastResponseTime: 50,
    models: ['llama3:latest', 'mistral:latest'] as string[],
    maxConcurrency: 4,
  },
  unhealthy: {
    id: 'server-2',
    url: 'http://localhost:11435',
    type: 'ollama' as const,
    healthy: false,
    lastResponseTime: Infinity,
    models: [] as string[],
    maxConcurrency: 4,
  },
  overloaded: {
    id: 'server-3',
    url: 'http://localhost:11436',
    type: 'ollama' as const,
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'] as string[],
    maxConcurrency: 1,
  },
  slow: {
    id: 'server-4',
    url: 'http://localhost:11437',
    type: 'ollama' as const,
    healthy: true,
    lastResponseTime: 2000,
    models: ['llama3:latest', 'mistral:latest'] as string[],
    maxConcurrency: 4,
  },
} as const;

// Helper to create custom mock servers
export function createMockServer(overrides: Partial<AIServer> = {}): AIServer {
  return {
    ...mockServers.healthy,
    ...overrides,
  };
}

// Mock models
export const mockModels = {
  llama3: {
    name: 'llama3:latest',
    model: 'llama3:latest',
    modified_at: '2024-01-01T00:00:00Z',
    size: 4700000000,
    digest: 'sha256:abc123',
    details: {
      parent_model: '',
      format: 'gguf',
      family: 'llama',
      families: ['llama'],
      parameter_size: '8B',
      quantization_level: 'Q4_0',
    },
  },
  mistral: {
    name: 'mistral:latest',
    model: 'mistral:latest',
    modified_at: '2024-01-01T00:00:00Z',
    size: 4100000000,
    digest: 'sha256:def456',
    details: {
      parent_model: '',
      format: 'gguf',
      family: 'mistral',
      families: ['mistral'],
      parameter_size: '7B',
      quantization_level: 'Q4_0',
    },
  },
  codellama: {
    name: 'codellama:7b',
    model: 'codellama:7b',
    modified_at: '2024-01-01T00:00:00Z',
    size: 3800000000,
    digest: 'sha256:ghi789',
    details: {
      parent_model: '',
      format: 'gguf',
      family: 'llama',
      families: ['llama'],
      parameter_size: '7B',
      quantization_level: 'Q4_0',
    },
  },
} as const;

// Mock Ollama API responses
export const mockResponses = {
  tags: {
    models: [mockModels.llama3, mockModels.mistral],
  },
  generate: {
    model: 'llama3:latest',
    created_at: '2024-01-01T00:00:00Z',
    response: 'Hello! How can I help you today?',
    done: true,
    context: [1, 2, 3],
    total_duration: 1234567890,
    load_duration: 12345678,
    prompt_eval_count: 5,
    prompt_eval_duration: 123456789,
    eval_count: 10,
    eval_duration: 987654321,
  },
  chat: {
    model: 'llama3:latest',
    created_at: '2024-01-01T00:00:00Z',
    message: {
      role: 'assistant',
      content: 'Hello! How can I help you today?',
    },
    done: true,
    total_duration: 1234567890,
    load_duration: 12345678,
    prompt_eval_count: 5,
    prompt_eval_duration: 123456789,
    eval_count: 10,
    eval_duration: 987654321,
  },
  embeddings: {
    embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
  },
  ps: {
    models: [
      {
        name: 'llama3:latest',
        model: 'llama3:latest',
        size: 4700000000,
        digest: 'sha256:abc123',
        expires_at: '2024-01-01T01:00:00Z',
        size_vram: 4700000000,
      },
    ],
  },
} as const;

// Error scenarios
export const mockErrors = {
  timeout: new Error('Request timeout'),
  connectionRefused: new Error('fetch failed: connect ECONNREFUSED'),
  oom: new Error('not enough ram'),
  runnerTerminated: new Error('runner process has terminated'),
  modelNotFound: new Error('model not found'),
  http500: new Error('HTTP 500: Internal Server Error'),
  http503: new Error('HTTP 503: Service Unavailable'),
} as const;

// Generate random test data
export function generateRandomLatency(min = 100, max = 2000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateServerMetrics(count: number): Array<{
  serverId: string;
  latency: number;
  errorRate: number;
}> {
  return Array.from({ length: count }, (_, i) => ({
    serverId: `server-${i}`,
    latency: generateRandomLatency(),
    errorRate: Math.random() * 0.1,
  }));
}

// Test timing helpers
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return;
    }
    await sleep(interval);
  }
  throw new Error('Timeout waiting for condition');
}
