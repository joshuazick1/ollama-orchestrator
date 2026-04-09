import { describe, it, expect } from 'vitest';
import { parseRetryAfter } from '../../src/utils/retry-after.js';

describe('parseRetryAfter', () => {
  describe('undefined/empty input', () => {
    it('should return null for undefined', () => {
      expect(parseRetryAfter(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseRetryAfter('')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(parseRetryAfter('   ')).toBeNull();
    });
  });

  describe('delta-seconds format', () => {
    it('should parse simple delta-seconds', () => {
      const result = parseRetryAfter('120');
      expect(result).toBe(120 * 1000); // 120 seconds = 120000 ms
    });

    it('should parse zero seconds', () => {
      const result = parseRetryAfter('0');
      expect(result).toBe(0);
    });

    it('should parse large delta-seconds', () => {
      const result = parseRetryAfter('3600');
      expect(result).toBe(3600 * 1000); // 1 hour = 3600000 ms
    });

    it('should handle whitespace around value', () => {
      const result = parseRetryAfter('  120  ');
      expect(result).toBe(120 * 1000);
    });

    it('should return null for negative delta-seconds', () => {
      expect(parseRetryAfter('-120')).toBeNull();
    });

    it('should return null for non-integer values', () => {
      expect(parseRetryAfter('120.5')).toBeNull();
    });

    it('should return null for non-numeric strings', () => {
      expect(parseRetryAfter('abc')).toBeNull();
    });
  });

  describe('HTTP-date format', () => {
    it('should parse HTTP-date in the future', () => {
      // Create a date 5 minutes in the future
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      const httpDateStr = futureDate.toUTCString();

      const result = parseRetryAfter(httpDateStr);
      expect(result).not.toBeNull();
      // Should be approximately 5 minutes (within 1 second tolerance)
      expect(result).toBeGreaterThanOrEqual(4 * 60 * 1000);
      expect(result).toBeLessThanOrEqual(6 * 60 * 1000);
    });

    it('should return 0 for HTTP-date in the past', () => {
      const pastDate = new Date(Date.now() - 60 * 1000);
      const httpDateStr = pastDate.toUTCString();

      const result = parseRetryAfter(httpDateStr);
      expect(result).toBe(0);
    });

    it('should parse standard HTTP-date format', () => {
      // Use a date definitely in the future (1 year from now)
      const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const httpDateStr = futureDate.toUTCString();

      const result = parseRetryAfter(httpDateStr);
      expect(result).not.toBeNull();
      expect(result).toBeGreaterThan(0);
    });

    it('should parse HTTP-date without day name', () => {
      // Use a date definitely in the future (1 year from now)
      const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const httpDateStr = futureDate.toUTCString().replace(/^[A-Za-z]{3},?\s+/, '');

      const result = parseRetryAfter(httpDateStr);
      expect(result).not.toBeNull();
      expect(result).toBeGreaterThan(0);
    });

    it('should cap HTTP-date more than 24 hours in future', () => {
      // A date 2 days in the future
      const farFutureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const httpDateStr = farFutureDate.toUTCString();

      const result = parseRetryAfter(httpDateStr);
      expect(result).toBe(24 * 60 * 60 * 1000); // Capped to 24 hours
    });
  });

  describe('invalid format', () => {
    it('should return null for completely invalid strings', () => {
      expect(parseRetryAfter('not a valid format')).toBeNull();
    });

    it('should return null for malformed HTTP-date', () => {
      expect(parseRetryAfter('invalid-date-string')).toBeNull();
    });

    it('should return null for random numbers mixed with text', () => {
      expect(parseRetryAfter('120abc')).toBeNull();
    });
  });

  describe('real-world examples', () => {
    it('should handle a typical Retry-After: 120 (2 minutes)', () => {
      const result = parseRetryAfter('120');
      expect(result).toBe(120000);
    });

    it('should handle Retry-After: 300 (5 minutes)', () => {
      const result = parseRetryAfter('300');
      expect(result).toBe(300000);
    });

    it('should handle Retry-After with service unavailable (503)', () => {
      // 503 responses often include Retry-After with seconds
      const result = parseRetryAfter('30');
      expect(result).toBe(30000);
    });
  });
});
