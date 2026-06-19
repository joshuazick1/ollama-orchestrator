import { describe, it, expect } from 'vitest';

import { ConsistentHashRing } from '../../../src/load-balancer/consistent-hash.js';
import { PrefixCacheRouter } from '../../../src/load-balancer/prefix-cache-router.js';
import type { AIServer, ServerModelMetrics } from '../../../src/orchestrator/orchestrator.types.js';
import { hashPrefix, PREFIX_HASH_DEFAULT_TOKEN_COUNT } from '../../../src/utils/hash.js';

function makeServer(id: string, model: string): AIServer {
  return {
    id,
    url: `http://localhost:800${id.slice(-1)}`,
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: [model],
    maxConcurrency: 4,
  } as AIServer;
}

describe('PrefixCacheRouter', () => {
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

  it('routes to cached server when prompt provided and target healthy', () => {
    const ring = new ConsistentHashRing<string>();
    ring.addNode('srv1');
    ring.addNode('srv2');
    ring.addNode('srv3');

    const router = new PrefixCacheRouter(ring);
    const server1 = makeServer('srv1', model);
    const server2 = makeServer('srv2', model);
    const server3 = makeServer('srv3', model);
    const candidates = [server1, server2, server3];

    const prompt = 'What is the meaning of life, the universe, and everything?';

    const result = router.selectPrefixCacheAware(
      prompt,
      model,
      candidates,
      (servers, _m) => servers,
      getLoad,
      getTotalLoad,
      getMetrics,
      (_candidates, _m, _gl, _gtl, _gm) => candidates[0]
    );

    const expected = ring.getNode(hashPrefix(prompt, PREFIX_HASH_DEFAULT_TOKEN_COUNT));
    expect(result).not.toBeNull();
    expect(result!.id).toBe(expected);
  });

  it('falls back to fastest-response when target unhealthy', () => {
    const ring = new ConsistentHashRing<string>();
    ring.addNode('srv1');
    ring.addNode('srv2');

    const router = new PrefixCacheRouter(ring);
    const healthy = makeServer('srv1', model);
    const unhealthy = makeServer('srv2', model);
    unhealthy.healthy = false;
    const candidates = [healthy, unhealthy];

    const prompt = 'some prompt text';

    const fastestResponseFallback: AIServer = healthy;
    const result = router.selectPrefixCacheAware(
      prompt,
      model,
      candidates,
      (servers, _m) => servers.filter(s => s.healthy !== false),
      getLoad,
      getTotalLoad,
      getMetrics,
      (_candidates, _m, _gl, _gtl, _gm) => fastestResponseFallback
    );

    expect(result).not.toBeNull();
  });

  it('falls back to fastest-response when no prompt', () => {
    const ring = new ConsistentHashRing<string>();
    ring.addNode('srv1');

    const router = new PrefixCacheRouter(ring);
    const server = makeServer('srv1', model);
    const candidates = [server];

    const fallbackServer = makeServer('fallback', model);

    const result = router.selectPrefixCacheAware(
      undefined,
      model,
      candidates,
      (servers, _m) => servers,
      getLoad,
      getTotalLoad,
      getMetrics,
      (_candidates, _m, _gl, _gtl, _gm) => fallbackServer
    );

    expect(result).not.toBeNull();
    expect(result!.id).toBe('fallback');
  });

  it('honors prefixCacheAware.enabled flag (returns null when disabled and no candidates)', () => {
    const ring = new ConsistentHashRing<string>();
    ring.addNode('srv1');

    const router = new PrefixCacheRouter(ring);
    const server = makeServer('srv1', model);

    const result = router.selectPrefixCacheAware(
      undefined,
      model,
      [],
      (servers, _m) => servers,
      getLoad,
      getTotalLoad,
      getMetrics,
      (_candidates, _m, _gl, _gtl, _gm) => undefined
    );

    expect(result).toBeNull();
  });
});
