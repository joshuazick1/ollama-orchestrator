import { describe, it, expect, beforeEach } from 'vitest';
import { InFlightManager, getInFlightManager } from '../../src/utils/in-flight-manager';

describe('InFlightManager', () => {
  let manager: InFlightManager;

  beforeEach(() => {
    manager = new InFlightManager();
  });

  describe('incrementInFlight', () => {
    it('should increment in-flight count', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(1);
    });

    it('should handle multiple models', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlight('server-1', 'codellama:7b');
      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(1);
      expect(manager.getInFlight('server-1', 'codellama:7b')).toBe(1);
    });
  });

  describe('streaming request tracking', () => {
    it('should add streaming request with initial chunkCount of 0', () => {
      manager.addStreamingRequest('req-123', 'server-1', 'llama3:8b');

      const progress = manager.getStreamingRequestProgress('req-123');
      expect(progress).toBeDefined();
      expect(progress?.chunkCount).toBe(0);
      expect(progress?.serverId).toBe('server-1');
      expect(progress?.model).toBe('llama3:8b');
      expect(progress?.isStalled).toBe(false);
    });

    it('should update chunkCount when chunks arrive', () => {
      manager.addStreamingRequest('req-123', 'server-1', 'llama3:8b');

      manager.updateChunkProgress('req-123', 5);

      const progress = manager.getStreamingRequestProgress('req-123');
      expect(progress?.chunkCount).toBe(5);
      expect(progress?.lastChunkTime).toBeGreaterThan(0);
    });

    it('should mark request as stalled', () => {
      manager.addStreamingRequest('req-123', 'server-1', 'llama3:8b');

      manager.markStalled('req-123');

      const progress = manager.getStreamingRequestProgress('req-123');
      expect(progress?.isStalled).toBe(true);
    });

    it('should update chunkCount multiple times during streaming', () => {
      manager.addStreamingRequest('req-123', 'server-1', 'llama3:8b');

      // Simulate chunks arriving during streaming
      manager.updateChunkProgress('req-123', 1);
      manager.updateChunkProgress('req-123', 2);
      manager.updateChunkProgress('req-123', 3);
      manager.updateChunkProgress('req-123', 10);

      const progress = manager.getStreamingRequestProgress('req-123');
      expect(progress?.chunkCount).toBe(10);
    });

    it('should remove streaming request on completion', () => {
      manager.addStreamingRequest('req-123', 'server-1', 'llama3:8b');
      manager.updateChunkProgress('req-123', 15);

      const removed = manager.removeStreamingRequest('req-123');

      expect(removed).toBeDefined();
      expect(removed?.chunkCount).toBe(15);
      expect(manager.getStreamingRequestProgress('req-123')).toBeUndefined();
    });

    it('should get all streaming requests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');
      manager.addStreamingRequest('req-2', 'server-1', 'llama3:8b');
      manager.addStreamingRequest('req-3', 'server-2', 'codellama:7b');

      const allRequests = manager.getAllStreamingRequests();

      expect(allRequests).toHaveLength(3);
    });

    it('should get streaming requests grouped by server', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');
      manager.addStreamingRequest('req-2', 'server-1', 'codellama:7b');
      manager.addStreamingRequest('req-3', 'server-2', 'llama3:8b');

      const byServer = manager.getStreamingRequestsByServer();

      expect(byServer['server-1']).toHaveLength(2);
      expect(byServer['server-2']).toHaveLength(1);
    });

    it('should return empty array for non-existent request', () => {
      const progress = manager.getStreamingRequestProgress('non-existent');
      expect(progress).toBeUndefined();
    });
  });

  describe('getInFlightDetailed', () => {
    it('should return detailed in-flight breakdown', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlight('server-1', 'codellama:7b', true);

      const detailed = manager.getInFlightDetailed();

      expect(detailed['server-1'].total).toBe(3);
      expect(detailed['server-1'].byModel['llama3:8b'].regular).toBe(2);
      expect(detailed['server-1'].byModel['codellama:7b'].bypass).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all data', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');

      manager.clear();

      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
      expect(manager.getAllStreamingRequests()).toHaveLength(0);
    });
  });

  describe('getTotalInFlight', () => {
    it('should return total in-flight for server', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlight('server-1', 'codellama:7b');

      const total = manager.getTotalInFlight('server-1');
      expect(total).toBe(3);
    });

    it('should return 0 for non-existent server', () => {
      const total = manager.getTotalInFlight('non-existent');
      expect(total).toBe(0);
    });

    it('should include bypass requests in total', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlight('server-1', 'llama3:8b', true);

      const total = manager.getTotalInFlight('server-1');
      expect(total).toBe(2);
    });
  });

  describe('getInFlightByServer', () => {
    it('should return in-flight grouped by model for server', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlight('server-1', 'codellama:7b');

      const byModel = manager.getInFlightByServer('server-1');
      expect(byModel['llama3:8b']).toBe(2);
      expect(byModel['codellama:7b']).toBe(1);
    });

    it('should return empty object for non-existent server', () => {
      const byModel = manager.getInFlightByServer('non-existent');
      expect(byModel).toEqual({});
    });
  });

  describe('getAllInFlight', () => {
    it('should return all in-flight grouped by server and model', () => {
      manager.incrementInFlight('server-1', 'llama3');
      manager.incrementInFlight('server-2', 'codellama');

      const all = manager.getAllInFlight();
      expect(all['server-1']['llama3']).toBe(1);
      expect(all['server-2']['codellama']).toBe(1);
    });

    it('should return empty object when nothing in-flight', () => {
      const all = manager.getAllInFlight();
      expect(all).toEqual({});
    });
  });
});

describe('getInFlightManager singleton', () => {
  it('should return same instance', () => {
    const manager1 = getInFlightManager();
    const manager2 = getInFlightManager();
    expect(manager1).toBe(manager2);
  });
});

describe('InFlightManager streaming edge cases', () => {
  let manager: InFlightManager;

  beforeEach(() => {
    manager = new InFlightManager();
  });

  describe('streaming request edge cases', () => {
    it('should handle removing non-existent streaming request', () => {
      const removed = manager.removeStreamingRequest('non-existent');
      expect(removed).toBeUndefined();
    });

    it('should handle updating progress for non-existent request', () => {
      expect(() => {
        manager.updateChunkProgress('non-existent', 5);
      }).not.toThrow();
    });

    it('should handle marking non-existent request as stalled', () => {
      expect(() => {
        manager.markStalled('non-existent');
      }).not.toThrow();
    });

    it('should handle duplicate streaming request IDs', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');
      manager.addStreamingRequest('req-1', 'server-2', 'llama3:8b');

      const progress = manager.getStreamingRequestProgress('req-1');
      expect(progress?.serverId).toBe('server-2');
    });

    it('should track lastChunkTime correctly', () => {
      manager.addStreamingRequest('req-123', 'server-1', 'llama3:8b');

      manager.updateChunkProgress('req-123', 1);
      const firstTime = manager.getStreamingRequestProgress('req-123')?.lastChunkTime;

      manager.updateChunkProgress('req-123', 2);
      const secondTime = manager.getStreamingRequestProgress('req-123')?.lastChunkTime;

      expect(secondTime).toBeGreaterThanOrEqual(firstTime || 0);
    });

    it('should handle unstalling a stalled request', () => {
      manager.addStreamingRequest('req-123', 'server-1', 'llama3:8b');
      manager.markStalled('req-123');

      const afterStall = manager.getStreamingRequestProgress('req-123');
      expect(afterStall?.isStalled).toBe(true);

      manager.updateChunkProgress('req-123', 5);
      const afterProgress = manager.getStreamingRequestProgress('req-123');
      expect(afterProgress?.isStalled).toBe(false);
    });

    it('should get streaming requests by server for empty manager', () => {
      const byServer = manager.getStreamingRequestsByServer();
      expect(Object.keys(byServer)).toHaveLength(0);
    });

    it('should correctly count total streaming requests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');
      manager.addStreamingRequest('req-2', 'server-1', 'codellama:7b');
      manager.addStreamingRequest('req-3', 'server-2', 'llama3:8b');

      const all = manager.getAllStreamingRequests();
      expect(all).toHaveLength(3);
    });

    it('should track streaming requests with zero chunks', () => {
      manager.addStreamingRequest('req-123', 'server-1', 'llama3:8b');

      const progress = manager.getStreamingRequestProgress('req-123');
      expect(progress?.chunkCount).toBe(0);
      expect(progress?.lastChunkTime).toBeGreaterThan(0);
      expect(progress?.isStalled).toBe(false);
    });

    it('should preserve chunkCount when request completes', () => {
      manager.addStreamingRequest('req-123', 'server-1', 'llama3:8b');
      manager.updateChunkProgress('req-123', 10);

      const removed = manager.removeStreamingRequest('req-123');

      expect(removed?.chunkCount).toBe(10);
      expect(manager.getStreamingRequestProgress('req-123')).toBeUndefined();
    });
  });

  describe('mixed in-flight and streaming', () => {
    it('should handle both in-flight and streaming requests', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.addStreamingRequest('stream-1', 'server-1', 'llama3:8b');

      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(2);
      expect(manager.getAllStreamingRequests()).toHaveLength(1);
    });

    it('should handle clearing mixed requests', () => {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.addStreamingRequest('stream-1', 'server-1', 'llama3:8b');
      manager.addStreamingRequest('stream-2', 'server-2', 'llama3:8b');

      manager.clear();

      expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
      expect(manager.getAllStreamingRequests()).toHaveLength(0);
    });
  });
});
