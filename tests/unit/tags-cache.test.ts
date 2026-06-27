import { describe, it, expect } from 'vitest';

import { TagsCacheStore, type TagsCacheMetadata } from '../../src/orchestrator/tags-cache.js';

const sampleMeta: TagsCacheMetadata = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  serverCount: 0,
  modelCount: 0,
  errors: [],
};

describe('TagsCacheStore', () => {
  describe('constructor', () => {
    it('rejects maxEntries < 1', () => {
      expect(() => new TagsCacheStore(0)).toThrow(RangeError);
      expect(() => new TagsCacheStore(-1)).toThrow(RangeError);
      expect(() => new TagsCacheStore(1.5)).toThrow(RangeError);
    });
    it('accepts maxEntries = 1', () => {
      expect(() => new TagsCacheStore(1)).not.toThrow();
    });
  });

  describe('get / set', () => {
    it('get returns undefined when empty', () => {
      const s = new TagsCacheStore(10);
      expect(s.get()).toBeUndefined();
    });

    it('set then get returns the same data', () => {
      const s = new TagsCacheStore(10);
      const data = [{ name: 'm1' }];
      s.set(data, { ...sampleMeta, modelCount: 1 });
      const got = s.get();
      expect(got).toBeDefined();
      expect(got!.data).toBe(data);
      expect(got!.metadata.modelCount).toBe(1);
    });

    it('slices data when length > maxEntries (FIFO, first-N wins)', () => {
      const s = new TagsCacheStore(2);
      const data = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
      s.set(data, sampleMeta);
      const got = s.get()!;
      expect(got.data.length).toBe(2);
      expect(got.data[0]).toEqual({ name: 'a' });
      expect(got.data[1]).toEqual({ name: 'b' });
    });

    it('does not slice when length === maxEntries', () => {
      const s = new TagsCacheStore(3);
      const data = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
      s.set(data, sampleMeta);
      expect(s.get()!.data.length).toBe(3);
    });

    it('does not slice when length < maxEntries', () => {
      const s = new TagsCacheStore(10);
      const data = [{ name: 'a' }];
      s.set(data, sampleMeta);
      expect(s.get()!.data.length).toBe(1);
    });
  });

  describe('clear', () => {
    it('clear empties the slot', () => {
      const s = new TagsCacheStore(10);
      s.set([{ name: 'a' }], sampleMeta);
      expect(s.get()).toBeDefined();
      s.clear();
      expect(s.get()).toBeUndefined();
    });

    it('clear is safe to call on empty store', () => {
      const s = new TagsCacheStore(10);
      expect(() => s.clear()).not.toThrow();
      expect(s.get()).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('invalidate is an alias for clear', () => {
      const s = new TagsCacheStore(10);
      s.set([{ name: 'a' }], sampleMeta);
      s.invalidate();
      expect(s.get()).toBeUndefined();
    });
  });
});
