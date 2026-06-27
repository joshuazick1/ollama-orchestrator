import { describe, it, expect } from 'vitest';

import { hashPrefix, PREFIX_HASH_DEFAULT_TOKEN_COUNT } from '../../src/utils/hash.js';

describe('hashPrefix', () => {
  it('should return deterministic results for same input', () => {
    const input = 'The quick brown fox jumps over the lazy dog';
    const h1 = hashPrefix(input);
    const h2 = hashPrefix(input);
    expect(h1).toBe(h2);
  });

  it('should be deterministic across 1000 calls', () => {
    const input = 'deterministic test input';
    const first = hashPrefix(input);
    for (let i = 0; i < 1000; i++) {
      expect(hashPrefix(input)).toBe(first);
    }
  });

  it('should produce different hashes for different inputs', () => {
    const h1 = hashPrefix('hello world');
    const h2 = hashPrefix('world hello');
    expect(h1).not.toBe(h2);
  });

  it('should handle empty string', () => {
    const h = hashPrefix('');
    expect(h).toBe(hashPrefix(''));
  });

  it('should handle unicode', () => {
    const h1 = hashPrefix('héllo wörld 🎉');
    const h2 = hashPrefix('héllo wörld 🎉');
    expect(h1).toBe(h2);
  });

  it('should return exactly 16 hex characters', () => {
    const h = hashPrefix('test');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should respect tokenCount parameter', () => {
    const longText = Array(1000).fill('token').join(' ');
    const short = hashPrefix(longText, 10);
    const full = hashPrefix(longText, 1000);
    expect(short).not.toBe(full);
  });

  it('should export the default token count constant', () => {
    expect(PREFIX_HASH_DEFAULT_TOKEN_COUNT).toBe(512);
  });

  it('should distribute hashes across range', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(hashPrefix(`input-${i}`));
    }
    expect(seen.size).toBe(1000);
  });
});
