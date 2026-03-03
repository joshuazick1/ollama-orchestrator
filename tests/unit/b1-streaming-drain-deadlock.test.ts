/**
 * b1-streaming-drain-deadlock.test.ts
 *
 * Tests for B-1 fix: drain deadlock in streaming.ts.
 *
 * Root cause: when `clientResponse.write()` returned false (buffer full), the code
 * awaited `new Promise(resolve => clientResponse.once('drain', resolve))` which would
 * deadlock forever if the client disconnected or the TCP buffer never drained.
 *
 * The fix races the drain promise against abort/close/finish signals so the stream
 * loop always exits cleanly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { streamResponse } from '../../src/streaming.js';

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

/**
 * Create a mock ReadableStream body from an array of string chunks.
 * Each chunk is encoded to Uint8Array.
 */
function createMockBody(chunks: string[]) {
  let index = 0;
  return {
    getReader: () => ({
      read: vi.fn(async () => {
        if (index < chunks.length) {
          return {
            done: false,
            value: new TextEncoder().encode(chunks[index++]),
          };
        }
        return { done: true, value: undefined };
      }),
      cancel: vi.fn(),
    }),
  };
}

/**
 * Create a mock upstream Response (globalThis.Response shape)
 */
function createMockUpstreamResponse(body: any): Partial<globalThis.Response> {
  return {
    body: body as ReadableStream,
    status: 200,
    headers: new Headers({ 'content-type': 'application/x-ndjson' }),
  };
}

/**
 * Create a mock Express clientResponse as an EventEmitter so we can emit
 * 'drain', 'close', 'finish' events.
 */
function createMockClientResponse(opts?: {
  writeReturns?: boolean | boolean[];
  writableEnded?: boolean;
}) {
  const emitter = new EventEmitter();
  const writeResults = opts?.writeReturns;
  let writeCallCount = 0;

  const mock: any = Object.assign(emitter, {
    setHeader: vi.fn().mockReturnThis(),
    write: vi.fn((chunk: any) => {
      writeCallCount++;
      if (Array.isArray(writeResults)) {
        return writeResults[writeCallCount - 1] ?? true;
      }
      return writeResults ?? true;
    }),
    end: vi.fn().mockReturnThis(),
    writableEnded: opts?.writableEnded ?? false,
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    // EventEmitter methods are inherited
  });

  return mock;
}

describe('B-1: Streaming drain deadlock prevention', () => {
  describe('Normal drain behavior', () => {
    it('should complete normally when write returns true (no backpressure)', async () => {
      const body = createMockBody(['data: hello\n\n', 'data: world\n\n']);
      const upstream = createMockUpstreamResponse(body);
      const client = createMockClientResponse({ writeReturns: true });

      await streamResponse(upstream as any, client);

      expect(client.write).toHaveBeenCalledTimes(2);
    });

    it('should resume when drain event fires after backpressure', async () => {
      // First chunk returns false (backpressure), second returns true
      const body = createMockBody(['data: chunk1\n\n', 'data: chunk2\n\n']);
      const upstream = createMockUpstreamResponse(body);
      const client = createMockClientResponse({ writeReturns: [false, true] });

      // After a short delay, emit drain to unblock the promise
      const streamPromise = streamResponse(upstream as any, client);

      // Let the event loop turn so streamResponse reaches the drain wait
      await new Promise(r => setTimeout(r, 20));
      client.emit('drain');

      await streamPromise;

      expect(client.write).toHaveBeenCalledTimes(2);
    });
  });

  describe('Deadlock prevention via close event', () => {
    it('should unblock drain wait when client emits close', async () => {
      // write returns false to trigger drain wait
      const body = createMockBody(['data: chunk1\n\n', 'data: chunk2\n\n']);
      const upstream = createMockUpstreamResponse(body);
      const client = createMockClientResponse({ writeReturns: false });

      const streamPromise = streamResponse(upstream as any, client);

      // Wait for the stream to reach the drain wait
      await new Promise(r => setTimeout(r, 20));

      // Simulate client disconnect
      client.writableEnded = true;
      client.emit('close');

      // Stream should complete without deadlocking
      await streamPromise;
    });

    it('should unblock drain wait when client emits finish', async () => {
      const body = createMockBody(['data: chunk1\n\n']);
      const upstream = createMockUpstreamResponse(body);
      const client = createMockClientResponse({ writeReturns: false });

      const streamPromise = streamResponse(upstream as any, client);

      await new Promise(r => setTimeout(r, 20));

      client.writableEnded = true;
      client.emit('finish');

      await streamPromise;
    });
  });

  describe('Deadlock prevention via abort signal', () => {
    it('should unblock drain wait when abortController signal fires', async () => {
      const body = createMockBody(['data: chunk1\n\n']);
      const upstream = createMockUpstreamResponse(body);
      const client = createMockClientResponse({ writeReturns: false });

      const abortController = new AbortController();
      const activityController = {
        resetTimeout: vi.fn(),
        controller: abortController,
      };

      const streamPromise = streamResponse(
        upstream as any,
        client,
        undefined, // onFirstToken
        undefined, // onComplete
        undefined, // onChunk
        undefined, // ttftOptions
        'test-request-id', // streamingRequestId
        undefined, // existingTtftTracker
        undefined, // onStall
        undefined, // stallThresholdMs
        undefined, // stallCheckIntervalMs
        undefined, // onStreamEnd
        activityController
      );

      await new Promise(r => setTimeout(r, 20));

      // Abort should unblock the drain wait
      abortController.abort();

      // Should complete without deadlocking (will throw activity timeout error)
      await streamPromise.catch(() => {
        // Expected - abort causes error which is fine
      });
    });
  });

  describe('Cleanup behavior', () => {
    it('should remove event listeners after drain resolves', async () => {
      const body = createMockBody(['data: chunk1\n\n', 'data: chunk2\n\n']);
      const upstream = createMockUpstreamResponse(body);
      const client = createMockClientResponse({ writeReturns: [false, true] });

      const streamPromise = streamResponse(upstream as any, client);

      await new Promise(r => setTimeout(r, 20));

      // Track listener counts before drain
      const closeListenersBefore = client.listenerCount('close');
      const finishListenersBefore = client.listenerCount('finish');

      // Emit drain to unblock
      client.emit('drain');

      await streamPromise;

      // After completion, the extra listeners from the drain wait should be cleaned up.
      // The close/finish listeners added by the drain wait should have been removed.
      // Note: streamResponse may add its own listeners, so we check that they're not accumulating.
      const closeListenersAfter = client.listenerCount('close');
      const finishListenersAfter = client.listenerCount('finish');

      // Should not have leaked listeners (may be same or fewer due to cleanup)
      expect(closeListenersAfter).toBeLessThanOrEqual(closeListenersBefore);
      expect(finishListenersAfter).toBeLessThanOrEqual(finishListenersBefore);
    });

    it('should not call resolve twice when multiple events fire', async () => {
      const body = createMockBody(['data: chunk1\n\n']);
      const upstream = createMockUpstreamResponse(body);
      const client = createMockClientResponse({ writeReturns: false });

      const streamPromise = streamResponse(upstream as any, client);

      await new Promise(r => setTimeout(r, 20));

      // Emit both drain and close — only one should take effect (settled guard)
      client.emit('drain');
      client.writableEnded = true;
      client.emit('close');

      // Should complete without errors
      await streamPromise;
    });
  });

  describe('Timeout-based deadlock prevention', () => {
    it('should complete within timeout even with sustained backpressure + client close', async () => {
      // Create a body with many chunks, all causing backpressure
      const chunks = Array.from({ length: 10 }, (_, i) => `data: chunk${i}\n\n`);
      const body = createMockBody(chunks);
      const upstream = createMockUpstreamResponse(body);
      const client = createMockClientResponse({ writeReturns: false });

      const startTime = Date.now();
      const streamPromise = streamResponse(upstream as any, client);

      // After a short delay, close the client to break all drain waits
      setTimeout(() => {
        client.writableEnded = true;
        client.emit('close');
      }, 50);

      await streamPromise;

      const elapsed = Date.now() - startTime;
      // Should complete quickly (not hang for 120s+ like the old drain-only wait)
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
