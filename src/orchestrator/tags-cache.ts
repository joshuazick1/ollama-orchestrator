/**
 * tags-cache.ts
 * Single-slot cache for aggregated model tags across the fleet.
 *
 * Extracted from Orchestrator to:
 *   1. Shrink orchestrator.ts and keep the boundary crisp
 *   2. Cap the cached `data` array length to prevent memory growth
 *      in fleets with many models
 *
 * The cache is intentionally a single slot (not a Map). The TTL is
 * enforced by the caller (models.ts) via OrchestratorConfig.tags.cacheTtlMs.
 *
 * Eviction policy: FIFO (first-N wins). When `data.length > maxEntries`,
 * the array is sliced to the first `maxEntries` entries. This matches
 * the natural insertion order of `Array.from(allTags.values())` in
 * `src/orchestrator/models.ts:88`.
 */

export interface TagsCache {
  data: any[];
  timestamp: number;
  metadata: TagsCacheMetadata;
}

export interface TagsCacheMetadata {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  serverCount: number;
  modelCount: number;
  errors: Array<{
    serverId: string;
    error: string;
    type: 'network' | 'server' | 'timeout' | 'unknown';
  }>;
}

export class TagsCacheStore {
  private slot: TagsCache | undefined;

  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(`maxEntries must be a positive integer, got ${maxEntries}`);
    }
  }

  get(): TagsCache | undefined {
    return this.slot;
  }

  set(data: any[], metadata: TagsCacheMetadata): void {
    const sliced = data.length > this.maxEntries ? data.slice(0, this.maxEntries) : data;
    this.slot = { data: sliced, timestamp: Date.now(), metadata };
  }

  clear(): void {
    this.slot = undefined;
  }

  /**
   * Alias for clear(). Kept for API parity with the original
   * Orchestrator.invalidateTagsCache() public method.
   */
  invalidate(): void {
    this.clear();
  }
}
