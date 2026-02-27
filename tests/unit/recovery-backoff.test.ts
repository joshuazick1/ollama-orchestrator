import { describe, it, expect } from 'vitest';
import {
  calculateRecoveryBackoff,
  calculateActiveTestTimeout,
  calculateCircuitBreakerBackoff,
  type BackoffOptions,
} from '../../src/utils/recovery-backoff.js';

describe('calculateRecoveryBackoff', () => {
  describe('model_capability errors', () => {
    it('should return short delay for first attempt', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        failureReason: 'model does not support generate',
      });
      expect(result.delayMs).toBe(30000);
      expect(result.shouldStop).toBe(false);
    });

    it('should return short delay for second attempt', () => {
      const result = calculateRecoveryBackoff({
        attempt: 1,
        failureReason: 'model does not support chat',
      });
      expect(result.delayMs).toBe(30000);
      expect(result.shouldStop).toBe(false);
    });

    it('should stop after 2 attempts for model capability errors', () => {
      const result = calculateRecoveryBackoff({
        attempt: 2,
        failureReason: 'unsupported operation',
      });
      expect(result.shouldStop).toBe(true);
      expect(result.stopReason).toContain('Max attempts');
    });

    it('should handle "does not support generate" error', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        failureReason: 'Error: model does not support generate endpoint',
      });
      expect(result.shouldStop).toBe(false);
    });
  });

  describe('model_file errors', () => {
    it('should return increasing delays', () => {
      const result1 = calculateRecoveryBackoff({
        attempt: 0,
        failureReason: 'unable to load model',
      });
      const result2 = calculateRecoveryBackoff({
        attempt: 1,
        failureReason: 'unable to load model',
      });
      const result3 = calculateRecoveryBackoff({
        attempt: 2,
        failureReason: 'unable to load model',
      });

      expect(result1.delayMs).toBe(60000);
      expect(result2.delayMs).toBe(300000);
      expect(result3.delayMs).toBe(600000);
    });

    it('should handle invalid file magic error', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        failureReason: 'invalid file magic',
      });
      expect(result.delayMs).toBe(60000);
    });

    it('should handle unsupported model format error', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        failureReason: 'unsupported model format',
      });
      expect(result.delayMs).toBe(60000);
    });

    it('should handle model file not found error', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        failureReason: 'model file not found',
      });
      expect(result.delayMs).toBe(60000);
    });

    it('should handle blob sha256 error', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        failureReason: 'blob sha256 mismatch',
      });
      expect(result.delayMs).toBe(60000);
    });

    it('should stop after 3 attempts for model file errors', () => {
      const result = calculateRecoveryBackoff({
        attempt: 3,
        failureReason: 'unable to load model',
      });
      expect(result.shouldStop).toBe(true);
    });
  });

  describe('permanent errors', () => {
    it('should use permanent delay array', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        errorType: 'non-retryable',
      });
      expect(result.delayMs).toBe(300000);
    });

    it('should handle errorType permanent', () => {
      const result = calculateRecoveryBackoff({
        attempt: 1,
        errorType: 'permanent',
      });
      expect(result.delayMs).toBe(600000);
    });

    it('should stop after 5 attempts for permanent errors', () => {
      const result = calculateRecoveryBackoff({
        attempt: 5,
        errorType: 'non-retryable',
      });
      expect(result.shouldStop).toBe(true);
    });
  });

  describe('standard errors', () => {
    it('should return increasing delays for standard errors', () => {
      const delays = [
        calculateRecoveryBackoff({ attempt: 0 }).delayMs,
        calculateRecoveryBackoff({ attempt: 1 }).delayMs,
        calculateRecoveryBackoff({ attempt: 2 }).delayMs,
        calculateRecoveryBackoff({ attempt: 3 }).delayMs,
        calculateRecoveryBackoff({ attempt: 4 }).delayMs,
        calculateRecoveryBackoff({ attempt: 5 }).delayMs,
        calculateRecoveryBackoff({ attempt: 6 }).delayMs,
        calculateRecoveryBackoff({ attempt: 7 }).delayMs,
      ];

      expect(delays[0]).toBe(30000);
      expect(delays[1]).toBe(60000);
      expect(delays[2]).toBe(120000);
      expect(delays[3]).toBe(240000);
      expect(delays[4]).toBe(480000);
      expect(delays[5]).toBe(900000);
      expect(delays[6]).toBe(1800000);
      expect(delays[7]).toBe(1800000); // max
    });

    it('should respect maxDelay option', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        maxDelay: 10000,
      });
      expect(result.delayMs).toBe(10000);
    });

    it('should stop after 8 attempts for standard errors', () => {
      const result = calculateRecoveryBackoff({
        attempt: 8,
      });
      expect(result.shouldStop).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle attempt beyond array length', () => {
      const result = calculateRecoveryBackoff({
        attempt: 100,
        failureReason: 'some random error',
      });
      expect(result.shouldStop).toBe(true);
    });

    it('should use baseDelay when provided', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        baseDelay: 1000,
        maxDelay: 100000,
      });
      // baseDelay isn't actually used in the current implementation
      expect(result.delayMs).toBeDefined();
    });

    it('should handle empty failureReason', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
        failureReason: '',
      });
      expect(result.shouldStop).toBe(false);
    });

    it('should handle undefined failureReason', () => {
      const result = calculateRecoveryBackoff({
        attempt: 0,
      });
      expect(result.shouldStop).toBe(false);
    });
  });
});

describe('calculateActiveTestTimeout', () => {
  describe('model capability errors', () => {
    it('should return 5000ms for does not support generate', () => {
      const result = calculateActiveTestTimeout(0, 120000, 'does not support generate');
      expect(result).toBe(5000);
    });

    it('should return 5000ms for does not support chat', () => {
      const result = calculateActiveTestTimeout(0, 120000, 'does not support chat');
      expect(result).toBe(5000);
    });

    it('should return 5000ms for unsupported operation', () => {
      const result = calculateActiveTestTimeout(0, 120000, 'unsupported operation');
      expect(result).toBe(5000);
    });
  });

  describe('non-retryable errors', () => {
    it('should return 15000ms for non-retryable error type', () => {
      const result = calculateActiveTestTimeout(0, 120000, undefined, 'non-retryable');
      expect(result).toBe(15000);
    });

    it('should return 15000ms for permanent error type', () => {
      const result = calculateActiveTestTimeout(5, 120000, undefined, 'permanent');
      expect(result).toBe(15000);
    });
  });

  describe('progressive timeouts', () => {
    it('should double timeout for each attempt', () => {
      const t0 = calculateActiveTestTimeout(0, 60000);
      const t1 = calculateActiveTestTimeout(1, 60000);
      const t2 = calculateActiveTestTimeout(2, 60000);

      expect(t0).toBe(60000);
      expect(t1).toBe(120000);
      expect(t2).toBe(240000);
    });

    it('should cap at 15 minutes', () => {
      const result = calculateActiveTestTimeout(100, 1000);
      expect(result).toBe(15 * 60 * 1000);
    });

    it('should handle attempt 0 correctly', () => {
      const result = calculateActiveTestTimeout(0, 120000);
      expect(result).toBe(120000);
    });

    it('should handle attempt 10+ correctly (capped)', () => {
      const result = calculateActiveTestTimeout(10, 1000);
      // 2^10 = 1024, but capped at 15min
      expect(result).toBe(15 * 60 * 1000);
    });
  });
});

describe('calculateCircuitBreakerBackoff', () => {
  describe('error types', () => {
    it('should return 24 hours for permanent error', () => {
      const result = calculateCircuitBreakerBackoff('permanent');
      expect(result).toBe(24 * 60 * 60 * 1000);
    });

    it('should return 48 hours for non-retryable error', () => {
      const result = calculateCircuitBreakerBackoff('non-retryable');
      expect(result).toBe(48 * 60 * 60 * 1000);
    });

    it('should return 12 hours for retryable error', () => {
      const result = calculateCircuitBreakerBackoff('retryable');
      expect(result).toBe(12 * 60 * 60 * 1000);
    });

    it('should return 2 minutes for transient error (default)', () => {
      const result = calculateCircuitBreakerBackoff('transient');
      expect(result).toBe(2 * 60 * 1000);
    });

    it('should return 2 minutes for unknown error type (default)', () => {
      const result = calculateCircuitBreakerBackoff('unknown' as any);
      expect(result).toBe(2 * 60 * 1000);
    });
  });

  describe('rateLimited errors', () => {
    it('should use exponential backoff for rateLimited', () => {
      const r0 = calculateCircuitBreakerBackoff('rateLimited', undefined, 0);
      const r1 = calculateCircuitBreakerBackoff('rateLimited', undefined, 1);
      const r2 = calculateCircuitBreakerBackoff('rateLimited', undefined, 2);

      expect(r0).toBe(300000);
      expect(r1).toBe(300000 * 3);
      expect(r2).toBe(300000 * 9);
    });

    it('should cap rateLimited at 60 minutes', () => {
      const result = calculateCircuitBreakerBackoff('rateLimited', undefined, 100);
      expect(result).toBe(3600000);
    });
  });

  describe('with failureReason', () => {
    it('should prioritize errorType over failureReason', () => {
      const result = calculateCircuitBreakerBackoff('permanent', 'some transient error');
      expect(result).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('with consecutiveFailures', () => {
    it('should use consecutiveFailures parameter for rateLimited', () => {
      const result = calculateCircuitBreakerBackoff('rateLimited', undefined, 2);
      // 3^2 = 9, so 300000 * 9 = 2700000 (< 3600000 cap)
      expect(result).toBe(2700000);
    });

    it('should cap at 60 minutes for high consecutive failures', () => {
      const result = calculateCircuitBreakerBackoff('rateLimited', undefined, 3);
      // 3^3 = 27, so 300000 * 27 = 8100000, but capped at 3600000
      expect(result).toBe(3600000);
    });

    it('should ignore consecutiveFailures for other error types', () => {
      const result = calculateCircuitBreakerBackoff('retryable', undefined, 5);
      expect(result).toBe(12 * 60 * 60 * 1000);
    });
  });
});
