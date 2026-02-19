import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestHistory } from '../../src/request-history';
import type { RequestContext, AIServer } from '../../src/orchestrator.types';

describe('RequestHistory', () => {
  let history: RequestHistory;
  const mockServer: AIServer = {
    id: 'server-1',
    url: 'http://localhost:11434',
    type: 'ollama',
    healthy: true,
    lastResponseTime: 100,
    models: ['llama3:latest'],
    maxConcurrency: 4,
  };

  function createMockContext(overrides: Partial<RequestContext> = {}): RequestContext {
    return {
      id: `req-${Date.now()}-${Math.random()}`,
      startTime: Date.now() - 1000,
      endTime: Date.now(),
      model: 'llama3:latest',
      endpoint: 'generate',
      streaming: false,
      success: true,
      duration: 500,
      serverId: 'server-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    history = new RequestHistory({
      maxRequestsPerServer: 1000,
      retentionHours: 1,
      enablePersistence: false,
    });
  });

  describe('recordRequest', () => {
    it('should record a request', () => {
      const context = createMockContext();
      history.recordRequest(context);

      expect(history.getTotalRequestCount()).toBe(1);
    });

    it('should record request with queue wait time', () => {
      const context = createMockContext();
      history.recordRequest(context, 100);

      expect(history.getTotalRequestCount()).toBe(1);
    });

    it('should record failed request', () => {
      const context = createMockContext({ success: false, error: new Error('Test error') });
      history.recordRequest(context);

      expect(history.getTotalRequestCount()).toBe(1);
    });

    it('should record streaming request', () => {
      const context = createMockContext({ streaming: true });
      history.recordRequest(context);

      expect(history.getTotalRequestCount()).toBe(1);
    });
  });

  describe('getServerHistory', () => {
    it('should get server history', () => {
      history.recordRequest(createMockContext({ serverId: 'server-1' }));
      history.recordRequest(createMockContext({ serverId: 'server-1' }));
      history.recordRequest(createMockContext({ serverId: 'server-2' }));

      const server1History = history.getServerHistory('server-1');
      expect(server1History).toHaveLength(2);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        history.recordRequest(createMockContext({ serverId: 'server-1' }));
      }

      const server1History = history.getServerHistory('server-1', 3);
      expect(server1History).toHaveLength(3);
    });

    it('should handle offset', () => {
      for (let i = 0; i < 10; i++) {
        history.recordRequest(createMockContext({ serverId: 'server-1' }));
      }

      const server1History = history.getServerHistory('server-1', 5, 5);
      expect(server1History).toHaveLength(5);
    });
  });

  describe('getServerStats', () => {
    it('should get server stats', () => {
      history.recordRequest(createMockContext({ serverId: 'server-1', success: true }));
      history.recordRequest(createMockContext({ serverId: 'server-1', success: true }));
      history.recordRequest(createMockContext({ serverId: 'server-1', success: false }));

      const stats = history.getServerStats('server-1', 1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.successfulRequests).toBe(2);
      expect(stats.failedRequests).toBe(1);
    });

    it('should return zero for unknown server', () => {
      const stats = history.getServerStats('unknown-server', 1);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('getServerIds', () => {
    it('should return all server IDs', () => {
      history.recordRequest(createMockContext({ serverId: 'server-1' }));
      history.recordRequest(createMockContext({ serverId: 'server-2' }));

      const serverIds = history.getServerIds();
      expect(serverIds).toContain('server-1');
      expect(serverIds).toContain('server-2');
    });

    it('should return empty for no requests', () => {
      const serverIds = history.getServerIds();
      expect(serverIds).toHaveLength(0);
    });
  });

  describe('getTotalRequestCount', () => {
    it('should return total count', () => {
      history.recordRequest(createMockContext());
      history.recordRequest(createMockContext());

      expect(history.getTotalRequestCount()).toBe(2);
    });
  });

  describe('clearServerHistory', () => {
    it('should clear server history', () => {
      history.recordRequest(createMockContext({ serverId: 'server-1' }));
      history.recordRequest(createMockContext({ serverId: 'server-2' }));

      history.clearServerHistory('server-1');

      expect(history.getServerHistory('server-1')).toHaveLength(0);
      expect(history.getServerHistory('server-2')).toHaveLength(1);
    });
  });

  describe('clearAllHistory', () => {
    it('should clear all history', () => {
      history.recordRequest(createMockContext());
      history.recordRequest(createMockContext());

      history.clearAllHistory();

      expect(history.getTotalRequestCount()).toBe(0);
    });
  });
});
