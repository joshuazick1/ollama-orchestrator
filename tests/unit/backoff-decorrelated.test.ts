import { describe, it, expect } from 'vitest';

import { decorrelatedStrategy } from '../../src/utils/backoff/strategies/decorrelated.js';

describe('decorrelatedStrategy - AWS Architecture Blog formula', () => {
  it('should produce delays in valid range', () => {
    const baseDelayMs = 100;
    const maxDelayMs = 10000;
    const multiplier = 3;
    let previousDelay = baseDelayMs;

    for (let i = 0; i < 100; i++) {
      const delay = decorrelatedStrategy({
        attempt: i,
        baseDelayMs,
        maxDelayMs,
        multiplier,
        previousDelay,
      });

      expect(delay.delayMs).toBeGreaterThanOrEqual(baseDelayMs);
      expect(delay.delayMs).toBeLessThanOrEqual(Math.max(previousDelay * multiplier, baseDelayMs));
      expect(delay.delayMs).toBeLessThanOrEqual(maxDelayMs);

      previousDelay = delay.delayMs;
    }
  });

  it('should produce decorrelated delays across independent chains', () => {
    const allCorrs: number[] = [];

    for (let chain = 0; chain < 50; chain++) {
      const samples: number[] = [];
      let prev = 100 + Math.random() * 900;
      for (let i = 0; i < 50; i++) {
        const result = decorrelatedStrategy({
          attempt: i,
          baseDelayMs: 100,
          maxDelayMs: 10000,
          multiplier: 3,
          previousDelay: prev,
        });
        samples.push(result.delayMs);
        prev = result.delayMs;
      }

      const indexed = samples.map((v, i) => ({ v, i }));
      indexed.sort((a, b) => a.v - b.v);

      const ranks = new Float64Array(samples.length);
      let i = 0;
      while (i < indexed.length) {
        let j = i;
        while (j < indexed.length && indexed[j].v === indexed[i].v) {j++;}
        const avgRank = (i + 1 + j) / 2;
        for (let k = i; k < j; k++) {ranks[indexed[k].i] = avgRank;}
        i = j;
      }

      const xRanks = new Float64Array(ranks.length - 1);
      const yRanks = new Float64Array(ranks.length - 1);
      for (let k = 0; k < xRanks.length; k++) {
        xRanks[k] = ranks[k];
        yRanks[k] = ranks[k + 1];
      }

      let sumXY = 0,
        sumX = 0,
        sumY = 0,
        sumX2 = 0,
        sumY2 = 0;
      const n = xRanks.length;
      for (let k = 0; k < n; k++) {
        const x = xRanks[k];
        const y = yRanks[k];
        sumXY += x * y;
        sumX += x;
        sumY += y;
        sumX2 += x * x;
        sumY2 += y * y;
      }
      const top = n * sumXY - sumX * sumY;
      const bot = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
      allCorrs.push(top / bot);
    }

    const avgCorr = allCorrs.reduce((a, b) => a + b, 0) / allCorrs.length;
    expect(avgCorr).toBeLessThan(0.8);
  });

  it('should generate diverse delays (not constant)', () => {
    const results = new Set<number>();
    let prev = 500;
    for (let i = 0; i < 100; i++) {
      const r = decorrelatedStrategy({
        attempt: i,
        baseDelayMs: 100,
        maxDelayMs: 10000,
        multiplier: 3,
        previousDelay: prev,
      });
      results.add(r.delayMs);
      prev = r.delayMs;
    }
    expect(results.size).toBeGreaterThan(10);
  });
});
