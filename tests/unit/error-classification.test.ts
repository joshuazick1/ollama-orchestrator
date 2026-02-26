/**
 * error-classification.test.ts
 * Tests for error classification functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ErrorClassifier,
  ErrorCategory,
  ErrorSeverity,
  ErrorType,
} from '../../src/utils/errorClassifier.js';

describe('Error Classification Tests', () => {
  let classifier: ErrorClassifier;

  beforeEach(() => {
    classifier = new ErrorClassifier();
    vi.clearAllMocks();
  });

  describe('Basic Classification - Timeout Errors', () => {
    it('should classify timeout errors as retryable and transient', () => {
      const result = classifier.classify('Request timeout');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
      expect(result.category).toBe(ErrorCategory.NETWORK);
    });

    it('should classify connection timeout as transient', () => {
      const result = classifier.classify('Connection timeout');
      expect(result.isRetryable).toBe(true);
      expect(result.type).toBe('transient');
    });

    it('should not circuit break on timeout', () => {
      const result = classifier.classify('timeout error');
      expect(result.shouldCircuitBreak).toBe(false);
    });
  });

  describe('Basic Classification - Connection Errors', () => {
    it('should classify connection refused as network error', () => {
      const result = classifier.classify('Connection refused');
      expect(result.isRetryable).toBe(true);
      expect(result.category).toBe(ErrorCategory.NETWORK);
    });

    it('should classify ECONNREFUSED as network error', () => {
      const result = classifier.classify('ECONNREFUSED');
      expect(result.isRetryable).toBe(true);
    });

    it('should classify ECONNRESET as network error', () => {
      const result = classifier.classify('ECONNRESET');
      expect(result.isRetryable).toBe(true);
    });
  });

  describe('Basic Classification - Rate Limit Errors', () => {
    it('should classify rate limit exceeded as retryable', () => {
      const result = classifier.classify('Rate limit exceeded');
      expect(result.isRetryable).toBe(true);
      expect(result.type).toBe('rateLimited');
    });

    it('should classify too many requests as transient', () => {
      const result = classifier.classify('too many requests');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
    });

    it('should circuit break on repeated rate limits', () => {
      const result = classifier.classify('rate limit');
      expect(result.shouldCircuitBreak).toBe(true);
    });
  });

  describe('Basic Classification - Auth Errors', () => {
    it('should classify authentication failed as non-retryable', () => {
      const result = classifier.classify('Authentication failed');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
      expect(result.category).toBe(ErrorCategory.AUTHENTICATION);
    });

    it('should classify unauthorized as non-retryable', () => {
      const result = classifier.classify('unauthorized');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
    });

    it('should classify forbidden as non-retryable', () => {
      const result = classifier.classify('forbidden');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
    });
  });

  describe('Basic Classification - Server Errors', () => {
    it('should classify internal server error as non-retryable', () => {
      const result = classifier.classify('Internal server error');
      expect(result.isRetryable).toBe(false);
    });

    it('should classify server errors with status in message', () => {
      const result = classifier.classify('Error 500');
      expect(result.isRetryable).toBe(true);
    });

    it('should classify 502 as transient', () => {
      const error = new Error('bad gateway') as any;
      error.status = 502;
      const result = classifier.classify(error);
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
    });

    it('should classify 503 as transient', () => {
      const error = new Error('service unavailable') as any;
      error.status = 503;
      const result = classifier.classify(error);
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
    });
  });

  describe('isRetryable Method', () => {
    it('should return true for timeout errors', () => {
      expect(classifier.isRetryable('timeout')).toBe(true);
    });

    it('should return false for authentication errors', () => {
      expect(classifier.isRetryable('authentication failed')).toBe(false);
    });

    it('should return true for rate limit errors', () => {
      expect(classifier.isRetryable('rate limit exceeded')).toBe(true);
    });

    it('should return true for connection refused', () => {
      expect(classifier.isRetryable('ECONNREFUSED')).toBe(true);
    });
  });

  describe('isTransient Method', () => {
    it('should return true for timeout errors', () => {
      expect(classifier.isTransient('timeout')).toBe(true);
    });

    it('should return true for connection errors', () => {
      expect(classifier.isTransient('connection refused')).toBe(true);
    });

    it('should return false for permanent errors', () => {
      expect(classifier.isTransient('not found')).toBe(false);
    });

    it('should return false for auth errors', () => {
      expect(classifier.isTransient('unauthorized')).toBe(false);
    });
  });

  describe('shouldCircuitBreak Method', () => {
    it('should return false for timeout errors', () => {
      expect(classifier.shouldCircuitBreak('timeout')).toBe(false);
    });

    it('should return true for repeated auth failures', () => {
      expect(classifier.shouldCircuitBreak('authentication failed')).toBe(true);
    });

    it('should return true for rate limits after repeated attempts', () => {
      expect(classifier.shouldCircuitBreak('rate limit')).toBe(true);
    });

    it('should return true for invalid model errors', () => {
      expect(classifier.shouldCircuitBreak('invalid model')).toBe(true);
    });
  });

  describe('getErrorType Method', () => {
    it('should return transient for timeout errors', () => {
      expect(classifier.getErrorType('timeout')).toBe('transient');
    });

    it('should return rateLimited for rate limit errors', () => {
      expect(classifier.getErrorType('rate limit')).toBe('rateLimited');
    });

    it('should return non-retryable for auth errors', () => {
      expect(classifier.getErrorType('unauthorized')).toBe('non-retryable');
    });

    it('should return transient for connection errors', () => {
      expect(classifier.getErrorType('connection refused')).toBe('transient');
    });
  });

  describe('HTTP Status Classification', () => {
    it('should classify 408 as transient', () => {
      const error = new Error('timeout') as any;
      error.status = 408;
      const result = classifier.classify(error);
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
    });

    it('should classify 429 as rateLimited', () => {
      const error = new Error('rate limit') as any;
      error.status = 429;
      const result = classifier.classify(error);
      expect(result.isRetryable).toBe(true);
      expect(result.type).toBe('rateLimited');
    });

    it('should classify 401 as non-retryable', () => {
      const error = new Error('unauthorized') as any;
      error.status = 401;
      const result = classifier.classify(error);
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
    });

    it('should classify 403 as non-retryable', () => {
      const error = new Error('forbidden') as any;
      error.status = 403;
      const result = classifier.classify(error);
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
    });

    it('should classify 504 as transient', () => {
      const error = new Error('gateway timeout') as any;
      error.status = 504;
      const result = classifier.classify(error);
      expect(result.isRetryable).toBe(true);
    });
  });

  describe('Ollama-Specific Errors', () => {
    it('should classify model not found as non-retryable', () => {
      const result = classifier.classify('model not found');
      expect(result.isRetryable).toBe(false);
    });

    it('should classify out of memory as non-retryable', () => {
      const result = classifier.classify('out of memory');
      expect(result.isRetryable).toBe(false);
      expect(result.category).toBe(ErrorCategory.RESOURCE);
    });
  });

  describe('OpenAI-Specific Errors', () => {
    it('should handle invalid API key', () => {
      const result = classifier.classify('invalid API key');
      expect(result.isRetryable).toBe(false);
    });
  });

  describe('Severity Classification', () => {
    it('should assign CRITICAL severity to model errors', () => {
      const result = classifier.classify('model not found');
      expect(result.severity).toBe(ErrorSeverity.CRITICAL);
    });

    it('should assign CRITICAL severity to auth errors', () => {
      const result = classifier.classify('authentication failed');
      expect(result.severity).toBe(ErrorSeverity.CRITICAL);
    });

    it('should assign MEDIUM severity to transient errors', () => {
      const result = classifier.classify('timeout');
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const result = classifier.classify('');
      expect(result).toBeDefined();
      expect(result.isRetryable).toBe(true);
    });

    it('should handle Error object', () => {
      const error = new Error('Test error');
      const result = classifier.classify(error);
      expect(result).toBeDefined();
      expect(result.isRetryable).toBe(true);
    });

    it('should handle object with message property', () => {
      const error = { message: 'Test error' } as any;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });

    it('should return valid classification for unknown errors', () => {
      const result = classifier.classify('completely unknown error xyz');
      expect(result.isRetryable).toBe(true);
      expect(result.shouldCircuitBreak).toBe(true);
    });
  });

  describe('Pattern Updates', () => {
    it('should update patterns and use them', () => {
      classifier.updatePatterns({
        nonRetryable: ['custom.*pattern'],
      });
      const patterns = classifier.getPatterns();
      expect(patterns.nonRetryable).toContain('custom.*pattern');
    });

    it('should get current patterns', () => {
      const patterns = classifier.getPatterns();
      expect(patterns.nonRetryable).toBeDefined();
      expect(patterns.transient).toBeDefined();
      expect(patterns.network).toBeDefined();
    });

    it('should classify custom pattern as non-retryable', () => {
      classifier.updatePatterns({
        nonRetryable: ['mycustomerror'],
      });
      const result = classifier.classify('mycustomerror happened');
      expect(result.isRetryable).toBe(false);
    });
  });

  describe('Dual Protocol Support', () => {
    it('should classify Ollama-specific errors', () => {
      const result = classifier.classify('llama.cpp error');
      expect(result).toBeDefined();
    });

    it('should classify OpenAI-specific errors', () => {
      const result = classifier.classify('openai error');
      expect(result).toBeDefined();
    });

    it('should provide retry strategy for each error type', () => {
      const result = classifier.classify('timeout');
      expect(result.retryStrategy).toBeDefined();
      expect(result.retryStrategy.maxAttempts).toBeGreaterThan(0);
      expect(result.retryStrategy.initialDelay).toBeGreaterThan(0);
    });
  });
});
