/**
 * Real Ollama API responses captured from actual servers
 * These are used for realistic mock responses in tests
 */

// Real /api/tags response from 192.168.4.65:11434
export const realApiTagsResponse = {
  models: [
    {
      name: 'glm-4.7-flash:latest',
      model: 'glm-4.7-flash:latest',
      modified_at: '2026-01-23T12:34:29.601532399-05:00',
      size: 18754370628,
      digest: 'ff14144f31df2c994b69134ffab74b3ceaf79ab767c3987e1bd9236a4c8243cf',
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'glm4moelite',
        families: ['glm4moelite'],
        parameter_size: '29.9B',
        quantization_level: 'Q4_K_M',
      },
    },
    {
      name: 'gemma3:4b',
      model: 'gemma3:4b',
      modified_at: '2025-11-19T15:00:07.360413187-05:00',
      size: 3338801804,
      digest: 'a2af6cc3eb7fa8be8504abaf9b04e88f17a119ec3f04a3addf55f92841195f5a',
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'gemma3',
        families: ['gemma3'],
        parameter_size: '4.3B',
        quantization_level: 'Q4_K_M',
      },
    },
    {
      name: 'mistral:latest',
      model: 'mistral:latest',
      modified_at: '2025-11-19T14:59:16.530604513-05:00',
      size: 4372824384,
      digest: '6577803aa9a036369e481d648a2baebb381ebc6e897f2bb9a766a2aa7bfbc1cf',
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'llama',
        families: ['llama'],
        parameter_size: '7.2B',
        quantization_level: 'Q4_K_M',
      },
    },
    {
      name: 'gpt-oss:20b',
      model: 'gpt-oss:20b',
      modified_at: '2025-11-19T14:58:12.113579651-05:00',
      size: 13793441244,
      digest: '17052f91a42e97930aa6e28a6c6c06a983e6a58dbb00434885a0cf5313e376f7',
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'gptoss',
        families: ['gptoss'],
        parameter_size: '20.9B',
        quantization_level: 'MXFP4',
      },
    },
    {
      name: 'mattw/pygmalion:latest',
      model: 'mattw/pygmalion:latest',
      modified_at: '2025-11-19T14:57:52.423266373-05:00',
      size: 3825517996,
      digest: '1bf1b3931a67cdd0b8fb9369a2077562e0e882eb279ffc4d914b6ae697ac5af8',
      details: {
        parent_model: '',
        format: '',
        family: 'llama',
        families: null,
        parameter_size: '7B',
        quantization_level: 'Q4_K_S',
      },
    },
    {
      name: 'nomic-embed-text:latest',
      model: 'nomic-embed-text:latest',
      modified_at: '2025-11-19T14:56:54.293341563-05:00',
      size: 274302450,
      digest: '0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f',
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'nomic-bert',
        families: ['nomic-bert'],
        parameter_size: '137M',
        quantization_level: 'F16',
      },
    },
    {
      name: 'llama3.2:latest',
      model: 'llama3.2:latest',
      modified_at: '2025-11-19T14:56:11.486660541-05:00',
      size: 2019393189,
      digest: 'a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72',
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'llama',
        families: ['llama'],
        parameter_size: '3.2B',
        quantization_level: 'Q4_K_M',
      },
    },
    {
      name: 'smollm2:135m',
      model: 'smollm2:135m',
      modified_at: '2025-11-19T14:54:01.447591673-05:00',
      size: 270898672,
      digest: '9077fe9d2ae1a4a41a868836b56b8163731a8fe16621397028c2c76f838c6907',
      details: {
        parent_model: '',
        format: 'gguf',
        family: 'llama',
        families: ['llama'],
        parameter_size: '134.52M',
        quantization_level: 'F16',
      },
    },
  ],
};

// Real /api/generate response (non-streaming)
export const realApiGenerateResponse = {
  model: 'smollm2:135m',
  created_at: '2026-02-02T18:43:06.789014531Z',
  response: 'Hello! How can I help you today?',
  done: true,
  done_reason: 'stop',
  context: [
    1, 9690, 198, 2683, 359, 253, 5356, 5646, 11173, 3365, 3511, 308, 34519, 28, 7018, 411, 407,
    19712, 8182, 2, 198, 1, 4093, 198, 19556, 2, 198, 1, 520, 9531, 198, 19556, 17, 1073, 416, 339,
    724, 346, 1834, 47,
  ],
  total_duration: 816687826,
  load_duration: 743002550,
  prompt_eval_count: 31,
  prompt_eval_duration: 30282845,
  eval_count: 10,
  eval_duration: 37673669,
};

// Real /api/chat response (non-streaming)
export const realApiChatResponse = {
  model: 'smollm2:135m',
  created_at: '2026-02-02T18:43:08.420463947Z',
  message: {
    role: 'assistant',
    content:
      "Welcome to our conversation. I'm here to help you navigate any situation that might be on your mind. What's been on your mind? Do you have something specific in mind related to the COVID-19 pandemic or perhaps a problem at home that requires some guidance?",
  },
  done: true,
  done_reason: 'stop',
  total_duration: 278611164,
  load_duration: 34207716,
  prompt_eval_count: 31,
  prompt_eval_duration: 4086156,
  eval_count: 55,
  eval_duration: 214376419,
};

// Real /api/embeddings response (truncated for brevity)
export const realApiEmbeddingsResponse = {
  embedding: [
    0.6651986241340637, 0.27006015181541443, -4.427126884460449, -0.2069551795721054,
    1.4544395208358765, 0.14282765984535217, 1.102286696434021, -0.0922856554389, 0.858975887298584,
    -0.6398410201072693, 0.11631111800670624, 1.5758349895477295,
    // ... 4096 dimensions total
  ],
};

// Real /api/version response
export const realApiVersionResponse = {
  version: '0.14.3',
};

// Real /api/ps response (empty in this case)
export const realApiPsResponse = {
  models: [],
};

// Error responses from real servers
export const realErrorResponses = {
  modelNotFound: {
    error: "model 'llama3:latest' not found",
  },
  oomError: {
    error: 'not enough ram',
  },
  runnerTerminated: {
    error: 'runner process has terminated',
  },
  timeout: {
    error: 'request timeout',
  },
  rateLimit: {
    error: 'rate limit exceeded',
  },
  badRequest: {
    error: 'invalid request',
  },
};
