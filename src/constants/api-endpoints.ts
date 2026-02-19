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
} as const;

export type OllamaEndpoint = (typeof API_ENDPOINTS.OLLAMA)[keyof typeof API_ENDPOINTS.OLLAMA];
export type OpenAIEndpoint = (typeof API_ENDPOINTS.OPENAI)[keyof typeof API_ENDPOINTS.OPENAI];
