import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DecisionHistory } from '../../src/decision-history';
import type { FailoverAttempt } from '../../src/decision-history';
import type { ServerScore } from '../../src/load-balancer';
import type { AIServer } from '../../src/orchestrator.types';

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
        throughputScore: 0,
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
            throughputScore: 0,
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

  describe('recordFailoverAttempt (REC-74)', () => {
    it('should record a single failover attempt', () => {
      history.recordFailoverAttempt({
        model: 'llama3:latest',
        phase: 1,
        serverId: 'server-1',
        result: 'success',
        latencyMs: 120,
      });
      const attempts = history.getRecentFailoverAttempts();
      expect(attempts).toHaveLength(1);
      expect(attempts[0].model).toBe('llama3:latest');
      expect(attempts[0].phase).toBe(1);
      expect(attempts[0].serverId).toBe('server-1');
      expect(attempts[0].result).toBe('success');
      expect(attempts[0].latencyMs).toBe(120);
      expect(attempts[0].timestamp).toBeTypeOf('number');
    });

    it('should record failure attempt with errorType', () => {
      history.recordFailoverAttempt({
        model: 'llama3:latest',
        phase: 2,
        serverId: 'server-2',
        result: 'failure',
        errorType: 'timeout',
        latencyMs: 5000,
      });
      const attempts = history.getRecentFailoverAttempts();
      expect(attempts[0].result).toBe('failure');
      expect(attempts[0].errorType).toBe('timeout');
    });

    it('should record skipped attempt without latency', () => {
      history.recordFailoverAttempt({
        model: 'llama3:latest',
        phase: 3,
        serverId: 'server-3',
        result: 'skipped',
      });
      const attempts = history.getRecentFailoverAttempts();
      expect(attempts[0].result).toBe('skipped');
      expect(attempts[0].latencyMs).toBeUndefined();
    });

    it('should record a full 3-server failover chain', () => {
      // Phase 1: server-1 fails
      history.recordFailoverAttempt({
        model: 'llama3:latest',
        phase: 1,
        serverId: 'server-1',
        result: 'failure',
        errorType: 'connection_error',
        latencyMs: 100,
      });
      // Phase 2: server-2 skipped at capacity
      history.recordFailoverAttempt({
        model: 'llama3:latest',
        phase: 2,
        serverId: 'server-2',
        result: 'skipped',
      });
      // Phase 3: server-3 succeeds
      history.recordFailoverAttempt({
        model: 'llama3:latest',
        phase: 3,
        serverId: 'server-3',
        result: 'success',
        latencyMs: 250,
      });

      const attempts = history.getRecentFailoverAttempts(10, 'llama3:latest');
      expect(attempts).toHaveLength(3);

      // All three server IDs are present
      const serverIds = attempts.map(a => a.serverId);
      expect(serverIds).toContain('server-1');
      expect(serverIds).toContain('server-2');
      expect(serverIds).toContain('server-3');

      // All three phases are present
      const phases = attempts.map(a => a.phase);
      expect(phases).toContain(1);
      expect(phases).toContain(2);
      expect(phases).toContain(3);

      // Correct results per server
      const byServer = Object.fromEntries(attempts.map(a => [a.serverId, a]));
      expect(byServer['server-1'].result).toBe('failure');
      expect(byServer['server-1'].errorType).toBe('connection_error');
      expect(byServer['server-2'].result).toBe('skipped');
      expect(byServer['server-3'].result).toBe('success');
      expect(byServer['server-3'].latencyMs).toBe(250);
    });

    it('clear() should also clear failover attempts', () => {
      history.recordFailoverAttempt({
        model: 'llama3:latest',
        phase: 1,
        serverId: 'server-1',
        result: 'success',
      });
      expect(history.getRecentFailoverAttempts()).toHaveLength(1);
      history.clear();
      expect(history.getRecentFailoverAttempts()).toHaveLength(0);
    });
  });

  describe('getRecentFailoverAttempts (REC-74)', () => {
    beforeEach(() => {
      // Seed attempts across two models
      history.recordFailoverAttempt({
        model: 'llama3:latest',
        phase: 1,
        serverId: 'server-1',
        result: 'success',
      });
      history.recordFailoverAttempt({
        model: 'llama3:latest',
        phase: 2,
        serverId: 'server-2',
        result: 'failure',
        errorType: 'timeout',
      });
      history.recordFailoverAttempt({
        model: 'llama2:latest',
        phase: 1,
        serverId: 'server-1',
        result: 'success',
      });
    });

    it('should return all attempts when no model filter', () => {
      const attempts = history.getRecentFailoverAttempts();
      expect(attempts).toHaveLength(3);
    });

    it('should filter by model', () => {
      const attempts = history.getRecentFailoverAttempts(100, 'llama3:latest');
      expect(attempts).toHaveLength(2);
      expect(attempts.every(a => a.model === 'llama3:latest')).toBe(true);
    });

    it('should filter by another model', () => {
      const attempts = history.getRecentFailoverAttempts(100, 'llama2:latest');
      expect(attempts).toHaveLength(1);
      expect(attempts[0].model).toBe('llama2:latest');
    });

    it('should respect the limit parameter', () => {
      const attempts = history.getRecentFailoverAttempts(2);
      expect(attempts).toHaveLength(2);
    });

    it('should return most recent first', () => {
      const attempts = history.getRecentFailoverAttempts();
      for (let i = 0; i < attempts.length - 1; i++) {
        expect(attempts[i].timestamp).toBeGreaterThanOrEqual(attempts[i + 1].timestamp);
      }
    });

    it('should return empty array when no attempts match model', () => {
      const attempts = history.getRecentFailoverAttempts(100, 'nonexistent:model');
      expect(attempts).toHaveLength(0);
    });
  });
});
