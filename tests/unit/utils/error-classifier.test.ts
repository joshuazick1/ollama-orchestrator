import { describe, it, expect } from 'vitest';

import type { RetryConfig } from '../../../src/config/config.js';
import { ErrorClassifier } from '../../../src/utils/error-classifier.js';
import {
  formatError,
  isRetryableOnSameServer,
  transientPatterns,
} from '../../../src/utils/error-classifier.js';

describe('ErrorClassifier - quotaExhausted', () => {
  const classifier = new ErrorClassifier();

  describe('quota exhaustion detection', () => {
    it('classifies plain quota message as quotaExhausted', () => {
      const result = classifier.classify(
        'HTTP 429: you (amohsen2011) have reached your weekly usage limit, try again later'
      );
      expect(result.type).toBe('quotaExhausted');
      expect(result.isRetryable).toBe(true);
      expect(result.shouldCircuitBreak).toBe(true);
      expect(result.category).toBe('resource');
    });

    it('classifies wrapped quota message as quotaExhausted', () => {
      const result = classifier.classify(
        'HTTP 429: 429 Too Many Requests: you (p2pdojo) have reached your monthly usage limit, ... (api_error)'
      );
      expect(result.type).toBe('quotaExhausted');
      expect(result.isRetryable).toBe(true);
      expect(result.shouldCircuitBreak).toBe(true);
    });

    it('extracts quota info and uses extended retry strategy', () => {
      const result = classifier.classify(
        'HTTP 429: you (testuser123) have reached your daily usage limit'
      );
      expect(result.type).toBe('quotaExhausted');
      expect(result.severity).toBe('high');
      expect(result.retryStrategy.initialDelay).toBe(300000);
      expect(result.retryStrategy.backoffMultiplier).toBe(3);
    });
  });

  describe('plain 429 without quota format', () => {
    it('classifies generic 429 as rateLimited', () => {
      const result = classifier.classify('HTTP 429: Too Many Requests');
      expect(result.type).toBe('rateLimited');
      expect(result.isRetryable).toBe(true);
    });

    it('classifies rate limit message without quota pattern as rateLimited', () => {
      const result = classifier.classify('rate limit exceeded, please try again later');
      expect(result.type).toBe('rateLimited');
    });

    it('classifies 429 with bandwidth limit as rateLimited', () => {
      const result = classifier.classify('HTTP 429: bandwidth limit exceeded');
      expect(result.type).toBe('rateLimited');
    });
  });

  describe('quotaExhausted takes precedence over rateLimited', () => {
    it('message containing both quota pattern and 429 is classified as quotaExhausted', () => {
      const result = classifier.classify(
        'HTTP 429: you (someuser) have reached your weekly usage limit, rate limit exceeded'
      );
      expect(result.type).toBe('quotaExhausted');
    });
  });
});

describe('formatError', () => {
  it('returns the .message of an Error instance', () => {
    const error = new Error('something went wrong');
    expect(formatError(error)).toBe('something went wrong');
  });

  it('returns the .message of a custom Error subclass', () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }
    const error = new CustomError('custom failure');
    expect(formatError(error)).toBe('custom failure');
  });

  it('returns a plain string unchanged', () => {
    expect(formatError('plain string error')).toBe('plain string error');
  });

  it('returns String(error) for null', () => {
    expect(formatError(null)).toBe('null');
  });

  it('returns String(error) for undefined', () => {
    expect(formatError(undefined)).toBe('undefined');
  });

  it('returns String(error) for a number', () => {
    expect(formatError(42)).toBe('42');
  });

  it('returns String(error) for a plain object', () => {
    const obj = { code: 'E_FAIL' };
    expect(formatError(obj)).toBe(String(obj));
  });

  it('returns String(error) for a boolean', () => {
    expect(formatError(false)).toBe('false');
  });
});

describe('isRetryableOnSameServer', () => {
  const baseRetryConfig: RetryConfig = {
    maxRetriesPerServer: 2,
    retryDelayMs: 500,
    backoffMultiplier: 2,
    maxRetryDelayMs: 5000,
    retryableStatusCodes: [502, 503, 504],
    jitterFactor: 0.25,
    maxBudget: 10,
  };

  it('returns true when message contains a configured retryable status code', () => {
    expect(isRetryableOnSameServer('upstream returned HTTP 503', baseRetryConfig)).toBe(true);
    expect(isRetryableOnSameServer('HTTP 502 bad gateway', baseRetryConfig)).toBe(true);
    expect(isRetryableOnSameServer('HTTP 504 gateway timeout', baseRetryConfig)).toBe(true);
  });

  it('returns true when message contains the bare status code', () => {
    expect(isRetryableOnSameServer('error 503 occurred', baseRetryConfig)).toBe(true);
  });

  it('returns false when message has none of the configured status codes and no transient pattern', () => {
    expect(isRetryableOnSameServer('HTTP 400 bad request', baseRetryConfig)).toBe(false);
    expect(isRetryableOnSameServer('HTTP 404 not found', baseRetryConfig)).toBe(false);
    expect(isRetryableOnSameServer('something completely unrelated', baseRetryConfig)).toBe(false);
  });

  it('returns true when message matches a transient pattern (timeout)', () => {
    expect(isRetryableOnSameServer('request timeout after 30s', baseRetryConfig)).toBe(true);
  });

  it('returns true when message matches a transient pattern (rate limit)', () => {
    expect(isRetryableOnSameServer('rate limit exceeded, slow down', baseRetryConfig)).toBe(true);
  });

  it('returns true when message matches transient pattern (connection reset)', () => {
    expect(isRetryableOnSameServer('econnreset while reading from upstream', baseRetryConfig)).toBe(
      true
    );
  });

  it('returns true when message matches transient pattern (temporarily unavailable)', () => {
    expect(isRetryableOnSameServer('service is temporarily unavailable', baseRetryConfig)).toBe(
      true
    );
  });

  it('returns false when retryableStatusCodes is empty and no transient pattern matches', () => {
    const emptyCodesConfig: RetryConfig = { ...baseRetryConfig, retryableStatusCodes: [] };
    expect(isRetryableOnSameServer('HTTP 400 bad request', emptyCodesConfig)).toBe(false);
  });

  it('respects custom retryableStatusCodes', () => {
    const customConfig: RetryConfig = { ...baseRetryConfig, retryableStatusCodes: [418] };
    expect(isRetryableOnSameServer('HTTP 418 I am a teapot', customConfig)).toBe(true);
    expect(isRetryableOnSameServer('HTTP 503 service unavailable', customConfig)).toBe(false);
  });
});

describe('transientPatterns', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(transientPatterns)).toBe(true);
    expect(transientPatterns.length).toBeGreaterThanOrEqual(6);
  });

  it('contains only RegExp instances', () => {
    for (const pattern of transientPatterns) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  it('matches a timeout message', () => {
    const timeoutPattern = transientPatterns.find(p => /timeout/i.test(p.source));
    expect(timeoutPattern).toBeDefined();
    expect(timeoutPattern!.test('Request timeout after 10s')).toBe(true);
  });

  it('matches a rate limit message', () => {
    const rateLimitPattern = transientPatterns.find(p => /rate limit/i.test(p.source));
    expect(rateLimitPattern).toBeDefined();
    expect(rateLimitPattern!.test('rate limit exceeded')).toBe(true);
  });

  it('matches an econnreset message', () => {
    const econnPattern = transientPatterns.find(p => /econnreset/i.test(p.source));
    expect(econnPattern).toBeDefined();
    expect(econnPattern!.test('socket hang up econnreset')).toBe(true);
  });

  it('matches an etimedout message', () => {
    const etimedoutPattern = transientPatterns.find(p => /etimedout/i.test(p.source));
    expect(etimedoutPattern).toBeDefined();
    expect(etimedoutPattern!.test('connect etimedout 1.2.3.4:11434')).toBe(true);
  });

  it('matches a temporarily unavailable message', () => {
    const unavailablePattern = transientPatterns.find(p =>
      /temporarily unavailable/i.test(p.source)
    );
    expect(unavailablePattern).toBeDefined();
    expect(unavailablePattern!.test('service temporarily unavailable')).toBe(true);
  });

  it('does not match unrelated messages', () => {
    for (const pattern of transientPatterns) {
      expect(pattern.test('this is a perfectly fine request')).toBe(false);
    }
  });
});
