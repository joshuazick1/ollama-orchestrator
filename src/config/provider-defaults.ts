export const PROVIDER_DEFAULTS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    endpoints: {
      chat: '/v1/chat/completions',
      completions: '/v1/completions',
      embeddings: '/v1/embeddings',
      messages: '/v1/messages'
    }
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    authType: 'api_key',
    authHeader: 'x-api-key',
    authPrefix: '',
    endpoints: {
      messages: '/v1/messages',
      models: '/v1/models'
    }
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
      anthropic: '/anthropic/v1/messages'
    }
  },
  azure: {
    name: 'Azure OpenAI',
    baseUrl: 'https://{resource}.openai.azure.com/openai/v1',
    authType: 'api_key',
    authHeader: 'api-key',
    authPrefix: '',
    endpoints: {
      chat: '/chat/completions',
      embeddings: '/embeddings'
    }
  },
  bedrock: {
    name: 'AWS Bedrock',
    baseUrl: 'https://bedrock-runtime.{region}.amazonaws.com',
    authType: 'aws',
    authHeader: '',
    authPrefix: '',
    endpoints: {}
  },
  vertex: {
    name: 'Google Vertex AI',
    baseUrl: 'https://{region}-aiplatform.googleapis.com/v1',
    authType: 'oauth',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    endpoints: {
      chat: '/publishers/google/models/{model}:generateContent'
    }
  }
} as const;

export type ProviderType = keyof typeof PROVIDER_DEFAULTS;

export function getProviderDefaults(provider: ProviderType) {
  return PROVIDER_DEFAULTS[provider];
}

export function isCustomProvider(url: string): boolean {
  return !Object.values(PROVIDER_DEFAULTS).some(p => url.includes(new URL(p.baseUrl).host));
}
