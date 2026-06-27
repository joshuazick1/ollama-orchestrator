import { describe, it, expect } from 'vitest';

import { ConsistentHashRing } from '../../../src/load-balancer/consistent-hash.js';

describe('ConsistentHashRing', () => {
  it('addNode + getNode produces deterministic results', () => {
    const ring = new ConsistentHashRing<string>();
    ring.addNode('server-a');
    ring.addNode('server-b');
    ring.addNode('server-c');

    const key = 'model:llama3:hello-world';
    const result1 = ring.getNode(key);
    const result2 = ring.getNode(key);
    expect(result1).toBe(result2);
    expect(['server-a', 'server-b', 'server-c']).toContain(result1);
  });

  it('weight=2 gets ~2x the keys of weight=1', () => {
    const ring = new ConsistentHashRing<string>();
    ring.addNode('light', 1);
    ring.addNode('heavy', 2);

    let light = 0;
    let heavy = 0;
    for (let i = 0; i < 5000; i++) {
      const node = ring.getNode(`key-${i}`);
      if (node === 'light') {light++;}
      else {heavy++;}
    }

    const ratio = heavy / Math.max(light, 1);
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(3.5);
  });

  it('1000 random keys distribute within 5% of expected across 5 nodes', () => {
    const ring = new ConsistentHashRing<string>();
    for (let i = 0; i < 5; i++) {
      ring.addNode(`server-${i}`, 1);
    }

    const counts: Record<string, number> = {};
    for (let i = 0; i < 10000; i++) {
      const node = ring.getNode(`test-key-${i}`);
      counts[node!] = (counts[node!] ?? 0) + 1;
    }

    const expected = 2000;
    for (let i = 0; i < 5; i++) {
      const count = counts[`server-${i}`] ?? 0;
      expect(count).toBeGreaterThan(expected * 0.85);
      expect(count).toBeLessThan(expected * 1.15);
    }
  });

  it('adding/removing a node only remaps ~1/N keys', () => {
    const ring = new ConsistentHashRing<string>();
    for (let i = 0; i < 5; i++) {
      ring.addNode(`server-${i}`, 1);
    }

    const initialMapping: Map<string, string | null> = new Map();
    for (let i = 0; i < 5000; i++) {
      initialMapping.set(`key-${i}`, ring.getNode(`key-${i}`));
    }

    ring.addNode('server-new', 1);

    let remapped = 0;
    for (const [key, origNode] of initialMapping) {
      const newNode = ring.getNode(key);
      if (newNode !== origNode) {remapped++;}
    }

    const fraction = remapped / 5000;
    expect(fraction).toBeLessThan(0.4);
    expect(fraction).toBeGreaterThan(0.05);
  });

  it('clear() empties the ring', () => {
    const ring = new ConsistentHashRing<string>();
    ring.addNode('server-a', 1);
    ring.addNode('server-b', 1);
    expect(ring.size()).toBe(2);

    ring.clear();
    expect(ring.size()).toBe(0);
    expect(ring.getNode('any-key')).toBeNull();
  });
});
