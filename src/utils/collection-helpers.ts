/**
 * collection-helpers.ts
 * Collection manipulation utilities
 * Centralizes pruning, cleanup, and filtering logic
 */

import { featureFlags } from '../config/feature-flags.js';

interface Timestamped {
  timestamp: number;
}

/**
 * Remove items older than maxAgeMs
 */
export function pruneByAge<T extends Timestamped>(
  items: T[],
  maxAgeMs: number,
  now = Date.now()
): T[] {
  const cutoff = now - maxAgeMs;
  return items.filter(item => item.timestamp >= cutoff);
}

/**
 * Keep only the most recent maxSize items
 */
export function pruneByMaxSize<T>(items: T[], maxSize: number): T[] {
  if (items.length <= maxSize) {return items;}
  return items.slice(-maxSize);
}

/**
 * Prune by both age and max size (applies both constraints)
 */
export function pruneCollection<T extends Timestamped>(
  items: T[],
  options: {
    maxAgeMs?: number;
    maxSize?: number;
    now?: number;
  }
): T[] {
  let result = items;

  if (options.maxAgeMs !== undefined) {
    result = pruneByAge(result, options.maxAgeMs, options.now);
  }

  if (options.maxSize !== undefined) {
    result = pruneByMaxSize(result, options.maxSize);
  }

  return result;
}

/**
 * Sliding window implementation
 */
export class SlidingWindow<T> {
  private items: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  add(item: T): void {
    this.items.push(item);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  getAll(): T[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

/**
 * Prune with feature flag support
 */
export function pruneCollectionWithFlag<T extends Timestamped>(
  items: T[],
  options: { maxAgeMs?: number; maxSize?: number; now?: number }
): T[] {
  if (!featureFlags.get('useCollectionHelpers')) {
    return items;
  }
  return pruneCollection(items, options);
}
