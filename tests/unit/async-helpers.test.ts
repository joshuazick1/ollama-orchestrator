/**
 * async-helpers.test.ts
 * Tests for async utility helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sleep, debounce, throttle } from '../../src/utils/async-helpers.js';

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
});
