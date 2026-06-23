export const PROVIDER_DEFAULTS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    authType: 'bearer',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    endpoints: {
      chat: '/v1/chat/completions',
      completions: '/v1/completions',
      embeddings: '/v1/embeddings',
      messages: '/v1/messages',
    },
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    authType: 'api_key',
    authHeader: 'x-api-key',
    authPrefix: '',
    endpoints: {
      messages: '/v1/messages',
      models: '/v1/models',
    },
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.io',
    authType: 'bearer',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    endpoints: {
      chat: '/v1/text/chatcompletion_v2',
      chatAlt: '/v1/chat/completions',
      embeddings: '/v1/embeddings',
      anthropic: '/anthropic/v1/messages',
    },
  },
  azure: {
    name: 'Azure OpenAI',
    baseUrl: 'https://{resource}.openai.azure.com/openai/v1',
    authType: 'api_key',
    authHeader: 'api-key',
    authPrefix: '',
    endpoints: {
      chat: '/chat/completions',
      embeddings: '/embeddings',
    },
  },
  bedrock: {
    name: 'AWS Bedrock',
    baseUrl: 'https://bedrock-runtime.{region}.amazonaws.com',
    authType: 'aws',
    authHeader: '',
    authPrefix: '',
    endpoints: {},
  },
  // Detected via OpenAI-compat probing — no new AIServer.type needed
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-pro',
    authType: 'bearer',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    supportsV1: true,
    capabilities: ['chat', 'completions', 'embeddings'],
    endpoints: {
      chat: '/v1/chat/completions',
      completions: '/v1/completions',
      embeddings: '/v1/embeddings',
    },
  },
  // Detected via OpenAI-compat probing — no new AIServer.type needed
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai',
    defaultModel: 'llama-3.3-70b-versatile',
    authType: 'bearer',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    supportsV1: true,
    capabilities: ['chat', 'completions', 'embeddings'],
    endpoints: {
      chat: '/v1/chat/completions',
      completions: '/v1/completions',
      embeddings: '/v1/embeddings',
    },
  },
  vertex: {
    name: 'Google Vertex AI',
    baseUrl: 'https://{region}-aiplatform.googleapis.com/v1',
    authType: 'oauth',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    endpoints: {
      chat: '/publishers/google/models/{model}:generateContent',
    },
  },
  // Detected via OpenAI-compat probing — no new AIServer.type needed
  vllm: {
    name: 'vLLM',
    baseUrl: 'http://localhost:8000',
    defaultModel: '',
    authType: 'bearer',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    supportsV1: true,
    selfHosted: true,
    capabilities: ['chat', 'completions', 'embeddings'],
    endpoints: {
      chat: '/v1/chat/completions',
      completions: '/v1/completions',
      embeddings: '/v1/embeddings',
    },
  },
} as const;

export type ProviderType = keyof typeof PROVIDER_DEFAULTS;

export function getProviderDefaults(provider: ProviderType) {
  return PROVIDER_DEFAULTS[provider];
}

export function isCustomProvider(url: string): boolean {
  return !Object.values(PROVIDER_DEFAULTS).some(p => url.includes(new URL(p.baseUrl).host));
}
