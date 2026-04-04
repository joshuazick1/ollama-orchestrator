/**
 * deepMerge.test.ts
 * Tests for deep merge utility
 */

import { describe, it, expect } from 'vitest';

import { deepMerge } from '../../src/utils/deep-merge.js';

describe('deepMerge', () => {
  it('should merge two objects', () => {
    const target = { a: 1, b: 2 };
    const source = { b: 3, c: 4 };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should deeply merge nested objects', () => {
    const target = { nested: { a: 1, b: 2 } };
    const source = { nested: { b: 3, c: 4 } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ nested: { a: 1, b: 3, c: 4 } });
  });

  it('should replace arrays instead of merging', () => {
    const target = { arr: [1, 2] };
    const source = { arr: [3, 4] };
    const result = deepMerge(target, source);
    expect(result).toEqual({ arr: [3, 4] });
  });

  it('should handle undefined source values', () => {
    const target = { a: 1 };
    const source = { b: undefined };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1, b: undefined });
  });

  it('should return target if source is not a plain object', () => {
    const target = { a: 1 };
    const source = 'not an object' as any;
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1 });
  });

  it('should handle null values', () => {
    const target = { a: 1 };
    const source = { b: null };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: 1, b: null });
  });
});
