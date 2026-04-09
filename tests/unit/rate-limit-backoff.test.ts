import { describe, it, expect } from 'vitest';
import { calculateRateLimitBackoff, calculateExponentialBackoff } from '../../src/utils/rate-limit-backoff.js';
import type { RateLimitConfig } from '../../src/config/schema.js';

describe('calculateRateLimitBackoff', () => {
  const defaultConfig: RateLimitConfig = {
    defaultRetryAfterMs: 60000,
    maxRetryAfterMs: 300000,
    enableRetryAfterHeader: true,
  };

  describe('Ollama provider', () => {
    it('should always use exponential backoff (no Retry-After support)', () => {
      const result = calculateRateLimitBackoff('ollama', '120', defaultConfig, 0);
      expect(result).toBe(60000);
    });

    it('should use exponential backoff with Retry-After header ignored', () => {
      const result = calculateRateLimitBackoff('ollama', '120', defaultConfig, 1);
      expect(result).toBe(120000);
    });

    it('should apply exponential backoff multiplier across attempts', () => {
      expect(calculateRateLimitBackoff('ollama', undefined, defaultConfig, 0)).toBe(60000);
      expect(calculateRateLimitBackoff('ollama', undefined, defaultConfig, 1)).toBe(120000);
      expect(calculateRateLimitBackoff('ollama', undefined, defaultConfig, 2)).toBe(240000);
    });

    it('should cap at maxRetryAfterMs', () => {
      const result = calculateRateLimitBackoff('ollama', undefined, defaultConfig, 10);
      expect(result).toBe(300000);
    });
  });

  describe('OpenAI provider', () => {
    it('should use Retry-After header when present and enabled', () => {
      const result = calculateRateLimitBackoff('openai', '120', defaultConfig, 0);
      expect(result).toBe(120000);
    });

    it('should use exponential backoff when Retry-After header is absent', () => {
      const result = calculateRateLimitBackoff('openai', undefined, defaultConfig, 0);
      expect(result).toBe(60000);
    });

    it('should use exponential backoff when Retry-After header is invalid', () => {
      const result = calculateRateLimitBackoff('openai', 'invalid', defaultConfig, 0);
      expect(result).toBe(60000);
    });

    it('should use exponential backoff when enableRetryAfterHeader is false', () => {
      const config: RateLimitConfig = { ...defaultConfig, enableRetryAfterHeader: false };
      const result = calculateRateLimitBackoff('openai', '120', config, 0);
      expect(result).toBe(60000);
    });

    it('should cap Retry-After value at maxRetryAfterMs', () => {
      const result = calculateRateLimitBackoff('openai', '600', defaultConfig, 0);
      expect(result).toBe(300000);
    });
  });

  describe('Anthropic provider', () => {
    it('should use Retry-After header when present and enabled', () => {
      const result = calculateRateLimitBackoff('anthropic', '60', defaultConfig, 0);
      expect(result).toBe(60000);
    });

    it('should use exponential backoff when Retry-After header is absent', () => {
      const result = calculateRateLimitBackoff('anthropic', undefined, defaultConfig, 0);
      expect(result).toBe(60000);
    });

    it('should use exponential backoff when Retry-After header is invalid', () => {
      const result = calculateRateLimitBackoff('anthropic', 'not-a-number', defaultConfig, 0);
      expect(result).toBe(60000);
    });

    it('should use exponential backoff when enableRetryAfterHeader is false', () => {
      const config: RateLimitConfig = { ...defaultConfig, enableRetryAfterHeader: false };
      const result = calculateRateLimitBackoff('anthropic', '60', config, 0);
      expect(result).toBe(60000);
    });
  });

  describe('HTTP-date format in Retry-After', () => {
    it('should handle HTTP-date Retry-After for OpenAI', () => {
      const futureDate = new Date(Date.now() + 120000).toUTCString();
      const result = calculateRateLimitBackoff('openai', futureDate, defaultConfig, 0);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(300000);
    });

    it('should handle HTTP-date Retry-After for Anthropic', () => {
      const futureDate = new Date(Date.now() + 60000).toUTCString();
      const result = calculateRateLimitBackoff('anthropic', futureDate, defaultConfig, 0);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(300000);
    });

    it('should handle past HTTP-date (returns 0)', () => {
      const pastDate = new Date(Date.now() - 60000).toUTCString();
      const result = calculateRateLimitBackoff('openai', pastDate, defaultConfig, 0);
      expect(result).toBe(0);
    });
  });

  describe('exponential backoff calculation', () => {
    it('should double delay with each attempt', () => {
      expect(calculateRateLimitBackoff('ollama', undefined, defaultConfig, 0)).toBe(60000);
      expect(calculateRateLimitBackoff('ollama', undefined, defaultConfig, 1)).toBe(120000);
      expect(calculateRateLimitBackoff('ollama', undefined, defaultConfig, 2)).toBe(240000);
    });

    it('should use custom base delay', () => {
      const config: RateLimitConfig = { ...defaultConfig, defaultRetryAfterMs: 30000 };
      expect(calculateRateLimitBackoff('ollama', undefined, config, 0)).toBe(30000);
      expect(calculateRateLimitBackoff('ollama', undefined, config, 1)).toBe(60000);
      expect(calculateRateLimitBackoff('ollama', undefined, config, 2)).toBe(120000);
    });
  });
});

describe('calculateExponentialBackoff', () => {
  it('should return base delay for attempt 0', () => {
    expect(calculateExponentialBackoff(0, 60000, 300000)).toBe(60000);
  });

  it('should apply multiplier of 2 per attempt', () => {
    expect(calculateExponentialBackoff(0, 1000, 100000)).toBe(1000);
    expect(calculateExponentialBackoff(1, 1000, 100000)).toBe(2000);
    expect(calculateExponentialBackoff(2, 1000, 100000)).toBe(4000);
    expect(calculateExponentialBackoff(3, 1000, 100000)).toBe(8000);
  });

  it('should cap at maxDelay', () => {
    expect(calculateExponentialBackoff(10, 60000, 300000)).toBe(300000);
  });

  it('should handle zero base delay', () => {
    expect(calculateExponentialBackoff(0, 0, 1000)).toBe(0);
    expect(calculateExponentialBackoff(1, 0, 1000)).toBe(0);
  });
});