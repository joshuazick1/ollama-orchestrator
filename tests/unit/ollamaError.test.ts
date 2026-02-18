/**
 * ollamaError.test.ts
 * Tests for Ollama error parsing utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseOllamaError, parseOllamaErrorGlobal } from '../../src/utils/ollamaError.js';

describe('ollamaError', () => {
  let mockLoggerError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLoggerError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseOllamaError', () => {
    it('should parse JSON error response with error field', async () => {
      const mockResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'Model not found' })),
      } as unknown as Response;

      const result = await parseOllamaError(mockResponse);

      expect(result).toBe('HTTP 500: Model not found');
    });

    it('should parse JSON error response with message field', async () => {
      const mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'Invalid request' })),
      } as unknown as Response;

      const result = await parseOllamaError(mockResponse);

      expect(result).toBe('HTTP 400: Invalid request');
    });

    it('should use text content when not JSON', async () => {
      const mockResponse = {
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('Not found error text'),
      } as unknown as Response;

      const result = await parseOllamaError(mockResponse);

      expect(result).toBe('HTTP 404: Not found error text');
    });

    it('should return status text for long text content', async () => {
      const longText = 'x'.repeat(600);
      const mockResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue(longText),
      } as unknown as Response;

      const result = await parseOllamaError(mockResponse);

      expect(result).toBe('HTTP 500: Internal Server Error');
    });

    it('should return status text when body read fails', async () => {
      const mockResponse = {
        status: 503,
        statusText: 'Service Unavailable',
        text: vi.fn().mockRejectedValue(new Error('Read failed')),
      } as unknown as Response;

      const result = await parseOllamaError(mockResponse);

      expect(result).toBe('HTTP 503: Service Unavailable');
    });

    it('should return status text for empty response', async () => {
      const mockResponse = {
        status: 204,
        statusText: 'No Content',
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response;

      const result = await parseOllamaError(mockResponse);

      expect(result).toBe('HTTP 204: No Content');
    });
  });

  describe('parseOllamaErrorGlobal', () => {
    it('should parse JSON error from global Response', async () => {
      const mockResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue({ error: 'Server error' }),
      } as unknown as globalThis.Response;

      const result = await parseOllamaErrorGlobal(mockResponse);

      expect(result).toBe('Server error');
    });

    it('should parse text error when not JSON', async () => {
      const mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        headers: {
          get: vi.fn().mockReturnValue('text/plain'),
        },
        text: vi.fn().mockResolvedValue('Bad request error'),
      } as unknown as globalThis.Response;

      const result = await parseOllamaErrorGlobal(mockResponse);

      expect(result).toBe('Bad request error');
    });

    it('should return status text when JSON has no error field', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue({}),
      } as unknown as globalThis.Response;

      const result = await parseOllamaErrorGlobal(mockResponse);

      expect(result).toBe('HTTP 200: OK');
    });

    it('should return status text for empty text', async () => {
      const mockResponse = {
        status: 204,
        statusText: 'No Content',
        headers: {
          get: vi.fn().mockReturnValue('text/plain'),
        },
        text: vi.fn().mockResolvedValue(''),
      } as unknown as globalThis.Response;

      const result = await parseOllamaErrorGlobal(mockResponse);

      expect(result).toBe('HTTP 204: No Content');
    });

    it('should handle exceptions and log error', async () => {
      const mockResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockRejectedValue(new Error('Parse failed')),
      } as unknown as globalThis.Response;

      const result = await parseOllamaErrorGlobal(mockResponse);

      expect(result).toBe('HTTP 500: Internal Server Error');
    });
  });
});
