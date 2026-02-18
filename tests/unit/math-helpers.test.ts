/**
 * math-helpers.test.ts
 * Tests for mathematical utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  clamp,
  lerp,
  calculateBackoff,
  roundTo,
  inRange,
  clampWithFlag,
} from '../../src/utils/math-helpers.js';

describe('math-helpers', () => {
  describe('clamp', () => {
    it('should return value when within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('should return min when value is below', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('should return max when value is above', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should handle edge cases', () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });

  describe('lerp', () => {
    it('should interpolate between start and end', () => {
      expect(lerp(0, 100, 0.5)).toBe(50);
    });

    it('should return start at t=0', () => {
      expect(lerp(10, 20, 0)).toBe(10);
    });

    it('should return end at t=1', () => {
      expect(lerp(10, 20, 1)).toBe(20);
    });

    it('should clamp t to 0-1 range', () => {
      expect(lerp(0, 100, -0.5)).toBe(0);
      expect(lerp(0, 100, 1.5)).toBe(100);
    });
  });

  describe('calculateBackoff', () => {
    it('should calculate exponential backoff', () => {
      expect(calculateBackoff(0, 100, 2, 1000)).toBe(100);
      expect(calculateBackoff(1, 100, 2, 1000)).toBe(200);
      expect(calculateBackoff(2, 100, 2, 1000)).toBe(400);
    });

    it('should cap at maxDelay', () => {
      expect(calculateBackoff(10, 100, 2, 1000)).toBe(1000);
    });
  });

  describe('roundTo', () => {
    it('should round to specified decimals', () => {
      expect(roundTo(3.14159, 2)).toBe(3.14);
      expect(roundTo(3.14159, 0)).toBe(3);
      expect(roundTo(3.5, 0)).toBe(4);
    });
  });

  describe('inRange', () => {
    it('should return true when value is within range', () => {
      expect(inRange(5, 0, 10)).toBe(true);
    });

    it('should return false when value is below range', () => {
      expect(inRange(-1, 0, 10)).toBe(false);
    });

    it('should return false when value is above range', () => {
      expect(inRange(11, 0, 10)).toBe(false);
    });

    it('should include boundaries', () => {
      expect(inRange(0, 0, 10)).toBe(true);
      expect(inRange(10, 0, 10)).toBe(true);
    });
  });

  describe('clampWithFlag', () => {
    it('should clamp value like regular clamp', () => {
      expect(clampWithFlag(5, 0, 10)).toBe(5);
      expect(clampWithFlag(-5, 0, 10)).toBe(0);
      expect(clampWithFlag(15, 0, 10)).toBe(10);
    });
  });
});
