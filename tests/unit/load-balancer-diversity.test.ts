import { describe, it, expect } from 'vitest';
import { LoadBalancer } from '../../src/load-balancer/load-balancer.js';
import type { AIServer, ServerModelMetrics } from '../../src/orchestrator/orchestrator.types.js';

function createHotServer(id: string, latencyMs: number, model: string): AIServer {
  return {
    id,
    url: `http://localhost:11434/${id}`,
    type: 'ollama',
    healthy: true,
    lastResponseTime: latencyMs,
    models: [model],
    maxConcurrency: 4,
    hardware: {
      totalVram: 24 * 1024,
      usedVram: 8 * 1024,
      loadedModels: [{ name: model, sizeVram: 4 * 1024, expiresAt: new Date(Date.now() + 3600_000).toISOString() }],
      lastUpdated: new Date(),
    },
  };
}

function createColdServer(id: string, model: string): AIServer {
  return {
    id,
    url: `http://localhost:11434/${id}`,
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: [model],
    maxConcurrency: 4,
  };
}

function createMetrics(model: string, latencyMs: number): ServerModelMetrics {
  return {
    serverId: 'test',
    model,
    inFlight: 0,
    queued: 0,
    windows: {} as any,
    percentiles: { p50: latencyMs, p95: latencyMs * 1.2, p99: latencyMs * 1.5 },
    successRate: 1.0,
    throughput: 10,
    avgTokensPerRequest: 50,
    avgTokensPerSecond: 0,
    coldStartCount: 0,
    lastUpdated: Date.now(),
    recentLatencies: [],
  };
}

describe('Load Balancer Diversity (B1 Fix)', () => {
  describe('selectFastestResponse round-robin tie-breaker', () => {
    it('4 identical hot servers — 20 requests distribute across all 4 (each ~25%, no server >50%)', () => {
      const lb = new LoadBalancer();
      const model = 'llama3:latest';
      const servers = [
        createHotServer('s1', 100, model),
        createHotServer('s2', 100, model),
        createHotServer('s3', 100, model),
        createHotServer('s4', 100, model),
      ];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => createMetrics(model, 100);

      const selectionCounts: Record<string, number> = { s1: 0, s2: 0, s3: 0, s4: 0 };

      for (let i = 0; i < 20; i++) {
        const selected = lb.select(servers, model, getLoad, getTotalLoad, getMetrics);
        if (selected) {
          selectionCounts[selected.id]++;
        }
      }

      const maxCount = Math.max(...Object.values(selectionCounts));
      expect(maxCount).toBeLessThanOrEqual(10);
      expect(maxCount / 20).toBeLessThanOrEqual(0.5);
    });

    it('round-robin alternates when scores tied within 5% — no server dominates', () => {
      const lb = new LoadBalancer();
      const model = 'mixtral:latest';
      const servers = [
        createHotServer('a', 100, model),
        createHotServer('b', 103, model),
        createHotServer('c', 107, model),
      ];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => createMetrics(model, 100);

      const selections: string[] = [];
      for (let i = 0; i < 6; i++) {
        const selected = lb.select(servers, model, getLoad, getTotalLoad, getMetrics);
        selections.push(selected?.id ?? 'none');
      }

      const aCount = selections.filter(s => s === 'a').length;
      const bCount = selections.filter(s => s === 'b').length;
      const cCount = selections.filter(s => s === 'c').length;

      expect(aCount).toBeGreaterThan(0);
      expect(bCount).toBeGreaterThan(0);
      expect(cCount).toBeGreaterThan(0);
      const maxCount = Math.max(aCount, bCount, cCount);
      expect(maxCount).toBeLessThanOrEqual(3);
    });

    it('hot vs cold with high gap — hot dominates when diversity threshold not met', () => {
      const lb = new LoadBalancer();
      const model = 'phi3:latest';

      // Hot: base=100, p95=120 -> blended=108, adjusted=86.4 (0.8x)
      // Cold: base=100, p95=120 -> blended=108, adjusted=118.8 (1.1x)
      // threshold = 86.4 * 1.05 = 90.72 — only hot is within 5%
      // -> diversity mechanism NOT triggered, hot always wins
      const hotServer = createHotServer('hot', 100, model);
      const cold1 = createColdServer('cold1', model);
      const cold2 = createColdServer('cold2', model);
      const cold3 = createColdServer('cold3', model);

      const servers = [hotServer, cold1, cold2, cold3];

      const getLoad = () => 0;
      const getTotalLoad = () => 0;
      const getMetrics = () => createMetrics(model, 100);

      const selectionCounts: Record<string, number> = { hot: 0, cold1: 0, cold2: 0, cold3: 0 };

      for (let i = 0; i < 20; i++) {
        const selected = lb.select(servers, model, getLoad, getTotalLoad, getMetrics);
        if (selected) {
          selectionCounts[selected.id]++;
        }
      }

      // With gap so large, hot takes all 20
      expect(selectionCounts.hot).toBe(20);
      const coldTotal = selectionCounts.cold1 + selectionCounts.cold2 + selectionCounts.cold3;
      expect(coldTotal).toBe(0);
    });
  });
});
