import { describe, it, expect, beforeEach } from 'vitest';
import { LoadBalancer } from '../../src/load-balancer/load-balancer.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';
import type { ProbeOrchestrator } from '../../src/probe/probe-orchestrator.js';
import type { EndpointRegistry } from '../../src/probe/endpoint-registry.js';
import type { Tuple, ProbeEndpoint } from '../../src/probe/types.js';

function createMockServer(id: string): AIServer {
  return {
    id,
    name: `Server ${id}`,
    url: `http://localhost:800${id.slice(-1)}`,
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
    maxConcurrency: 4,
  } as AIServer;
}

class MockProbeOrchestrator implements Pick<ProbeOrchestrator, 'canServe'> {
  private states = new Map<string, 'HEALTHY' | 'SUSPECT' | 'UNHEALTHY' | 'RECOVERING'>();

  setState(
    serverId: string,
    model: string,
    endpoint: ProbeEndpoint,
    state: 'HEALTHY' | 'SUSPECT' | 'UNHEALTHY' | 'RECOVERING'
  ) {
    this.states.set(`${serverId}:${model}:${endpoint}`, state);
  }

  canServe(tuple: Tuple, caller: 'routing' | 'probe' | 'admin'): boolean {
    const state = this.states.get(`${tuple.serverId}:${tuple.model}:${tuple.endpoint}`);
    if (!state) return caller === 'admin';
    if (caller === 'admin') return true;
    if (caller === 'probe') return state === 'RECOVERING';
    if (caller === 'routing') return state === 'HEALTHY' || state === 'SUSPECT';
    return false;
  }
}

class MockEndpointRegistry implements Pick<EndpointRegistry, 'getActiveEndpoints'> {
  private endpoints = new Map<string, ProbeEndpoint[]>();

  setActiveEndpoints(serverId: string, model: string, endpoints: ProbeEndpoint[]) {
    this.endpoints.set(`${serverId}:${model}`, endpoints);
  }

  getActiveEndpoints(serverId: string, model: string): ProbeEndpoint[] {
    return this.endpoints.get(`${serverId}:${model}`) ?? [];
  }
}

describe('LoadBalancer canServe integration', () => {
  let probeOrchestrator: MockProbeOrchestrator;
  let endpointRegistry: MockEndpointRegistry;
  let loadBalancer: LoadBalancer;

  const model = 'llama3:latest';
  const endpoints: ProbeEndpoint[] = ['ollama_chat', 'ollama_generate'];

  function getLoad(_serverId: string, _model: string): number {
    return 0;
  }
  function getTotalLoad(_serverId: string): number {
    return 0;
  }
  function getMetrics(_serverId: string, _model: string) {
    return undefined;
  }

  beforeEach(() => {
    probeOrchestrator = new MockProbeOrchestrator();
    endpointRegistry = new MockEndpointRegistry();
    loadBalancer = new LoadBalancer();
    loadBalancer.setProbeOrchestrator(probeOrchestrator as unknown as ProbeOrchestrator);
    loadBalancer.setEndpointRegistry(endpointRegistry as unknown as EndpointRegistry);
  });

  describe('UNHEALTHY tuple — excluded from all algorithms', () => {
    const server1 = createMockServer('srv1');
    const server2 = createMockServer('srv2');

    beforeEach(() => {
      endpointRegistry.setActiveEndpoints('srv1', model, endpoints);
      endpointRegistry.setActiveEndpoints('srv2', model, endpoints);
      probeOrchestrator.setState('srv1', model, 'ollama_chat', 'HEALTHY');
      probeOrchestrator.setState('srv1', model, 'ollama_generate', 'HEALTHY');
      probeOrchestrator.setState('srv2', model, 'ollama_chat', 'UNHEALTHY');
      probeOrchestrator.setState('srv2', model, 'ollama_generate', 'UNHEALTHY');
    });

    it('selectWeighted excludes server with UNHEALTHY tuple', () => {
      loadBalancer.setAlgorithm('weighted');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectRoundRobin excludes server with UNHEALTHY tuple', () => {
      loadBalancer.setAlgorithm('round-robin');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectLeastConnections excludes server with UNHEALTHY tuple', () => {
      loadBalancer.setAlgorithm('least-connections');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectFastestResponse excludes server with UNHEALTHY tuple', () => {
      loadBalancer.setAlgorithm('fastest-response');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });
  });

  describe('RECOVERING tuple — excluded from routing', () => {
    const server1 = createMockServer('srv1');
    const server2 = createMockServer('srv2');

    beforeEach(() => {
      endpointRegistry.setActiveEndpoints('srv1', model, endpoints);
      endpointRegistry.setActiveEndpoints('srv2', model, endpoints);
      probeOrchestrator.setState('srv1', model, 'ollama_chat', 'HEALTHY');
      probeOrchestrator.setState('srv1', model, 'ollama_generate', 'HEALTHY');
      probeOrchestrator.setState('srv2', model, 'ollama_chat', 'RECOVERING');
      probeOrchestrator.setState('srv2', model, 'ollama_generate', 'RECOVERING');
    });

    it('selectWeighted excludes server with RECOVERING tuple', () => {
      loadBalancer.setAlgorithm('weighted');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectRoundRobin excludes server with RECOVERING tuple', () => {
      loadBalancer.setAlgorithm('round-robin');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectLeastConnections excludes server with RECOVERING tuple', () => {
      loadBalancer.setAlgorithm('least-connections');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectFastestResponse excludes server with RECOVERING tuple', () => {
      loadBalancer.setAlgorithm('fastest-response');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });
  });

  describe('SUSPECT tuple — included in routing (canServe returns true)', () => {
    const server1 = createMockServer('srv1');
    const server2 = createMockServer('srv2');

    beforeEach(() => {
      endpointRegistry.setActiveEndpoints('srv1', model, endpoints);
      endpointRegistry.setActiveEndpoints('srv2', model, endpoints);
      probeOrchestrator.setState('srv1', model, 'ollama_chat', 'HEALTHY');
      probeOrchestrator.setState('srv1', model, 'ollama_generate', 'HEALTHY');
      probeOrchestrator.setState('srv2', model, 'ollama_chat', 'SUSPECT');
      probeOrchestrator.setState('srv2', model, 'ollama_generate', 'SUSPECT');
    });

    it('selectWeighted includes server with SUSPECT tuple', () => {
      loadBalancer.setAlgorithm('weighted');
      const candidates = [server1, server2];
      const result = loadBalancer.select(candidates, model, getLoad, getTotalLoad, getMetrics);
      expect(result).toBeDefined();
      expect(['srv1', 'srv2']).toContain(result?.id);
    });

    it('selectRoundRobin includes server with SUSPECT tuple', () => {
      loadBalancer.setAlgorithm('round-robin');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result).toBeDefined();
      expect(['srv1', 'srv2']).toContain(result?.id);
    });

    it('selectLeastConnections includes server with SUSPECT tuple', () => {
      loadBalancer.setAlgorithm('least-connections');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result).toBeDefined();
      expect(['srv1', 'srv2']).toContain(result?.id);
    });

    it('selectFastestResponse includes server with SUSPECT tuple', () => {
      loadBalancer.setAlgorithm('fastest-response');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result).toBeDefined();
      expect(['srv1', 'srv2']).toContain(result?.id);
    });
  });

  describe('Server with no active endpoints — excluded', () => {
    const server1 = createMockServer('srv1');
    const server2 = createMockServer('srv2');

    beforeEach(() => {
      endpointRegistry.setActiveEndpoints('srv1', model, endpoints);
      probeOrchestrator.setState('srv1', model, 'ollama_chat', 'HEALTHY');
      probeOrchestrator.setState('srv1', model, 'ollama_generate', 'HEALTHY');
    });

    it('selectWeighted excludes server with no active endpoints', () => {
      loadBalancer.setAlgorithm('weighted');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectRoundRobin excludes server with no active endpoints', () => {
      loadBalancer.setAlgorithm('round-robin');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectLeastConnections excludes server with no active endpoints', () => {
      loadBalancer.setAlgorithm('least-connections');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectFastestResponse excludes server with no active endpoints', () => {
      loadBalancer.setAlgorithm('fastest-response');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });
  });

  describe('Server with at least one HEALTHY endpoint — included even if other endpoints are UNHEALTHY', () => {
    const server1 = createMockServer('srv1');
    const server2 = createMockServer('srv2');

    beforeEach(() => {
      endpointRegistry.setActiveEndpoints('srv1', model, endpoints);
      endpointRegistry.setActiveEndpoints('srv2', model, endpoints);
      probeOrchestrator.setState('srv1', model, 'ollama_chat', 'HEALTHY');
      probeOrchestrator.setState('srv1', model, 'ollama_generate', 'UNHEALTHY');
      probeOrchestrator.setState('srv2', model, 'ollama_chat', 'UNHEALTHY');
      probeOrchestrator.setState('srv2', model, 'ollama_generate', 'UNHEALTHY');
    });

    it('selectWeighted includes server with mixed endpoint states (one healthy)', () => {
      loadBalancer.setAlgorithm('weighted');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectRoundRobin includes server with mixed endpoint states (one healthy)', () => {
      loadBalancer.setAlgorithm('round-robin');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectLeastConnections includes server with mixed endpoint states (one healthy)', () => {
      loadBalancer.setAlgorithm('least-connections');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });

    it('selectFastestResponse includes server with mixed endpoint states (one healthy)', () => {
      loadBalancer.setAlgorithm('fastest-response');
      const result = loadBalancer.select(
        [server1, server2],
        model,
        getLoad,
        getTotalLoad,
        getMetrics
      );
      expect(result?.id).toBe('srv1');
    });
  });

  describe('Falls back to candidates when probe subsystem is not configured', () => {
    const server1 = createMockServer('srv1');
    const server2 = createMockServer('srv2');

    it('returns any candidate when probe orchestrator is not set', () => {
      loadBalancer.setAlgorithm('weighted');
      const lb = new LoadBalancer();
      const result = lb.select([server1, server2], model, getLoad, getTotalLoad, getMetrics);
      expect(result).toBeDefined();
    });
  });

  describe('All servers filtered out — returns undefined', () => {
    const server1 = createMockServer('srv1');

    beforeEach(() => {
      endpointRegistry.setActiveEndpoints('srv1', model, endpoints);
      probeOrchestrator.setState('srv1', model, 'ollama_chat', 'UNHEALTHY');
      probeOrchestrator.setState('srv1', model, 'ollama_generate', 'UNHEALTHY');
    });

    it('selectWeighted returns undefined when all servers filtered', () => {
      loadBalancer.setAlgorithm('weighted');
      const result = loadBalancer.select([server1], model, getLoad, getTotalLoad, getMetrics);
      expect(result).toBeUndefined();
    });
  });
});
