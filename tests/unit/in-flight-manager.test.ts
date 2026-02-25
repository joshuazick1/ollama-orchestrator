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
});

describe('getInFlightManager singleton', () => {
  it('should return same instance', () => {
    const manager1 = getInFlightManager();
    const manager2 = getInFlightManager();
    expect(manager1).toBe(manager2);
  });
});
