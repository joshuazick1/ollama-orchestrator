/**
 * stalled-streaming-handler.test.ts
 * Tests for stalled streaming response detection and handling
 *
 * TESTING REQUIREMENTS:
 * - All tests must verify dual-protocol support (Ollama AND OpenAI)
 * - Tests must include edge cases, error handling, concurrent operations
 * - Tests must verify metrics collection for both protocols
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  InFlightManager,
  type StreamingRequestProgress,
} from '../../src/utils/in-flight-manager.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Stalled Streaming Handler - InFlightManager', () => {
  let manager: InFlightManager;

  beforeEach(() => {
    manager = new InFlightManager();
  });

  afterEach(() => {
    manager.clear();
  });

  // ============================================================================
  // SECTION 6.1: Stall Detection Tests
  // ============================================================================

  describe('Stall Detection', () => {
    it('should track streaming request with isStalled initially false', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress).toBeDefined();
      expect(progress?.isStalled).toBe(false);
      expect(progress?.chunkCount).toBe(0);
    });

    it('should mark request as stalled when markStalled is called', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.markStalled('req-1');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.isStalled).toBe(true);
    });

    it('should NOT mark stalled when chunks arrive within timeout', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      // Simulate chunks arriving
      manager.updateChunkProgress('req-1', 1);
      manager.updateChunkProgress('req-1', 2);

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.isStalled).toBe(false);
      expect(progress?.chunkCount).toBe(2);
    });

    it('should track multiple stalled requests', () => {
      // Add multiple requests to different servers (Ollama and OpenAI)
      manager.addStreamingRequest('req-ollama-1', 'ollama-server-1', 'llama3');
      manager.addStreamingRequest('req-ollama-2', 'ollama-server-2', 'mistral');
      manager.addStreamingRequest('req-openai-1', 'openai-server-1', 'gpt-4');
      manager.addStreamingRequest('req-openai-2', 'openai-server-2', 'gpt-3.5-turbo');

      manager.markStalled('req-ollama-1');
      manager.markStalled('req-openai-1');

      expect(manager.getStreamingRequestProgress('req-ollama-1')?.isStalled).toBe(true);
      expect(manager.getStreamingRequestProgress('req-ollama-2')?.isStalled).toBe(false);
      expect(manager.getStreamingRequestProgress('req-openai-1')?.isStalled).toBe(true);
      expect(manager.getStreamingRequestProgress('req-openai-2')?.isStalled).toBe(false);
    });

    it('should track stalled requests per server:model combination', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'llama3'); // Same server:model
      manager.addStreamingRequest('req-3', 'server-1', 'mistral'); // Different model

      manager.markStalled('req-1');

      const requests = manager.getStreamingRequestsForServer('server-1');
      const stalledRequests = requests.filter(r => r.isStalled);

      expect(stalledRequests.length).toBe(1);
      expect(stalledRequests[0].model).toBe('llama3');
    });

    it('should handle stalled detection for dual-capability servers', () => {
      // Server supporting both Ollama and OpenAI protocols
      manager.addStreamingRequest('req-1', 'dual-server-1', 'llama3'); // Ollama protocol
      manager.addStreamingRequest('req-2', 'dual-server-1', 'gpt-4'); // OpenAI protocol

      manager.markStalled('req-1');

      // Only the Ollama request should be stalled
      expect(manager.getStreamingRequestProgress('req-1')?.isStalled).toBe(true);
      expect(manager.getStreamingRequestProgress('req-2')?.isStalled).toBe(false);
    });

    it('should handle non-existent request ID gracefully', () => {
      expect(manager.getStreamingRequestProgress('non-existent')).toBeUndefined();

      // Should not throw
      expect(() => manager.markStalled('non-existent')).not.toThrow();
      expect(() => manager.updateChunkProgress('non-existent', 5)).not.toThrow();
    });
  });

  // ============================================================================
  // SECTION 6.2: Chunk Gap Tracking Tests
  // ============================================================================

  describe('Chunk Gap Tracking', () => {
    it('should update chunk count correctly', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      manager.updateChunkProgress('req-1', 1);
      manager.updateChunkProgress('req-1', 2);
      manager.updateChunkProgress('req-1', 3);

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.chunkCount).toBe(3);
    });

    it('should track last chunk time', () => {
      const before = Date.now();
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      const after = Date.now();

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.lastChunkTime).toBeGreaterThanOrEqual(before);
      expect(progress?.lastChunkTime).toBeLessThanOrEqual(after);
    });

    it('should update last chunk time on chunk progress', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      const initialTime = manager.getStreamingRequestProgress('req-1')?.lastChunkTime;

      // Simulate time passing
      vi.useFakeTimers();
      vi.advanceTimersByTime(5000);

      manager.updateChunkProgress('req-1', 1);

      const updatedTime = manager.getStreamingRequestProgress('req-1')?.lastChunkTime;

      expect(updatedTime).toBeGreaterThan(initialTime!);

      vi.useRealTimers();
    });

    it('should track chunk gaps for multiple protocols', () => {
      // Ollama streaming
      manager.addStreamingRequest('req-ollama', 'ollama-server', 'llama3');
      manager.updateChunkProgress('req-ollama', 1);
      manager.updateChunkProgress('req-ollama', 2);

      // OpenAI streaming
      manager.addStreamingRequest('req-openai', 'openai-server', 'gpt-4');
      manager.updateChunkProgress('req-openai', 1);

      const ollamaProgress = manager.getStreamingRequestProgress('req-ollama');
      const openaiProgress = manager.getStreamingRequestProgress('req-openai');

      expect(ollamaProgress?.chunkCount).toBe(2);
      expect(openaiProgress?.chunkCount).toBe(1);
    });
  });

  // ============================================================================
  // SECTION 6.3: Stall Recovery Tests
  // ============================================================================

  describe('Stall Recovery', () => {
    it('should recover from stalled state when chunks resume', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      // Mark as stalled
      manager.markStalled('req-1');
      expect(manager.getStreamingRequestProgress('req-1')?.isStalled).toBe(true);

      // Chunks resume - should reset stalled flag
      manager.updateChunkProgress('req-1', 1);

      expect(manager.getStreamingRequestProgress('req-1')?.isStalled).toBe(false);
      expect(manager.getStreamingRequestProgress('req-1')?.chunkCount).toBe(1);
    });

    it('should handle multiple stall/recover cycles', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      // First stall cycle
      manager.markStalled('req-1');
      expect(manager.getStreamingRequestProgress('req-1')?.isStalled).toBe(true);

      manager.updateChunkProgress('req-1', 1);
      expect(manager.getStreamingRequestProgress('req-1')?.isStalled).toBe(false);

      // Second stall cycle
      manager.markStalled('req-1');
      expect(manager.getStreamingRequestProgress('req-1')?.isStalled).toBe(true);

      manager.updateChunkProgress('req-1', 2);
      expect(manager.getStreamingRequestProgress('req-1')?.isStalled).toBe(false);
    });

    it('should recover stalled requests for both protocols', () => {
      // Ollama request stalls then recovers
      manager.addStreamingRequest('req-ollama', 'server-1', 'llama3');
      manager.markStalled('req-ollama');
      manager.updateChunkProgress('req-ollama', 1);

      // OpenAI request stalls then recovers
      manager.addStreamingRequest('req-openai', 'server-1', 'gpt-4');
      manager.markStalled('req-openai');
      manager.updateChunkProgress('req-openai', 1);

      expect(manager.getStreamingRequestProgress('req-ollama')?.isStalled).toBe(false);
      expect(manager.getStreamingRequestProgress('req-openai')?.isStalled).toBe(false);
    });

    it('should preserve chunk count during recovery', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      manager.updateChunkProgress('req-1', 5);
      manager.markStalled('req-1');
      manager.updateChunkProgress('req-1', 6);

      expect(manager.getStreamingRequestProgress('req-1')?.chunkCount).toBe(6);
      expect(manager.getStreamingRequestProgress('req-1')?.isStalled).toBe(false);
    });
  });

  // ============================================================================
  // SECTION 6.4: Stall Metrics Tests
  // ============================================================================

  describe('Stall Metrics Collection', () => {
    it('should track all streaming requests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'mistral');
      manager.addStreamingRequest('req-3', 'server-2', 'gpt-4');

      const allRequests = manager.getAllStreamingRequests();

      expect(allRequests.length).toBe(3);
    });

    it('should group streaming requests by server', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'mistral');
      manager.addStreamingRequest('req-3', 'server-2', 'gpt-4');

      const byServer = manager.getStreamingRequestsByServer();

      expect(byServer['server-1']).toHaveLength(2);
      expect(byServer['server-2']).toHaveLength(1);
    });

    it('should calculate stalled metrics per server', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'mistral');
      manager.addStreamingRequest('req-3', 'server-1', 'gpt-4');

      manager.markStalled('req-1');
      manager.markStalled('req-2');

      const requests = manager.getStreamingRequestsForServer('server-1');
      const stalledCount = requests.filter(r => r.isStalled).length;
      const totalCount = requests.length;

      expect(stalledCount).toBe(2);
      expect(totalCount).toBe(3);
    });

    it('should track metrics for both Ollama and OpenAI protocols', () => {
      // Ollama servers
      manager.addStreamingRequest('ollama-req-1', 'ollama-1', 'llama3');
      manager.addStreamingRequest('ollama-req-2', 'ollama-2', 'mistral');

      // OpenAI servers
      manager.addStreamingRequest('openai-req-1', 'openai-1', 'gpt-4');
      manager.addStreamingRequest('openai-req-2', 'openai-2', 'gpt-3.5-turbo');

      // Stall some
      manager.markStalled('ollama-req-1');
      manager.markStalled('openai-req-1');

      const allRequests = manager.getAllStreamingRequests();

      // Should have 4 total requests
      expect(allRequests.length).toBe(4);

      // Check Ollama requests
      const ollamaRequests = allRequests.filter(r => r.serverId.startsWith('ollama'));
      expect(ollamaRequests).toHaveLength(2);
      expect(ollamaRequests.filter(r => r.isStalled)).toHaveLength(1);

      // Check OpenAI requests
      const openaiRequests = allRequests.filter(r => r.serverId.startsWith('openai'));
      expect(openaiRequests).toHaveLength(2);
      expect(openaiRequests.filter(r => r.isStalled)).toHaveLength(1);
    });
  });

  // ============================================================================
  // SECTION 6.5: Concurrent Stream Tests
  // ============================================================================

  describe('Concurrent Stream Management', () => {
    it('should handle 100 concurrent streaming requests', () => {
      // Simulate 100 concurrent streams (max 100 per documentation)
      for (let i = 0; i < 100; i++) {
        manager.addStreamingRequest(`req-${i}`, `server-${i % 10}`, 'llama3');
      }

      const allRequests = manager.getAllStreamingRequests();

      expect(allRequests.length).toBe(100);
    });

    it('should handle concurrent streams across multiple servers', () => {
      const servers = ['ollama-1', 'ollama-2', 'openai-1', 'openai-2', 'dual-1'];

      // Add 50 requests per server
      servers.forEach(serverId => {
        for (let i = 0; i < 50; i++) {
          manager.addStreamingRequest(`${serverId}-req-${i}`, serverId, 'llama3');
        }
      });

      const byServer = manager.getStreamingRequestsByServer();

      Object.values(byServer).forEach(requests => {
        expect(requests).toHaveLength(50);
      });
    });

    it('should clean up completed streaming requests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'mistral');

      expect(manager.getAllStreamingRequests()).toHaveLength(2);

      // Remove completed request
      manager.removeStreamingRequest('req-1');

      expect(manager.getAllStreamingRequests()).toHaveLength(1);
      expect(manager.getStreamingRequestProgress('req-1')).toBeUndefined();
      expect(manager.getStreamingRequestProgress('req-2')).toBeDefined();
    });

    it('should return removed request progress', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.updateChunkProgress('req-1', 5);
      manager.markStalled('req-1');

      const removed = manager.removeStreamingRequest('req-1');

      expect(removed).toBeDefined();
      expect(removed?.chunkCount).toBe(5);
      expect(removed?.isStalled).toBe(true);
    });

    it('should handle rapid concurrent chunk updates', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      // Simulate rapid chunk updates
      for (let i = 0; i < 1000; i++) {
        manager.updateChunkProgress('req-1', i + 1);
      }

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.chunkCount).toBe(1000);
      expect(progress?.isStalled).toBe(false);
    });
  });

  // ============================================================================
  // SECTION 6.6: Server Failure During Stream Tests
  // ============================================================================

  describe('Server Failure During Stream', () => {
    it('should identify all requests to a failed server', () => {
      manager.addStreamingRequest('req-1', 'failed-server', 'llama3');
      manager.addStreamingRequest('req-2', 'failed-server', 'mistral');
      manager.addStreamingRequest('req-3', 'healthy-server', 'gpt-4');

      const failedServerRequests = manager.getStreamingRequestsForServer('failed-server');

      expect(failedServerRequests).toHaveLength(2);
    });

    it('should track in-flight requests with in-flight manager', () => {
      // Combine with in-flight tracking
      manager.incrementInFlight('server-1', 'llama3');
      manager.incrementInFlight('server-1', 'llama3');
      manager.incrementInFlight('server-2', 'gpt-4');

      // Add streaming requests
      manager.addStreamingRequest('stream-1', 'server-1', 'llama3');
      manager.addStreamingRequest('stream-2', 'server-2', 'gpt-4');

      expect(manager.getInFlight('server-1', 'llama3')).toBe(2);
      expect(manager.getInFlight('server-2', 'gpt-4')).toBe(1);
    });

    it('should handle server removal during active streams', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'mistral');
      manager.addStreamingRequest('req-3', 'server-2', 'gpt-4');

      // Mark all requests to server-1 as stalled (simulating failure)
      manager.getStreamingRequestsForServer('server-1').forEach(req => {
        manager.markStalled(req.id);
      });

      const server1Requests = manager.getStreamingRequestsForServer('server-1');
      const server2Requests = manager.getStreamingRequestsForServer('server-2');

      expect(server1Requests.every(r => r.isStalled)).toBe(true);
      expect(server2Requests.every(r => !r.isStalled)).toBe(true);
    });

    it('should handle partial server failure (some models affected)', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'mistral'); // This model fails
      manager.addStreamingRequest('req-3', 'server-1', 'gpt-4');

      // Only mark llama3 as stalled
      manager.markStalled('req-1');

      const requests = manager.getStreamingRequestsForServer('server-1');
      const stalled = requests.filter(r => r.isStalled);

      expect(stalled).toHaveLength(1);
      expect(stalled[0].model).toBe('llama3');
    });
  });

  // ============================================================================
  // SECTION 6.7: Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty server ID', () => {
      manager.addStreamingRequest('req-1', '', 'llama3');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress).toBeDefined();
      expect(progress?.serverId).toBe('');
    });

    it('should handle empty model name', () => {
      manager.addStreamingRequest('req-1', 'server-1', '');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress).toBeDefined();
      expect(progress?.model).toBe('');
    });

    it('should handle special characters in IDs', () => {
      manager.addStreamingRequest('req-with-dash', 'server-with-dash', 'model:with:colons');

      const progress = manager.getStreamingRequestProgress('req-with-dash');

      expect(progress).toBeDefined();
    });

    it('should handle duplicate request IDs gracefully', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.updateChunkProgress('req-1', 5);

      // Adding duplicate should overwrite
      manager.addStreamingRequest('req-1', 'server-2', 'mistral');

      // Should have only one request (the latest)
      const allRequests = manager.getAllStreamingRequests();
      expect(allRequests).toHaveLength(1);

      // Should have the new server:model
      const progress = manager.getStreamingRequestProgress('req-1');
      expect(progress?.serverId).toBe('server-2');
      expect(progress?.chunkCount).toBe(0); // Reset because it's a new request
    });

    it('should handle clear all requests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-2', 'mistral');
      manager.addStreamingRequest('req-3', 'server-3', 'gpt-4');

      manager.clear();

      expect(manager.getAllStreamingRequests()).toHaveLength(0);
      expect(manager.getInFlight('server-1', 'llama3')).toBe(0);
    });

    it('should handle concurrent modification', () => {
      // Simulate concurrent add/update/remove
      const promises = Array.from({ length: 100 }, async (_, i) => {
        manager.addStreamingRequest(`req-${i}`, `server-${i % 5}`, 'llama3');
        manager.updateChunkProgress(`req-${i}`, i);
        if (i % 2 === 0) {
          manager.markStalled(`req-${i}`);
        }
      });

      // This should complete without errors
      expect(async () => {
        await Promise.all(promises);
      }).not.toThrow();
    });
  });

  // ============================================================================
  // SECTION 6.8: Dual-Protocol Comprehensive Tests
  // ============================================================================

  describe('Dual-Protocol Comprehensive Tests', () => {
    it('should handle mixed Ollama and OpenAI servers', () => {
      // Ollama servers
      const ollamaServers = ['ollama-1', 'ollama-2', 'ollama-3'];
      ollamaServers.forEach((serverId, idx) => {
        manager.addStreamingRequest(`ollama-req-${idx}`, serverId, `llama${idx}`);
      });

      // OpenAI servers
      const openaiServers = ['openai-1', 'openai-2'];
      openaiServers.forEach((serverId, idx) => {
        manager.addStreamingRequest(`openai-req-${idx}`, serverId, `gpt-${idx}`);
      });

      // Dual-capability servers
      manager.addStreamingRequest('dual-req-1', 'dual-1', 'llama3'); // Using Ollama protocol
      manager.addStreamingRequest('dual-req-2', 'dual-1', 'gpt-4'); // Using OpenAI protocol

      const all = manager.getAllStreamingRequests();

      expect(all.filter(r => r.serverId.startsWith('ollama'))).toHaveLength(3);
      expect(all.filter(r => r.serverId.startsWith('openai'))).toHaveLength(2);
      expect(all.filter(r => r.serverId.startsWith('dual'))).toHaveLength(2);
    });

    it('should track stall status independently per protocol', () => {
      // Add requests to dual-capability server with different protocols
      manager.addStreamingRequest('dual-ollama', 'dual-server', 'llama3');
      manager.addStreamingRequest('dual-openai', 'dual-server', 'gpt-4');

      // Stall only Ollama protocol
      manager.markStalled('dual-ollama');

      const ollamaReq = manager.getStreamingRequestProgress('dual-ollama');
      const openaiReq = manager.getStreamingRequestProgress('dual-openai');

      expect(ollamaReq?.isStalled).toBe(true);
      expect(openaiReq?.isStalled).toBe(false);
    });

    it('should handle failover between protocols on dual-capability servers', () => {
      // Simulate Ollama protocol failing, switching to OpenAI
      manager.addStreamingRequest('req-1', 'dual-server', 'llama3');
      manager.markStalled('req-1');

      // Remove stalled request
      manager.removeStreamingRequest('req-1');

      // Add new request using OpenAI protocol
      manager.addStreamingRequest('req-2', 'dual-server', 'gpt-4');

      const requests = manager.getStreamingRequestsForServer('dual-server');

      // Should have only the OpenAI request now
      expect(requests).toHaveLength(1);
      expect(requests[0].id).toBe('req-2');
      expect(requests[0].isStalled).toBe(false);
    });

    it('should calculate metrics separately for each protocol', () => {
      // Add many Ollama requests
      for (let i = 0; i < 10; i++) {
        manager.addStreamingRequest(`ollama-${i}`, 'server-1', 'llama3');
        manager.updateChunkProgress(`ollama-${i}`, i);
      }

      // Add many OpenAI requests
      for (let i = 0; i < 10; i++) {
        manager.addStreamingRequest(`openai-${i}`, 'server-1', 'gpt-4');
        manager.updateChunkProgress(`openai-${i}`, i);
        if (i < 5) {
          manager.markStalled(`openai-${i}`);
        }
      }

      const allRequests = manager.getAllStreamingRequests();
      const stalledCount = allRequests.filter(r => r.isStalled).length;
      const totalCount = allRequests.length;

      expect(totalCount).toBe(20);
      expect(stalledCount).toBe(5); // Only OpenAI requests stalled
    });
  });

  // ============================================================================
  // SECTION 6.9: Configuration Tests
  // ============================================================================

  describe('Configuration Tests', () => {
    it('should accept custom configuration', () => {
      const customManager = new InFlightManager({
        maxConcurrentPerModel: 10,
        maxConcurrentPerServer: 50,
      });

      expect(customManager).toBeDefined();

      customManager.clear();
    });

    it('should track in-flight requests separately from streaming requests', () => {
      // Add in-flight (non-streaming) requests
      manager.incrementInFlight('server-1', 'llama3');
      manager.incrementInFlight('server-1', 'llama3');
      manager.incrementInFlight('server-2', 'gpt-4');

      // Add streaming requests
      manager.addStreamingRequest('stream-1', 'server-1', 'llama3');
      manager.addStreamingRequest('stream-2', 'server-2', 'gpt-4');

      // Both should be tracked independently
      expect(manager.getInFlight('server-1', 'llama3')).toBe(2);
      expect(manager.getInFlight('server-2', 'gpt-4')).toBe(1);

      const streamingRequests = manager.getStreamingRequestsForServer('server-1');
      expect(streamingRequests).toHaveLength(1);
    });

    it('should track bypass requests separately', () => {
      manager.incrementInFlight('server-1', 'llama3', false);
      manager.incrementInFlight('server-1', 'llama3', true); // bypass

      // Should have 1 regular + 1 bypass = 2 total
      expect(manager.getInFlight('server-1', 'llama3')).toBe(2);
    });
  });

  // ============================================================================
  // SECTION 6.10: New Stall Detection Fields Tests
  // ============================================================================

  describe('Stall Detection Fields', () => {
    it('should initialize accumulatedText as empty string', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.accumulatedText).toBe('');
    });

    it('should track accumulated text through chunk updates', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      manager.updateChunkProgress('req-1', 1, 'Hello');
      manager.updateChunkProgress('req-1', 2, 'Hello World');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.accumulatedText).toBe('Hello World');
    });

    it('should track lastContext when provided', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      const context = [1, 2, 3, 4, 5];
      manager.updateChunkProgress('req-1', 1, 'Hello', context);

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.lastContext).toEqual(context);
    });

    it('should track protocol and endpoint from addStreamingRequest', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3', 'ollama', 'generate');
      manager.addStreamingRequest('req-2', 'server-1', 'gpt-4', 'openai', 'chat');

      const progress1 = manager.getStreamingRequestProgress('req-1');
      const progress2 = manager.getStreamingRequestProgress('req-2');

      expect(progress1?.protocol).toBe('ollama');
      expect(progress1?.endpoint).toBe('generate');
      expect(progress2?.protocol).toBe('openai');
      expect(progress2?.endpoint).toBe('chat');
    });

    it('should default protocol to ollama and endpoint to generate', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.protocol).toBe('ollama');
      expect(progress?.endpoint).toBe('generate');
    });

    it('should initialize handoffCount to 0', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.handoffCount).toBe(0);
    });

    it('should initialize hasReceivedFirstChunk to false', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.hasReceivedFirstChunk).toBe(false);
    });

    it('should set hasReceivedFirstChunk to true after updateChunkProgress', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.updateChunkProgress('req-1', 1);

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.hasReceivedFirstChunk).toBe(true);
    });

    it('should increment handoffCount when incrementHandoffCount is called', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      manager.incrementHandoffCount('req-1');
      manager.incrementHandoffCount('req-1');
      manager.incrementHandoffCount('req-1');

      const progress = manager.getStreamingRequestProgress('req-1');

      expect(progress?.handoffCount).toBe(3);
    });

    it('should not throw when incrementHandoffCount for non-existent request', () => {
      expect(() => {
        manager.incrementHandoffCount('non-existent');
      }).not.toThrow();
    });
  });

  // ============================================================================
  // SECTION 6.11: Stall Detection Helper Methods Tests
  // ============================================================================

  describe('Stall Detection Helper Methods', () => {
    beforeEach(() => {
      manager = new InFlightManager();
    });

    afterEach(() => {
      manager.clear();
    });

    it('should get all stalled requests with getStalledRequests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'llama3');
      manager.addStreamingRequest('req-3', 'server-2', 'gpt-4');

      manager.updateChunkProgress('req-1', 1);
      manager.updateChunkProgress('req-2', 1);
      manager.updateChunkProgress('req-3', 1);

      manager.markStalled('req-1');
      manager.markStalled('req-3');

      const stalled = manager.getStalledRequests();

      expect(stalled).toHaveLength(2);
      expect(stalled.map(r => r.id).sort()).toEqual(['req-1', 'req-3']);
    });

    it('should NOT include requests without first chunk in getStalledRequests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'llama3');

      manager.markStalled('req-1');
      manager.markStalled('req-2');

      const stalled = manager.getStalledRequests();

      expect(stalled).toHaveLength(0);
    });

    it('should check if server has stalled requests with hasStalledRequests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'mistral');
      manager.addStreamingRequest('req-3', 'server-2', 'gpt-4');

      manager.updateChunkProgress('req-1', 1);
      manager.updateChunkProgress('req-2', 1);
      manager.updateChunkProgress('req-3', 1);

      manager.markStalled('req-1');

      expect(manager.hasStalledRequests('server-1')).toBe(true);
      expect(manager.hasStalledRequests('server-2')).toBe(false);
      expect(manager.hasStalledRequests('server-3')).toBe(false);
    });

    it('should check stalled requests per model with hasStalledRequests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'mistral');

      manager.updateChunkProgress('req-1', 1);
      manager.updateChunkProgress('req-2', 1);

      manager.markStalled('req-1');

      expect(manager.hasStalledRequests('server-1', 'llama3')).toBe(true);
      expect(manager.hasStalledRequests('server-1', 'mistral')).toBe(false);
      expect(manager.hasStalledRequests('server-1', 'gpt-4')).toBe(false);
    });

    it('should get count of stalled requests with getStalledRequestCount', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'llama3');
      manager.addStreamingRequest('req-3', 'server-1', 'llama3');
      manager.addStreamingRequest('req-4', 'server-1', 'mistral');

      manager.updateChunkProgress('req-1', 1);
      manager.updateChunkProgress('req-2', 1);
      manager.updateChunkProgress('req-3', 1);
      manager.updateChunkProgress('req-4', 1);

      manager.markStalled('req-1');
      manager.markStalled('req-2');
      manager.markStalled('req-4');

      expect(manager.getStalledRequestCount('server-1')).toBe(3);
      expect(manager.getStalledRequestCount('server-1', 'llama3')).toBe(2);
      expect(manager.getStalledRequestCount('server-1', 'mistral')).toBe(1);
      expect(manager.getStalledRequestCount('server-1', 'gpt-4')).toBe(0);
    });

    it('should get potentially stalled requests based on time threshold', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'llama3');
      manager.addStreamingRequest('req-3', 'server-1', 'gpt-4');

      // Update with old timestamps by manipulating lastChunkTime
      manager.updateChunkProgress('req-1', 1);
      manager.updateChunkProgress('req-2', 1);
      manager.updateChunkProgress('req-3', 1);

      // Manually set lastChunkTime to simulate old timestamps
      const oldTime = Date.now() - 400000; // 6+ minutes ago
      const progress1 = manager.getStreamingRequestProgress('req-1');
      const progress3 = manager.getStreamingRequestProgress('req-3');
      if (progress1) {progress1.lastChunkTime = oldTime;}
      if (progress3) {progress3.lastChunkTime = oldTime;}

      // 5 minute threshold
      const potentiallyStalled = manager.getPotentiallyStalledRequests(300000);

      expect(potentiallyStalled.length).toBeGreaterThanOrEqual(2);
      expect(potentiallyStalled.map(r => r.id).sort()).toContain('req-1');
      expect(potentiallyStalled.map(r => r.id).sort()).toContain('req-3');
    });

    it('should NOT include requests without first chunk in getPotentiallyStalledRequests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');
      manager.addStreamingRequest('req-2', 'server-1', 'llama3');

      manager.updateChunkProgress('req-1', 1);

      // Set old timestamp for req-1
      const oldTime = Date.now() - 400000;
      const progress1 = manager.getStreamingRequestProgress('req-1');
      if (progress1) {progress1.lastChunkTime = oldTime;}

      const potentiallyStalled = manager.getPotentiallyStalledRequests(300000);

      expect(potentiallyStalled).toHaveLength(1);
      expect(potentiallyStalled[0].id).toBe('req-1');
    });

    it('should NOT include already stalled requests in getPotentiallyStalledRequests', () => {
      manager.addStreamingRequest('req-1', 'server-1', 'llama3');

      manager.updateChunkProgress('req-1', 1);

      // Set old timestamp
      const oldTime = Date.now() - 400000;
      const progress1 = manager.getStreamingRequestProgress('req-1');
      if (progress1) {progress1.lastChunkTime = oldTime;}

      // Mark as already stalled
      manager.markStalled('req-1');

      const potentiallyStalled = manager.getPotentiallyStalledRequests(300000);

      expect(potentiallyStalled).toHaveLength(0);
    });
  });
});
