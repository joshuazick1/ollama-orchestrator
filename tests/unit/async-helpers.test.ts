/**
 * async-helpers.test.ts
 * Tests for async utility helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sleep,
  withTimeout,
  withRetry,
  debounce,
  throttle,
  sleepWithFlag,
} from '../../src/utils/async-helpers.js';

describe('async-helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('sleep', () => {
    it('should resolve after specified ms', async () => {
      const promise = sleep(100);
      vi.advanceTimersByTime(100);
      await promise;
      expect(true).toBe(true);
    });
  });

  describe('withTimeout', () => {
    it('should resolve if promise completes within timeout', async () => {
      const promise = withTimeout(Promise.resolve('success'), 1000);
      vi.advanceTimersByTime(500);
      const result = await promise;
      expect(result).toBe('success');
    });

    it('should reject if promise does not complete in time', async () => {
      const promise = withTimeout(
        new Promise(resolve => setTimeout(() => resolve('slow'), 2000)),
        100,
        'Custom timeout'
      );
      vi.advanceTimersByTime(150);

      await expect(promise).rejects.toThrow('Custom timeout');
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    afterEach(() => {
      vi.useFakeTimers();
    });

    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'success';
      };

      const result = await withRetry(fn, { maxAttempts: 3, baseDelay: 5 });
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should call onRetry callback', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error('fail');
      };
      const onRetry = vi.fn();

      try {
        await withRetry(fn, { maxAttempts: 2, baseDelay: 5, onRetry });
      } catch {}

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('should throw if all attempts fail', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error('always fails');
      };

      await expect(withRetry(fn, { maxAttempts: 2, baseDelay: 5 })).rejects.toThrow('always fails');
      expect(attempts).toBe(2);
    });
  });

  describe('debounce', () => {
    it('should delay function execution', () => {
      const fn = vi.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn();
      debouncedFn();
      debouncedFn();

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('throttle', () => {
    it('should execute immediately on first call', () => {
      const fn = vi.fn();
      const throttledFn = throttle(fn, 100);

      throttledFn();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should ignore subsequent calls within throttle window', () => {
      const fn = vi.fn();
      const throttledFn = throttle(fn, 100);

      throttledFn();
      throttledFn();
      throttledFn();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should allow calls after throttle window', () => {
      const fn = vi.fn();
      const throttledFn = throttle(fn, 100);

      throttledFn();
      vi.advanceTimersByTime(100);
      throttledFn();

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('sleepWithFlag', () => {
    it('should sleep for specified time', async () => {
      const promise = sleepWithFlag(100);
      vi.advanceTimersByTime(100);
      await promise;
      expect(true).toBe(true);
    });
  });
});
