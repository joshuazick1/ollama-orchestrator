import { describe, it, expect } from 'vitest';

import { selectProbeModels, getUncoveredServers } from '../../src/utils/probe-model-selector.js';

describe('probe-model-selector', () => {
  describe('selectProbeModels', () => {
    it('returns models covering most uncovered servers first', () => {
      const result = selectProbeModels({
        a: ['s1', 's2', 's3', 's4', 's5'],
        b: ['s1', 's2'],
      });
      expect(result).toEqual(['a']);
    });

    it('tie-breaker: alphabetically lower model name wins', () => {
      const result = selectProbeModels({
        b: ['s1', 's2'],
        a: ['s3', 's4'],
      });
      expect(result).toEqual(['a', 'b']);
    });

    it('returns both models when both needed to cover all servers', () => {
      const result = selectProbeModels({
        a: ['s1', 's2'],
        b: ['s1', 's3'],
      });
      expect(result).toEqual(['a', 'b']);
    });

    it('maxModels cap returns at most maxModels models', () => {
      const result = selectProbeModels(
        {
          a: ['s1', 's2', 's3'],
          b: ['s4', 's5'],
          c: ['s6'],
        },
        1
      );
      expect(result.length).toBe(1);
      expect(result).toContain('a');
    });

    it('empty input returns empty array', () => {
      const result = selectProbeModels({});
      expect(result).toEqual([]);
    });

    it('all servers uncovered returns empty array', () => {
      const result = selectProbeModels({
        a: [],
        b: [],
      });
      expect(result).toEqual([]);
    });

    it('single server covered by multiple models picks alphabetically first', () => {
      const result = selectProbeModels({
        z: ['s1'],
        a: ['s1'],
      });
      expect(result).toEqual(['a']);
    });

    it('all models on every server returns single alphabetically-first model', () => {
      const result = selectProbeModels({
        z: ['s1', 's2', 's3'],
        a: ['s1', 's2', 's3'],
      });
      expect(result).toEqual(['a']);
    });

    it('five servers each having 2 models returns at most 3 models', () => {
      const result = selectProbeModels({
        m1: ['s1', 's2'],
        m2: ['s2', 's3'],
        m3: ['s3', 's4'],
        m4: ['s4', 's5'],
        m5: ['s5', 's1'],
      });
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('selection order reflects greedy iteration order', () => {
      const result = selectProbeModels({
        c: ['s1', 's2'],
        b: ['s3', 's4'],
        a: ['s5', 's6'],
      });
      expect(result).toEqual(['a', 'b', 'c']);
    });
  });

  describe('getUncoveredServers', () => {
    it('returns all servers when no models selected', () => {
      const result = getUncoveredServers({ a: ['s1', 's2'], b: ['s3'] }, []);
      expect(result).toEqual(['s1', 's2', 's3']);
    });

    it('returns servers not covered by selected models', () => {
      const result = getUncoveredServers({ a: ['s1', 's2'], b: ['s1', 's3'] }, ['a']);
      expect(result).toContain('s3');
      expect(result).not.toContain('s1');
      expect(result).not.toContain('s2');
    });

    it('returns empty array when all servers covered', () => {
      const result = getUncoveredServers({ a: ['s1', 's2'], b: ['s3'] }, ['a', 'b']);
      expect(result).toEqual([]);
    });

    it('handles empty modelToServers', () => {
      const result = getUncoveredServers({}, []);
      expect(result).toEqual([]);
    });

    it('handles model with no servers', () => {
      const result = getUncoveredServers({ a: [], b: ['s1'] }, ['a']);
      expect(result).toEqual(['s1']);
    });
  });
});
