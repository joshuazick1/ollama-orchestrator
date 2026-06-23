/**
 * api-endpoints.ts
 * API endpoint constants for Ollama and OpenAI-compatible servers
 */

export const API_ENDPOINTS = {
  OLLAMA: {
    TAGS: '/api/tags',
    GENERATE: '/api/generate',
    CHAT: '/api/chat',
    EMBEDDINGS: '/api/embeddings',
    EMBED: '/api/embed',
    PULL: '/api/pull',
    SHOW: '/api/show',
    PS: '/api/ps',
    DELETE: '/api/delete',
    VERSION: '/api/version',
  },
  OPENAI: {
    CHAT_COMPLETIONS: '/v1/chat/completions',
    COMPLETIONS: '/v1/completions',
    EMBEDDINGS: '/v1/embeddings',
    MODELS: '/v1/models',
  },
  ANTHROPIC: {
    MESSAGES: '/v1/messages',
  },
} as const;

export type OllamaEndpoint = (typeof API_ENDPOINTS.OLLAMA)[keyof typeof API_ENDPOINTS.OLLAMA];
export type OpenAIEndpoint = (typeof API_ENDPOINTS.OPENAI)[keyof typeof API_ENDPOINTS.OPENAI];
export type AnthropicEndpoint =
  (typeof API_ENDPOINTS.ANTHROPIC)[keyof typeof API_ENDPOINTS.ANTHROPIC];

export const CAPABILITY_PROBE = '/api/orchestrator/servers/:id/capability-probe';
export const TEST_CONNECTION = '/api/orchestrator/servers/test-connection';
export const ANALYTICS_CIRCUIT_BREAKERS = '/api/orchestrator/analytics/circuit-breakers';

/**
 * Performance probe endpoints for orchestrator-managed load testing tasks.
 * POST /api/orchestrator/performance-probe - Start a new performance probe task.
 * GET  /api/orchestrator/performance-probe/:taskId - Get status of a running probe task.
 * DELETE /api/orchestrator/performance-probe/:taskId - Cancel a running probe task.
 */
export const PERFORMANCE_PROBE = '/api/orchestrator/performance-probe';
export const PERFORMANCE_PROBE_STATUS = '/api/orchestrator/performance-probe/:taskId';
export const PERFORMANCE_PROBE_CANCEL = '/api/orchestrator/performance-probe/:taskId';
export const PERFORMANCE_PROBE_HISTORY = '/api/orchestrator/performance-probe/history';
export const PERFORMANCE_PROBE_HISTORY_EXPORT =
  '/api/orchestrator/performance-probe/history/export';
export const PERFORMANCE_PROBE_SCHEDULER_STATUS =
  '/api/orchestrator/performance-probe/scheduler-status';
export const PERFORMANCE_PROBE_RECENT = '/api/orchestrator/performance-probe/recent';
export const PERFORMANCE_PROBE_COVERAGE_GRID = '/api/orchestrator/performance-probe/coverage-grid';
export const PERFORMANCE_PROBE_SCHEDULED_PROBES =
  '/api/orchestrator/performance-probe/scheduled-probes';
