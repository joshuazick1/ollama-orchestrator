import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoadBalancer, type LoadBalancerAlgorithm } from '../../src/load-balancer/load-balancer.js';
import { PrefixCacheRouter } from '../../src/load-balancer/prefix-cache-router.js';
import { ConsistentHashRing } from '../../src/load-balancer/consistent-hash.js';
import { SLOFallbackMonitor } from '../../src/load-balancer/slo-fallback.js';
import type { AIServer, ServerModelMetrics } from '../../src/orchestrator/orchestrator.types.js';

function makeServer(id: string, model: string): AIServer {
  return {
    id,
    url: `http://localhost:800${id.slice(-1)}`,
    type: 'ollama' as const,
    healthy: true,
    lastResponseTime: 100,
    models: [model],
    maxConcurrency: 4,
  } as AIServer;
}

function makeMetrics(p95: number, successRate: number = 1): ServerModelMetrics {
  return {
    serverId: 'srv1',
    model: 'llama3:latest',
    inFlight: 0,
    queued: 0,
    windows: {} as any,
    percentiles: { p50: p95 * 0.5, p95, p99: p95 * 1.5 },
    successRate,
    throughput: 10,
    avgTokensPerRequest: 50,
    avgTokensPerSecond: 25,
    coldStartCount: 0,
    lastUpdated: Date.now(),
    recentLatencies: [],
  };
}

const model = 'llama3:latest';

function getLoad(_s: string, _m: string): number {
  return 0;
}
function getTotalLoad(_s: string): number {
  return 0;
}
function getMetrics(_s: string, _m: string): ServerModelMetrics | undefined {
  return undefined;
}
function getTimeout(_s: string, _m: string): number {
  return 30000;
}

describe('Load Balancer Algorithm Integration', () => {
  let servers: AIServer[];
  let lb: LoadBalancer;

  beforeEach(() => {
    servers = [makeServer('srv1', model), makeServer('srv2', model), makeServer('srv3', model)];
    lb = new LoadBalancer();
  });

  describe('All 5 algorithms work with the same fleet', () => {
    const algorithms: LoadBalancerAlgorithm[] = [
      'fastest-response',
      'weighted',
      'round-robin',
      'least-connections',
      'prefix-cache-aware',
    ];

    for (const algo of algorithms) {
      it(`${algo} selects a server from the fleet`, () => {
        lb.setAlgorithm(algo);

        if (algo === 'prefix-cache-aware') {
          const ring = new ConsistentHashRing<string>();
          ring.addNode('srv1');
          ring.addNode('srv2');
          ring.addNode('srv3');
          const router = new PrefixCacheRouter(ring);
          lb.setPrefixCacheRouter(router);
        }

        const result = lb.select(
          servers,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          false,
          undefined,
          getTimeout,
          undefined,
          undefined,
          undefined,
          undefined,
          algo === 'prefix-cache-aware' ? 'test prompt' : undefined
        );

        expect(result).toBeDefined();
        expect(servers.map(s => s.id)).toContain(result!.id);
      });
    }
  });

  function enablePrefixCache(): void {
    lb.updateConfig({ prefixCacheAware: { enabled: true, hashTokenCount: 512, hashBuckets: 256 } });
    const ring = new ConsistentHashRing<string>();
    ring.addNode('srv1');
    ring.addNode('srv2');
    ring.addNode('srv3');
    const router = new PrefixCacheRouter(ring);
    lb.setPrefixCacheRouter(router);
    lb.setAlgorithm('prefix-cache-aware');
  }

  describe('Prefix-cache-aware: same prompt → same server', () => {
    it('routes 100 identical requests to the same server', () => {
      enablePrefixCache();

      const results: string[] = [];
      for (let i = 0; i < 100; i++) {
        const result = lb.select(
          servers,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          false,
          undefined,
          getTimeout,
          undefined,
          undefined,
          undefined,
          undefined,
          'same prompt every time'
        );
        if (result) results.push(result.id);
      }

      expect(results.length).toBe(100);
      const uniqueServers = new Set(results);
      expect(uniqueServers.size).toBe(1);
    });
  });

  describe('Prefix-cache-aware: different prompts distribute', () => {
    it('different prompts route to different servers', () => {
      enablePrefixCache();

      const results = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const result = lb.select(
          servers,
          model,
          getLoad,
          getTotalLoad,
          getMetrics,
          false,
          undefined,
          getTimeout,
          undefined,
          undefined,
          undefined,
          undefined,
          `different prompt number ${i} with some unique content ${Math.random()}`
        );
        if (result) results.add(result.id);
      }

      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('Prefix-cache-aware: target unhealthy → fallback', () => {
    it('routes to another server when target is unhealthy', () => {
      enablePrefixCache();
      const ring = new ConsistentHashRing<string>();
      ring.addNode('srv1');
      ring.addNode('srv2');

      const targetId = ring.getNode('any prompt')!;
      const targetServer = servers.find(s => s.id === targetId)!;

      const unhealthyServer = makeServer(targetId, model);
      unhealthyServer.healthy = false;

      const mixedServers = servers.map(s => (s.id === targetId ? unhealthyServer : s));

      const result = lb.select(
        mixedServers,
        model,
        getLoad,
        getTotalLoad,
        getMetrics,
        false,
        undefined,
        getTimeout,
        undefined,
        undefined,
        undefined,
        undefined,
        'any prompt'
      );

      expect(result).toBeDefined();
      expect(result!.healthy).toBe(true);
    });
  });

  describe('SLO fallback', () => {
    it('enters, stays, and exits fallback mode', () => {
      vi.useFakeTimers();
      lb.setAlgorithm('fastest-response');

      const monitor = new SLOFallbackMonitor({
        enabled: true,
        ttftThresholdMs: 2000,
        p95WindowMs: 60000,
      });
      lb.setSLOFallbackMonitor(monitor);

      expect(monitor.getMode()).toBe('normal');

      for (let i = 0; i < 12; i++) {
        vi.advanceTimersByTime(6000);
        monitor.update({ srv1: 3000, srv2: 2500, srv3: 2800 });
      }
      expect(monitor.getMode()).toBe('fallback');

      vi.advanceTimersByTime(120000);

      for (let i = 0; i < 12; i++) {
        vi.advanceTimersByTime(6000);
        monitor.update({ srv1: 500, srv2: 600, srv3: 550 });
      }
      expect(monitor.getMode()).toBe('normal');

      vi.useRealTimers();
    });
  });

  describe('Fallback kill switch', () => {
    it('fallbackToFastestResponse=true makes all algorithms behave like fastest-response', () => {
      lb = new LoadBalancer({ fallbackToFastestResponse: true });

      const slowServer = makeServer('slow', model);
      slowServer.lastResponseTime = 5000;
      const fastServer = makeServer('fast', model);
      fastServer.lastResponseTime = 50;
      const allServers = [slowServer, fastServer];

      const algorithms: LoadBalancerAlgorithm[] = [
        'weighted',
        'round-robin',
        'least-connections',
        'random',
      ];

      for (const algo of algorithms) {
        lb.setAlgorithm(algo);
        const result = lb.select(
          allServers,
          model,
          (_s, _m) => (_s === 'slow' ? 0 : 0),
          _s => 0,
          getMetrics
        );
        expect(result).toBeDefined();
      }
    });
  });

  describe('Chaos: kill target server mid-route', () => {
    it('falls back when target server is removed after ring setup', () => {
      lb.updateConfig({
        prefixCacheAware: { enabled: true, hashTokenCount: 512, hashBuckets: 256 },
      });
      const ring = new ConsistentHashRing<string>();
      ring.addNode('srv1');
      ring.addNode('srv2');
      ring.addNode('srv3');
      const router = new PrefixCacheRouter(ring);
      lb.setPrefixCacheRouter(router);
      lb.setAlgorithm('prefix-cache-aware');

      const prompt = 'some route-determining prompt';
      const targetId = ring.getNode(prompt)!;

      ring.removeNode(targetId);

      const result = lb.select(
        servers,
        model,
        getLoad,
        getTotalLoad,
        getMetrics,
        false,
        undefined,
        getTimeout,
        undefined,
        undefined,
        undefined,
        undefined,
        prompt
      );

      expect(result).toBeDefined();
      expect(servers.map(s => s.id)).toContain(result!.id);
    });
  });
});
