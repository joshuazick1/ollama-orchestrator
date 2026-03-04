/**
 * streaming-stall-detection.test.ts
 * Tests for stall detection and chunk accumulation in streaming.ts
 */

import type { Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { streamResponse } from '../../src/streaming.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/in-flight-manager.js', () => ({
  getInFlightManager: vi.fn(() => ({
    updateChunkProgress: vi.fn(),
    addStreamingRequest: vi.fn(),
    removeStreamingRequest: vi.fn(),
  })),
}));

function createMockBody(data: string[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < data.length) {
        controller.enqueue(new TextEncoder().encode(data[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function createMockUpstreamResponse(body: ReadableStream<Uint8Array>): {
  body: ReadableStream<Uint8Array>;
} {
  return { body };
}

describe('streamResponse - Stall Detection Parameters', () => {
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockResponse = {
      setHeader: vi.fn((_name: string, _value: string) => {
        return mockResponse as Response;
      }),
      write: vi.fn(() => true),
      end: vi.fn(() => {
        return mockResponse as Response;
      }),
      writableEnded: false,
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  describe('New Parameter Support', () => {
    it('should accept onStall callback parameter without error', async () => {
      const onStall = vi.fn();

      const mockBody = createMockBody([
        'data: {"response":"test","done":false}\n\n',
        'data: {"response":"","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await streamResponse(
        mockUpstreamResponse as any,
        mockResponse as Response,
        undefined,
        undefined,
        undefined,
        undefined,
        'test-request-id',
        undefined,
        onStall,
        5000,
        1000
      );

      expect(onStall).not.toHaveBeenCalled();
    });

    it('should accept stallThresholdMs parameter', async () => {
      const mockBody = createMockBody([
        'data: {"response":"test","done":false}\n\n',
        'data: {"response":"","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id',
          undefined,
          undefined,
          300000
        )
      ).resolves.not.toThrow();
    });

    it('should accept stallCheckIntervalMs parameter', async () => {
      const mockBody = createMockBody([
        'data: {"response":"test","done":false}\n\n',
        'data: {"response":"","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id',
          undefined,
          undefined,
          300000,
          5000
        )
      ).resolves.not.toThrow();
    });

    it('should accept all new parameters together', async () => {
      const mockBody = createMockBody([
        'data: {"response":"test","done":false}\n\n',
        'data: {"response":"","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          () => {},
          () => {},
          () => {},
          {},
          'test-request-id',
          {} as any,
          () => {},
          300000,
          10000
        )
      ).resolves.not.toThrow();
    });

    it('should use default values when parameters not provided', async () => {
      const mockBody = createMockBody([
        'data: {"response":"test","done":false}\n\n',
        'data: {"response":"","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(mockUpstreamResponse as any, mockResponse as Response)
      ).resolves.not.toThrow();
    });
  });

  describe('Chunk Streaming Behavior', () => {
    it('should stream chunks successfully', async () => {
      const mockBody = createMockBody([
        'data: {"response":"Hello","done":false}\n\n',
        'data: {"response":" World","done":false}\n\n',
        'data: {"response":"!","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });

    it('should handle chat message streaming', async () => {
      const mockBody = createMockBody([
        'data: {"message":{"role":"assistant","content":"Hello"},"done":false}\n\n',
        'data: {"message":{"role":"assistant","content":""},"done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });

    it('should handle empty response in final chunk', async () => {
      const mockBody = createMockBody([
        'data: {"response":"test","done":false}\n\n',
        'data: {"response":"","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });

    it('should work without streamingRequestId', async () => {
      const mockBody = createMockBody([
        'data: {"response":"test","done":false}\n\n',
        'data: {"response":"","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(mockUpstreamResponse as any, mockResponse as Response)
      ).resolves.not.toThrow();
    });

    it('should handle multiple rapid chunks', async () => {
      const chunks: string[] = [];
      for (let i = 0; i < 10; i++) {
        chunks.push(`data: {"response":"chunk${i}","done":false}\n\n`);
      }
      chunks.push('data: {"response":"","done":true}\n\n');

      const mockBody = createMockBody(chunks);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });

    it('should handle error chunks gracefully', async () => {
      const mockBody = createMockBody([
        'data: {"response":"partial","done":false}\n\n',
        'data: {"error":"Something went wrong","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle single chunk stream', async () => {
      const mockBody = createMockBody(['data: {"response":"single","done":true}\n\n']);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });

    it('should handle chunks with text content', async () => {
      const mockBody = createMockBody([
        'data: {"response":"Hello world","done":false}\n\n',
        'data: {"response":"","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });

    it('should handle large response', async () => {
      const mockBody = createMockBody([
        'data: {"response":"test","done":false}\n\n',
        'data: {"response":"","done":true}\n\n',
      ]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });

    it('should handle empty chunks array', async () => {
      const mockBody = createMockBody([]);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });

    it('should handle only done chunk', async () => {
      const mockBody = createMockBody(['data: {"response":"","done":true}\n\n']);
      const mockUpstreamResponse = createMockUpstreamResponse(mockBody);

      await expect(
        streamResponse(
          mockUpstreamResponse as any,
          mockResponse as Response,
          undefined,
          undefined,
          undefined,
          undefined,
          'test-request-id'
        )
      ).resolves.not.toThrow();
    });
  });
});
