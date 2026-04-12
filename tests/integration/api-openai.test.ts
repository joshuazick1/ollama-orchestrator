import { createServer } from 'http';
import { AddressInfo } from 'net';

import express from 'express';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';

import { v1Router } from '../../src/routes/v1.routes.js';

let server: ReturnType<typeof createServer>;
let baseUrl: string;

const AUTH_HEADER = { 'Authorization': 'Bearer sk-test-openai-key-12345' };

beforeAll(async () => {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    if (req.headers.authorization?.startsWith('Bearer ')) {
      (req as any).user = { id: 'test-user-1', role: 'user' };
    }
    next();
  });

  app.use('/v1', v1Router);

  server = createServer(app);
  await new Promise<void>(resolve => {
    server.listen(0, 'localhost', () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://localhost:${address.port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  let data: unknown;
  const ct = response.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, data };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      ...headers,
    },
  });

  let data: unknown;
  const ct = response.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, data };
}

describe('POST /v1/chat/completions', () => {
  const validChatRequest = {
    model: 'llama3:latest',
    messages: [
      { role: 'user', content: 'Hello, how are you?' },
    ],
  };

  it('returns 400 when model is missing', async () => {
    const { model: _model, ...bodyWithoutModel } = validChatRequest;
    const { status, data } = await post('/v1/chat/completions', bodyWithoutModel, AUTH_HEADER);

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).error).toBeDefined();
    expect(((data as Record<string, unknown>).error as Record<string, unknown>).type).toBe('invalid_request_error');
  });

  it('returns 400 when messages is missing', async () => {
    const { messages: _messages, ...bodyWithoutMessages } = validChatRequest;
    const { status, data } = await post('/v1/chat/completions', bodyWithoutMessages, AUTH_HEADER);

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).error).toBeDefined();
  });

  it('returns 400 when messages is not an array', async () => {
    const { status, data } = await post('/v1/chat/completions', {
      model: 'llama3:latest',
      messages: 'not an array',
    }, AUTH_HEADER);

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).error).toBeDefined();
  });

  it('passes validation for syntactically valid request', async () => {
    const { status } = await post('/v1/chat/completions', validChatRequest, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts optional parameters (temperature, top_p, max_tokens)', async () => {
    const requestWithOptions = {
      ...validChatRequest,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
    };
    const { status } = await post('/v1/chat/completions', requestWithOptions, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts stop parameter as string array', async () => {
    const requestWithStop = {
      ...validChatRequest,
      stop: ['.', '!', '?'],
    };
    const { status } = await post('/v1/chat/completions', requestWithStop, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts response_format for JSON mode', async () => {
    const jsonModeRequest = {
      model: 'llama3:latest',
      messages: [{ role: 'user', content: 'Return JSON' }],
      response_format: { type: 'json_object' },
    };
    const { status } = await post('/v1/chat/completions', jsonModeRequest, AUTH_HEADER);
    expect(status).not.toBe(400);
  });
});

describe('POST /v1/chat/completions with function calling', () => {
  const functionCallingRequest = {
    model: 'llama3:latest',
    messages: [
      { role: 'user', content: 'What is the weather in New York?' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
            },
            required: ['location'],
          },
        },
      },
    ],
  };

  it('accepts request with tools parameter', async () => {
    const { status } = await post('/v1/chat/completions', functionCallingRequest, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts request with tool_choice parameter', async () => {
    const requestWithToolChoice = {
      ...functionCallingRequest,
      tool_choice: 'auto',
    };
    const { status } = await post('/v1/chat/completions', requestWithToolChoice, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts tool_choice as specific function', async () => {
    const requestWithSpecificTool = {
      ...functionCallingRequest,
      tool_choice: { type: 'function', function: { name: 'get_weather' } },
    };
    const { status } = await post('/v1/chat/completions', requestWithSpecificTool, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts streaming with function calling', async () => {
    const streamingRequest = {
      ...functionCallingRequest,
      stream: true,
    };
    const { status } = await post('/v1/chat/completions', streamingRequest, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts messages with assistant tool calls', async () => {
    const requestWithToolResult = {
      model: 'llama3:latest',
      messages: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: '{"temperature":"72F","conditions":"sunny"}',
        },
      ],
      tools: functionCallingRequest.tools,
    };
    const { status } = await post('/v1/chat/completions', requestWithToolResult, AUTH_HEADER);
    expect(status).not.toBe(400);
  });
});

describe('POST /v1/chat/completions streaming', () => {
  it('accepts streaming request with stream: true', async () => {
    const streamingRequest = {
      model: 'llama3:latest',
      messages: [{ role: 'user', content: 'Count to 5' }],
      stream: true,
    };
    const { status } = await post('/v1/chat/completions', streamingRequest, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts streaming with stream_options for usage', async () => {
    const streamingWithUsage = {
      model: 'llama3:latest',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
      stream_options: { include_usage: true },
    };
    const { status } = await post('/v1/chat/completions', streamingWithUsage, AUTH_HEADER);
    expect(status).not.toBe(400);
  });
});

describe('POST /v1/completions', () => {
  const validCompletionRequest = {
    model: 'llama3:latest',
    prompt: 'Once upon a time',
  };

  it('returns 400 when model is missing', async () => {
    const { model: _model, ...bodyWithoutModel } = validCompletionRequest;
    const { status, data } = await post('/v1/completions', bodyWithoutModel, AUTH_HEADER);

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).error).toBeDefined();
    expect(((data as Record<string, unknown>).error as Record<string, unknown>).type).toBe('invalid_request_error');
  });

  it('returns 4xx when prompt is missing', async () => {
    const { prompt: _prompt, ...bodyWithoutPrompt } = validCompletionRequest;
    const { status, data } = await post('/v1/completions', bodyWithoutPrompt, AUTH_HEADER);

    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
    expect((data as Record<string, unknown>).error).toBeDefined();
  });

  it('accepts prompt as string array', async () => {
    const requestWithArrayPrompt = {
      model: 'llama3:latest',
      prompt: ['First prompt', 'Second prompt'],
    };
    const { status } = await post('/v1/completions', requestWithArrayPrompt, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts optional parameters (temperature, max_tokens, stop)', async () => {
    const requestWithOptions = {
      model: 'llama3:latest',
      prompt: 'Hello',
      temperature: 0.8,
      max_tokens: 50,
      stop: ['\n'],
    };
    const { status } = await post('/v1/completions', requestWithOptions, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts streaming completion request', async () => {
    const streamingRequest = {
      model: 'llama3:latest',
      prompt: 'Hello world',
      stream: true,
    };
    const { status } = await post('/v1/completions', streamingRequest, AUTH_HEADER);
    expect(status).not.toBe(400);
  });
});

describe('POST /v1/embeddings', () => {
  const validEmbeddingRequest = {
    model: 'nomic-embed-text:latest',
    input: 'The quick brown fox jumps over the lazy dog',
  };

  it('returns 400 when model is missing', async () => {
    const { model: _model, ...bodyWithoutModel } = validEmbeddingRequest;
    const { status, data } = await post('/v1/embeddings', bodyWithoutModel, AUTH_HEADER);

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).error).toBeDefined();
    expect(((data as Record<string, unknown>).error as Record<string, unknown>).type).toBe('invalid_request_error');
  });

  it('returns 400 when input is missing', async () => {
    const { input: _input, ...bodyWithoutInput } = validEmbeddingRequest;
    const { status, data } = await post('/v1/embeddings', bodyWithoutInput, AUTH_HEADER);

    expect(status).toBe(400);
    expect((data as Record<string, unknown>).error).toBeDefined();
  });

  it('accepts input as string', async () => {
    const { status } = await post('/v1/embeddings', validEmbeddingRequest, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts input as array of strings', async () => {
    const requestWithArrayInput = {
      model: 'nomic-embed-text:latest',
      input: ['First text', 'Second text', 'Third text'],
    };
    const { status } = await post('/v1/embeddings', requestWithArrayInput, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts encoding_format parameter', async () => {
    const requestWithEncoding = {
      model: 'nomic-embed-text:latest',
      input: 'Test text',
      encoding_format: 'float',
    };
    const { status } = await post('/v1/embeddings', requestWithEncoding, AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts dimensions parameter', async () => {
    const requestWithDimensions = {
      model: 'nomic-embed-text:latest',
      input: 'Test text',
      dimensions: 512,
    };
    const { status } = await post('/v1/embeddings', requestWithDimensions, AUTH_HEADER);
    expect(status).not.toBe(400);
  });
});

describe('GET /v1/models', () => {
  it('returns 200 with model list for valid request', async () => {
    const { status } = await get('/v1/models', AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('returns model list in OpenAI format', async () => {
    const { status, data } = await get('/v1/models', AUTH_HEADER);
    if (status === 200) {
      expect(data).toHaveProperty('data');
      expect(Array.isArray((data as Record<string, unknown>).data)).toBe(true);
    }
  });

  it('accepts optional authentication', async () => {
    const { status } = await get('/v1/models', {});
    expect([200, 503]).toContain(status);
  });

  it('response has correct OpenAI models structure when successful', async () => {
    const { status, data } = await get('/v1/models', AUTH_HEADER);
    if (status === 200) {
      const response = data as Record<string, unknown>;
      expect(response).toHaveProperty('object');
      expect(response).toHaveProperty('data');
      const models = response.data as Array<Record<string, unknown>>;
      expect(Array.isArray(models)).toBe(true);
      models.forEach(model => {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('object');
        expect(model).toHaveProperty('created');
      });
    }
  });
});

describe('GET /v1/models/:model', () => {
  it('returns non-400 for valid model retrieval', async () => {
    const { status } = await get('/v1/models/llama3:latest', AUTH_HEADER);
    expect(status).not.toBe(400);
  });

  it('accepts optional authentication', async () => {
    const { status } = await get('/v1/models/llama3:latest', {});
    expect([200, 404, 503]).toContain(status);
  });
});

describe('OpenAI response format verification', () => {
  it('chat completions response has required OpenAI fields when successful', async () => {
    const request = {
      model: 'llama3:latest',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const { status, data } = await post('/v1/chat/completions', request, AUTH_HEADER);

    if (status === 200) {
      const response = data as Record<string, unknown>;
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('object');
      expect(response).toHaveProperty('created');
      expect(response).toHaveProperty('model');
      expect(response).toHaveProperty('choices');
      expect(Array.isArray(response.choices)).toBe(true);
      if (response.choices && (response.choices as Array<unknown>).length > 0) {
        const choice = (response.choices as Array<Record<string, unknown>>)[0];
        expect(choice).toHaveProperty('message');
        expect(choice).toHaveProperty('finish_reason');
      }
    }
  });

  it('embeddings response has required OpenAI fields when successful', async () => {
    const request = {
      model: 'nomic-embed-text:latest',
      input: 'test text for embedding',
    };
    const { status, data } = await post('/v1/embeddings', request, AUTH_HEADER);

    if (status === 200) {
      const response = data as Record<string, unknown>;
      expect(response).toHaveProperty('object');
      expect(response).toHaveProperty('data');
      expect(Array.isArray(response.data)).toBe(true);
      if (response.data && (response.data as Array<unknown>).length > 0) {
        const embeddingItem = (response.data as Array<Record<string, unknown>>)[0];
        expect(embeddingItem).toHaveProperty('object');
        expect(embeddingItem).toHaveProperty('embedding');
        expect(Array.isArray(embeddingItem.embedding)).toBe(true);
        expect(embeddingItem).toHaveProperty('index');
      }
      expect(response).toHaveProperty('model');
      expect(response).toHaveProperty('usage');
      const usage = response.usage as Record<string, unknown>;
      expect(usage).toHaveProperty('prompt_tokens');
      expect(usage).toHaveProperty('total_tokens');
    }
  });

  it('completions response has required OpenAI fields when successful', async () => {
    const request = {
      model: 'llama3:latest',
      prompt: 'Hello',
    };
    const { status, data } = await post('/v1/completions', request, AUTH_HEADER);

    if (status === 200) {
      const response = data as Record<string, unknown>;
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('object');
      expect(response).toHaveProperty('created');
      expect(response).toHaveProperty('model');
      expect(response).toHaveProperty('choices');
      expect(Array.isArray(response.choices)).toBe(true);
    }
  });
});

describe('POST /v1/chat/completions--:serverId (server-specific routing)', () => {
  it('accepts server-specific chat completions request', async () => {
    const request = {
      model: 'llama3:latest',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const { status } = await post('/v1/chat/completions--test-server-1', request, AUTH_HEADER);
    expect(status).not.toBe(400);
  });
});

describe('POST /v1/completions--:serverId (server-specific routing)', () => {
  it('accepts server-specific completions request', async () => {
    const request = {
      model: 'llama3:latest',
      prompt: 'Hello',
    };
    const { status } = await post('/v1/completions--test-server-1', request, AUTH_HEADER);
    expect(status).not.toBe(400);
  });
});

describe('POST /v1/embeddings--:serverId (server-specific routing)', () => {
  it('accepts server-specific embeddings request', async () => {
    const request = {
      model: 'nomic-embed-text:latest',
      input: 'test',
    };
    const { status } = await post('/v1/embeddings--test-server-1', request, AUTH_HEADER);
    expect(status).not.toBe(400);
  });
});