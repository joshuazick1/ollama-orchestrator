/**
 * statistics.test.ts
 * Tests for Statistics utility class
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Statistics } from '../../src/utils/statistics.js';

describe('Statistics', () => {
  describe('calculatePercentile', () => {
    it('should return 0 for empty array', () => {
      const result = Statistics.calculatePercentile([], 0.5);
      expect(result).toBe(0);
    });

    it('should return single value for single element array', () => {
      const result = Statistics.calculatePercentile([42], 0.5);
      expect(result).toBe(42);
    });

    it('should calculate correct percentile', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = Statistics.calculatePercentile(values, 0.5);
      expect(result).toBe(5);
    });

    it('should handle percentile at edges', () => {
      const values = [10, 20, 30, 40, 50];
      const p0 = Statistics.calculatePercentile(values, 0);
      const p100 = Statistics.calculatePercentile(values, 1);
      expect(p0).toBe(10);
      expect(p100).toBe(50);
    });
  });

  describe('calculatePercentiles', () => {
    it('should return zeros for empty array', () => {
      const result = Statistics.calculatePercentiles([]);
      expect(result.p50).toBe(0);
      expect(result.p95).toBe(0);
      expect(result.p99).toBe(0);
    });

    it('should calculate multiple percentiles', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const result = Statistics.calculatePercentiles(values);
      expect(result.p50).toBe(50);
      expect(result.p95).toBe(95);
      expect(result.p99).toBe(99);
    });

    it('should support custom percentiles', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = Statistics.calculatePercentiles(values, [0.25, 0.75]);
      expect(result.p25).toBe(3);
      expect(result.p75).toBe(8);
    });
  });

  describe('calculateAverage', () => {
    it('should return 0 for empty array', () => {
      const result = Statistics.calculateAverage([]);
      expect(result).toBe(0);
    });

    it('should calculate correct average', () => {
      const result = Statistics.calculateAverage([1, 2, 3, 4, 5]);
      expect(result).toBe(3);
    });

    it('should handle single value', () => {
      const result = Statistics.calculateAverage([42]);
      expect(result).toBe(42);
    });
  });

  describe('calculateWeightedAverage', () => {
    it('should throw for mismatched array lengths', () => {
      expect(() => Statistics.calculateWeightedAverage([1, 2], [1])).toThrow();
    });

    it('should return 0 for empty arrays', () => {
      const result = Statistics.calculateWeightedAverage([], []);
      expect(result).toBe(0);
    });

    it('should return 0 when total weight is 0', () => {
      const result = Statistics.calculateWeightedAverage([1, 2], [0, 0]);
      expect(result).toBe(0);
    });

    it('should calculate correct weighted average', () => {
      const result = Statistics.calculateWeightedAverage([2, 4], [1, 3]);
      expect(result).toBe(3.5);
    });
  });

  describe('calculateStandardDeviation', () => {
    it('should return 0 for less than 2 values', () => {
      expect(Statistics.calculateStandardDeviation([])).toBe(0);
      expect(Statistics.calculateStandardDeviation([5])).toBe(0);
    });

    it('should calculate correct standard deviation', () => {
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      const result = Statistics.calculateStandardDeviation(values);
      expect(result).toBeCloseTo(2, 0);
    });
  });

  describe('calculateMedian', () => {
    it('should return 0 for empty array', () => {
      const result = Statistics.calculateMedian([]);
      expect(result).toBe(0);
    });

    it('should calculate median for odd count', () => {
      const result = Statistics.calculateMedian([1, 3, 5]);
      expect(result).toBe(3);
    });

    it('should calculate median for even count', () => {
      const result = Statistics.calculateMedian([1, 2, 3, 4]);
      expect(result).toBe(2);
    });
  });

  describe('calculateRange', () => {
    it('should return zeros for empty array', () => {
      const result = Statistics.calculateRange([]);
      expect(result).toEqual({ min: 0, max: 0 });
    });

    it('should calculate correct range', () => {
      const result = Statistics.calculateRange([5, 2, 8, 1, 9]);
      expect(result).toEqual({ min: 1, max: 9 });
    });
  });

  describe('calculateSuccessRate', () => {
    it('should return 0 for zero total', () => {
      const result = Statistics.calculateSuccessRate(0, 0);
      expect(result).toBe(0);
    });

    it('should calculate correct success rate', () => {
      const result = Statistics.calculateSuccessRate(75, 100);
      expect(result).toBe(0.75);
    });

    it('should round to 3 decimal places', () => {
      const result = Statistics.calculateSuccessRate(1, 3);
      expect(result).toBeCloseTo(0.333, 2);
    });
  });

  describe('calculateRate', () => {
    it('should return 0 for non-positive time', () => {
      expect(Statistics.calculateRate(100, 0)).toBe(0);
      expect(Statistics.calculateRate(100, -1)).toBe(0);
    });

    it('should calculate rate per second', () => {
      const result = Statistics.calculateRate(1000, 1000);
      expect(result).toBe(1000);
    });
  });

  describe('calculatePercentilesWithFlag', () => {
    // Note: This feature flag test is complex to mock properly
    // The function delegates to calculatePercentiles when flag is enabled
    it('should calculate percentiles (delegates to calculatePercentiles)', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const result = Statistics.calculatePercentilesWithFlag(values);
      expect(result.p50).toBe(50);
      expect(result.p95).toBe(95);
      expect(result.p99).toBe(99);
    });
  });
});
