import { describe, it, expect } from 'vitest';

import { LoadBalancer } from '../../src/load-balancer/load-balancer.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';

describe('LoadBalancer - roundRobinIndex bounds', () => {
  it('should not skip servers when index exceeds set size', () => {
    const lb = new LoadBalancer();
    lb.setAlgorithm('round-robin');

    const servers: AIServer[] = [
      {
        id: 'srv-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3'],
        maxConcurrency: 4,
      },
      {
        id: 'srv-2',
        url: 'http://localhost:11435',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3'],
        maxConcurrency: 4,
      },
      {
        id: 'srv-3',
        url: 'http://localhost:11436',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3'],
        maxConcurrency: 4,
      },
    ];

    const getLoad = () => 0;
    const getTotalLoad = () => 0;
    const getMetrics = () => undefined;

    (lb as any).roundRobinIndex = 100;

    const selected = lb.select(servers, 'llama3', getLoad, getTotalLoad, getMetrics);

    expect(selected?.id).toBeDefined();
    expect(['srv-1', 'srv-2', 'srv-3']).toContain(selected!.id);
  });

  it('should visit all servers when they come and go', () => {
    const lb = new LoadBalancer();
    lb.setAlgorithm('round-robin');

    const getLoad = () => 0;
    const getTotalLoad = () => 0;
    const getMetrics = () => undefined;

    const selectedIds = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const servers: AIServer[] = [
        {
          id: 'srv-1',
          url: 'http://localhost:11434',
          type: 'ollama',
          healthy: true,
          lastResponseTime: 100,
          models: ['llama3'],
          maxConcurrency: 4,
        },
        {
          id: 'srv-2',
          url: 'http://localhost:11435',
          type: 'ollama',
          healthy: true,
          lastResponseTime: 100,
          models: ['llama3'],
          maxConcurrency: 4,
        },
        {
          id: 'srv-3',
          url: 'http://localhost:11436',
          type: 'ollama',
          healthy: true,
          lastResponseTime: 100,
          models: ['llama3'],
          maxConcurrency: 4,
        },
      ];
      const selected = lb.select(servers, 'llama3', getLoad, getTotalLoad, getMetrics);
      if (selected) {
        selectedIds.add(selected.id);
      }
    }

    expect(selectedIds.size).toBe(3);
  });

  it('should bound index to eligible set size after filtering', () => {
    const lb = new LoadBalancer();
    lb.setAlgorithm('round-robin');

    const getLoad = () => 0;
    const getTotalLoad = () => 0;
    const getMetrics = () => undefined;

    (lb as any).roundRobinIndex = 50;

    const servers: AIServer[] = [
      {
        id: 'srv-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: false,
        lastResponseTime: 100,
        models: ['llama3'],
        maxConcurrency: 4,
      },
      {
        id: 'srv-2',
        url: 'http://localhost:11435',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3'],
        maxConcurrency: 4,
      },
      {
        id: 'srv-3',
        url: 'http://localhost:11436',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3'],
        maxConcurrency: 4,
      },
    ];

    const selected = lb.select(servers, 'llama3', getLoad, getTotalLoad, getMetrics);

    expect(['srv-2', 'srv-3']).toContain(selected!.id);
  });
});
