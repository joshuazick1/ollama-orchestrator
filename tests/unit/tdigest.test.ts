import { describe, it, expect } from 'vitest';

import { TDigest, createTDigest, TDigestAggregator } from '../../src/utils/tdigest.js';

describe('TDigest', () => {
  it('should create with default compression', () => {
    const td = createTDigest();
    expect(td).toBeInstanceOf(TDigest);
  });

  it('should compute accurate percentiles for uniform data', () => {
    const td = new TDigest(100);
    const count = 10000;
    for (let i = 0; i < count; i++) {
      td.add(i);
    }
    // Allow 1% error for t-digest approximation
    expect(td.percentile(0.5)).toBeGreaterThan(4900);
    expect(td.percentile(0.5)).toBeLessThan(5100);
    expect(td.percentile(0.95)).toBeGreaterThan(9400);
    expect(td.percentile(0.95)).toBeLessThan(9600);
    expect(td.percentile(0.99)).toBeGreaterThan(9800);
  });

  it('should maintain bounded memory with large insertions', () => {
    const td = new TDigest(100);
    for (let i = 0; i < 1000000; i++) {
      td.add(Math.random() * 1000);
    }
    expect(td.size()).toBeLessThan(200);
  });

  it('should merge correctly', () => {
    const td1 = new TDigest(100);
    const td2 = new TDigest(100);
    for (let i = 0; i < 100; i++) {
      td1.add(i);
      td2.add(i + 100);
    }
    td1.merge(td2);
    expect(td1.percentile(0.5)).toBeGreaterThan(90);
    expect(td1.percentile(0.5)).toBeLessThan(110);
  });

  it('should serialize and deserialize roundtrip', () => {
    const td = new TDigest(100);
    for (let i = 0; i < 1000; i++) {
      td.add(i);
    }
    const serialized = td.serialize();
    const td2 = new TDigest(100);
    td2.deserialize(serialized);
    expect(td2.percentile(0.5)).toBeCloseTo(td.percentile(0.5), 0);
    expect(td2.percentile(0.95)).toBeCloseTo(td.percentile(0.95), 0);
    expect(td2.percentile(0.99)).toBeCloseTo(td.percentile(0.99), 0);
  });

  it('should clear correctly', () => {
    const td = new TDigest(100);
    td.add(42);
    expect(td.size()).toBe(1);
    td.clear();
    expect(td.size()).toBe(0);
    expect(td.percentile(0.5)).toBe(0);
  });
});

describe('TDigestAggregator', () => {
  it('should create and retrieve digests by key', () => {
    const agg = new TDigestAggregator();
    const d1 = agg.getOrCreate('server1:model1');
    const d2 = agg.getOrCreate('server1:model2');
    d1.add(10);
    d2.add(20);
    expect(agg.get('server1:model1')?.percentile(0.5)).toBeCloseTo(10, 0);
    expect(agg.get('server1:model2')?.percentile(0.5)).toBeCloseTo(20, 0);
  });

  it('should enforce max keys limit', () => {
    const agg = new TDigestAggregator(2);
    agg.getOrCreate('a');
    agg.getOrCreate('b');
    agg.getOrCreate('c');
    expect(agg.size()).toBe(2);
    expect(agg.get('a')).toBeUndefined();
  });

  it('should delete keys', () => {
    const agg = new TDigestAggregator();
    agg.getOrCreate('test');
    expect(agg.size()).toBe(1);
    agg.delete('test');
    expect(agg.size()).toBe(0);
  });

  it('should clear all keys', () => {
    const agg = new TDigestAggregator();
    agg.getOrCreate('a');
    agg.getOrCreate('b');
    agg.clear();
    expect(agg.size()).toBe(0);
  });
});
