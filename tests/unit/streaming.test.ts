import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import {
  streamResponse,
  parseSSEData,
  isStreamingRequest,
  handleStreamWithRetry,
} from '../../src/streaming.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('streamResponse', () => {
  let mockResponse: Partial<Response>;
  let writtenChunks: Buffer[];
  let responseEnded: boolean;
  let headersSent: boolean;

  beforeEach(() => {
    writtenChunks = [];
    responseEnded = false;
    headersSent = false;

    mockResponse = {
      setHeader: vi.fn((name: string, value: string) => {
        if (!headersSent) {
          headersSent = true;
        }
      }),
      write: vi.fn((chunk: Buffer) => {
        writtenChunks.push(chunk);
        return true;
      }),
      end: vi.fn(() => {
        responseEnded = true;
      }),
      writableEnded: false,
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  it('should set SSE headers', async () => {
    const mockBody = createMockBody(['data: test\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(mockUpstreamResponse as any, mockResponse as Response);

    expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
  });

  it('should write chunks to response', async () => {
    const data = ['Hello', ' World', '!'];
    const mockBody = createMockBody(data.map(d => `data: ${d}\n\n`));
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(mockUpstreamResponse as any, mockResponse as Response);

    expect(writtenChunks.length).toBe(3);
    // Chunks are Uint8Arrays, convert to string for comparison
    const chunkStr = Buffer.from(writtenChunks[0]).toString();
    expect(chunkStr).toBe('data: Hello\n\n');
  });

  it('should call first token callback', async () => {
    const onFirstToken = vi.fn();
    const mockBody = createMockBody(['data: first\n\n', 'data: second\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(mockUpstreamResponse as any, mockResponse as Response, onFirstToken);

    expect(onFirstToken).toHaveBeenCalledTimes(1);
  });

  it('should call complete callback with duration and token count', async () => {
    const onComplete = vi.fn();
    const mockBody = createMockBody(['data: test\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      onComplete
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('should handle client disconnection gracefully', async () => {
    const mockBody = createMockBody(['data: test\n\n', 'data: more\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    // Simulate client disconnect after first chunk
    let callCount = 0;
    const responseProxy = new Proxy(mockResponse as any, {
      get(target, prop) {
        if (prop === 'writableEnded') {
          return callCount >= 1;
        }
        return target[prop];
      },
      set(target, prop, value) {
        if (prop === 'write') {
          const originalWrite = value;
          target.write = (chunk: Buffer) => {
            callCount++;
            return originalWrite(chunk);
          };
          return true;
        }
        target[prop] = value;
        return true;
      },
    });

    await streamResponse(mockUpstreamResponse as any, responseProxy as Response);

    expect(responseEnded).toBe(true);
  });

  it('should handle error without headers sent', async () => {
    const mockBody = {
      getReader: () => {
        throw new Error('Stream error');
      },
    };
    const mockUpstreamResponse = { body: mockBody } as any;

    await streamResponse(mockUpstreamResponse, mockResponse as Response);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Streaming failed',
      })
    );
  });

  it('should handle error with headers already sent', async () => {
    mockResponse.headersSent = true;
    const mockBody = {
      getReader: () => {
        throw new Error('Stream error');
      },
    };
    const mockUpstreamResponse = { body: mockBody } as any;

    await streamResponse(mockUpstreamResponse, mockResponse as Response);

    expect(mockResponse.status).not.toHaveBeenCalled();
    expect(responseEnded).toBe(true);
  });

  it('should wait for drain when buffer is full', async () => {
    let drainCalled = false;
    let writeCount = 0;

    const mockBody = createMockBody(['data: test1\n\n', 'data: test2\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    mockResponse.write = vi.fn((chunk: Buffer) => {
      writeCount++;
      if (writeCount === 1) {
        return false; // Buffer full
      }
      return true;
    });

    mockResponse.once = vi.fn((event: string, callback: () => void) => {
      if (event === 'drain') {
        setTimeout(callback, 10);
      }
    });

    await streamResponse(mockUpstreamResponse as any, mockResponse as Response);

    expect(mockResponse.once).toHaveBeenCalledWith('drain', expect.any(Function));
    expect(writeCount).toBe(2);
  });

  it('should log progress for long streams', async () => {
    const LOG_INTERVAL = 30000;
    vi.useFakeTimers();

    const mockBody = createMockBody(['data: test\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    const promise = streamResponse(mockUpstreamResponse as any, mockResponse as Response);

    await vi.advanceTimersByTimeAsync(LOG_INTERVAL + 1);

    await promise;
    vi.useRealTimers();

    expect(mockResponse.setHeader).toHaveBeenCalled();
  });

  it('should extract token counts from done chunk', async () => {
    const onComplete = vi.fn();
    const mockBody = createMockBody([
      'data: {"response":"hello","done":false}\n\n',
      'data: {"response":" world","done":true,"eval_count":10,"prompt_eval_count":5}\n\n',
    ]);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      onComplete
    );

    expect(onComplete).toHaveBeenCalled();
    const args = onComplete.mock.calls[0];
    expect(args[0]).toBeGreaterThanOrEqual(0);
    expect(typeof args[1]).toBe('number');
    expect(typeof args[2]).toBe('number');
  });

  it('should handle non-JSON done chunk gracefully', async () => {
    const onComplete = vi.fn();
    const mockBody = createMockBody(['data: plain text\n\n', 'data: [DONE]\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      onComplete
    );

    expect(onComplete).toHaveBeenCalled();
    const args = onComplete.mock.calls[0];
    expect(typeof args[1]).toBe('number');
  });
});

describe('parseSSEData', () => {
  it('should parse single SSE event', () => {
    const data = new TextEncoder().encode('data: {"message": "hello"}\n\n');
    const events = parseSSEData(data);

    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ message: 'hello' });
    expect(events[0].done).toBe(false);
  });

  it('should parse multiple SSE events', () => {
    const data = new TextEncoder().encode('data: {"msg": 1}\n\ndata: {"msg": 2}\n\n');
    const events = parseSSEData(data);

    expect(events).toHaveLength(2);
    expect(events[0].data).toEqual({ msg: 1 });
    expect(events[1].data).toEqual({ msg: 2 });
  });

  it('should handle [DONE] event', () => {
    const data = new TextEncoder().encode('data: [DONE]\n\n');
    const events = parseSSEData(data);

    expect(events).toHaveLength(1);
    expect(events[0].done).toBe(true);
  });

  it('should handle non-JSON data', () => {
    const data = new TextEncoder().encode('data: plain text\n\n');
    const events = parseSSEData(data);

    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('plain text');
  });

  it('should handle empty data', () => {
    const data = new Uint8Array(0);
    const events = parseSSEData(data);

    expect(events).toHaveLength(0);
  });

  it('should handle data without newline', () => {
    const data = new TextEncoder().encode('data: test');
    const events = parseSSEData(data);

    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('test');
  });
});

describe('isStreamingRequest', () => {
  it('should return true when stream is true', () => {
    expect(isStreamingRequest({ stream: true })).toBe(true);
  });

  it('should return false when stream is false', () => {
    expect(isStreamingRequest({ stream: false })).toBe(false);
  });

  it('should return false when stream is undefined', () => {
    expect(isStreamingRequest({})).toBe(false);
  });

  it('should return false when stream is not a boolean', () => {
    expect(isStreamingRequest({ stream: 'true' as any })).toBe(false);
  });
});

describe('handleStreamWithRetry', () => {
  it('should succeed on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await handleStreamWithRetry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('First failure'))
      .mockRejectedValueOnce(new Error('Second failure'))
      .mockResolvedValue('success');

    const onRetry = vi.fn();
    const result = await handleStreamWithRetry(fn, 3, onRetry);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
  });

  it('should throw after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

    await expect(handleStreamWithRetry(fn, 3)).rejects.toThrow('Always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should use default max retries of 3', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

    await expect(handleStreamWithRetry(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should handle non-error rejections', async () => {
    const fn = vi.fn().mockRejectedValue('string error');

    await expect(handleStreamWithRetry(fn, 1)).rejects.toThrow('string error');
  });

  it('should apply exponential backoff', async () => {
    const startTime = Date.now();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Retry 1'))
      .mockRejectedValueOnce(new Error('Retry 2'))
      .mockResolvedValue('success');

    await handleStreamWithRetry(fn, 3);

    const duration = Date.now() - startTime;
    // First retry: 200ms, second retry: 400ms
    expect(duration).toBeGreaterThanOrEqual(500);
  });
});

// Helper functions
function createMockBody(chunks: string[]): ReadableStream {
  let index = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (index >= chunks.length) {
          return { done: true, value: undefined };
        }
        const chunk = new TextEncoder().encode(chunks[index]);
        index++;
        return { done: false, value: chunk };
      },
      cancel: vi.fn(),
    }),
  } as any;
}

function createMockUpstreamResponse(body: ReadableStream): any {
  return {
    body,
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'content-type': 'text/event-stream',
    }),
  };
}
