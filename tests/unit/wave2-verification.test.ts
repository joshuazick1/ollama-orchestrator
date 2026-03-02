import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimeoutManager } from '../../src/utils/timeout-manager.js';
import { classifyError } from '../../src/utils/errorClassifier.js';
import { parseOllamaError, parseOllamaErrorGlobal } from '../../src/utils/ollamaError.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('REC-67: Timeout EMA (Exponential Moving Average)', () => {
  let manager: TimeoutManager;

  beforeEach(() => {
    manager = new TimeoutManager({
      defaultTimeout: 60000,
      minTimeout: 10000,
      maxTimeout: 300000,
      slowRequestMultiplier: 1.5,
      activeTestMultiplier: 0.8,
    });
  });

  it('should allow timeout to decrease after fast responses (EMA)', () => {
    manager.updateFromResponseTime('server-1', 'model-a', 5000, false);

    const timeout1 = manager.getTimeout('server-1', 'model-a');

    manager.updateFromResponseTime('server-1', 'model-a', 5000, false);

    const timeout2 = manager.getTimeout('server-1', 'model-a');

    expect(timeout2).toBeLessThan(timeout1);
  });

  it('should allow timeout to increase after slow responses', () => {
    manager.updateFromResponseTime('server-1', 'model-a', 100000, false);

    const timeout1 = manager.getTimeout('server-1', 'model-a');

    expect(timeout1).toBeGreaterThan(60000);
  });

  it('should never go below minTimeout', () => {
    for (let i = 0; i < 100; i++) {
      manager.updateFromResponseTime('server-1', 'model-a', 100, false);
    }

    const timeout = manager.getTimeout('server-1', 'model-a');

    expect(timeout).toBeGreaterThanOrEqual(10000);
  });

  it('should use EMA formula: newTimeout = alpha * calculated + (1-alpha) * current', () => {
    const alpha = 0.3;
    const currentTimeout = 60000;
    const responseTimeMs = 5000;
    const multiplier = 1.5;
    const minTimeout = 10000;

    const calculatedTimeout = Math.max(minTimeout, Math.floor(responseTimeMs * multiplier));
    const expectedNewTimeout = alpha * calculatedTimeout + (1 - alpha) * currentTimeout;

    manager.updateFromResponseTime('server-1', 'model-a', responseTimeMs, false);
    const actualTimeout = manager.getTimeout('server-1', 'model-a');

    expect(actualTimeout).toBeCloseTo(expectedNewTimeout, -2);
  });
});

describe('REC-46: HTTP 500 Classification as Transient', () => {
  it('should classify HTTP 500 as transient (not retryable)', () => {
    const result = classifyError('HTTP 500');
    expect(result.type).toBe('transient');
    expect(result.isRetryable).toBe(true);
  });

  it('should classify HTTP 500 as NETWORK category', () => {
    const result = classifyError('HTTP 500');
    expect(result.category).toBe('network');
  });

  it('should classify HTTP 400 as non-retryable', () => {
    const result = classifyError('HTTP 400');
    expect(result.type).toBe('non-retryable');
  });

  it('should classify HTTP 401 as non-retryable', () => {
    const result = classifyError('HTTP 401');
    expect(result.type).toBe('non-retryable');
  });

  it('should classify HTTP 503 as retryable (service unavailable)', () => {
    const result = classifyError('HTTP 503');
    expect(result.isRetryable).toBe(true);
  });
});

describe('REC-44: OpenAI Nested Error Format Parsing', () => {
  it('should parse nested OpenAI error format {error: {message, type, code}}', async () => {
    const mockResponse = {
      status: 429,
      statusText: 'Too Many Requests',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          error: {
            message: 'Rate limit exceeded',
            type: 'tokens',
            code: 'rate_limit_exceeded',
          },
        })
      ),
    } as unknown as Response;

    const result = await parseOllamaError(mockResponse);

    expect(result).toBe('HTTP 429: Rate limit exceeded (tokens, rate_limit_exceeded)');
  });

  it('should parse nested error with only message', async () => {
    const mockResponse = {
      status: 500,
      statusText: 'Internal Server Error',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          error: {
            message: 'Something went wrong',
          },
        })
      ),
    } as unknown as Response;

    const result = await parseOllamaError(mockResponse);

    expect(result).toBe('HTTP 500: Something went wrong');
  });

  it('should still handle simple {error: "string"} format', async () => {
    const mockResponse = {
      status: 400,
      statusText: 'Bad Request',
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'Invalid model' })),
    } as unknown as Response;

    const result = await parseOllamaError(mockResponse);

    expect(result).toBe('HTTP 400: Invalid model');
  });

  it('should handle global Response format with nested error', async () => {
    const mockResponse = {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        get: vi.fn().mockReturnValue('application/json'),
      },
      json: vi.fn().mockResolvedValue({
        error: {
          message: 'Rate limit exceeded',
          type: 'tokens',
          code: 'rate_limit_exceeded',
        },
      }),
    } as unknown as globalThis.Response;

    const result = await parseOllamaErrorGlobal(mockResponse);

    expect(result).toBe('HTTP 429: Rate limit exceeded (tokens, rate_limit_exceeded)');
  });
});
