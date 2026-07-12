import { describe, it, expect } from 'vitest';
import { ErrorClassifier } from '../../../src/utils/error-classifier.js';

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
