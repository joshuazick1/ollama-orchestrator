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

// Mock InFlightManager
vi.mock('../../src/utils/in-flight-manager.js', () => ({
  getInFlightManager: vi.fn(() => ({
    updateChunkProgress: vi.fn(),
    addStreamingRequest: vi.fn(),
    removeStreamingRequest: vi.fn(),
  })),
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
      setHeader: vi.fn((_name: string, _value: string) => {
        if (!headersSent) {
          headersSent = true;
        }
        return mockResponse as Response;
      }),
      write: vi.fn((chunk: Buffer) => {
        writtenChunks.push(chunk);
        return true;
      }),
      end: vi.fn(() => {
        responseEnded = true;
        return mockResponse as Response;
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

  it('should call onChunk callback with chunkCount on each chunk', async () => {
    const onChunk = vi.fn();
    const mockBody = createMockBody(['data: first\n\n', 'data: second\n\n', 'data: third\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      undefined,
      onChunk
    );

    // onChunk should be called with the current chunk count (1, 2, 3)
    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onChunk).toHaveBeenNthCalledWith(1, 1);
    expect(onChunk).toHaveBeenNthCalledWith(2, 2);
    expect(onChunk).toHaveBeenNthCalledWith(3, 3);
  });

  it('should call activityController.resetTimeout on each chunk', async () => {
    const resetTimeout = vi.fn();
    const controller = { abort: vi.fn(), signal: { aborted: false } };
    const activityController = {
      resetTimeout,
      controller: controller as unknown as AbortController,
    };
    const onChunk = vi.fn();
    const mockBody = createMockBody(['data: first\n\n', 'data: second\n\n', 'data: third\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    // Call with all parameters up to activityController
    await streamResponse(
      mockUpstreamResponse as any, // upstreamResponse
      mockResponse as Response, // clientResponse
      undefined, // onFirstToken
      undefined, // onComplete
      onChunk, // onChunk
      undefined, // ttftOptions
      undefined, // streamingRequestId
      undefined, // existingTtftTracker
      undefined, // onStall
      undefined, // stallThresholdMs
      undefined, // stallCheckIntervalMs
      undefined, // onStreamEnd
      activityController // activityController
    );

    // resetTimeout should be called once per chunk (3 times)
    expect(resetTimeout).toHaveBeenCalledTimes(3);
  });

  it('should track correct chunkCount in onComplete callback', async () => {
    const onComplete = vi.fn();
    const mockBody = createMockBody(['data: chunk1\n\n', 'data: chunk2\n\n', 'data: chunk3\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      onComplete
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
    const chunkData = onComplete.mock.calls[0][3];
    // Should have exactly 3 chunks, not more due to double counting
    expect(chunkData.chunkCount).toBe(3);
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
      expect.any(Number),
      expect.objectContaining({
        chunkCount: expect.any(Number),
        totalBytes: expect.any(Number),
        maxChunkGapMs: expect.any(Number),
        avgChunkSizeBytes: expect.any(Number),
      }),
      undefined // ollamaDurations — no done chunk with duration fields in this test
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
      return mockResponse as Response;
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

describe('streamResponse TTFT integration', () => {
  let mockResponse: Partial<Response>;
  let writtenChunks: Buffer[];

  beforeEach(() => {
    writtenChunks = [];
    mockResponse = {
      setHeader: vi.fn(),
      write: vi.fn((chunk: Buffer) => {
        writtenChunks.push(chunk);
        return true;
      }),
      end: vi.fn(),
      writableEnded: false,
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  it('should track chunk counts correctly without double counting', async () => {
    const chunkCounts: number[] = [];
    const onChunk: (chunkCount: number) => void = count => {
      chunkCounts.push(count);
    };
    const mockBody = createMockBody([
      'data: {"response":"H","done":false}\n\n',
      'data: {"response":"He","done":false}\n\n',
      'data: {"response":"Hel","done":false}\n\n',
      'data: {"response":"Hell","done":false}\n\n',
      'data: {"response":"Hello","done":true}\n\n',
    ]);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      undefined,
      onChunk
    );

    expect(chunkCounts).toEqual([1, 2, 3, 4, 5]);
  });

  it('should provide correct chunkCount in onComplete callback for single chunk', async () => {
    const onComplete = vi.fn();
    const mockBody = createMockBody(['data: {"response":"x","done":true}\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      onComplete
    );

    const chunkData = onComplete.mock.calls[0][3];
    expect(chunkData.chunkCount).toBe(1);
  });

  it('should provide correct chunkCount for empty response', async () => {
    const onComplete = vi.fn();
    const onChunk = vi.fn();
    const mockBody = createMockBody([]);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      onComplete,
      onChunk
    );

    expect(onChunk).not.toHaveBeenCalled();
    const chunkData = onComplete.mock.calls[0][3];
    expect(chunkData.chunkCount).toBe(0);
  });

  it('should call onChunk before onFirstToken for first chunk', async () => {
    const callOrder: string[] = [];
    const onFirstToken = () => callOrder.push('firstToken');
    const onChunk = () => callOrder.push('chunk');

    const mockBody = createMockBody(['data: {"response":"test","done":false}\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      onFirstToken,
      undefined,
      onChunk
    );

    expect(callOrder).toEqual(['chunk', 'firstToken']);
  });

  it('should handle multiple rapid chunks with correct timing', async () => {
    const onChunk = vi.fn();
    const mockBody = createMockBody(['data: chunk1\n\n', 'data: chunk2\n\n', 'data: chunk3\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      undefined,
      onChunk
    );

    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onChunk).toHaveBeenNthCalledWith(1, 1);
    expect(onChunk).toHaveBeenNthCalledWith(2, 2);
    expect(onChunk).toHaveBeenNthCalledWith(3, 3);
  });

  it('should handle malformed JSON chunks gracefully', async () => {
    const onComplete = vi.fn();
    const onChunk = vi.fn();
    const mockBody = createMockBody([
      'data: not json\n\n',
      'data: {"response":"valid","done":false}\n\n',
      'data: [DONE]\n\n',
    ]);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      onComplete,
      onChunk
    );

    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onComplete).toHaveBeenCalled();
  });

  it('should include totalBytes in onComplete callback', async () => {
    const onComplete = vi.fn();
    const mockBody = createMockBody(['data: {"response":"Hello","done":true,"eval_count":5}\n\n']);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      onComplete
    );

    const chunkData = onComplete.mock.calls[0][3];
    expect(chunkData.totalBytes).toBeGreaterThan(0);
  });

  it('should track maxChunkGapMs in onComplete callback', async () => {
    const onComplete = vi.fn();
    const mockBody = createMockBody([
      'data: {"response":"1","done":false}\n\n',
      'data: {"response":"2","done":true}\n\n',
    ]);
    const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

    await streamResponse(
      mockUpstreamResponse as any,
      mockResponse as Response,
      undefined,
      onComplete
    );

    const chunkData = onComplete.mock.calls[0][3];
    expect(chunkData.maxChunkGapMs).toBeDefined();
    expect(typeof chunkData.maxChunkGapMs).toBe('number');
  });

  describe('streamingRequestId parameter', () => {
    it('should accept streamingRequestId as 7th parameter and update InFlightManager', async () => {
      const { getInFlightManager } = await import('../../src/utils/in-flight-manager.js');
      const mockUpdateChunkProgress = vi.fn();
      (getInFlightManager as any).mockReturnValue({
        updateChunkProgress: mockUpdateChunkProgress,
        addStreamingRequest: vi.fn(),
        removeStreamingRequest: vi.fn(),
      });

      const mockBody = createMockBody(['data: chunk1\n\n', 'data: chunk2\n\n', 'data: chunk3\n\n']);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await streamResponse(
        mockUpstreamResponse as any,
        mockResponse as Response,
        undefined,
        undefined,
        undefined,
        undefined,
        'test-request-id-123'
      );

      expect(mockUpdateChunkProgress).toHaveBeenCalledTimes(3);
      expect(mockUpdateChunkProgress).toHaveBeenNthCalledWith(
        1,
        'test-request-id-123',
        1,
        '',
        undefined
      );
      expect(mockUpdateChunkProgress).toHaveBeenNthCalledWith(
        2,
        'test-request-id-123',
        2,
        '',
        undefined
      );
      expect(mockUpdateChunkProgress).toHaveBeenNthCalledWith(
        3,
        'test-request-id-123',
        3,
        '',
        undefined
      );
    });

    it('should update chunk progress with correct incrementing count', async () => {
      const { getInFlightManager } = await import('../../src/utils/in-flight-manager.js');
      const mockUpdateChunkProgress = vi.fn();
      (getInFlightManager as any).mockReturnValue({
        updateChunkProgress: mockUpdateChunkProgress,
        addStreamingRequest: vi.fn(),
        removeStreamingRequest: vi.fn(),
      });

      const mockBody = createMockBody([
        'data: first\n\n',
        'data: second\n\n',
        'data: third\n\n',
        'data: fourth\n\n',
        'data: fifth\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await streamResponse(
        mockUpstreamResponse as any,
        mockResponse as Response,
        undefined,
        undefined,
        undefined,
        undefined,
        'streaming-id-abc'
      );

      expect(mockUpdateChunkProgress).toHaveBeenCalledTimes(5);
      for (let i = 1; i <= 5; i++) {
        expect(mockUpdateChunkProgress).toHaveBeenNthCalledWith(
          i,
          'streaming-id-abc',
          i,
          '',
          undefined
        );
      }
    });

    it('should not call InFlightManager when streamingRequestId is not provided', async () => {
      const { getInFlightManager } = await import('../../src/utils/in-flight-manager.js');
      const mockUpdateChunkProgress = vi.fn();
      (getInFlightManager as any).mockReturnValue({
        updateChunkProgress: mockUpdateChunkProgress,
        addStreamingRequest: vi.fn(),
        removeStreamingRequest: vi.fn(),
      });

      const mockBody = createMockBody(['data: test\n\n']);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await streamResponse(
        mockUpstreamResponse as any,
        mockResponse as Response,
        undefined,
        undefined,
        undefined,
        undefined
      );

      expect(mockUpdateChunkProgress).not.toHaveBeenCalled();
    });

    it('should handle InFlightManager errors gracefully', async () => {
      const { getInFlightManager } = await import('../../src/utils/in-flight-manager.js');
      const mockUpdateChunkProgress = vi.fn(() => {
        throw new Error('InFlightManager error');
      });
      (getInFlightManager as any).mockReturnValue({
        updateChunkProgress: mockUpdateChunkProgress,
        addStreamingRequest: vi.fn(),
        removeStreamingRequest: vi.fn(),
      });

      const mockBody = createMockBody(['data: test\n\n']);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'error-test-id'
        )
      ).resolves.not.toThrow();
    });
  });
});

describe('parseSSEData edge cases', () => {
  it('should handle JSON parse errors gracefully', () => {
    const data = new TextEncoder().encode('data: {"incomplete":\n\n');
    const events = parseSSEData(data);
    expect(events).toHaveLength(1);
  });

  it('should handle multiple events in single data chunk', () => {
    const data = new TextEncoder().encode('data: {"e":1}\ndata: {"e":2}\n\n');
    const events = parseSSEData(data);
    expect(events).toHaveLength(2);
  });

  it('should handle events with newlines in content', () => {
    const data = new TextEncoder().encode('data: {"response":"line1\\nline2","done":false}\n\n');
    const events = parseSSEData(data);
    expect(events).toHaveLength(1);
    expect((events[0] as any).data.response).toBe('line1\nline2');
  });

  it('should handle empty lines between events', () => {
    const data = new TextEncoder().encode('data: {"e":1}\n\n\ndata: {"e":2}\n\n');
    const events = parseSSEData(data);
    expect(events).toHaveLength(2);
  });
});
