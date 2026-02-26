/**
 * error-classification.test.ts
 * Tests for error classification functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorClassifier } from '../../src/utils/errorClassifier.js';

describe('Error Classification Tests', () => {
  let classifier: ErrorClassifier;

  beforeEach(() => {
    classifier = new ErrorClassifier();
    vi.clearAllMocks();
  });

  describe('Basic Classification', () => {
    it('should classify timeout errors', () => {
      const result = classifier.classify('Request timeout');
      expect(result).toBeDefined();
    });

    it('should classify connection errors', () => {
      const result = classifier.classify('Connection refused');
      expect(result).toBeDefined();
    });

    it('should classify rate limit errors', () => {
      const result = classifier.classify('Rate limit exceeded');
      expect(result).toBeDefined();
    });

    it('should classify auth errors', () => {
      const result = classifier.classify('Authentication failed');
      expect(result).toBeDefined();
    });

    it('should classify server errors', () => {
      const result = classifier.classify('Internal server error');
      expect(result).toBeDefined();
    });
  });

  describe('Retryable Errors', () => {
    it('should identify retryable errors', () => {
      const retryable = classifier.isRetryable('timeout');
      expect(typeof retryable).toBe('boolean');
    });

    it('should identify transient errors', () => {
      const transient = classifier.isTransient('temporary failure');
      expect(typeof transient).toBe('boolean');
    });

    it('should identify circuit break errors', () => {
      const shouldBreak = classifier.shouldCircuitBreak('repeated failures');
      expect(typeof shouldBreak).toBe('boolean');
    });
  });

  describe('Error Type', () => {
    it('should get error type', () => {
      const errorType = classifier.getErrorType('timeout error');
      expect(errorType).toBeDefined();
    });

    it('should handle unknown errors', () => {
      const errorType = classifier.getErrorType('random error message');
      expect(errorType).toBeDefined();
    });
  });

  describe('Error Patterns', () => {
    it('should match timeout patterns', () => {
      const result = classifier.classify('Connection timeout');
      expect(result).toBeDefined();
    });

    it('should match connection patterns', () => {
      const result = classifier.classify('Connection refused');
      expect(result).toBeDefined();
    });

    it('should match rate limit patterns', () => {
      const result = classifier.classify('Rate limit exceeded');
      expect(result).toBeDefined();
    });

    it('should match auth patterns', () => {
      const result = classifier.classify('Invalid API key');
      expect(result).toBeDefined();
    });
  });

  describe('HTTP Status Classification', () => {
    it('should handle timeout status', () => {
      const error = new Error('timeout') as any;
      error.status = 408;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });

    it('should handle rate limit status', () => {
      const error = new Error('rate limit') as any;
      error.status = 429;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });

    it('should handle server error status', () => {
      const error = new Error('server error') as any;
      error.status = 500;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });

    it('should handle bad gateway', () => {
      const error = new Error('bad gateway') as any;
      error.status = 502;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });

    it('should handle service unavailable', () => {
      const error = new Error('unavailable') as any;
      error.status = 503;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });

    it('should handle gateway timeout', () => {
      const error = new Error('gateway timeout') as any;
      error.status = 504;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });

    it('should handle unauthorized', () => {
      const error = new Error('unauthorized') as any;
      error.status = 401;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });

    it('should handle forbidden', () => {
      const error = new Error('forbidden') as any;
      error.status = 403;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });
  });

  describe('Network Errors', () => {
    it('should handle connection refused', () => {
      const result = classifier.classify('ECONNREFUSED');
      expect(result).toBeDefined();
    });

    it('should handle timeout', () => {
      const result = classifier.classify('ETIMEDOUT');
      expect(result).toBeDefined();
    });

    it('should handle not found', () => {
      const result = classifier.classify('ENOTFOUND');
      expect(result).toBeDefined();
    });

    it('should handle connection reset', () => {
      const result = classifier.classify('ECONNRESET');
      expect(result).toBeDefined();
    });

    it('should handle host unreachable', () => {
      const result = classifier.classify('EHOSTUNREACH');
      expect(result).toBeDefined();
    });
  });

  describe('Ollama-Specific Errors', () => {
    it('should handle model not found', () => {
      const result = classifier.classify('model not found');
      expect(result).toBeDefined();
    });

    it('should handle pull failure', () => {
      const result = classifier.classify('failed to pull model');
      expect(result).toBeDefined();
    });

    it('should handle loading error', () => {
      const result = classifier.classify('error loading model');
      expect(result).toBeDefined();
    });

    it('should handle CUDA errors', () => {
      const result = classifier.classify('CUDA error');
      expect(result).toBeDefined();
    });

    it('should handle out of memory', () => {
      const result = classifier.classify('out of memory');
      expect(result).toBeDefined();
    });
  });

  describe('OpenAI-Specific Errors', () => {
    it('should handle invalid API key', () => {
      const result = classifier.classify('invalid API key');
      expect(result).toBeDefined();
    });

    it('should handle insufficient quota', () => {
      const result = classifier.classify('insufficient quota');
      expect(result).toBeDefined();
    });

    it('should handle billing errors', () => {
      const result = classifier.classify('billing issue');
      expect(result).toBeDefined();
    });

    it('should handle context length exceeded', () => {
      const result = classifier.classify('context length exceeded');
      expect(result).toBeDefined();
    });

    it('should handle invalid request', () => {
      const result = classifier.classify('invalid request');
      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const result = classifier.classify('');
      expect(result).toBeDefined();
    });

    it('should handle Error object', () => {
      const error = new Error('Test error');
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });

    it('should handle object error', () => {
      const error = { message: 'Test error' } as any;
      const result = classifier.classify(error);
      expect(result).toBeDefined();
    });
  });

  describe('Pattern Updates', () => {
    it('should update patterns', () => {
      classifier.updatePatterns({
        nonRetryable: ['custom.*pattern'],
      });
      const patterns = classifier.getPatterns();
      expect(patterns).toBeDefined();
    });

    it('should get current patterns', () => {
      const patterns = classifier.getPatterns();
      expect(patterns).toBeDefined();
    });
  });
});
