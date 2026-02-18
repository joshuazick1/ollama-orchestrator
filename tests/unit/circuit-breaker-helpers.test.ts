/**
 * circuit-breaker-helpers.test.ts
 * Tests for circuit breaker helper utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import {
  shouldBypassCircuitBreaker,
  extractCircuitBreakerOptions,
  calculateAdaptiveTimeout,
  shouldBypassWithFlag,
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

  describe('calculateAdaptiveTimeout', () => {
    it('should calculate timeout with default options', () => {
      const result = calculateAdaptiveTimeout(10000);

      expect(result).toBe(30000);
    });

    it('should use custom multiplier', () => {
      const result = calculateAdaptiveTimeout(10000, { multiplier: 5 });

      expect(result).toBe(50000);
    });

    it('should clamp to minTimeout', () => {
      const result = calculateAdaptiveTimeout(100, { minTimeout: 5000 });

      expect(result).toBe(5000);
    });

    it('should clamp to maxTimeout', () => {
      const result = calculateAdaptiveTimeout(500000, { maxTimeout: 60000 });

      expect(result).toBe(60000);
    });

    it('should use all custom options', () => {
      const result = calculateAdaptiveTimeout(10000, {
        minTimeout: 20000,
        maxTimeout: 100000,
        multiplier: 2,
      });

      expect(result).toBe(20000);
    });
  });

  describe('shouldBypassWithFlag', () => {
    it('should call shouldBypassCircuitBreaker', () => {
      mockReq.query = { bypass: 'true' };

      const result = shouldBypassWithFlag(mockReq as Request);

      expect(result).toBe(true);
    });
  });
});
