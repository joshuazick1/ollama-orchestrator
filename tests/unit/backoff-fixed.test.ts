/**
 * backoff-fixed.test.ts
 * Tests for fixed backoff strategy
 */

import { describe, it, expect } from 'vitest';

import { fixedStrategy } from '../../src/utils/backoff/strategies/fixed.js';
import type { FixedOptions } from '../../src/utils/backoff/types.js';

describe('fixedStrategy', () => {
  describe('basic fixed delay behavior', () => {
    it('should return baseDelayMs for attempt 0 without delaysMs', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(1000);
      expect(result.metadata.strategy).toBe('fixed');
      expect(result.metadata.attempt).toBe(0);
      expect(result.metadata.baseDelayMs).toBe(1000);
    });

    it('should return same delay regardless of attempt number', () => {
      const options1: FixedOptions = { attempt: 0, baseDelayMs: 1000, maxDelayMs: 5000 };
      const options2: FixedOptions = { attempt: 5, baseDelayMs: 1000, maxDelayMs: 5000 };
      const options3: FixedOptions = { attempt: 100, baseDelayMs: 1000, maxDelayMs: 5000 };

      const result1 = fixedStrategy(options1);
      const result2 = fixedStrategy(options2);
      const result3 = fixedStrategy(options3);

      expect(result1.delayMs).toBe(result2.delayMs);
      expect(result2.delayMs).toBe(result3.delayMs);
      expect(result1.delayMs).toBe(1000);
    });

    it('should respect maxDelayMs cap on baseDelayMs', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 10000,
        maxDelayMs: 5000,
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(5000);
    });
  });

  describe('custom delaysMs array', () => {
    it('should use delaysMs array when provided', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        delaysMs: [100, 200, 300],
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(100);
      expect(result.metadata.delaysMs).toEqual([100, 200, 300]);
    });

    it('should return correct delay for each attempt index', () => {
      const options: FixedOptions = {
        attempt: 2,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        delaysMs: [100, 200, 300, 400, 500],
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(300);
    });

    it('should cap index at last element when attempt exceeds array length', () => {
      const options: FixedOptions = {
        attempt: 100,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        delaysMs: [100, 200, 300],
      };

      const result = fixedStrategy(options);

      // attempt 100 > index 2 (last valid index), so uses last element
      expect(result.delayMs).toBe(300);
    });

    it('should respect maxDelayMs cap on delaysMs element', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 1000,
        maxDelayMs: 150,
        delaysMs: [100, 200, 300],
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(100); // 100 < 150, no cap needed
    });

    it('should cap delaysMs element at maxDelayMs', () => {
      const options: FixedOptions = {
        attempt: 2,
        baseDelayMs: 1000,
        maxDelayMs: 250,
        delaysMs: [100, 200, 300],
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(250); // 300 capped to 250
    });

    it('should handle single element delaysMs array', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        delaysMs: [500],
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(500);
    });

    it('should use last element for any attempt >= array length minus 1', () => {
      const options: FixedOptions = {
        attempt: 5,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        delaysMs: [10, 20, 30],
      };

      const result = fixedStrategy(options);

      // array length is 3, last valid index is 2
      // attempt 5 > 2, so index = 2, delay = 30
      expect(result.delayMs).toBe(30);
    });
  });

  describe('edge cases', () => {
    it('should handle attempt 0 with empty delaysMs array', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 500,
        maxDelayMs: 5000,
        delaysMs: [],
      };

      const result = fixedStrategy(options);

      // delaysMs.length = 0, so the first branch is skipped
      expect(result.delayMs).toBe(500);
    });

    it('should handle attempt 1 with empty delaysMs array', () => {
      const options: FixedOptions = {
        attempt: 1,
        baseDelayMs: 500,
        maxDelayMs: 5000,
        delaysMs: [],
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(500);
    });

    it('should handle undefined delaysMs (not provided)', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 500,
        maxDelayMs: 5000,
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(500);
    });

    it('should handle large baseDelayMs values', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 1000000,
        maxDelayMs: 500000,
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(500000); // capped at maxDelayMs
    });

    it('should handle zero baseDelayMs', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 0,
        maxDelayMs: 5000,
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(0);
    });

    it('should handle zero maxDelayMs', () => {
      const options: FixedOptions = {
        attempt: 0,
        baseDelayMs: 1000,
        maxDelayMs: 0,
      };

      const result = fixedStrategy(options);

      expect(result.delayMs).toBe(0); // 1000 capped to 0
    });
  });

  describe('metadata', () => {
    it('should include correct metadata for base delay case', () => {
      const options: FixedOptions = {
        attempt: 3,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
      };

      const result = fixedStrategy(options);

      expect(result.metadata).toEqual({
        strategy: 'fixed',
        attempt: 3,
        baseDelayMs: 1000,
      });
    });

    it('should include correct metadata for delaysMs case', () => {
      const options: FixedOptions = {
        attempt: 1,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        delaysMs: [100, 200, 300],
      };

      const result = fixedStrategy(options);

      expect(result.metadata).toEqual({
        strategy: 'fixed',
        attempt: 1,
        delaysMs: [100, 200, 300],
      });
    });
  });
});
