import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runProbe } from './perf-probe-runner.js';

describe('perf-probe-runner', () => {
  const serverId = 'test-server-1';
  const model = 'llama3:latest';
  const serverUrl = 'http://localhost:11434';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should return successful result with TTFT and tokensPerSec on happy path', async () => {
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"ok","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"ok ","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: true,
          value: new TextEncoder().encode(
            '{"model":"llama3:latest","response":"ok","done":true,"eval_count":10,"eval_duration":1000000000,"total_duration":2000000000}'
          ),
        }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: mockBody,
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(true);
    expect(result.serverId).toBe(serverId);
    expect(result.model).toBe(model);
    expect(result.ttftMs).toBeDefined();
    expect(result.tokensPerSec).toBe(10); // eval_count=10, eval_duration=1e9ns=1s
    expect(result.totalDurationMs).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.errorType).toBeUndefined();
  });

  it('should return classification on HTTP error', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('http_error');
    expect(result.classification).toBeDefined();
    expect(result.error).toContain('500');
  });

  it('should return classification on timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.spyOn(global, 'fetch').mockRejectedValue(abortError);

    const result = await runProbe(serverId, model, serverUrl, { timeoutMs: 5000 });

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('timeout');
    expect(result.classification).toBeDefined();
    expect(result.error).toContain('Timeout');
  });

  it('should return classification on network error', async () => {
    const networkError = new Error('Failed to fetch');
    vi.spyOn(global, 'fetch').mockRejectedValue(networkError);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('network_error');
    expect(result.classification).toBeDefined();
    expect(result.error).toBe('Failed to fetch');
  });

  it('should return correct tokensPerSec calculation', async () => {
    // 20 tokens in 500ms = 40 tokens/sec
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"ok"}\n'),
        })
        .mockResolvedValueOnce({
          done: true,
          value: new TextEncoder().encode('{"eval_count":20,"eval_duration":500000000}'), // 500ms in ns
        }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: mockBody,
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(true);
    expect(result.tokensPerSec).toBe(40); // 20 tokens / 0.5s
  });

  it('should handle null response body', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      body: null,
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('http_error');
    expect(result.error).toBe('Response body is null');
  });

  it('should use default timeout of 10 seconds', async () => {
    const mockReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: new Uint8Array() }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: mockBody,
    };

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(mockResponse as unknown as Response);

    await runProbe(serverId, model, serverUrl);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('should use custom prompt when provided', async () => {
    const mockReader = {
      read: vi.fn().mockResolvedValue({ done: true, value: new Uint8Array() }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: mockBody,
    };

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(mockResponse as unknown as Response);

    await runProbe(serverId, model, serverUrl, { prompt: 'Custom test prompt' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({
        body: JSON.stringify({
          model,
          prompt: 'Custom test prompt',
          stream: true,
        }),
      })
    );
  });

  it('should return no valid response data error when eval_count missing', async () => {
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"ok"}\n'),
        })
        .mockResolvedValueOnce({
          done: true,
          value: new TextEncoder().encode('{"response":"ok","done":true}'), // missing eval_count
        }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: mockBody,
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(false);
    expect(result.error).toBe('No valid response data received');
  });

  it('should capture all Ollama duration fields on happy path', async () => {
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"o","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"k","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: true,
          value: new TextEncoder().encode(
            JSON.stringify({
              model: 'llama3:latest',
              response: 'ok',
              done: true,
              eval_count: 10,
              eval_duration: 500_000_000, // 500ms in ns
              prompt_eval_count: 5,
              prompt_eval_duration: 100_000_000, // 100ms in ns
              total_duration: 1_000_000_000, // 1s in ns
              load_duration: 200_000_000, // 200ms in ns (cold start)
            })
          ),
        }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: mockBody,
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(true);
    expect(result.evalCount).toBe(10);
    expect(result.evalDuration).toBe(500_000_000);
    expect(result.promptEvalDuration).toBe(100_000_000);
    expect(result.totalDuration).toBe(1_000_000_000);
    expect(result.loadDuration).toBe(200_000_000);
    expect(result.tokensPerSec).toBeCloseTo(20); // 10 tokens / 0.5s
  });

  it('should leave loadDuration undefined when warm (no load_duration field)', async () => {
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"o","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: true,
          value: new TextEncoder().encode(
            JSON.stringify({
              model: 'llama3:latest',
              response: 'ok',
              done: true,
              eval_count: 8,
              eval_duration: 400_000_000, // 400ms
              prompt_eval_count: 3,
              prompt_eval_duration: 50_000_000, // 50ms
              total_duration: 500_000_000, // 500ms total
              // no load_duration - warm model
            })
          ),
        }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: mockBody,
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(true);
    expect(result.loadDuration).toBeUndefined();
    expect(result.evalCount).toBe(8);
    expect(result.evalDuration).toBe(400_000_000);
    expect(result.totalDuration).toBe(500_000_000);
  });

  it('should track chunkCount and totalBytes from streaming', async () => {
    // 5 chunks of streaming response
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"H","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"He","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"Hel","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"Hell","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: true,
          value: new TextEncoder().encode(
            JSON.stringify({
              model: 'llama3:latest',
              response: 'Hello',
              done: true,
              eval_count: 5,
              eval_duration: 200_000_000, // 200ms
            })
          ),
        }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: mockBody,
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(true);
    expect(result.chunkCount).toBe(5);
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.evalCount).toBe(5);
  });

  it('should capture cold-start loadDuration when load_duration exceeds threshold', async () => {
    const mockReader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('{"response":"o","done":false}\n'),
        })
        .mockResolvedValueOnce({
          done: true,
          value: new TextEncoder().encode(
            JSON.stringify({
              model: 'llama3:latest',
              response: 'ok',
              done: true,
              eval_count: 12,
              eval_duration: 600_000_000, // 600ms
              prompt_eval_count: 4,
              prompt_eval_duration: 80_000_000, // 80ms
              total_duration: 5_000_000_000, // 5s total
              load_duration: 4_000_000_000, // 4s load time (cold start > 100ms)
            })
          ),
        }),
    };

    const mockBody = {
      getReader: () => mockReader,
    };

    const mockResponse = {
      ok: true,
      status: 200,
      body: mockBody,
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

    const result = await runProbe(serverId, model, serverUrl);

    expect(result.success).toBe(true);
    expect(result.loadDuration).toBe(4_000_000_000);
    expect(result.loadDuration).toBeGreaterThan(100_000_000); // > 100ms
    expect(result.evalDuration).toBe(600_000_000);
    expect(result.totalDuration).toBe(5_000_000_000);
    expect(result.evalCount).toBe(12);
  });
});
