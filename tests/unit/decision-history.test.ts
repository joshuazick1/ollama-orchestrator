import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DecisionHistory } from '../../src/decision-history';
import type { AIServer } from '../../src/orchestrator.types';
import type { ServerScore } from '../../src/load-balancer';

describe('DecisionHistory', () => {
  let history: DecisionHistory;
  const mockServer: AIServer = {
    id: 'server-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
  };
  const mockServer2: AIServer = {
    id: 'server-2',
    url: 'http://localhost:11435',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 150,
    models: ['llama2:latest'],
  };
  const mockScores: ServerScore[] = [
    {
      server: mockServer,
      totalScore: 80,
      breakdown: {
        latencyScore: 90,
        successRateScore: 95,
        loadScore: 85,
        capacityScore: 100,
        circuitBreakerScore: 100,
        timeoutScore: 100,
      },
    },
  ];

  beforeEach(() => {
    history = new DecisionHistory({
      maxEvents: 100,
      persistenceEnabled: false,
    });
  });

  afterEach(() => {
    history.stop();
  });

  describe('recordDecision', () => {
    it('should record a decision event', () => {
      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores);
      expect(history.getEventCount()).toBe(1);
    });

    it('should record multiple decisions', () => {
      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores);
      history.recordDecision('llama2:latest', mockServer, 'round-robin', mockScores);
      expect(history.getEventCount()).toBe(2);
    });
  });

  describe('getRecentEvents', () => {
    it('should return recent events', () => {
      for (let i = 0; i < 5; i++) {
        history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores);
      }

      const events = history.getRecentEvents(3);
      expect(events.length).toBe(3);
    });

    it('should filter by model', () => {
      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores);
      history.recordDecision('llama2:latest', mockServer, 'weighted', mockScores);
      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores);

      const events = history.getRecentEvents(10, 'llama3:latest');

      expect(events.length).toBe(2);
      expect(events.every(e => e.model === 'llama3:latest')).toBe(true);
    });

    it('should filter by server', () => {
      const mockScores2: ServerScore[] = [
        {
          server: mockServer2,
          totalScore: 90,
          breakdown: {
            latencyScore: 95,
            successRateScore: 100,
            loadScore: 90,
            capacityScore: 100,
            circuitBreakerScore: 100,
            timeoutScore: 100,
          },
        },
      ];

      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores);
      history.recordDecision('llama3:latest', mockServer2, 'weighted', mockScores2);

      const events = history.getRecentEvents(10, undefined, 'server-1');

      expect(events.length).toBe(1);
      expect(events[0].selectedServerId).toBe('server-1');
    });
  });

  describe('getServerModelTrend', () => {
    it('should return trend data for server:model', () => {
      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores);
      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores);

      const trend = history.getServerModelTrend('server-1', 'llama3:latest');

      expect(trend.serverId).toBe('server-1');
      expect(trend.model).toBe('llama3:latest');
      expect(trend.selectionCount).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all events', () => {
      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores);
      expect(history.getEventCount()).toBe(1);

      history.clear();
      expect(history.getEventCount()).toBe(0);
    });
  });

  describe('getEventCount', () => {
    it('should return 0 for empty history', () => {
      expect(history.getEventCount()).toBe(0);
    });
  });
});
