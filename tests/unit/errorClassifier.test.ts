import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ErrorClassifier,
  ErrorCategory,
  ErrorSeverity,
  ErrorType,
  classifyError,
  isRetryableError,
  isTransientError,
  getErrorClassifier,
  setErrorClassifier,
} from '../../src/utils/errorClassifier';

describe('ErrorClassifier', () => {
  let classifier: ErrorClassifier;

  beforeEach(() => {
    classifier = new ErrorClassifier();
  });

  afterEach(() => {
    setErrorClassifier(new ErrorClassifier());
  });

  describe('classify', () => {
    it('should classify model not found error as non-retryable', () => {
      const result = classifier.classify('model llama3 not found');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
      expect(result.type).toBe('non-retryable');
    });

    it('should classify unauthorized error as non-retryable', () => {
      const result = classifier.classify('authentication failed');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
      expect(result.category).toBe(ErrorCategory.AUTHENTICATION);
    });

    it('should classify out of memory as non-retryable', () => {
      const result = classifier.classify('out of memory');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
      expect(result.category).toBe(ErrorCategory.RESOURCE);
    });

    it('should classify connection error as transient', () => {
      const result = classifier.classify('connection refused');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
      expect(result.type).toBe('transient');
    });

    it('should classify timeout as transient', () => {
      const result = classifier.classify('request timed out');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
    });

    it('should classify rate limit error as retryable', () => {
      const result = classifier.classify('rate limit exceeded');
      expect(result.isRetryable).toBe(true);
      expect(result.type).toBe('rateLimited');
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should classify 429 as rate limited', () => {
      const result = classifier.classify('Error: 429 Too Many Requests');
      expect(result.isRetryable).toBe(true);
      expect(result.type).toBe('rateLimited');
    });

    it('should classify 500 as retryable', () => {
      const result = classifier.classify('HTTP 500');
      expect(result.isRetryable).toBe(true);
    });

    it('should classify 502 as transient', () => {
      const result = classifier.classify('Error: 502 Bad Gateway');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
    });

    it('should classify 503 as transient', () => {
      const result = classifier.classify('Error: 503 Service Unavailable');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
    });

    it('should classify 504 as transient', () => {
      const result = classifier.classify('Error: 504 Gateway Timeout');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(true);
    });

    it('should classify 400 as non-retryable', () => {
      const result = classifier.classify('Error: 400 Bad Request');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
    });

    it('should classify 401 as non-retryable', () => {
      const result = classifier.classify('Error: 401 Unauthorized');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
    });

    it('should classify 403 as non-retryable', () => {
      const result = classifier.classify('Error: 403 Forbidden');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
    });

    it('should classify 404 as non-retryable', () => {
      const result = classifier.classify('Error: 404 Not Found');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermanent).toBe(true);
    });

    it('should classify server overload as retryable but not transient', () => {
      const result = classifier.classify('server overloaded');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(false);
    });

    it('should classify temporary failure as retryable but not transient', () => {
      const result = classifier.classify('temporary failure');
      expect(result.isRetryable).toBe(true);
      expect(result.isTransient).toBe(false);
    });

    it('should return unknown category for unrecognized errors', () => {
      const result = classifier.classify('some random error message');
      expect(result.isRetryable).toBe(true);
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.shouldCircuitBreak).toBe(true);
    });

    it('should classify Error object', () => {
      const error = new Error('model not found');
      const result = classifier.classify(error);
      expect(result.isRetryable).toBe(false);
    });

    it('should return matched pattern in classification', () => {
      const result = classifier.classify('rate limit exceeded');
      expect(result.matchedPattern).toBeDefined();
    });
  });

  describe('isRetryable', () => {
    it('should return true for retryable errors', () => {
      expect(classifier.isRetryable('connection refused')).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      expect(classifier.isRetryable('model not found')).toBe(false);
    });
  });

  describe('isTransient', () => {
    it('should return true for transient errors', () => {
      expect(classifier.isTransient('timeout')).toBe(true);
    });

    it('should return false for non-transient errors', () => {
      expect(classifier.isTransient('unauthorized')).toBe(false);
    });
  });

  describe('shouldCircuitBreak', () => {
    it('should return true for errors that should open circuit', () => {
      expect(classifier.shouldCircuitBreak('model not found')).toBe(true);
    });

    it('should return false for transient errors', () => {
      expect(classifier.shouldCircuitBreak('timeout')).toBe(false);
    });

    it('should return false for ignore patterns', () => {
      const customClassifier = new ErrorClassifier({
        ignore: ['wrong model type'],
      });
      expect(customClassifier.shouldCircuitBreak('wrong model type')).toBe(false);
    });
  });

  describe('getErrorType', () => {
    it('should return correct error type', () => {
      expect(classifier.getErrorType('rate limit')).toBe('rateLimited');
      expect(classifier.getErrorType('model not found')).toBe('non-retryable');
      expect(classifier.getErrorType('timeout')).toBe('transient');
    });
  });

  describe('updatePatterns', () => {
    it('should add new patterns at runtime', () => {
      classifier.updatePatterns({
        nonRetryable: ['custom error'],
      });
      const result = classifier.classify('custom error');
      expect(result.isRetryable).toBe(false);
    });

    it('should preserve existing patterns when adding new ones', () => {
      classifier.updatePatterns({
        transient: ['new transient error'],
      });
      const result1 = classifier.classify('connection refused');
      const result2 = classifier.classify('new transient error');
      expect(result1.isTransient).toBe(true);
      expect(result2.isTransient).toBe(true);
    });
  });

  describe('getPatterns', () => {
    it('should return current patterns', () => {
      const patterns = classifier.getPatterns();
      expect(patterns).toHaveProperty('nonRetryable');
      expect(patterns).toHaveProperty('transient');
      expect(patterns).toHaveProperty('network');
      expect(patterns).toHaveProperty('resource');
      expect(patterns).toHaveProperty('ignore');
    });
  });

  describe('custom patterns', () => {
    it('should use custom patterns from constructor', () => {
      const custom = new ErrorClassifier({
        nonRetryable: ['custom-error'],
      });
      const result = custom.classify('custom-error');
      expect(result.isRetryable).toBe(false);
    });
  });
});

describe('Module-level functions', () => {
  afterEach(() => {
    setErrorClassifier(new ErrorClassifier());
  });

  it('classifyError should use default classifier', () => {
    const result = classifyError('model not found');
    expect(result.isRetryable).toBe(false);
  });

  it('isRetryableError should use default classifier', () => {
    expect(isRetryableError('connection refused')).toBe(true);
  });

  it('getErrorClassifier should return default instance', () => {
    const classifier = getErrorClassifier();
    expect(classifier).toBeInstanceOf(ErrorClassifier);
  });

  it('setErrorClassifier should replace default instance', () => {
    const custom = new ErrorClassifier({
      nonRetryable: ['my-error'],
    });
    setErrorClassifier(custom);
    const classifier = getErrorClassifier();
    expect(classifier.classify('my-error').isRetryable).toBe(false);
  });
});
