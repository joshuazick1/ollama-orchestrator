import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock SQLite store used by DecisionHistory Phase 2 reads/writes
vi.mock('../../src/storage/metrics-store.js', () => {
  const mockStore = {
    getDecisions: vi.fn(),
    recordDecision: vi.fn(),
  };
  return { getMetricsStore: () => mockStore, _mockStore: mockStore };
});

import { DecisionHistory } from '../../src/decision-history.js';
import type { ServerScore } from '../../src/load-balancer/load-balancer.js';
import type { AIServer } from '../../src/orchestrator/orchestrator.types.js';

describe('DecisionHistory requestId', () => {
  let history: DecisionHistory;
  const mockServer: AIServer = {
    id: 'server-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
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
        vramScore: 0,
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

  describe('recordDecision with requestId', () => {
    it('should store requestId when provided', () => {
      const requestId = 'test-request-123';
      history.recordDecision(
        'llama3:latest',
        mockServer,
        'weighted',
        mockScores,
        'best_score',
        requestId
      );

      const events = history.getRecentEvents(1);
      expect(events).toHaveLength(1);
      expect(events[0].requestId).toBe(requestId);
    });

    it('should work without requestId (backward compatible)', () => {
      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores, 'best_score');

      const events = history.getRecentEvents(1);
      expect(events).toHaveLength(1);
      expect(events[0].requestId).toBeUndefined();
    });

    it('should return requestId in getRecentEvents', () => {
      const requestId1 = 'req-001';
      const requestId2 = 'req-002';

      history.recordDecision(
        'llama3:latest',
        mockServer,
        'weighted',
        mockScores,
        'single_candidate',
        requestId1
      );
      history.recordDecision(
        'llama2:latest',
        mockServer,
        'round-robin',
        mockScores,
        'load_balancer',
        requestId2
      );
      history.recordDecision('llama3:latest', mockServer, 'weighted', mockScores, 'best_score');

      const events = history.getRecentEvents(3);

      const eventWithReq1 = events.find(e => e.requestId === requestId1);
      const eventWithReq2 = events.find(e => e.requestId === requestId2);
      const eventWithoutReq = events.find(e => e.requestId === undefined);

      expect(eventWithReq1).toBeDefined();
      expect(eventWithReq1?.selectionReason).toBe('single_candidate');
      expect(eventWithReq2).toBeDefined();
      expect(eventWithReq2?.selectionReason).toBe('load_balancer');
      expect(eventWithoutReq).toBeDefined();
      expect(eventWithoutReq?.selectionReason).toBe('best_score');
    });
  });
});
