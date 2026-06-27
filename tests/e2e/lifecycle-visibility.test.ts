import { test, expect, APIRequestContext } from '@playwright/test';

import { MockOllamaServer } from './mock-ollama-server.js';

class ExtendedMockOllamaServer extends MockOllamaServer {
  constructor(port: number = 11440, failureRate: number = 0) {
    super(port, failureRate);
    this.setupOpenAIEndpoints();
    this.setupAnthropicEndpoints();
  }

  private setupOpenAIEndpoints(): void {
    const app = (this as any).app;

    app.post('/v1/chat/completions', (req: any, res: any) => {
      const { messages, model, stream = false } = req.body;

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Transfer-Encoding': 'chunked',
        });

        const response = `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"${model}","choices":[{"index":0,"delta":{"content":"Hello! This is a streaming response."},"finish_reason":null}]}\n`;
        const done = `data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"${model}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`;

        setTimeout(() => {
          res.write(response);
          setTimeout(() => {
            res.write(done);
            res.end();
          }, 100);
        }, 50);
      } else {
        res.json({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Date.now(),
          model: model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello! This is a chat response.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        });
      }
    });

    app.post('/v1/completions', (req: any, res: any) => {
      const { prompt, model, stream = false } = req.body;

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Transfer-Encoding': 'chunked',
        });

        const response = `data: {"id":"compl-123","object":"text_completion","created":1234567890,"model":"${model}","choices":[{"text":"Hello! This is a streaming response.","index":0,"finish_reason":null}]}\n`;
        const done = `data: [DONE]\n\n`;

        setTimeout(() => {
          res.write(response);
          setTimeout(() => {
            res.write(done);
            res.end();
          }, 100);
        }, 50);
      } else {
        res.json({
          id: 'compl-123',
          object: 'text_completion',
          created: Date.now(),
          model: model,
          choices: [
            {
              text: 'Hello! This is a completion response.',
              index: 0,
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        });
      }
    });

    app.post('/v1/embeddings', (req: any, res: any) => {
      res.json({
        object: 'list',
        data: [
          {
            object: 'embedding',
            embedding: Array.from({ length: 1536 }, () => Math.random() - 0.5),
            index: 0,
          },
        ],
        model: req.body.model || 'text-embedding-ada-002',
        usage: {
          prompt_tokens: 8,
          total_tokens: 8,
        },
      });
    });
  }

  private setupAnthropicEndpoints(): void {
    const app = (this as any).app;

    app.post('/v1/messages', (req: any, res: any) => {
      const { messages, model, stream = false } = req.body;

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const response = `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"${model}","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n`;
        const contentBlock = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello! This is a streaming response."}}\n\n`;
        const messageDelta = `event: message_delta\ndata: {"type":"message_delta","index":0,"delta":{"type":"text_delta","text":""},"usage":{"input_tokens":10,"output_tokens":20}}\n\n`;
        const messageStop = `event: message_stop\ndata: {"type":"message_stop"}\n\n`;

        setTimeout(() => {
          res.write(response);
          setTimeout(() => {
            res.write(contentBlock);
            setTimeout(() => {
              res.write(messageDelta);
              setTimeout(() => {
                res.write(messageStop);
                res.end();
              }, 100);
            }, 100);
          }, 100);
        }, 50);
      } else {
        res.json({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Hello! This is an Anthropic message response.',
            },
          ],
          model: model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
          },
        });
      }
    });
  }
}

test.describe('Lifecycle Visibility E2E Tests', () => {
  let apiContext: APIRequestContext;
  let mockServer: ExtendedMockOllamaServer;
  const TEST_MODEL = 'llama2:7b';

  test.beforeAll(async ({ playwright }) => {
    mockServer = new ExtendedMockOllamaServer(11440);
    await mockServer.start();

    apiContext = await playwright.request.newContext({
      baseURL: 'http://localhost:5100',
    });

    const addResponse = await apiContext.post('/api/orchestrator/servers/add', {
      data: {
        id: 'lifecycle-test-server',
        url: mockServer.getUrl(),
        maxConcurrency: 4,
      },
    });

    if (!addResponse.ok()) {
      throw new Error(`Failed to add test server: ${await addResponse.text()}`);
    }
  });

  test.afterAll(async () => {
    await apiContext.dispose();
    await mockServer.stop();
  });

  test.beforeEach(async () => {
    await apiContext.post('/api/orchestrator/logs/clear');
  });

  test('1. Ollama /api/generate emits complete lifecycle chain', async () => {
    const response = await apiContext.post('/api/generate', {
      data: {
        model: TEST_MODEL,
        prompt: 'Say hello in one sentence.',
        stream: false,
      },
    });

    expect(response.ok()).toBeTruthy();

    const requestId = response.headers()['x-request-id'];
    expect(requestId).toBeDefined();
    expect(requestId.length).toBeGreaterThan(0);

    const body = await response.json();
    expect(body.response).toBeDefined();

    const logsResponse = await apiContext.get('/api/orchestrator/logs');
    expect(logsResponse.ok()).toBeTruthy();
    const logsData = await logsResponse.json();
    const logs = logsData.logs;

    const lifecycleEvents = logs.filter((log: any) => log.meta?.requestId === requestId);

    const eventNames = lifecycleEvents.map((log: any) => log.message);

    expect(eventNames).toContain('LIFECYCLE_RECEIVED');
    expect(eventNames).toContain('LIFECYCLE_VALIDATED');
    expect(eventNames).toContain('LIFECYCLE_SERVER_SELECTED');
    expect(eventNames).toContain('LIFECYCLE_UPSTREAM_STARTED');
    expect(eventNames).toContain('LIFECYCLE_UPSTREAM_FINISHED');

    const orderedEvents = [
      'LIFECYCLE_RECEIVED',
      'LIFECYCLE_VALIDATED',
      'LIFECYCLE_SERVER_SELECTED',
      'LIFECYCLE_UPSTREAM_STARTED',
      'LIFECYCLE_UPSTREAM_FINISHED',
    ];
    const orderedIndices = orderedEvents.map(event => eventNames.indexOf(event));
    for (let i = 1; i < orderedIndices.length; i++) {
      expect(orderedIndices[i]).toBeGreaterThan(orderedIndices[i - 1]);
    }
  });

  test('2. X-Request-Id header present in all endpoint responses', async () => {
    const endpoints = [
      {
        name: 'Ollama /api/generate',
        method: 'POST',
        path: '/api/generate',
        body: { model: TEST_MODEL, prompt: 'Hi', stream: false },
      },
      {
        name: 'Ollama /api/chat',
        method: 'POST',
        path: '/api/chat',
        body: { model: TEST_MODEL, messages: [{ role: 'user', content: 'Hi' }], stream: false },
      },
      {
        name: 'OpenAI /v1/chat/completions',
        method: 'POST',
        path: '/v1/chat/completions',
        body: { model: TEST_MODEL, messages: [{ role: 'user', content: 'Hi' }], stream: false },
      },
      {
        name: 'Anthropic /v1/messages',
        method: 'POST',
        path: '/v1/messages',
        body: { model: TEST_MODEL, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100 },
      },
    ];

    for (const endpoint of endpoints) {
      const response = await apiContext.post(endpoint.path, { data: endpoint.body });
      const requestId = response.headers()['x-request-id'];

      expect(requestId, `X-Request-Id missing for ${endpoint.name}`).toBeDefined();
      expect(requestId.length, `X-Request-Id empty for ${endpoint.name}`).toBeGreaterThan(0);
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  test('3. All endpoint formats emit lifecycle events', async () => {
    const endpoints = [
      {
        name: 'Ollama /api/generate',
        path: '/api/generate',
        body: { model: TEST_MODEL, prompt: 'Test', stream: false },
      },
      {
        name: 'Ollama /api/chat',
        path: '/api/chat',
        body: { model: TEST_MODEL, messages: [{ role: 'user', content: 'Test' }], stream: false },
      },
      {
        name: 'OpenAI /v1/chat/completions',
        path: '/v1/chat/completions',
        body: { model: TEST_MODEL, messages: [{ role: 'user', content: 'Test' }], stream: false },
      },
      {
        name: 'Anthropic /v1/messages',
        path: '/v1/messages',
        body: { model: TEST_MODEL, messages: [{ role: 'user', content: 'Test' }], max_tokens: 50 },
      },
    ];

    for (const endpoint of endpoints) {
      await apiContext.post('/api/orchestrator/logs/clear');

      const response = await apiContext.post(endpoint.path, { data: endpoint.body });
      const requestId = response.headers()['x-request-id'];

      const logsResponse = await apiContext.get('/api/orchestrator/logs');
      const logsData = await logsResponse.json();
      const logs = logsData.logs;

      const requestLogs = logs.filter((log: any) => log.meta?.requestId === requestId);

      const eventNames = requestLogs.map((log: any) => log.message);
      const hasReceived = eventNames.includes('LIFECYCLE_RECEIVED');
      const hasValidated = eventNames.includes('LIFECYCLE_VALIDATED');

      expect(hasReceived, `LIFECYCLE_RECEIVED missing for ${endpoint.name}`).toBeTruthy();
      expect(hasValidated, `LIFECYCLE_VALIDATED missing for ${endpoint.name}`).toBeTruthy();
    }
  });

  test('4. Lifecycle events include correct request metadata', async () => {
    const model = TEST_MODEL;

    const response = await apiContext.post('/api/generate', {
      data: {
        model,
        prompt: 'Hello world',
        stream: false,
      },
    });

    expect(response.ok()).toBeTruthy();
    const requestId = response.headers()['x-request-id'];

    const logsResponse = await apiContext.get('/api/orchestrator/logs');
    const logsData = await logsResponse.json();
    const logs = logsData.logs;

    const receivedEvent = logs.find(
      (log: any) => log.message === 'LIFECYCLE_RECEIVED' && log.meta?.requestId === requestId
    );

    expect(receivedEvent).toBeDefined();
    expect(receivedEvent.meta).toMatchObject({
      endpoint: '/api/generate',
      method: 'POST',
      model,
    });

    const finishedEvent = logs.find(
      (log: any) =>
        log.message === 'LIFECYCLE_UPSTREAM_FINISHED' && log.meta?.requestId === requestId
    );

    expect(finishedEvent).toBeDefined();
    expect(finishedEvent.meta.model).toBe(model);
    expect(finishedEvent.meta.serverId).toBeDefined();
    expect(finishedEvent.meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(finishedEvent.meta.status).toBeDefined();
  });

  test('5. Client-provided X-Request-Id is preserved throughout lifecycle', async () => {
    const clientRequestId = '11111111-2222-3333-4444-555555555555';

    const response = await apiContext.post('/api/generate', {
      data: {
        model: TEST_MODEL,
        prompt: 'Test request ID preservation',
        stream: false,
      },
      headers: {
        'X-Request-Id': clientRequestId,
      },
    });

    expect(response.ok()).toBeTruthy();

    const responseRequestId = response.headers()['x-request-id'];
    expect(responseRequestId).toBe(clientRequestId);

    const logsResponse = await apiContext.get('/api/orchestrator/logs');
    const logsData = await logsResponse.json();
    const logs = logsData.logs;

    const lifecycleEvents = logs.filter((log: any) => log.meta?.requestId === clientRequestId);

    expect(lifecycleEvents.length).toBeGreaterThan(0);

    for (const event of lifecycleEvents) {
      expect(event.meta.requestId).toBe(clientRequestId);
    }
  });
});
