/**
 * bounded-map.ts
 * Generic LRU map with a max-size cap and deterministic tie-breaking
 */

export class BoundedMap<K, V> {
  /**
   * Internal entry envelope storing value plus LRU metadata.
   * - `lastUsed` is updated on every `get()` and `set()` touching the key.
   * - `insertedAt` is set once on first insertion and used only as a tie-breaker
   *   when two entries have equal `lastUsed` (older insertion wins).
   *
   * Thread-safety note: JS is single-threaded, so no external synchronization
   * is needed. Concurrent access from multiple async contexts is fine as long
   * as each operation completes before the next begins.
   *
   * @example
   * const m = new BoundedMap<string, number>(3);
   * m.set('a', 1).set('b', 2).set('c', 3);
   * m.get('a');           // bumps 'a' to most-recent
   * m.set('d', 4);        // evicts 'b' (oldest lastUsed)
   * console.log([...m.keys()]); // ['a', 'c', 'd']
   */

  private store = new Map<K, { value: V; lastUsed: number; insertedAt: number }>();
  private insertionCounter = 0;

  constructor(private maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new RangeError(`maxSize must be a positive integer, got ${maxSize}`);
    }
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return undefined;
    }
    entry.lastUsed = Date.now();
    return entry.value;
  }

  set(key: K, value: V): this {
    const now = Date.now();
    const existing = this.store.get(key);

    if (existing !== undefined) {
      existing.value = value;
      existing.lastUsed = now;
    } else {
      this.store.set(key, { value, lastUsed: now, insertedAt: this.insertionCounter++ });
    }

    if (this.store.size > this.maxSize) {
      this.evictOldest();
    }

    return this;
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }

  keys(): IterableIterator<K> {
    return this.sortedKeys()[Symbol.iterator]();
  }

  values(): IterableIterator<V> {
    return this.sortedValues()[Symbol.iterator]();
  }

  entries(): IterableIterator<[K, V]> {
    return this.sortedEntries()[Symbol.iterator]();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Evict the entry with the smallest (lastUsed, insertedAt) tuple.
   * Tie-break: older insertion wins when lastUsed is equal.
   */
  private evictOldest(): void {
    let oldestKey: K | null = null;
    let oldestLastUsed = Infinity;
    let oldestInsertedAt = Infinity;

    for (const [key, entry] of this.store) {
      if (
        entry.lastUsed < oldestLastUsed ||
        (entry.lastUsed === oldestLastUsed && entry.insertedAt < oldestInsertedAt)
      ) {
        oldestKey = key;
        oldestLastUsed = entry.lastUsed;
        oldestInsertedAt = entry.insertedAt;
      }
    }

    if (oldestKey !== null) {
      this.store.delete(oldestKey);
    }
  }

  private sortedEntries(): Array<[K, V]> {
    return Array.from(this.store.entries())
      .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
      .map(([k, e]) => [k, e.value] as [K, V]);
  }

  private sortedKeys(): K[] {
    return this.sortedEntries().map(([k]) => k);
  }

  private sortedValues(): V[] {
    return this.sortedEntries().map(([, v]) => v);
  }
}
