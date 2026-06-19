import { describe, it, expect } from 'vitest';

import {
  classify,
  type Classification,
  type ClassificationContext,
} from '../../../src/probe/failure-classifier.js';

describe('FailureClassifier', () => {
  describe('HTTP Status Classifications', () => {
    it('classifies HTTP 429 as rate_limited with Retry-After seconds', () => {
      const result = classify(new Error('429 Too Many Requests'), {
        httpStatus: 429,
        retryAfterHeader: '120',
      });
      expect(result.kind).toBe('rate_limited');
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBe(120000);
    });

    it('classifies HTTP 429 with Retry-After HTTP date', () => {
      const futureDate = new Date(Date.now() + 60000).toUTCString();
      const result = classify(new Error('429 Too Many Requests'), {
        httpStatus: 429,
        retryAfterHeader: futureDate,
      });
      expect(result.kind).toBe('rate_limited');
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBeGreaterThan(50000);
    });

    it('classifies HTTP 429 without Retry-After header', () => {
      const result = classify(new Error('429 Too Many Requests'), { httpStatus: 429 });
      expect(result.kind).toBe('rate_limited');
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBeUndefined();
    });

    it('classifies HTTP 503 as transient with 5000ms retry', () => {
      const result = classify(new Error('503 Service Unavailable'), { httpStatus: 503 });
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBe(5000);
    });

    it('classifies HTTP 500 as transient', () => {
      const result = classify(new Error('500 Internal Server Error'), { httpStatus: 500 });
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('classifies HTTP 502 as transient', () => {
      const result = classify(new Error('502 Bad Gateway'), { httpStatus: 502 });
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('classifies HTTP 504 as transient', () => {
      const result = classify(new Error('504 Gateway Timeout'), { httpStatus: 504 });
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('classifies HTTP 400 as non_retryable', () => {
      const result = classify(new Error('400 Bad Request'), { httpStatus: 400 });
      expect(result.kind).toBe('non_retryable');
      expect(result.retryable).toBe(false);
    });

    it('classifies HTTP 404 as non_retryable', () => {
      const result = classify(new Error('404 Not Found'), { httpStatus: 404 });
      expect(result.kind).toBe('non_retryable');
      expect(result.retryable).toBe(false);
    });

    it('classifies HTTP 401 as permanent', () => {
      const result = classify(new Error('401 Unauthorized'), { httpStatus: 401 });
      expect(result.kind).toBe('permanent');
      expect(result.retryable).toBe(false);
    });

    it('classifies HTTP 403 as permanent', () => {
      const result = classify(new Error('403 Forbidden'), { httpStatus: 403 });
      expect(result.kind).toBe('permanent');
      expect(result.retryable).toBe(false);
    });
  });

  describe('Network Error Classifications', () => {
    it('classifies ECONNREFUSED as transient', () => {
      const result = classify(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('classifies ETIMEDOUT as transient', () => {
      const result = classify(new Error('request ETIMEDOUT'));
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('classifies ENOTFOUND as transient', () => {
      const result = classify(new Error('getaddrinfo ENOTFOUND invalid-host'));
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('classifies ECONNRESET as transient', () => {
      const result = classify(new Error('ECONNRESET'));
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });
  });

  describe('AbortError Classification', () => {
    it('classifies "AbortError" string as timeout', () => {
      const result = classify('AbortError');
      expect(result.kind).toBe('timeout');
      expect(result.retryable).toBe(true);
    });

    it('classifies error containing AbortError as timeout', () => {
      const result = classify(new Error('The operation was aborted (code: 20) AbortError'));
      expect(result.kind).toBe('timeout');
      expect(result.retryable).toBe(true);
    });
  });

  describe('Compatibility Error Classifications', () => {
    it('classifies "does not support generate" as non_retryable', () => {
      const result = classify(new Error('model does not support generate'));
      expect(result.kind).toBe('non_retryable');
      expect(result.retryable).toBe(false);
    });

    it('classifies "not support" pattern as non_retryable', () => {
      const result = classify(new Error('embedding model not support chat endpoint'));
      expect(result.kind).toBe('non_retryable');
      expect(result.retryable).toBe(false);
    });
  });

  describe('Default Classification', () => {
    it('classifies unknown errors as transient', () => {
      const result = classify(new Error('some unknown error'));
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('classifies empty error message as transient', () => {
      const result = classify(new Error(''));
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('handles string input instead of Error', () => {
      const result = classify('connection reset by peer');
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });
  });

  describe('No Side Effects', () => {
    it('does not mutate global state', () => {
      const error = new Error('test');
      classify(error, { httpStatus: 500 });
      expect(error.message).toBe('test');
    });

    it('produces consistent results for same input', () => {
      const error = new Error('500 Server Error');
      const context = { httpStatus: 500 };
      const result1 = classify(error, context);
      const result2 = classify(error, context);
      expect(result1).toEqual(result2);
    });
  });

  describe('Edge Cases', () => {
    it('extracts HTTP status from message when context not provided', () => {
      const result = classify(new Error('Error: 502 Bad Gateway at ...'));
      expect(result.kind).toBe('transient');
      expect(result.retryable).toBe(true);
    });

    it('prioritizes context httpStatus over extracted status', () => {
      const result = classify(new Error('Error: 500 Server Error'), { httpStatus: 429 });
      expect(result.kind).toBe('rate_limited');
    });

    it('handles decimal Retry-After values', () => {
      const result = classify(new Error('429 Too Many Requests'), {
        httpStatus: 429,
        retryAfterHeader: '30.5',
      });
      expect(result.retryAfterMs).toBe(30500);
    });

    it('ignores invalid Retry-After header values', () => {
      const result = classify(new Error('429 Too Many Requests'), {
        httpStatus: 429,
        retryAfterHeader: 'invalid',
      });
      expect(result.kind).toBe('rate_limited');
      expect(result.retryAfterMs).toBeUndefined();
    });
  });
});
