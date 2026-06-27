/**
 * perf-probe-scorer.test.ts
 * Tests for perf-probe-scorer utilities
 */

import { describe, it, expect } from 'vitest';

import type { ServerScore } from '../../src/types/perf-probe.types.js';
import type { ProbeRunResult } from '../../src/types/perf-probe.types.js';
import {
  computeCompositeScore,
  rankServers,
  selectBestResultPerServer,
} from '../../src/utils/perf-probe-scorer.js';

describe('computeCompositeScore', () => {
  it('returns ~0.745 for (100ms, 50 tps)', () => {
    const score = computeCompositeScore(100, 50);
    expect(score).toBeCloseTo(0.6 * (1 / (1 + 0.1)) + 0.4 * 0.5, 3);
  });

  it('returns 1.0 for (0ms, 100 tps)', () => {
    const score = computeCompositeScore(0, 100);
    expect(score).toBeCloseTo(1.0, 5);
  });

  it('returns ~0 for (Infinity, 0)', () => {
    const score = computeCompositeScore(Infinity, 0);
    expect(score).toBeCloseTo(0, 5);
  });

  it('caps TPS at 100', () => {
    const score200 = computeCompositeScore(0, 200);
    const score100 = computeCompositeScore(0, 100);
    expect(score200).toBeCloseTo(score100, 5);
  });

  it('returns 0.6 for (0ms, 0 tps)', () => {
    const score = computeCompositeScore(0, 0);
    expect(score).toBeCloseTo(0.6, 5);
  });

  it('returns 0.4 for (Infinity, 100 tps)', () => {
    const score = computeCompositeScore(Infinity, 100);
    expect(score).toBeCloseTo(0.4, 5);
  });
});

describe('rankServers', () => {
  it('assigns rank 1 to highest score', () => {
    const servers: ServerScore[] = [
      { serverId: 'a', score: 0.5, ttftMs: 100, tokensPerSec: 50, modelUsed: 'm1', rank: 0 },
      { serverId: 'b', score: 0.9, ttftMs: 50, tokensPerSec: 80, modelUsed: 'm1', rank: 0 },
    ];
    const ranked = rankServers(servers);
    expect(ranked.find(s => s.serverId === 'b')?.rank).toBe(1);
    expect(ranked.find(s => s.serverId === 'a')?.rank).toBe(2);
  });

  it('sorts descending by score', () => {
    const servers: ServerScore[] = [
      { serverId: 'a', score: 0.3, ttftMs: 200, tokensPerSec: 30, modelUsed: 'm1', rank: 0 },
      { serverId: 'b', score: 0.7, ttftMs: 100, tokensPerSec: 60, modelUsed: 'm1', rank: 0 },
      { serverId: 'c', score: 0.5, ttftMs: 150, tokensPerSec: 45, modelUsed: 'm1', rank: 0 },
    ];
    const ranked = rankServers(servers);
    expect(ranked[0].score).toBe(0.7);
    expect(ranked[1].score).toBe(0.5);
    expect(ranked[2].score).toBe(0.3);
  });

  it('does not mutate input array', () => {
    const servers: ServerScore[] = [
      { serverId: 'a', score: 0.5, ttftMs: 100, tokensPerSec: 50, modelUsed: 'm1', rank: 0 },
    ];
    rankServers(servers);
    expect(servers[0].rank).toBe(0);
  });

  it('assigns sequential ranks to ties', () => {
    const servers: ServerScore[] = [
      { serverId: 'a', score: 0.5, ttftMs: 100, tokensPerSec: 50, modelUsed: 'm1', rank: 0 },
      { serverId: 'b', score: 0.5, ttftMs: 100, tokensPerSec: 50, modelUsed: 'm1', rank: 0 },
      { serverId: 'c', score: 0.9, ttftMs: 50, tokensPerSec: 80, modelUsed: 'm1', rank: 0 },
    ];
    const ranked = rankServers(servers);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
    expect(ranked[2].rank).toBe(3);
  });

  it('returns new array', () => {
    const servers: ServerScore[] = [
      { serverId: 'a', score: 0.5, ttftMs: 100, tokensPerSec: 50, modelUsed: 'm1', rank: 0 },
    ];
    const ranked = rankServers(servers);
    expect(ranked).not.toBe(servers);
  });
});

describe('selectBestResultPerServer', () => {
  it('returns best-scoring result per serverId', () => {
    const results: ProbeRunResult[] = [
      {
        serverId: 's1',
        model: 'm1',
        success: true,
        ttftMs: 100,
        tokensPerSec: 50,
        totalDurationMs: 1000,
        score: 0.5,
      },
      {
        serverId: 's1',
        model: 'm2',
        success: true,
        ttftMs: 50,
        tokensPerSec: 80,
        totalDurationMs: 800,
        score: 0.8,
      },
      {
        serverId: 's2',
        model: 'm1',
        success: true,
        ttftMs: 200,
        tokensPerSec: 30,
        totalDurationMs: 1200,
        score: 0.4,
      },
    ];
    const best = selectBestResultPerServer(results);
    expect(best.get('s1')?.score).toBe(0.8);
    expect(best.get('s2')?.score).toBe(0.4);
  });

  it('ignores failed results', () => {
    const results: ProbeRunResult[] = [
      { serverId: 's1', model: 'm1', success: false, totalDurationMs: 1000, error: 'fail' },
      {
        serverId: 's1',
        model: 'm2',
        success: true,
        ttftMs: 50,
        tokensPerSec: 80,
        totalDurationMs: 800,
        score: 0.8,
      },
    ];
    const best = selectBestResultPerServer(results);
    expect(best.get('s1')?.model).toBe('m2');
  });

  it('ignores results without score', () => {
    const results: ProbeRunResult[] = [
      {
        serverId: 's1',
        model: 'm1',
        success: true,
        ttftMs: 100,
        tokensPerSec: 50,
        totalDurationMs: 1000,
      },
      {
        serverId: 's1',
        model: 'm2',
        success: true,
        ttftMs: 50,
        tokensPerSec: 80,
        totalDurationMs: 800,
        score: 0.8,
      },
    ];
    const best = selectBestResultPerServer(results);
    expect(best.get('s1')?.score).toBe(0.8);
  });

  it('returns empty map when no successful results', () => {
    const results: ProbeRunResult[] = [
      { serverId: 's1', model: 'm1', success: false, totalDurationMs: 1000, error: 'fail' },
    ];
    const best = selectBestResultPerServer(results);
    expect(best.size).toBe(0);
  });
});
