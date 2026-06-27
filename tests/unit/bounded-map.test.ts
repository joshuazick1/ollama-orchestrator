/**
 * bounded-map.test.ts
 * Tests for BoundedMap LRU helper
 */

import { describe, it, expect, vi } from 'vitest';

import { BoundedMap } from '../../src/utils/bounded-map.js';

describe('BoundedMap', () => {
  describe('constructor', () => {
    it('rejects maxSize < 1', () => {
      expect(() => new BoundedMap(0)).toThrow(RangeError);
      expect(() => new BoundedMap(-1)).toThrow(RangeError);
      expect(() => new BoundedMap(1.5)).toThrow(RangeError);
    });

    it('accepts maxSize = 1', () => {
      expect(() => new BoundedMap(1)).not.toThrow();
    });
  });

  describe('set / get', () => {
    it('set then get returns the value', () => {
      const m = new BoundedMap<string, number>(3);
      m.set('a', 1);
      expect(m.get('a')).toBe(1);
      m.set('b', 2);
      expect(m.get('b')).toBe(2);
    });

    it('get updates lastUsed (LRU: re-accessed entry is NOT evicted)', () => {
      vi.useFakeTimers();
      const m = new BoundedMap<string, number>(2);
      m.set('a', 1);
      m.set('b', 2);
      vi.advanceTimersByTime(10);
      m.get('a'); // bump 'a' to most-recent
      vi.advanceTimersByTime(10);
      m.set('c', 3); // should evict 'b', not 'a'
      expect(m.has('a')).toBe(true);
      expect(m.has('b')).toBe(false);
      expect(m.has('c')).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('LRU eviction', () => {
    it('set evicts the oldest (smallest lastUsed) when over capacity', () => {
      const m = new BoundedMap<string, number>(2);
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3); // should evict 'a' (oldest lastUsed)
      expect(m.has('a')).toBe(false);
      expect(m.has('b')).toBe(true);
      expect(m.has('c')).toBe(true);
    });
  });

  describe('delete', () => {
    it('delete returns true for existing key, false for missing key', () => {
      const m = new BoundedMap<string, number>(3);
      m.set('a', 1);
      expect(m.delete('a')).toBe(true);
      expect(m.delete('a')).toBe(false);
    });
  });

  describe('has', () => {
    it('has works correctly', () => {
      const m = new BoundedMap<string, number>(3);
      expect(m.has('a')).toBe(false);
      m.set('a', 1);
      expect(m.has('a')).toBe(true);
      m.delete('a');
      expect(m.has('a')).toBe(false);
    });
  });

  describe('size', () => {
    it('size reflects the actual size', () => {
      const m = new BoundedMap<string, number>(3);
      expect(m.size).toBe(0);
      m.set('a', 1);
      expect(m.size).toBe(1);
      m.delete('a');
      expect(m.size).toBe(0);
    });
  });

  describe('iteration order', () => {
    it('keys / values / entries iterate in lastUsed desc order', () => {
      vi.useFakeTimers();
      const m = new BoundedMap<string, number>(3);
      m.set('a', 1);
      vi.advanceTimersByTime(10);
      m.set('b', 2);
      vi.advanceTimersByTime(10);
      m.set('c', 3);
      vi.advanceTimersByTime(10);
      m.get('a'); // bump 'a' to most-recent — order should be [a, c, b]
      expect([...m.keys()]).toEqual(['a', 'c', 'b']);
      expect([...m.values()]).toEqual([1, 3, 2]);
      expect([...m.entries()]).toEqual([
        ['a', 1],
        ['c', 3],
        ['b', 2],
      ]);
      vi.useRealTimers();
    });
  });

  describe('clear', () => {
    it('clear empties the map', () => {
      const m = new BoundedMap<string, number>(3);
      m.set('a', 1);
      m.set('b', 2);
      m.clear();
      expect(m.size).toBe(0);
      expect(m.has('a')).toBe(false);
      expect(m.has('b')).toBe(false);
    });
  });

  describe('Symbol.iterator', () => {
    it('iterator protocol works', () => {
      const m = new BoundedMap<string, number>(3);
      m.set('a', 1);
      m.set('b', 2);
      const entries: [string, number][] = [];
      for (const [k, v] of m) {
        entries.push([k, v]);
      }
      expect(entries).toHaveLength(2);
      expect(entries[0][0]).toBe('a');
      expect(entries[1][0]).toBe('b');
    });
  });

  describe('determinism on tie-break', () => {
    it('when lastUsed is equal, older insertion is evicted first', () => {
      const mockNow = vi.spyOn(Date, 'now').mockReturnValue(1000);

      const m = new BoundedMap<string, number>(2);
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3); // same timestamp, but 'a' was inserted first — 'a' evicted

      expect(m.has('a')).toBe(false);
      expect(m.has('b')).toBe(true);
      expect(m.has('c')).toBe(true);

      mockNow.mockRestore();
    });
  });

  describe('last-write-wins', () => {
    it('set on existing key updates value and lastUsed without evicting', () => {
      const m = new BoundedMap<string, number>(2);
      m.set('a', 1);
      m.set('a', 2); // same key, new value
      expect(m.size).toBe(1);
      expect(m.get('a')).toBe(2);

      m.set('b', 3); // should not evict 'a' (was just updated)
      expect(m.has('a')).toBe(true);
      expect(m.get('a')).toBe(2);
    });
  });
});
