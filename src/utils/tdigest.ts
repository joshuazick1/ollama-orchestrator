import { TDigest as TDigestClass } from 'tdigest';

export class TDigest {
  private td: TDigestClass;
  readonly compression: number;

  constructor(compression: number = 100) {
    this.compression = compression;
    this.td = new TDigestClass(compression);
  }

  add(value: number): void {
    this.td.push(value);
  }

  percentile(p: number): number {
    return this.td.percentile(p) ?? 0;
  }

  merge(other: TDigest): void {
    const centroids = other.toJSON();
    for (const c of centroids) {
      this.td.push(c.mean, c.n);
    }
  }

  serialize(): string {
    return JSON.stringify(this.td.toArray());
  }

  deserialize(data: string): void {
    const centroids = JSON.parse(data) as Array<{ mean: number; n: number }>;
    this.td = new TDigestClass(this.compression);
    for (const c of centroids) {
      this.td.push(c.mean, c.n);
    }
  }

  size(): number {
    return this.td.size();
  }

  clear(): void {
    this.td = new TDigestClass(this.compression);
  }

  toJSON(): { mean: number; n: number }[] {
    return this.td.toArray();
  }
}

export function createTDigest(compression: number = 100): TDigest {
  return new TDigest(compression);
}

export class TDigestAggregator {
  private digests: Map<string, TDigest> = new Map();
  private maxKeys: number;

  constructor(maxKeys: number = 1000) {
    this.maxKeys = maxKeys;
  }

  getOrCreate(key: string, compression: number = 100): TDigest {
    let d = this.digests.get(key);
    if (!d) {
      if (this.digests.size >= this.maxKeys) {
        const firstKey = this.digests.keys().next().value;
        if (firstKey !== undefined) {
          this.digests.delete(firstKey as string);
        }
      }
      d = new TDigest(compression);
      this.digests.set(key, d);
    }
    return d;
  }

  get(key: string): TDigest | undefined {
    return this.digests.get(key);
  }

  delete(key: string): void {
    this.digests.delete(key);
  }

  clear(): void {
    this.digests.clear();
  }

  keys(): IterableIterator<string> {
    return this.digests.keys();
  }

  entries(): IterableIterator<[string, TDigest]> {
    return this.digests.entries();
  }

  size(): number {
    return this.digests.size;
  }
}
