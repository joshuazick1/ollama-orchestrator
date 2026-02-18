/**
 * collection-helpers.test.ts
 * Tests for collection utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  pruneByAge,
  pruneByMaxSize,
  pruneCollection,
  SlidingWindow,
  pruneCollectionWithFlag,
} from '../../src/utils/collection-helpers.js';

interface TestItem {
  timestamp: number;
  value: string;
}

describe('collection-helpers', () => {
  describe('pruneByAge', () => {
    it('should remove items older than maxAgeMs', () => {
      const now = Date.now();
      const items: TestItem[] = [
        { timestamp: now - 1000, value: 'old' },
        { timestamp: now - 500, value: 'middle' },
        { timestamp: now, value: 'new' },
      ];

      const result = pruneByAge(items, 600, now);
      expect(result).toHaveLength(2);
      expect(result.map(i => i.value)).toEqual(['middle', 'new']);
    });

    it('should keep all items if none are expired', () => {
      const now = Date.now();
      const items: TestItem[] = [{ timestamp: now, value: 'new' }];

      const result = pruneByAge(items, 600, now);
      expect(result).toHaveLength(1);
    });
  });

  describe('pruneByMaxSize', () => {
    it('should keep only maxSize most recent items', () => {
      const items = [1, 2, 3, 4, 5];
      const result = pruneByMaxSize(items, 3);
      expect(result).toEqual([3, 4, 5]);
    });

    it('should return all items if under maxSize', () => {
      const items = [1, 2];
      const result = pruneByMaxSize(items, 3);
      expect(result).toEqual([1, 2]);
    });
  });

  describe('pruneCollection', () => {
    it('should apply both age and size constraints', () => {
      const now = Date.now();
      const items: TestItem[] = [
        { timestamp: now - 2000, value: 'old' },
        { timestamp: now - 1000, value: 'middle' },
        { timestamp: now, value: 'new' },
      ];

      const result = pruneCollection(items, { maxAgeMs: 1500, maxSize: 2, now });
      expect(result).toHaveLength(2);
    });

    it('should apply only maxAgeMs if specified', () => {
      const now = Date.now();
      const items: TestItem[] = [
        { timestamp: now - 2000, value: 'old' },
        { timestamp: now, value: 'new' },
      ];

      const result = pruneCollection(items, { maxAgeMs: 1500, now });
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe('new');
    });

    it('should apply only maxSize if specified', () => {
      const items = [1, 2, 3, 4, 5];
      const result = pruneCollection(items as any, { maxSize: 2 });
      expect(result).toHaveLength(2);
    });
  });

  describe('SlidingWindow', () => {
    it('should add items and maintain max size', () => {
      const window = new SlidingWindow<number>(3);
      window.add(1);
      window.add(2);
      window.add(3);
      expect(window.size).toBe(3);

      window.add(4);
      expect(window.size).toBe(3);
      expect(window.getAll()).toEqual([2, 3, 4]);
    });

    it('should return all items', () => {
      const window = new SlidingWindow<number>(5);
      window.add(1);
      window.add(2);
      expect(window.getAll()).toEqual([1, 2]);
    });

    it('should clear all items', () => {
      const window = new SlidingWindow<number>(5);
      window.add(1);
      window.add(2);
      window.clear();
      expect(window.size).toBe(0);
    });
  });

  describe('pruneCollectionWithFlag', () => {
    it('should prune collection normally', () => {
      const items: TestItem[] = [
        { timestamp: Date.now() - 10000, value: 'old' },
        { timestamp: Date.now(), value: 'new' },
      ];
      const result = pruneCollectionWithFlag(items, { maxAgeMs: 1000 });
      expect(result).toHaveLength(1);
    });
  });
});
