/**
 * circuit-breaker-helpers.test.ts
 * Tests for circuit breaker helper utilities
 */

import { Request } from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  shouldBypassCircuitBreaker,
  extractCircuitBreakerOptions,
} from '../../src/utils/circuit-breaker-helpers.js';

describe('circuit-breaker-helpers', () => {
  let mockReq: Partial<Request>;

  beforeEach(() => {
    mockReq = {
      query: {},
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('shouldBypassCircuitBreaker', () => {
    it('should return true when bypass query param is "true"', () => {
      mockReq.query = { bypass: 'true' };

      const result = shouldBypassCircuitBreaker(mockReq as Request);

      expect(result).toBe(true);
    });

    it('should return true when force query param is "true"', () => {
      mockReq.query = { force: 'true' };

      const result = shouldBypassCircuitBreaker(mockReq as Request);

      expect(result).toBe(true);
    });

    it('should return false when neither bypass nor force is "true"', () => {
      mockReq.query = { bypass: 'false', force: 'false' };

      const result = shouldBypassCircuitBreaker(mockReq as Request);

      expect(result).toBe(false);
    });

    it('should return false when no query params', () => {
      mockReq.query = {};

      const result = shouldBypassCircuitBreaker(mockReq as Request);

      expect(result).toBe(false);
    });
  });

  describe('extractCircuitBreakerOptions', () => {
    it('should extract bypass option with bypass reason', () => {
      mockReq.query = { bypass: 'true' };

      const result = extractCircuitBreakerOptions(mockReq as Request);

      expect(result).toEqual({ bypass: true, reason: 'bypass query param' });
    });

    it('should extract bypass option with force reason', () => {
      mockReq.query = { force: 'true' };

      const result = extractCircuitBreakerOptions(mockReq as Request);

      expect(result).toEqual({ bypass: true, reason: 'force query param' });
    });

    it('should return bypass false when no bypass params', () => {
      mockReq.query = {};

      const result = extractCircuitBreakerOptions(mockReq as Request);

      expect(result).toEqual({ bypass: false });
    });
  });
});
