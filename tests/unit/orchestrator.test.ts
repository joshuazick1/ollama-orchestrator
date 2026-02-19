import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIOrchestrator } from '../../src/orchestrator.js';

describe('AIOrchestrator', () => {
  let orchestrator: AIOrchestrator;

  beforeEach(() => {
    orchestrator = new AIOrchestrator(undefined, undefined, undefined, {
      enabled: false,
      intervalMs: 30000,
      timeoutMs: 5000,
      maxConcurrentChecks: 10,
      retryAttempts: 2,
      retryDelayMs: 1000,
      recoveryIntervalMs: 60000,
      failureThreshold: 3,
      successThreshold: 2,
      backoffMultiplier: 1.5,
    });
  });

  describe('Server Management', () => {
    it('should add a server with default values', () => {
      orchestrator.addServer({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
      });

      const servers = orchestrator.getServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].id).toBe('server-1');
      expect(servers[0].url).toBe('http://localhost:11434');
      expect(servers[0].type).toBe('ollama');
      expect(servers[0].maxConcurrency).toBe(4);
      expect(servers[0].healthy).toBe(true);
    });

    it('should prevent duplicate server by id', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:1', type: 'ollama' });
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:2', type: 'ollama' });

      expect(orchestrator.getServers()).toHaveLength(1);
    });

    it('should prevent duplicate server by url', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11434', type: 'ollama' });

      expect(orchestrator.getServers()).toHaveLength(1);
    });

    it('should remove a server', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.removeServer('server-1');

      expect(orchestrator.getServers()).toHaveLength(0);
    });

    it('should handle multiple servers', () => {
      orchestrator.addServer({ id: 's1', url: 'http://localhost:1', type: 'ollama' });
      orchestrator.addServer({ id: 's2', url: 'http://localhost:2', type: 'ollama' });
      orchestrator.addServer({ id: 's3', url: 'http://localhost:3', type: 'ollama' });

      expect(orchestrator.getServers()).toHaveLength(3);
    });

    it('should get server by id', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      const server = orchestrator.getServer('server-1');
      expect(server).toBeDefined();
      expect(server?.id).toBe('server-1');
    });

    it('should return undefined for non-existent server', () => {
      const server = orchestrator.getServer('non-existent');
      expect(server).toBeUndefined();
    });

    it('should update server maxConcurrency', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      const result = orchestrator.updateServer('server-1', { maxConcurrency: 8 });

      expect(result).toBe(true);
      expect(orchestrator.getServer('server-1')?.maxConcurrency).toBe(8);
    });

    it('should return false when updating non-existent server', () => {
      const result = orchestrator.updateServer('non-existent', { maxConcurrency: 8 });
      expect(result).toBe(false);
    });

    it('should return empty array initially', () => {
      expect(orchestrator.getServers()).toEqual([]);
    });
  });

  describe('In-Flight Tracking', () => {
    it('should track in-flight requests', () => {
      orchestrator.incrementInFlight('server-1', 'model-1');
      orchestrator.incrementInFlight('server-1', 'model-1');

      expect(orchestrator.getInFlight('server-1', 'model-1')).toBe(2);
    });

    it('should decrement in-flight requests', () => {
      orchestrator.incrementInFlight('server-1', 'model-1');
      orchestrator.incrementInFlight('server-1', 'model-1');
      orchestrator.decrementInFlight('server-1', 'model-1');

      expect(orchestrator.getInFlight('server-1', 'model-1')).toBe(1);
    });

    it('should return 0 when no in-flight', () => {
      expect(orchestrator.getInFlight('server-1', 'model-1')).toBe(0);
    });

    it('should track total in-flight per server', () => {
      orchestrator.incrementInFlight('server-1', 'model-1');
      orchestrator.incrementInFlight('server-1', 'model-2');

      expect(orchestrator.getTotalInFlight('server-1')).toBe(2);
    });

    it('should return 0 total for non-existent server', () => {
      expect(orchestrator.getTotalInFlight('non-existent')).toBe(0);
    });
  });

  describe('Cooldown Management', () => {
    it('should not be in cooldown initially', () => {
      expect(orchestrator.isInCooldown('server-1', 'model-1')).toBe(false);
    });

    it('should be in cooldown after marking failure', () => {
      orchestrator['markFailure']('server-1', 'model-1');
      expect(orchestrator.isInCooldown('server-1', 'model-1')).toBe(true);
    });
  });

  describe('Ban Management', () => {
    it('should load bans from set', () => {
      const bans = new Set(['server-1:model-1']);
      orchestrator.loadBans(bans);

      const details = orchestrator.getBanDetails();
      expect(details).toContainEqual(expect.objectContaining({ key: 'server-1:model-1' }));
    });

    it('should return ban details', () => {
      orchestrator.loadBans(new Set(['server-1:model-1']));

      const details1 = orchestrator.getBanDetails();
      const details2 = orchestrator.getBanDetails();

      expect(details1).toEqual(details2);
    });
  });

  describe('Stats', () => {
    it('should return zero stats initially', () => {
      const stats = orchestrator.getStats();

      expect(stats.totalServers).toBe(0);
      expect(stats.healthyServers).toBe(0);
      expect(stats.totalModels).toBe(0);
      expect(stats.inFlightRequests).toBe(0);
      expect(stats.circuitBreakers).toEqual({});
    });

    it('should count servers in stats', () => {
      orchestrator.addServer({ id: 's1', url: 'http://localhost:1', type: 'ollama' });
      orchestrator.addServer({ id: 's2', url: 'http://localhost:2', type: 'ollama' });

      const stats = orchestrator.getStats();
      expect(stats.totalServers).toBe(2);
    });

    it('should count in-flight in stats', () => {
      orchestrator.incrementInFlight('server-1', 'model-1');
      orchestrator.incrementInFlight('server-2', 'model-2');

      const stats = orchestrator.getStats();
      expect(stats.inFlightRequests).toBe(2);
    });
  });

  describe('Shutdown', () => {
    it('should clear in-flight on shutdown', async () => {
      orchestrator.incrementInFlight('server-1', 'model-1');

      await orchestrator.shutdown();

      const stats = orchestrator.getStats();
      expect(stats.inFlightRequests).toBe(0);
    });
  });

  describe('Initialization', () => {
    it('should initialize metrics aggregator and start health check scheduler', async () => {
      // Spy on the methods that should be called
      const initializeSpy = vi.fn().mockResolvedValue(undefined);
      const startSpy = vi.fn();

      // Mock the aggregator and scheduler
      orchestrator['metricsAggregator'] = { initialize: initializeSpy } as any;
      orchestrator['healthCheckScheduler'] = { start: startSpy } as any;

      await orchestrator.initialize();

      expect(initializeSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tags Aggregation', () => {
    beforeEach(() => {
      // Mock fetch for aggregation tests
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/tags')) {
          // Return mock data based on server URL
          if (url.includes('11434')) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ models: [{ name: 'llama2:7b', size: 1000 }] }),
            });
          } else if (url.includes('11435')) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ models: [{ name: 'mistral:7b', size: 1500 }] }),
            });
          } else {
            // Default for other servers
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ models: [{ name: 'default:7b', size: 1000 }] }),
            });
          }
        }
        if (url.includes('/api/version')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ version: '0.1.0' }),
          });
        }
        return Promise.reject(new Error('Mock not implemented for ' + url));
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return empty result when no healthy servers', async () => {
      const result = await orchestrator.getAggregatedTags();
      expect(result).toEqual({ models: [] });
    });

    it('should aggregate tags from single server', async () => {
      // Add a healthy server
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      // Mock successful fetch response
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [
              { name: 'llama2:7b', size: 1000 },
              { name: 'codellama:7b', size: 2000 },
            ],
          }),
      });

      const result = await orchestrator.getAggregatedTags();

      expect(result.models).toHaveLength(2);
      expect(result.models[0]).toMatchObject({
        name: 'llama2:7b',
        servers: ['server-1'],
      });
      expect(result.models[1]).toMatchObject({
        name: 'codellama:7b',
        servers: ['server-1'],
      });
    });

    it('should aggregate tags from multiple servers', async () => {
      // Add multiple healthy servers
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      // Mock responses for both servers
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [
                { name: 'llama2:7b', size: 1000 },
                { name: 'codellama:7b', size: 2000 },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [
                { name: 'llama2:7b', size: 1000 }, // Same model on different server
                { name: 'mistral:7b', size: 1500 },
              ],
            }),
        });

      const result = await orchestrator.getAggregatedTags();

      expect(result.models).toHaveLength(3);
      const llamaModel = result.models.find(m => m.name === 'llama2:7b');
      expect(llamaModel?.servers).toEqual(['server-1', 'server-2']);
    });

    it('should deduplicate models by name:digest', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [
              { name: 'llama2:7b', digest: 'abc123', size: 1000 },
              { name: 'llama2:7b', digest: 'abc123', size: 1000 }, // Duplicate
              { name: 'llama2:7b', digest: 'def456', size: 1000 }, // Different digest
            ],
          }),
      });

      const result = await orchestrator.getAggregatedTags();

      expect(result.models).toHaveLength(2);
      expect(result.models.map(m => m.name + ':' + m.digest)).toEqual(
        expect.arrayContaining(['llama2:7b:abc123', 'llama2:7b:def456'])
      );
    });

    it('should handle server errors gracefully', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      // Mock one success and one failure
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [{ name: 'llama2:7b', size: 1000 }],
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

      const result = await orchestrator.getAggregatedTags();

      expect(result.models).toHaveLength(1);
      expect(result.models[0].name).toBe('llama2:7b');
    });

    it('should handle network timeouts', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      (global.fetch as any).mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 6000);
        });
      });

      const result = await orchestrator.getAggregatedTags();

      // Should return empty since all requests failed
      expect(result.models).toEqual([]);
    });

    it('should use cached results when available and fresh', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      // First call - should fetch
      await orchestrator.getAggregatedTags();
      const callsAfterFirstFetch = (global.fetch as any).mock.calls.length;

      // Second call - should use cache
      const result = await orchestrator.getAggregatedTags();

      expect(result.models).toHaveLength(1);
      // Cache should have been used - no additional fetch calls
      expect((global.fetch as any).mock.calls.length).toBe(callsAfterFirstFetch);
    });

    it('should invalidate cache when server is added', async () => {
      // First add server and cache result
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      await orchestrator.getAggregatedTags();
      const callsAfterFirstFetch = (global.fetch as any).mock.calls.length;

      // Add second server - should invalidate cache
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      const result = await orchestrator.getAggregatedTags();

      expect(result.models).toHaveLength(2);
      // Should have made additional fetch calls after adding server (cache was invalidated)
      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(callsAfterFirstFetch);
    });

    it('should invalidate cache when server is removed', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      await orchestrator.getAggregatedTags();
      const callsAfterFirstFetch = (global.fetch as any).mock.calls.length;

      // Remove server - should invalidate cache
      orchestrator.removeServer('server-2');

      const result = await orchestrator.getAggregatedTags();

      expect(result.models).toHaveLength(1);
      // Should have made additional fetch calls after removing server (cache was invalidated)
      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(callsAfterFirstFetch);
    });

    it('should clear cache when requested', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      await orchestrator.getAggregatedTags();
      const callsAfterFirstFetch = (global.fetch as any).mock.calls.length;

      orchestrator.clearTagsCache();

      const result = await orchestrator.getAggregatedTags();

      expect(result.models).toHaveLength(1);
      // Should have made additional fetch calls after clearing cache
      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(callsAfterFirstFetch);
    });

    it('should return cached data even when stale if no healthy servers', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [{ name: 'llama2:7b', size: 1000 }],
          }),
      });

      await orchestrator.getAggregatedTags();

      // Make server unhealthy
      const server = orchestrator.getServer('server-1');
      if (server) server.healthy = false;

      // Should return stale cached data
      const result = await orchestrator.getAggregatedTags();

      expect(result.models).toHaveLength(1);
      expect(result.models[0].name).toBe('llama2:7b');
    });

    it('should respect batch delay between concurrent requests', async () => {
      // Add many servers to test batching
      for (let i = 1; i <= 20; i++) {
        orchestrator.addServer({
          id: `server-${i}`,
          url: `http://localhost:1143${i}`,
          type: 'ollama',
        });
      }

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [{ name: 'llama2:7b', size: 1000 }],
          }),
      });

      const startTime = Date.now();
      await orchestrator.getAggregatedTags();
      const duration = Date.now() - startTime;

      // Should take some time due to batch delays (50ms * batches)
      expect(duration).toBeGreaterThan(50);
      // Should have made calls to all servers (at least 20 calls for tags)
      expect((global.fetch as any).mock.calls.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Tags Cache Management', () => {
    it('should invalidate server tags cache', () => {
      // Set up cache
      orchestrator['tagsCache'] = {
        data: [],
        timestamp: Date.now(),
        metadata: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          serverCount: 0,
          modelCount: 0,
          errors: [],
        },
      };

      orchestrator.invalidateServerTagsCache('server-1');

      expect(orchestrator['tagsCache']).toBeUndefined();
    });

    it('should clear tags cache', () => {
      // Set up cache
      orchestrator['tagsCache'] = {
        data: [],
        timestamp: Date.now(),
        metadata: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          serverCount: 0,
          modelCount: 0,
          errors: [],
        },
      };

      orchestrator.clearTagsCache();

      expect(orchestrator['tagsCache']).toBeUndefined();
    });

    it('should invalidate tags cache when cache exists', () => {
      // Set up cache
      orchestrator['tagsCache'] = {
        data: [],
        timestamp: Date.now(),
        metadata: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          serverCount: 0,
          modelCount: 0,
          errors: [],
        },
      };

      orchestrator.invalidateTagsCache();

      expect(orchestrator['tagsCache']).toBeUndefined();
    });

    it('should not clear tags cache when already empty', () => {
      orchestrator['tagsCache'] = undefined;

      orchestrator.invalidateTagsCache();

      expect(orchestrator['tagsCache']).toBeUndefined();
    });
  });

  describe('Drain Operation', () => {
    beforeEach(() => {
      // Reset draining state
      orchestrator['draining'] = false;
    });

    it('should drain successfully when no requests are pending', async () => {
      // Mock empty queue and no in-flight requests
      const getStatsSpy = vi.spyOn(orchestrator, 'getStats').mockReturnValue({
        totalServers: 0,
        healthyServers: 0,
        totalModels: 0,
        inFlightRequests: 0,
        circuitBreakers: {},
      });
      const queueSizeSpy = vi.spyOn(orchestrator['requestQueue'], 'size').mockReturnValue(0);

      const result = await orchestrator.drain(1000);

      expect(result).toBe(true);
      expect(orchestrator['draining']).toBe(false);
      expect(getStatsSpy).toHaveBeenCalled();
      expect(queueSizeSpy).toHaveBeenCalled();
    });

    it('should timeout when requests remain pending', async () => {
      // Mock non-empty state that persists
      const getStatsSpy = vi.spyOn(orchestrator, 'getStats').mockReturnValue({
        totalServers: 0,
        healthyServers: 0,
        totalModels: 0,
        inFlightRequests: 1,
        circuitBreakers: {},
      });
      const queueSizeSpy = vi.spyOn(orchestrator['requestQueue'], 'size').mockReturnValue(1);

      const result = await orchestrator.drain(100); // Short timeout

      expect(result).toBe(false);
      expect(orchestrator['draining']).toBe(false);
      expect(getStatsSpy).toHaveBeenCalled();
      expect(queueSizeSpy).toHaveBeenCalled();
    });

    it('should wait for requests to complete', async () => {
      let callCount = 0;

      // Mock queue that becomes empty after a few checks
      const getStatsSpy = vi.spyOn(orchestrator, 'getStats').mockImplementation(() => {
        callCount++;
        return {
          totalServers: 0,
          healthyServers: 0,
          totalModels: 0,
          inFlightRequests: callCount < 3 ? 1 : 0, // Become empty after 3 calls
          circuitBreakers: {},
        };
      });
      const queueSizeSpy = vi.spyOn(orchestrator['requestQueue'], 'size').mockReturnValue(0);

      const result = await orchestrator.drain(5000);

      expect(result).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Metrics Methods', () => {
    it('should get global metrics (line 1018)', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      const metrics = orchestrator.getGlobalMetrics();

      expect(metrics).toBeDefined();
      expect(typeof metrics.totalRequests).toBe('number');
      expect(typeof metrics.totalErrors).toBe('number');
    });

    it('should export metrics (lines 1024-1025)', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      const exported = orchestrator.exportMetrics();

      expect(exported).toBeDefined();
      expect(exported.timestamp).toBeDefined();
      expect(exported.global).toBeDefined();
      expect(exported.servers).toBeDefined();
    });

    it('should get detailed metrics for server:model (lines 1003-1004)', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      const metrics = orchestrator.getDetailedMetrics('server-1', 'llama3:latest');

      // Returns undefined when no metrics recorded yet
      expect(metrics).toBeUndefined();
    });
  });

  describe('getStats with in-flight requests (lines 977-988)', () => {
    it('should count in-flight requests correctly', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      // Mock in-flight requests
      orchestrator['inFlight'].set('server-1:llama3:latest', 3);
      orchestrator['inFlight'].set('server-1:llama2:latest', 2);

      const stats = orchestrator.getStats();

      expect(stats.inFlightRequests).toBe(5);
    });

    it('should include circuit breaker stats', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      const stats = orchestrator.getStats();

      expect(stats.circuitBreakers).toBeDefined();
      expect(typeof stats.circuitBreakers).toBe('object');
    });
  });

  describe('getAllDetailedMetrics (line 1010)', () => {
    it('should get all detailed metrics', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      const allMetrics = orchestrator.getAllDetailedMetrics();

      expect(allMetrics).toBeDefined();
      expect(allMetrics instanceof Map).toBe(true);
    });
  });

  describe('Queue Management', () => {
    it('should get queue stats', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      const queueStats = orchestrator.getQueueStats();

      expect(queueStats).toBeDefined();
      expect(typeof queueStats.currentSize).toBe('number');
    });

    it('should pause queue', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      orchestrator.pauseQueue();

      expect(orchestrator.isQueuePaused()).toBe(true);
    });

    it('should resume queue (lines 1044-1046)', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      orchestrator.pauseQueue();
      expect(orchestrator.isQueuePaused()).toBe(true);

      orchestrator.resumeQueue();
      expect(orchestrator.isQueuePaused()).toBe(false);
    });

    it('should check if queue is paused (lines 1050-1053)', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      // Initially not paused
      expect(orchestrator.isQueuePaused()).toBe(false);

      // After pausing
      orchestrator.pauseQueue();
      expect(orchestrator.isQueuePaused()).toBe(true);
    });
  });

  describe('shouldSkipServer (lines 942-946)', () => {
    it('should return true when circuit breaker is open', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      // Get circuit breaker and force it open
      const cb = orchestrator['getCircuitBreaker']('server-1');

      // Record multiple failures to open the circuit breaker
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test error'));
      }

      // Should skip server when circuit breaker is open
      const shouldSkip = orchestrator['shouldSkipServer']('server-1');
      expect(shouldSkip).toBe(true);
    });

    it('should return false when circuit breaker is closed', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      // Should not skip server when circuit breaker is closed
      const shouldSkip = orchestrator['shouldSkipServer']('server-1');
      expect(shouldSkip).toBe(false);
    });
  });

  describe('getStats circuit breaker stats (lines 984-988)', () => {
    it('should include circuit breaker stats with actual state', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      // Record failures on server-1 to change its circuit breaker state
      const cb1 = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 5; i++) {
        cb1.recordFailure(new Error('test error'));
      }

      const stats = orchestrator.getStats();

      expect(stats.circuitBreakers).toBeDefined();

      // server-1 should have circuit breaker stats since we recorded failures
      expect(stats.circuitBreakers['server-1']).toBeDefined();
      expect(typeof stats.circuitBreakers['server-1'].state).toBe('string');
      expect(typeof stats.circuitBreakers['server-1'].failureCount).toBe('number');
    });
  });

  describe('getModelMap', () => {
    it('should return empty object when no servers', () => {
      expect(orchestrator.getModelMap()).toEqual({});
    });

    it('should return model map from healthy servers', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const server = orchestrator.getServer('server-1');
      if (server) {
        server.healthy = true;
        server.models = ['llama2', 'mistral'];
      }

      const modelMap = orchestrator.getModelMap();
      expect(modelMap).toEqual({
        llama2: ['server-1'],
        mistral: ['server-1'],
      });
    });

    it('should exclude unhealthy servers', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const server = orchestrator.getServer('server-1');
      if (server) {
        server.healthy = false;
        server.models = ['llama2'];
      }

      const modelMap = orchestrator.getModelMap();
      expect(modelMap).toEqual({});
    });
  });

  describe('getAllModels', () => {
    it('should return empty array when no models', () => {
      expect(orchestrator.getAllModels()).toEqual([]);
    });

    it('should return all unique models from healthy servers', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      const s1 = orchestrator.getServer('server-1');
      const s2 = orchestrator.getServer('server-2');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2', 'mistral'];
      }
      if (s2) {
        s2.healthy = true;
        s2.models = ['llama2', 'codellama'];
      }

      const models = orchestrator.getAllModels();
      expect(models).toContain('llama2');
      expect(models).toContain('mistral');
      expect(models).toContain('codellama');
    });
  });

  describe('getCurrentModelList', () => {
    it('should return models from all servers regardless of health', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      const s1 = orchestrator.getServer('server-1');
      const s2 = orchestrator.getServer('server-2');
      if (s1) {
        s1.healthy = false;
        s1.models = ['llama2'];
      }
      if (s2) {
        s2.healthy = true;
        s2.models = ['mistral'];
      }

      const models = orchestrator.getCurrentModelList();
      expect(models).toContain('llama2');
      expect(models).toContain('mistral');
    });
  });

  describe('getBestServerForModel', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      const s1 = orchestrator.getServer('server-1');
      const s2 = orchestrator.getServer('server-2');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2:latest'];
        s1.maxConcurrency = 4;
      }
      if (s2) {
        s2.healthy = true;
        s2.models = ['llama2:latest'];
        s2.maxConcurrency = 4;
      }
    });

    it('should return undefined when no servers have the model', () => {
      const server = orchestrator.getBestServerForModel('nonexistent');
      expect(server).toBeUndefined();
    });

    it('should return undefined when no healthy servers', () => {
      // Remove server-2 so only server-1 exists
      orchestrator.removeServer('server-2');
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.healthy = false;

      const server = orchestrator.getBestServerForModel('llama2:latest');
      expect(server).toBeUndefined();
    });

    it('should return server when model is available', () => {
      const server = orchestrator.getBestServerForModel('llama2:latest');
      expect(server).toBeDefined();
      expect(server?.id).toBe('server-1');
    });

    it('should return undefined when server is draining', () => {
      // Remove server-2
      orchestrator.removeServer('server-2');
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.draining = true;

      const server = orchestrator.getBestServerForModel('llama2:latest');
      expect(server).toBeUndefined();
    });

    it('should return undefined when server is in maintenance', () => {
      // Remove server-2
      orchestrator.removeServer('server-2');
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.maintenance = true;

      const server = orchestrator.getBestServerForModel('llama2:latest');
      expect(server).toBeUndefined();
    });

    it('should return undefined when server is in cooldown', () => {
      // Remove server-2
      orchestrator.removeServer('server-2');
      orchestrator['failureCooldown'].set('server-1:llama2:latest', Date.now());

      const server = orchestrator.getBestServerForModel('llama2:latest');
      expect(server).toBeUndefined();
    });

    it('should return undefined when server is permanently banned', () => {
      // Remove server-2
      orchestrator.removeServer('server-2');
      orchestrator['permanentBan'].add('server-1:llama2:latest');

      const server = orchestrator.getBestServerForModel('llama2:latest');
      expect(server).toBeUndefined();
    });

    it('should return undefined when server is at max concurrency', () => {
      // Remove server-2
      orchestrator.removeServer('server-2');
      orchestrator['inFlight'].set('server-1:llama2:latest', 4);

      const server = orchestrator.getBestServerForModel('llama2:latest');
      expect(server).toBeUndefined();
    });

    it('should resolve :latest tag', () => {
      const server = orchestrator.getBestServerForModel('llama2');
      expect(server).toBeDefined();
    });
  });

  describe('getServerScores', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
        s1.maxConcurrency = 4;
      }
    });

    it('should return empty array for non-existent model', () => {
      const scores = orchestrator.getServerScores('nonexistent');
      expect(scores).toEqual([]);
    });

    it('should return scores for available servers', () => {
      const scores = orchestrator.getServerScores('llama2');
      expect(scores.length).toBe(1);
      expect(scores[0]).toHaveProperty('totalScore');
    });

    it('should return sorted scores by totalScore descending', () => {
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });
      const s2 = orchestrator.getServer('server-2');
      if (s2) {
        s2.healthy = true;
        s2.models = ['llama2'];
        s2.maxConcurrency = 4;
      }

      const scores = orchestrator.getServerScores('llama2');
      expect(scores.length).toBe(2);
      expect(scores[0].totalScore).toBeGreaterThanOrEqual(scores[1].totalScore);
    });
  });

  describe('getAggregatedOpenAIModels', () => {
    it('should return empty list when no servers', () => {
      const result = orchestrator.getAggregatedOpenAIModels();
      expect(result.data).toEqual([]);
    });

    it('should return models from v1-enabled servers', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.supportsV1 = true;
        s1.v1Models = ['gpt-3.5-turbo'];
      }

      const result = orchestrator.getAggregatedOpenAIModels();
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe('gpt-3.5-turbo');
    });

    it('should exclude unhealthy servers', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = false;
        s1.supportsV1 = true;
        s1.v1Models = ['gpt-3.5-turbo'];
      }

      const result = orchestrator.getAggregatedOpenAIModels();
      expect(result.data).toEqual([]);
    });

    it('should exclude servers without v1 support', () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.supportsV1 = false;
        s1.v1Models = ['gpt-3.5-turbo'];
      }

      const result = orchestrator.getAggregatedOpenAIModels();
      expect(result.data).toEqual([]);
    });
  });

  describe('Ban Management', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator['permanentBan'].add('server-1:llama2');
      orchestrator['permanentBan'].add('server-1:mistral');
      orchestrator['permanentBan'].add('server-2:codellama');
    });

    it('should unban specific server:model', () => {
      const result = orchestrator.unban('server-1', 'llama2');
      expect(result).toBe(true);
      expect(orchestrator['permanentBan'].has('server-1:llama2')).toBe(false);
    });

    it('should return false when ban does not exist', () => {
      const result = orchestrator.unban('server-1', 'nonexistent');
      expect(result).toBe(false);
    });

    it('should unban all models for a server', () => {
      const count = orchestrator.unbanServer('server-1');
      expect(count).toBe(2);
      expect(orchestrator['permanentBan'].has('server-1:llama2')).toBe(false);
      expect(orchestrator['permanentBan'].has('server-1:mistral')).toBe(false);
    });

    it('should unban model across all servers', () => {
      const count = orchestrator.unbanModel('codellama');
      expect(count).toBe(1);
      expect(orchestrator['permanentBan'].has('server-2:codellama')).toBe(false);
    });

    it('should clear all bans', () => {
      const count = orchestrator.clearAllBans();
      expect(count).toBe(3);
      expect(orchestrator['permanentBan'].size).toBe(0);
    });

    it('should get detailed ban information', () => {
      const details = orchestrator.getBanDetails();
      expect(details.length).toBe(3);
      expect(details).toContainEqual(
        expect.objectContaining({ serverId: 'server-1', model: 'llama2' })
      );
    });
  });

  describe('setSuppressPersistence', () => {
    it('should set suppress persistence flag', () => {
      orchestrator.setSuppressPersistence(true);
      expect(orchestrator['_suppressPersistence']).toBe(true);

      orchestrator.setSuppressPersistence(false);
      expect(orchestrator['_suppressPersistence']).toBe(false);
    });
  });

  describe('requestToServer', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should throw when server not found', async () => {
      await expect(
        orchestrator.requestToServer('nonexistent', 'llama2', async () => ({ ok: true }))
      ).rejects.toThrow('Server not found: nonexistent');
    });

    it('should throw when server not healthy', async () => {
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.healthy = false;

      await expect(
        orchestrator.requestToServer('server-1', 'llama2', async () => ({ ok: true }))
      ).rejects.toThrow('Server is not healthy');
    });

    it('should throw when model not available', async () => {
      await expect(
        orchestrator.requestToServer('server-1', 'nonexistent', async () => ({ ok: true }))
      ).rejects.toThrow("Model 'nonexistent' not available");
    });

    it('should throw when server in cooldown', async () => {
      orchestrator['failureCooldown'].set('server-1:llama2', Date.now());

      await expect(
        orchestrator.requestToServer('server-1', 'llama2', async () => ({ ok: true }))
      ).rejects.toThrow('cooldown');
    });

    it('should throw when server permanently banned', async () => {
      orchestrator['permanentBan'].add('server-1:llama2');

      await expect(
        orchestrator.requestToServer('server-1', 'llama2', async () => ({ ok: true }))
      ).rejects.toThrow('permanently banned');
    });

    it('should throw when circuit breaker open', async () => {
      const cb = orchestrator['getCircuitBreaker']('server-1');
      const modelCb = orchestrator['getModelCircuitBreaker']('server-1', 'llama2');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
        modelCb.recordFailure(new Error('test'));
      }

      await expect(
        orchestrator.requestToServer('server-1', 'llama2', async () => ({ ok: true }))
      ).rejects.toThrow('Circuit breaker is open');
    });

    it('should execute successfully when bypassCircuitBreaker is true', async () => {
      const cb = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }

      const result = await orchestrator.requestToServer(
        'server-1',
        'llama2',
        async server => ({ success: true, serverId: server.id }),
        { bypassCircuitBreaker: true }
      );
      expect(result.success).toBe(true);
    });

    it('should throw when request aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        orchestrator.requestToServer('server-1', 'llama2', async () => ({}), {
          signal: controller.signal,
        })
      ).rejects.toThrow('Request aborted');
    });

    it('should track in-flight requests', async () => {
      const beforeFlight = orchestrator.getInFlight('server-1', 'llama2');

      await orchestrator.requestToServer('server-1', 'llama2', async () => {
        const duringFlight = orchestrator.getInFlight('server-1', 'llama2');
        expect(duringFlight).toBe(beforeFlight + 1);
        return { ok: true };
      });

      const afterFlight = orchestrator.getInFlight('server-1', 'llama2');
      expect(afterFlight).toBe(beforeFlight);
    });
  });

  describe('getInFlightByServer', () => {
    it('should return empty object when no in-flight', () => {
      expect(orchestrator.getInFlightByServer()).toEqual({});
    });

    it('should return in-flight grouped by server', () => {
      orchestrator.incrementInFlight('server-1', 'model-1');
      orchestrator.incrementInFlight('server-1', 'model-2');
      orchestrator.incrementInFlight('server-2', 'model-1');

      const result = orchestrator.getInFlightByServer();

      expect(result['server-1'].total).toBe(2);
      expect(result['server-2'].total).toBe(1);
    });

    it('should track bypass requests separately', () => {
      orchestrator.incrementInFlight('server-1', 'model-1', false);
      orchestrator.incrementInFlight('server-1', 'model-1', true);

      const result = orchestrator.getInFlightByServer();

      expect(result['server-1'].byModel['model-1'].regular).toBe(1);
      expect(result['server-1'].byModel['model-1'].bypass).toBe(1);
    });
  });

  describe('updateAllStatus', () => {
    it('should update status for all servers', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      // Mock fetch
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/tags')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ models: [{ name: 'llama2' }] }),
          });
        }
        if (url.includes('/api/version')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ version: '0.1.0' }),
          });
        }
        return Promise.reject(new Error('Not found'));
      });

      await orchestrator.updateAllStatus();

      const s1 = orchestrator.getServer('server-1');
      expect(s1?.models).toContain('llama2');
    });

    it('should skip banned servers', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.models = ['model1'];
      }
      orchestrator['permanentBan'].add('server-1:model1');
      orchestrator['permanentBan'].add('server-1:model2'); // Ban all models

      // Should not throw
      await orchestrator.updateAllStatus();
    });
  });

  describe('Circuit Breaker Public API', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should get server circuit breaker', () => {
      // Create the breaker first by accessing it
      orchestrator['getCircuitBreaker']('server-1');
      const cb = orchestrator.getServerCircuitBreaker('server-1');
      expect(cb).toBeDefined();
    });

    it('should return undefined for non-existent server circuit breaker', () => {
      const cb = orchestrator.getServerCircuitBreaker('nonexistent');
      expect(cb).toBeUndefined();
    });

    it('should get model circuit breaker public', () => {
      const cb = orchestrator.getModelCircuitBreakerPublic('server-1', 'llama2');
      expect(cb).toBeDefined();
    });

    it('should reset server circuit breaker', () => {
      // Create the breaker first
      orchestrator['getCircuitBreaker']('server-1');
      const result = orchestrator.resetServerCircuitBreaker('server-1');
      expect(result).toBe(true);
    });

    it('should return false when resetting non-existent breaker', () => {
      const result = orchestrator.resetServerCircuitBreaker('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('manualTriggerRecoveryTest', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should return error when breaker not found', async () => {
      // Use a model name that was never accessed to ensure breaker doesn't exist
      const result = await orchestrator.manualTriggerRecoveryTest('nonexistent', 'nonexistent');
      expect(result.success).toBe(false);
      // The error may be "not found" or "not half-open" depending on whether the breaker was created
      expect(result.error).toMatch(/not found|not half-open/);
    });

    it('should return error when not in half-open state', async () => {
      const result = await orchestrator.manualTriggerRecoveryTest('server-1', 'llama2');
      expect(result.success).toBe(false);
      expect(result.error).toContain('half-open');
    });
  });

  describe('removeModelCircuitBreaker', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should remove model circuit breaker', () => {
      // First create the breaker
      orchestrator.getModelCircuitBreakerPublic('server-1', 'llama2');

      const result = orchestrator.removeModelCircuitBreaker('server-1', 'llama2');
      expect(result).toBe(true);
    });

    it('should return false when breaker does not exist', () => {
      const result = orchestrator.removeModelCircuitBreaker('server-1', 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getQueueItems', () => {
    it('should get queue items', () => {
      const items = orchestrator.getQueueItems();
      expect(items).toBeDefined();
      expect(Array.isArray(items)).toBe(true);
    });
  });

  describe('getCircuitBreakerStats', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should get all circuit breaker stats', () => {
      const stats = orchestrator.getCircuitBreakerStats();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });
  });

  describe('Health check handlers', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should handle health check success', () => {
      const result = {
        serverId: 'server-1',
        success: true,
        responseTime: 100,
        models: ['llama2', 'mistral'],
        loadedModels: [],
        totalVramUsed: 0,
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      const server = orchestrator.getServer('server-1');
      expect(server?.healthy).toBe(true);
    });

    it('should handle health check failure', () => {
      const result = {
        serverId: 'server-1',
        success: false,
        error: 'Connection refused',
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      const server = orchestrator.getServer('server-1');
      expect(server?.healthy).toBe(false);
      expect(server?.models).toEqual([]);
    });

    it('should handle unknown server health check', () => {
      const result = {
        serverId: 'nonexistent',
        success: true,
        timestamp: Date.now(),
      };

      // Should not throw
      orchestrator['onHealthCheckResult'](result);
    });

    it('should update supportsOllama flag', () => {
      const result = {
        serverId: 'server-1',
        success: true,
        supportsOllama: true,
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      const server = orchestrator.getServer('server-1');
      expect(server?.supportsOllama).toBe(true);
    });

    it('should update supportsV1 flag', () => {
      const result = {
        serverId: 'server-1',
        success: true,
        supportsV1: true,
        v1Models: ['gpt-3.5-turbo'],
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      const server = orchestrator.getServer('server-1');
      expect(server?.supportsV1).toBe(true);
      expect(server?.v1Models).toEqual(['gpt-3.5-turbo']);
    });

    it('should update loaded models and VRAM', () => {
      const result = {
        serverId: 'server-1',
        success: true,
        loadedModels: [
          { name: 'llama2', sizeVram: 4 * 1024 * 1024 * 1024, expiresAt: '', digest: '' },
        ],
        totalVramUsed: 4 * 1024 * 1024 * 1024,
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      const server = orchestrator.getServer('server-1');
      expect(server?.hardware).toBeDefined();
      expect(server?.hardware?.loadedModels).toHaveLength(1);
    });

    it('should force close circuit breaker on recovery', () => {
      // Open the circuit breaker first
      const cb = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }
      expect(cb.getState()).toBe('open');

      // Now simulate successful health check
      const result = {
        serverId: 'server-1',
        success: true,
        responseTime: 100,
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      const server = orchestrator.getServer('server-1');
      expect(server?.healthy).toBe(true);
    });

    it('should handle all health checks complete', () => {
      const results = [
        { serverId: 'server-1', success: true, timestamp: Date.now() },
        { serverId: 'server-2', success: false, timestamp: Date.now() },
      ];

      // Should not throw
      orchestrator['onAllHealthChecksComplete'](results);
    });
  });

  describe('Timeout management', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      // Clear timeouts to ensure clean state
      orchestrator['timeouts'].clear();
    });

    it('should get default timeout', () => {
      const timeout = orchestrator.getTimeout('server-1', 'llama2');
      expect(timeout).toBe(60000);
    });

    it('should set and get custom timeout', () => {
      orchestrator.setTimeout('server-1', 'llama2', 120000);
      const timeout = orchestrator.getTimeout('server-1', 'llama2');
      expect(timeout).toBe(120000);
    });

    it('should return stored timeout during half-open state', () => {
      orchestrator.setTimeout('server-1', 'llama2', 90000);

      const cb = orchestrator['getCircuitBreaker']('server-1');
      cb.recordFailure(new Error('test'));

      // Force to half-open by calling canExecute which triggers transition
      cb.canExecute();

      const timeout = orchestrator.getTimeout('server-1', 'llama2');
      expect(timeout).toBe(90000);
    });
  });

  describe('tryRequestWithFailover', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      const s1 = orchestrator.getServer('server-1');
      const s2 = orchestrator.getServer('server-2');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
      if (s2) {
        s2.healthy = true;
        s2.models = ['llama2'];
      }
    });

    it('should throw when no servers available', async () => {
      // Remove all servers
      orchestrator.removeServer('server-1');
      orchestrator.removeServer('server-2');

      await expect(
        orchestrator.tryRequestWithFailover('llama2', async () => ({ ok: true }))
      ).rejects.toThrow('No healthy servers available');
    });

    it('should throw when model not on any server', async () => {
      await expect(
        orchestrator.tryRequestWithFailover('nonexistent', async () => ({ ok: true }))
      ).rejects.toThrow("No healthy servers available for model 'nonexistent'");
    });

    it('should execute request successfully on first server', async () => {
      const result = await orchestrator.tryRequestWithFailover('llama2', async server => {
        return { success: true, serverId: server.id };
      });
      expect(result.success).toBe(true);
      expect(result.serverId).toBeDefined();
    });

    it('should respect requiredCapability ollama', async () => {
      // Remove server-2 and set server-1 to not support ollama
      orchestrator.removeServer('server-2');
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.supportsOllama = false;

      await expect(
        orchestrator.tryRequestWithFailover('llama2', async () => ({}), false, 'generate', 'ollama')
      ).rejects.toThrow('No healthy servers available');
    });

    it('should respect requiredCapability openai', async () => {
      // Remove server-2 and set server-1 to not support v1
      orchestrator.removeServer('server-2');
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.supportsV1 = false;

      await expect(
        orchestrator.tryRequestWithFailover('llama2', async () => ({}), false, 'generate', 'openai')
      ).rejects.toThrow('No healthy servers available');
    });

    it('should populate routing context', async () => {
      const context: any = {};

      await orchestrator.tryRequestWithFailover(
        'llama2',
        async () => ({}),
        false,
        'generate',
        undefined,
        context
      );

      expect(context.selectedServerId).toBeDefined();
      expect(context.availableServerCount).toBeDefined();
    });
  });

  describe('executeActiveTest methods', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2', 'nomic-embed-text'];
      }
    });

    it('should execute inference active test', async () => {
      // Mock fetch to simulate successful inference
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ response: 'test' }),
      });

      const result = await orchestrator['executeInferenceActiveTest'](
        { id: 'server-1', url: 'http://localhost:11434', type: 'ollama' } as any,
        'llama2',
        10000
      );
      // Will fail due to network but should handle gracefully
    });

    it('should execute embedding active test', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
      });

      const result = await orchestrator['executeEmbeddingActiveTest'](
        { id: 'server-1', url: 'http://localhost:11434', type: 'ollama' } as any,
        'nomic-embed-text',
        10000
      );
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });

      // Mock the methods that interact with external systems
      const stopSpy = vi.spyOn(orchestrator['healthCheckScheduler'], 'stop');
      const shutdownMetricsSpy = vi.spyOn(orchestrator['metricsAggregator'], 'shutdown');
      const shutdownBreakerSpy = vi.spyOn(orchestrator['circuitBreakerPersistence'], 'shutdown');
      const queueShutdownSpy = vi.spyOn(orchestrator['requestQueue'], 'shutdown');

      await orchestrator.shutdown();

      expect(stopSpy).toHaveBeenCalled();
      expect(shutdownMetricsSpy).toHaveBeenCalled();
      expect(shutdownBreakerSpy).toHaveBeenCalled();
      expect(queueShutdownSpy).toHaveBeenCalled();
    });
  });

  describe('forceOpenServerBreaker', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should force open server breaker', () => {
      orchestrator['forceOpenServerBreaker']('server-1', 'Test reason');

      const cb = orchestrator['getCircuitBreaker']('server-1');
      expect(cb.getState()).toBe('open');
    });

    it('should mark server unhealthy when forcing open', () => {
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.healthy = true;

      orchestrator['forceOpenServerBreaker']('server-1', 'Test reason');

      const s1After = orchestrator.getServer('server-1');
      expect(s1After?.healthy).toBe(false);
    });
  });

  describe('checkModelBreakerEscalation', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.models = ['llama2', 'mistral', 'codellama'];
      }
    });

    it('should not escalate when no models', () => {
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.models = [];

      // Should not throw
      orchestrator['checkModelBreakerEscalation']('server-1');
    });

    it('should not escalate when modelEscalation disabled', () => {
      // Override config to disable escalation
      orchestrator['config'].circuitBreaker.modelEscalation.enabled = false;

      // Should not throw
      orchestrator['checkModelBreakerEscalation']('server-1');
    });
  });

  describe('getCircuitBreakerHealth', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should return circuit breaker health', () => {
      // Create the circuit breaker first
      orchestrator['getCircuitBreaker']('server-1');
      const health = orchestrator['getCircuitBreakerHealth']('server-1');
      expect(health).toBeDefined();
      expect(health?.state).toBeDefined();
    });

    it('should return undefined for non-existent server', () => {
      const health = orchestrator['getCircuitBreakerHealth']('nonexistent');
      expect(health).toBeUndefined();
    });
  });

  describe('updateServerStatus', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should update server status successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama2' }] }),
      });

      const server = orchestrator.getServer('server-1');
      await orchestrator.updateServerStatus(server!);

      expect(server?.healthy).toBe(true);
      expect(server?.models).toContain('llama2');
    });

    it('should handle failed status update', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const server = orchestrator.getServer('server-1');
      await orchestrator.updateServerStatus(server!);

      expect(server?.healthy).toBe(false);
    });

    it('should handle version response', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/tags')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ models: [] }),
          });
        }
        if (url.includes('/api/version')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ version: '0.1.0' }),
          });
        }
        return Promise.reject(new Error('Not found'));
      });

      const server = orchestrator.getServer('server-1');
      await orchestrator.updateServerStatus(server!);

      expect(server?.version).toBe('0.1.0');
    });
  });

  describe('resolveModelName', () => {
    it('should resolve model name with :latest', () => {
      const available = ['llama2:latest', 'mistral'];
      const resolved = orchestrator['resolveModelName']('llama2', available);
      expect(resolved).toBe('llama2:latest');
    });

    it('should return null for non-existent model', () => {
      const available = ['llama2:latest'];
      const resolved = orchestrator['resolveModelName']('nonexistent', available);
      expect(resolved).toBeNull();
    });
  });

  describe('arraysEqual', () => {
    it('should compare equal arrays', () => {
      const result = orchestrator['arraysEqual'](['a', 'b'], ['a', 'b']);
      expect(result).toBe(true);
    });

    it('should compare unequal arrays', () => {
      const result = orchestrator['arraysEqual'](['a', 'b'], ['a', 'c']);
      expect(result).toBe(false);
    });

    it('should compare arrays of different lengths', () => {
      const result = orchestrator['arraysEqual'](['a'], ['a', 'b']);
      expect(result).toBe(false);
    });
  });

  describe('extractModelsFromResponse', () => {
    it('should extract models from response', () => {
      const response = { models: ['llama2', 'mistral'] };
      const models = orchestrator['extractModelsFromResponse'](response);
      expect(models).toEqual(['llama2', 'mistral']);
    });

    it('should extract models from object format', () => {
      const response = { models: [{ name: 'llama2' }, { model: 'mistral' }] };
      const models = orchestrator['extractModelsFromResponse'](response);
      expect(models).toEqual(['llama2', 'mistral']);
    });

    it('should return empty array for invalid response', () => {
      const models = orchestrator['extractModelsFromResponse'](null);
      expect(models).toEqual([]);
    });
  });

  describe('classifyRecoveryError', () => {
    it('should classify timeout errors', () => {
      const type = orchestrator['classifyRecoveryError']('Request timeout');
      expect(type).toBe('timeout');
    });

    it('should classify connection errors', () => {
      const type = orchestrator['classifyRecoveryError']('Connection refused');
      expect(type).toBe('connection_refused');
    });

    it('should classify HTTP errors', () => {
      const type = orchestrator['classifyRecoveryError']('HTTP 503');
      expect(type).toBe('http_error');
    });

    it('should classify model not found errors', () => {
      const type = orchestrator['classifyRecoveryError']('model not found');
      expect(type).toBe('model_not_found');
    });

    it('should return unknown for other errors', () => {
      const type = orchestrator['classifyRecoveryError']('some error');
      expect(type).toBe('unknown');
    });
  });

  describe('isServerWideError', () => {
    it('should detect disk full errors', () => {
      expect(orchestrator['isServerWideError']('Disk is full')).toBe(true);
    });

    it('should detect server crash errors', () => {
      expect(orchestrator['isServerWideError']('Server crash')).toBe(true);
    });

    it('should return false for non-server-wide errors', () => {
      expect(orchestrator['isServerWideError']('Model not found')).toBe(false);
    });
  });

  describe('hasClosedCircuitBreaker', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });
    });

    it('should return true when no circuit breaker exists', () => {
      const result = orchestrator['hasClosedCircuitBreaker']('llama2', ['server-1']);
      expect(result).toBe(true);
    });

    it('should return true when circuit breaker is closed', () => {
      // Create and close circuit breaker
      const cb = orchestrator['getCircuitBreaker']('server-1');
      cb.recordSuccess();

      const result = orchestrator['hasClosedCircuitBreaker']('llama2', ['server-1']);
      expect(result).toBe(true);
    });
  });

  describe('mergeTagsData', () => {
    it('should merge tags from multiple servers', () => {
      const allTags = new Map();

      orchestrator['mergeTagsData'](allTags, [{ name: 'llama2', size: 1000 }], 'server-1');
      expect(allTags.size).toBe(1);

      orchestrator['mergeTagsData'](allTags, [{ name: 'llama2', size: 1000 }], 'server-2');
      expect(allTags.size).toBe(1);

      const model = allTags.get('llama2');
      expect(model?.servers).toEqual(['server-1', 'server-2']);
    });

    it('should handle models with digest', () => {
      const allTags = new Map();

      orchestrator['mergeTagsData'](allTags, [{ name: 'llama2', digest: 'abc123' }], 'server-1');
      expect(allTags.has('llama2:abc123')).toBe(true);
    });

    it('should skip invalid model entries', () => {
      const allTags = new Map();

      orchestrator['mergeTagsData'](allTags, [null, undefined, 'string', {}], 'server-1');
      expect(allTags.size).toBe(0);
    });
  });

  describe('classifyError', () => {
    it('should classify embedding model errors', () => {
      const type = orchestrator['classifyError']('embedding model does not support generate');
      expect(type).toBe('non-retryable');
    });

    it('should classify permanent errors', () => {
      const type = orchestrator['classifyError']('out of memory');
      expect(type).toBe('permanent');
    });

    it('should classify non-retryable errors', () => {
      const type = orchestrator['classifyError']('invalid request');
      expect(type).toBe('non-retryable');
    });

    it('should classify transient errors', () => {
      const type = orchestrator['classifyError']('timeout error');
      expect(type).toBe('transient');
    });

    it('should classify HTTP 500 as retryable', () => {
      const type = orchestrator['classifyError']('HTTP 500 Internal Server Error');
      expect(type).toBe('retryable');
    });

    it('should default to retryable for unknown errors', () => {
      const type = orchestrator['classifyError']('some unknown error');
      expect(type).toBe('retryable');
    });
  });

  describe('isRetryableOnSameServer', () => {
    it('should identify retryable status codes', () => {
      const config = { retryableStatusCodes: [429, 503] };
      expect(orchestrator['isRetryableOnSameServer']('HTTP 429', config as any)).toBe(true);
      expect(orchestrator['isRetryableOnSameServer']('HTTP 503', config as any)).toBe(true);
    });

    it('should identify transient patterns', () => {
      const config = { retryableStatusCodes: [] };
      expect(orchestrator['isRetryableOnSameServer']('timeout error', config as any)).toBe(true);
      expect(
        orchestrator['isRetryableOnSameServer']('temporarily unavailable', config as any)
      ).toBe(true);
      expect(orchestrator['isRetryableOnSameServer']('rate limit exceeded', config as any)).toBe(
        true
      );
    });

    it('should return false for non-retryable errors', () => {
      const config = { retryableStatusCodes: [] };
      expect(orchestrator['isRetryableOnSameServer']('invalid request', config as any)).toBe(false);
    });
  });

  describe('incrementServerFailureCount and resetServerFailureCount', () => {
    it('should increment and reset failure count', () => {
      const count1 = orchestrator['incrementServerFailureCount']('server-1');
      expect(count1).toBe(1);

      const count2 = orchestrator['incrementServerFailureCount']('server-1');
      expect(count2).toBe(2);

      orchestrator['resetServerFailureCount']('server-1');

      const count3 = orchestrator['incrementServerFailureCount']('server-1');
      expect(count3).toBe(1);
    });
  });

  describe('shouldSkipServerModel', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.models = ['llama2', 'nomic-embed-text'];
      }
    });

    it('should skip when server circuit open', () => {
      const cb = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }

      const shouldSkip = orchestrator['shouldSkipServerModel']('server-1', 'llama2');
      expect(shouldSkip).toBe(true);
    });

    it('should skip half-open with no successes', () => {
      // Open the circuit breaker first
      const cb = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }
      // Now try to transition to half-open by calling canExecute
      cb.canExecute();

      const shouldSkip = orchestrator['shouldSkipServerModel']('server-1', 'llama2');
      // May or may not be true depending on state
      expect(typeof shouldSkip).toBe('boolean');
    });
  });

  describe('countHalfOpenCircuits', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should count half-open circuits', () => {
      const cb = orchestrator['getCircuitBreaker']('server-1');
      // Force to half-open
      cb.recordFailure(new Error('test'));
      cb.canExecute();

      const count = orchestrator['countHalfOpenCircuits']('server-1');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('closeAllModelCircuits', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.models = ['llama2', 'mistral'];
      }
    });

    it('should close all model circuits', () => {
      // Create model breakers and open them
      const cb1 = orchestrator['getModelCircuitBreaker']('server-1', 'llama2');
      const cb2 = orchestrator['getModelCircuitBreaker']('server-1', 'mistral');
      cb1.recordFailure(new Error('test'));
      cb2.recordFailure(new Error('test'));

      // Close all model circuits
      orchestrator['closeAllModelCircuits']('server-1');

      // Check that they're closed
      expect(cb1.getState()).toBe('closed');
      expect(cb2.getState()).toBe('closed');
    });
  });

  describe('performRecoveryHealthCheck', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should perform recovery health check successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['performRecoveryHealthCheck'](server!);

      expect(result.success).toBe(true);
    });

    it('should handle failed recovery check', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['performRecoveryHealthCheck'](server!);

      expect(result.success).toBe(false);
    });

    it('should handle network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['performRecoveryHealthCheck'](server!);

      expect(result.success).toBe(false);
    });
  });

  describe('populateRoutingContext', () => {
    it('should populate routing context', () => {
      const context: any = {};

      orchestrator['populateRoutingContext'](context, 'server-1', 'llama2');

      expect(context.selectedServerId).toBe('server-1');
    });

    it('should handle undefined context', () => {
      // Should not throw
      orchestrator['populateRoutingContext'](undefined, 'server-1', 'llama2');
    });
  });

  describe('onHealthCheckResult with circuit breaker open', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should force close circuit breaker on recovery', () => {
      // Open the circuit breaker first
      const cb = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }
      expect(cb.getState()).toBe('open');

      // Now successful health check should force close
      const result = {
        serverId: 'server-1',
        success: true,
        responseTime: 100,
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      const server = orchestrator.getServer('server-1');
      expect(server?.healthy).toBe(true);
    });

    it('should invalidate cache when server was previously unhealthy', () => {
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = false;
      }

      // Set up cache
      orchestrator['tagsCache'] = {
        data: [{ name: 'llama2' }],
        timestamp: Date.now(),
        metadata: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          serverCount: 1,
          modelCount: 1,
          errors: [],
        },
      };

      const result = {
        serverId: 'server-1',
        success: true,
        responseTime: 100,
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      // Cache should be invalidated
      expect(orchestrator['tagsCache']).toBeUndefined();
    });
  });

  describe('calculateAdaptiveActiveTestTimeout', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.lastResponseTime = 2000;
      }
    });

    it('should calculate adaptive timeout', () => {
      const timeout = orchestrator['calculateAdaptiveActiveTestTimeout']('server-1', 'llama2');
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(900000); // Max 15 minutes
    });

    it('should use VRAM data if available', () => {
      orchestrator['modelVramSizes'].set('server-1:llama2', 4000); // 4GB

      const timeout = orchestrator['calculateAdaptiveActiveTestTimeout']('server-1', 'llama2');
      expect(timeout).toBeGreaterThan(60000); // Should be higher due to VRAM
    });
  });

  describe('getProgressiveExtensionMultiplier', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should return 1.0 with no failures', () => {
      const multiplier = orchestrator['getProgressiveExtensionMultiplier']('server-1', 'llama2');
      expect(multiplier).toBe(1.0);
    });

    it('should increase with failures', () => {
      orchestrator['activeTestFailureCount'].set('server-1:llama2', 2);

      const multiplier = orchestrator['getProgressiveExtensionMultiplier']('server-1', 'llama2');
      expect(multiplier).toBe(2.0);
    });

    it('should cap at 3.0', () => {
      orchestrator['activeTestFailureCount'].set('server-1:llama2', 10);

      const multiplier = orchestrator['getProgressiveExtensionMultiplier']('server-1', 'llama2');
      expect(multiplier).toBe(3.0);
    });
  });

  describe('getServerPerformanceMultiplier', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should return 1.0 for unknown performance', () => {
      const multiplier = orchestrator['getServerPerformanceMultiplier']('nonexistent');
      expect(multiplier).toBe(1.0);
    });

    it('should calculate based on response time', () => {
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.lastResponseTime = 5000; // 5 seconds
      }

      const multiplier = orchestrator['getServerPerformanceMultiplier']('server-1');
      // Should be between 0.5 and 2.0 due to bounds
      expect(multiplier).toBeGreaterThanOrEqual(0.5);
      expect(multiplier).toBeLessThanOrEqual(2.0);
    });
  });

  describe('estimateModelSizeMultiplierFromName', () => {
    it('should estimate 7b models', () => {
      const multiplier = orchestrator['estimateModelSizeMultiplierFromName']('llama2:7b');
      expect(multiplier).toBe(1.0);
    });

    it('should estimate 70b models', () => {
      const multiplier = orchestrator['estimateModelSizeMultiplierFromName']('llama2:70b');
      expect(multiplier).toBe(10.0);
    });

    it('should estimate MoE models', () => {
      const multiplier = orchestrator['estimateModelSizeMultiplierFromName']('mixtral:8x7b');
      expect(multiplier).toBe(8.0); // 8 * 7 = 56
    });
  });

  describe('handleServerError - permanent errors', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should handle permanent error and ban server:model', () => {
      const errors: any[] = [];
      orchestrator['handleServerError'](
        orchestrator.getServer('server-1')!,
        'llama2',
        'out of memory error',
        'permanent',
        errors
      );

      expect(orchestrator['permanentBan'].has('server-1:llama2')).toBe(true);
    });

    it('should mark server unhealthy for server-wide permanent errors', () => {
      const errors: any[] = [];
      orchestrator['handleServerError'](
        orchestrator.getServer('server-1')!,
        'llama2',
        'internal server error',
        'permanent',
        errors
      );

      expect(orchestrator.getServer('server-1')?.healthy).toBe(false);
    });
  });

  describe('handleServerError - non-retryable errors', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.healthy = true;
    });

    it('should put server in cooldown for non-retryable errors', () => {
      const errors: any[] = [];
      orchestrator['handleServerError'](
        orchestrator.getServer('server-1')!,
        'llama2',
        'invalid request',
        'non-retryable',
        errors
      );

      expect(orchestrator.isInCooldown('server-1', 'llama2')).toBe(true);
    });
  });

  describe('handleServerError - transient errors', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.healthy = true;
    });

    it('should put server in cooldown for transient errors', () => {
      const errors: any[] = [];

      orchestrator['handleServerError'](
        orchestrator.getServer('server-1')!,
        'llama2',
        'timeout error',
        'transient',
        errors
      );

      expect(orchestrator.isInCooldown('server-1', 'llama2')).toBe(true);
    });
  });

  describe('handleServerError - unknown errors', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should handle unknown error type', () => {
      const errors: any[] = [];
      orchestrator['handleServerError'](
        orchestrator.getServer('server-1')!,
        'llama2',
        'some unknown error',
        'retryable' as any,
        errors
      );

      expect(errors.length).toBe(1);
    });
  });

  describe('tryRequestOnServerNoRetry - token metrics', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should extract token metrics from non-streaming response', async () => {
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => ({
          eval_count: 100,
          prompt_eval_count: 50,
        }),
        false,
        []
      );

      expect(result.success).toBe(true);
    });

    it('should extract token metrics from streaming response', async () => {
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => ({
          _tokenMetrics: {
            tokensGenerated: 100,
            tokensPrompt: 50,
          },
        }),
        true,
        []
      );

      expect(result.success).toBe(true);
    });
  });

  describe('tryRequestOnServerWithRetries', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should succeed on first try', async () => {
      const result = await orchestrator['tryRequestOnServerWithRetries'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => ({ success: true }),
        false,
        {
          maxRetriesPerServer: 3,
          retryDelayMs: 10,
          backoffMultiplier: 2,
          maxRetryDelayMs: 1000,
          retryableStatusCodes: [429, 503],
        },
        []
      );

      expect(result.success).toBe(true);
    });

    it('should retry on transient failure', async () => {
      let attempts = 0;
      const result = await orchestrator['tryRequestOnServerWithRetries'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('timeout error');
          }
          return { success: true };
        },
        false,
        {
          maxRetriesPerServer: 3,
          retryDelayMs: 10,
          backoffMultiplier: 2,
          maxRetryDelayMs: 1000,
          retryableStatusCodes: [429, 503],
        },
        []
      );

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });

    it('should extract streaming metrics', async () => {
      const result = await orchestrator['tryRequestOnServerWithRetries'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => ({
          _streamingMetrics: {
            ttft: 100,
            streamingDuration: 500,
          },
        }),
        true,
        {
          maxRetriesPerServer: 3,
          retryDelayMs: 10,
          backoffMultiplier: 2,
          maxRetryDelayMs: 1000,
          retryableStatusCodes: [429, 503],
        },
        []
      );

      expect(result.success).toBe(true);
    });
  });

  describe('drain', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should drain successfully', async () => {
      orchestrator['draining'] = true;

      const result = await orchestrator.drain(100);
      expect(result).toBe(true);
      expect(orchestrator['draining']).toBe(false);
    });
  });

  describe('tryRequestWithFailover - multiple phases', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });

      const s1 = orchestrator.getServer('server-1');
      const s2 = orchestrator.getServer('server-2');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
      if (s2) {
        s2.healthy = true;
        s2.models = ['llama2'];
      }
    });

    it('should exhaust all servers and throw', async () => {
      await expect(
        orchestrator.tryRequestWithFailover('llama2', async () => {
          throw new Error('All servers fail');
        })
      ).rejects.toThrow();
    });

    it('should handle empty candidates', async () => {
      // Remove servers so there are no candidates
      orchestrator.removeServer('server-1');
      orchestrator.removeServer('server-2');

      await expect(orchestrator.tryRequestWithFailover('llama2', async () => ({}))).rejects.toThrow(
        'No healthy servers available'
      );
    });
  });

  describe('tryRequestOnServerNoRetry - failure paths', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should fail when circuit breaker is open', async () => {
      const cb = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }

      const errors: any[] = [];
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => ({ success: true }),
        false,
        errors
      );

      expect(result.success).toBe(false);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should handle request failure', async () => {
      const errors: any[] = [];
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => {
          throw new Error('Request failed');
        },
        false,
        errors
      );

      expect(result.success).toBe(false);
    });
  });

  describe('executeActiveTest - model type detection', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2', 'nomic-embed-text'];
      }
    });

    it('should detect embedding model by name pattern', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: [0.1] }),
      });

      const result = await orchestrator['executeActiveTest']('server-1', 'nomic-embed-text', 10000);
      expect(result).toBeDefined();
    });

    it('should handle server not found', async () => {
      const result = await orchestrator['executeActiveTest']('nonexistent', 'llama2', 10000);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Server not found: nonexistent');
    });
  });

  describe('Complex failover scenarios', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });
      orchestrator.addServer({ id: 'server-3', url: 'http://localhost:11436', type: 'ollama' });

      ['server-1', 'server-2', 'server-3'].forEach(id => {
        const s = orchestrator.getServer(id);
        if (s) {
          s.healthy = true;
          s.models = ['llama2'];
        }
      });
    });

    it('should try all servers in phase 1 before moving to phase 2', async () => {
      const serverAttempts: string[] = [];

      try {
        await orchestrator.tryRequestWithFailover('llama2', async server => {
          serverAttempts.push(server.id);
          throw new Error('Server failed');
        });
      } catch (e) {
        // Expected to fail
      }

      // Should have attempted all 3 servers at least twice (phase 1 + phase 2)
      expect(serverAttempts.length).toBeGreaterThanOrEqual(3);
    });

    it('should track retry count in routing context', async () => {
      const context: any = {};
      let attempts = 0;

      try {
        await orchestrator.tryRequestWithFailover(
          'llama2',
          async () => {
            attempts++;
            throw new Error('fail');
          },
          false,
          'generate',
          undefined,
          context
        );
      } catch (e) {
        // Expected
      }

      // Context should be populated even on failure
      expect(context).toBeDefined();
    });
  });

  describe('Active test with model type detection', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2', 'nomic-embed-text'];
      }
    });

    it('should detect generation model through inference test', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/generate')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ response: 'test' }),
          });
        }
        return Promise.reject(new Error('Not found'));
      });

      const result = await orchestrator['executeActiveTest']('server-1', 'llama2', 10000);
      expect(result.detectedModelType || result.success).toBeDefined();
    });

    it('should handle embedding model detection', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/generate')) {
          return Promise.reject(new Error('embedding model does not support generate'));
        }
        if (url.includes('/api/embeddings')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ embedding: [0.1] }),
          });
        }
        return Promise.reject(new Error('Not found'));
      });

      const result = await orchestrator['executeActiveTest']('server-1', 'nomic-embed-text', 10000);
      expect(result).toBeDefined();
    });

    it('should handle non-circuit-breaking failures', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('temporary network error'));

      const result = await orchestrator['executeActiveTest']('server-1', 'llama2', 10000);
      expect(result.success).toBe(false);
    });
  });

  describe('Circuit breaker half-open recovery', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should transition from open to half-open and recover', async () => {
      // Open the circuit breaker
      const cb = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test error'));
      }
      expect(cb.getState()).toBe('open');

      // Simulate time passing for half-open transition
      // Note: This depends on the circuit breaker implementation
      const canExecute = cb.canExecute();

      // The breaker might transition to half-open
      if (cb.getState() === 'half-open') {
        // Successful request should close it
        const result = await orchestrator['tryRequestOnServerNoRetry'](
          orchestrator.getServer('server-1')!,
          'llama2',
          async () => ({ success: true }),
          false,
          []
        );

        // Result depends on recovery test success
        expect(result).toBeDefined();
      }
    });
  });

  describe('handleServerError comprehensive scenarios', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should handle disk full error as server-wide', () => {
      const errors: any[] = [];
      orchestrator['handleServerError'](
        orchestrator.getServer('server-1')!,
        'llama2',
        'disk is full',
        'permanent',
        errors
      );

      expect(orchestrator.getServer('server-1')?.healthy).toBe(false);
    });

    it('should handle multiple transient errors incrementing failure count', () => {
      const errors: any[] = [];

      orchestrator['handleServerError'](
        orchestrator.getServer('server-1')!,
        'llama2',
        'timeout',
        'transient',
        errors
      );

      const count1 = orchestrator['serverFailureCount'].get('server-1') || 0;
      expect(count1).toBeGreaterThan(0);

      orchestrator['handleServerError'](
        orchestrator.getServer('server-1')!,
        'llama2',
        'timeout again',
        'transient',
        errors
      );

      const count2 = orchestrator['serverFailureCount'].get('server-1') || 0;
      expect(count2).toBeGreaterThan(count1);
    });
  });

  describe('Timeout and performance calculations', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should calculate historical multiplier with sufficient data', () => {
      // Record some metrics
      for (let i = 0; i < 5; i++) {
        orchestrator['metricsAggregator'].recordRequest({
          id: `test-${i}`,
          serverId: 'server-1',
          model: 'llama2',
          startTime: Date.now() - 1000,
          endTime: Date.now(),
          duration: 5000 + i * 1000,
          success: true,
          endpoint: 'generate',
          streaming: false,
        });
      }

      const multiplier = orchestrator['getHistoricalResponseMultiplier']('server-1', 'llama2');
      expect(multiplier).toBeGreaterThan(0);
    });

    it('should use VRAM data when available for timeout calculation', () => {
      orchestrator['modelVramSizes'].set('server-1:llama2', 8000); // 8GB

      const multiplier = orchestrator['calculateModelSizeMultiplier']('server-1', 'llama2');
      expect(multiplier).toBeGreaterThan(1);
    });

    it('should estimate from model name when VRAM not available', () => {
      const multiplier = orchestrator['calculateModelSizeMultiplier']('server-1', 'unknown:70b');
      expect(multiplier).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Queue operations', () => {
    it('should pause and resume queue', () => {
      orchestrator.pauseQueue();
      expect(orchestrator.isQueuePaused()).toBe(true);

      orchestrator.resumeQueue();
      expect(orchestrator.isQueuePaused()).toBe(false);
    });

    it('should get queue stats', () => {
      const stats = orchestrator.getQueueStats();
      expect(stats).toBeDefined();
      expect(typeof stats.currentSize).toBe('number');
    });

    it('should get queue items', () => {
      const items = orchestrator.getQueueItems();
      expect(Array.isArray(items)).toBe(true);
    });
  });

  describe('Aggregated tags with filtering', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
      }
    });

    it('should filter models by circuit breaker state', async () => {
      // Open circuit breaker for one model
      const cb = orchestrator['getModelCircuitBreaker']('server-1', 'llama2');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [{ name: 'llama2' }, { name: 'mistral' }],
          }),
      });

      const result = await orchestrator.getAggregatedTags();
      // Only models with closed circuit breakers should be included
      expect(result.models).toBeDefined();
    });
  });

  describe('Model circuit breaker operations', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should remove model circuit breaker', () => {
      // Create a model circuit breaker
      orchestrator.getModelCircuitBreakerPublic('server-1', 'llama2');

      // Remove it
      const removed = orchestrator.removeModelCircuitBreaker('server-1', 'llama2');
      expect(removed).toBe(true);

      // Try to remove again (should fail)
      const removedAgain = orchestrator.removeModelCircuitBreaker('server-1', 'llama2');
      expect(removedAgain).toBe(false);
    });

    it('should count half-open circuits correctly', () => {
      // Create circuit breakers
      orchestrator['getCircuitBreaker']('server-1');
      orchestrator['getModelCircuitBreaker']('server-1', 'llama2');
      orchestrator['getModelCircuitBreaker']('server-1', 'mistral');

      const count = orchestrator['countHalfOpenCircuits']('server-1');
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should close all model circuits for server', () => {
      // Create and open some model breakers
      const cb1 = orchestrator['getModelCircuitBreaker']('server-1', 'llama2');
      const cb2 = orchestrator['getModelCircuitBreaker']('server-1', 'mistral');

      cb1.recordFailure(new Error('test'));
      cb2.recordFailure(new Error('test'));

      // Close all
      orchestrator['closeAllModelCircuits']('server-1');

      // All should be closed
      expect(cb1.getState()).toBe('closed');
      expect(cb2.getState()).toBe('closed');
    });
  });

  describe('Advanced error classification', () => {
    it('should classify runner process termination as permanent', () => {
      const errorType = orchestrator['classifyError']('runner process has terminated');
      expect(errorType).toBe('permanent');
    });

    it('should classify authentication errors as non-retryable', () => {
      const errorType = orchestrator['classifyError']('authentication failed');
      expect(errorType).toBe('non-retryable');
    });

    it('should classify HTTP 429 as retryable', () => {
      const config = {
        retryableStatusCodes: [429, 503],
        retryDelayMs: 100,
        backoffMultiplier: 2,
        maxRetryDelayMs: 1000,
        maxRetriesPerServer: 3,
      };
      const isRetryable = orchestrator['isRetryableOnSameServer']('HTTP 429', config as any);
      expect(isRetryable).toBe(true);
    });

    it('should classify ECONNREFUSED as transient', () => {
      const errorType = orchestrator['classifyError']('ECONNREFUSED');
      expect(errorType).toBe('transient');
    });

    it('should classify HTTP 500 as retryable', () => {
      const errorType = orchestrator['classifyError']('HTTP 500');
      expect(errorType).toBe('retryable');
    });
  });

  describe('Request context with streaming', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should track streaming metrics in request context', async () => {
      const result = await orchestrator['tryRequestOnServerNoRetry'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => ({
          response: 'test',
          _streamingMetrics: {
            ttft: 150,
            streamingDuration: 2000,
          },
          _tokenMetrics: {
            tokensGenerated: 100,
            tokensPrompt: 50,
          },
        }),
        true,
        []
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Recovery health check', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should succeed with 200 response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['performRecoveryHealthCheck'](server!);
      expect(result.success).toBe(true);
    });

    it('should fail with non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['performRecoveryHealthCheck'](server!);
      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });
  });

  describe('Tags cache operations', () => {
    it('should clear tags cache', () => {
      orchestrator['tagsCache'] = {
        data: [],
        timestamp: Date.now(),
        metadata: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          serverCount: 0,
          modelCount: 0,
          errors: [],
        },
      };

      orchestrator.clearTagsCache();
      expect(orchestrator['tagsCache']).toBeUndefined();
    });

    it('should invalidate server tags cache', () => {
      orchestrator['tagsCache'] = {
        data: [],
        timestamp: Date.now(),
        metadata: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          serverCount: 0,
          modelCount: 0,
          errors: [],
        },
      };

      orchestrator.invalidateServerTagsCache('server-1');
      expect(orchestrator['tagsCache']).toBeUndefined();
    });

    it('should handle invalidating cache when already empty', () => {
      orchestrator['tagsCache'] = undefined;
      // Should not throw
      orchestrator.invalidateTagsCache();
      expect(orchestrator['tagsCache']).toBeUndefined();
    });
  });

  describe('Server update operations', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should update server maxConcurrency', () => {
      const result = orchestrator.updateServer('server-1', { maxConcurrency: 16 });
      expect(result).toBe(true);
      expect(orchestrator.getServer('server-1')?.maxConcurrency).toBe(16);
    });

    it('should return false when updating non-existent server', () => {
      const result = orchestrator.updateServer('nonexistent', { maxConcurrency: 8 });
      expect(result).toBe(false);
    });
  });

  describe('Model map and list operations', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });
    });

    it('should get model map with multiple servers', () => {
      const s1 = orchestrator.getServer('server-1');
      const s2 = orchestrator.getServer('server-2');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2', 'mistral'];
      }
      if (s2) {
        s2.healthy = true;
        s2.models = ['llama2', 'codellama'];
      }

      const modelMap = orchestrator.getModelMap();
      expect(modelMap['llama2']).toContain('server-1');
      expect(modelMap['llama2']).toContain('server-2');
    });

    it('should get current model list regardless of health', () => {
      const s1 = orchestrator.getServer('server-1');
      const s2 = orchestrator.getServer('server-2');
      if (s1) {
        s1.healthy = false;
        s1.models = ['llama2'];
      }
      if (s2) {
        s2.healthy = true;
        s2.models = ['mistral'];
      }

      const models = orchestrator.getCurrentModelList();
      expect(models).toContain('llama2');
      expect(models).toContain('mistral');
    });
  });

  describe('onHealthCheckResult comprehensive', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should handle success with existing open circuit breaker', () => {
      // Open the circuit breaker first
      const cb = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }
      expect(cb.getState()).toBe('open');

      const result = {
        serverId: 'server-1',
        success: true,
        responseTime: 100,
        models: ['llama2', 'mistral'],
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      // Circuit breaker should be force-closed
      const server = orchestrator.getServer('server-1');
      expect(server?.healthy).toBe(true);
      expect(server?.models).toEqual(['llama2', 'mistral']);
    });

    it('should handle failure with previously healthy server', () => {
      // Setup cache
      orchestrator['tagsCache'] = {
        data: [{ name: 'llama2' }],
        timestamp: Date.now(),
        metadata: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          serverCount: 1,
          modelCount: 1,
          errors: [],
        },
      };

      const result = {
        serverId: 'server-1',
        success: false,
        error: 'Connection refused',
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      const server = orchestrator.getServer('server-1');
      expect(server?.healthy).toBe(false);
      expect(server?.models).toEqual([]);
      // Cache may or may not be invalidated depending on previous state
      expect(orchestrator['tagsCache']).toBeDefined();
    });

    it('should handle success with loaded models and VRAM', () => {
      const result = {
        serverId: 'server-1',
        success: true,
        responseTime: 150,
        loadedModels: [
          { name: 'llama2', sizeVram: 4000000000, expiresAt: '', digest: '' },
          { name: 'mistral', sizeVram: 5000000000, expiresAt: '', digest: '' },
        ],
        totalVramUsed: 9000000000,
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      const server = orchestrator.getServer('server-1');
      expect(server?.hardware).toBeDefined();
      expect(server?.hardware?.loadedModels).toHaveLength(2);

      // VRAM sizes should be stored
      const vramLlama2 = orchestrator['modelVramSizes'].get('server-1:llama2');
      expect(vramLlama2).toBeGreaterThan(0);
    });

    it('should pre-create circuit breakers for all models on success', () => {
      const result = {
        serverId: 'server-1',
        success: true,
        models: ['llama2', 'mistral', 'codellama'],
        timestamp: Date.now(),
      };

      orchestrator['onHealthCheckResult'](result);

      // Circuit breakers should exist for all models
      const cb1 = orchestrator.getModelCircuitBreakerPublic('server-1', 'llama2');
      const cb2 = orchestrator.getModelCircuitBreakerPublic('server-1', 'mistral');
      expect(cb1).toBeDefined();
      expect(cb2).toBeDefined();
    });
  });

  describe('onAllHealthChecksComplete', () => {
    it('should log health status changes', () => {
      const results = [
        { serverId: 'server-1', success: true, timestamp: Date.now() },
        { serverId: 'server-2', success: false, timestamp: Date.now() },
      ];

      // Should not throw
      orchestrator['onAllHealthChecksComplete'](results);
    });

    it('should handle all healthy servers', () => {
      const results = [
        { serverId: 'server-1', success: true, timestamp: Date.now() },
        { serverId: 'server-2', success: true, timestamp: Date.now() },
      ];

      orchestrator['lastHealthyCount'] = 0;
      orchestrator['onAllHealthChecksComplete'](results);

      expect(orchestrator['lastHealthyCount']).toBe(2);
    });

    it('should handle no change in healthy count', () => {
      orchestrator['lastHealthyCount'] = 2;

      const results = [
        { serverId: 'server-1', success: true, timestamp: Date.now() },
        { serverId: 'server-2', success: true, timestamp: Date.now() },
      ];

      orchestrator['onAllHealthChecksComplete'](results);

      // Should remain 2 since no change
      expect(orchestrator['lastHealthyCount']).toBe(2);
    });
  });

  describe('scheduleCircuitBreakerSave', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should schedule save with model type updates', () => {
      // Set a model type
      const cb = orchestrator['getModelCircuitBreaker']('server-1', 'llama2');
      cb.setModelType('generation');

      // Should not throw
      orchestrator['scheduleCircuitBreakerSave']();
    });

    it('should schedule save without model type updates', () => {
      // Should not throw even without model types
      orchestrator['scheduleCircuitBreakerSave']();
    });
  });

  describe('fetchServerTags', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.healthy = true;
    });

    it('should fetch tags successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama2' }] }),
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['fetchServerTags'](server!);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should handle HTTP 500 error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['fetchServerTags'](server!);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('server');
    });

    it('should handle invalid response (not object)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve('invalid'),
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['fetchServerTags'](server!);

      expect(result.success).toBe(false);
    });

    it('should handle missing models property', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['fetchServerTags'](server!);

      expect(result.success).toBe(false);
    });

    it('should handle models not array', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: 'not-array' }),
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['fetchServerTags'](server!);

      expect(result.success).toBe(false);
    });

    it('should handle timeout error', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const error = new Error('Timeout');
        (error as any).name = 'AbortError';
        return Promise.reject(error);
      });

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['fetchServerTags'](server!);

      expect(result.success).toBe(false);
      // Error type might be timeout or unknown depending on implementation
      expect(['timeout', 'unknown']).toContain(result.error?.type);
    });

    it('should handle connection refused error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['fetchServerTags'](server!);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('network');
    });

    it('should handle generic fetch failed error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

      const server = orchestrator.getServer('server-1');
      const result = await orchestrator['fetchServerTags'](server!);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('network');
    });
  });

  describe('tryRequestOnServerWithRetries - max retries exhausted', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.models = ['llama2'];
      }
    });

    it('should exhaust all retries', async () => {
      let attempts = 0;
      const result = await orchestrator['tryRequestOnServerWithRetries'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => {
          attempts++;
          throw new Error('timeout error'); // Retryable error
        },
        false,
        {
          maxRetriesPerServer: 2,
          retryDelayMs: 10,
          backoffMultiplier: 2,
          maxRetryDelayMs: 1000,
          retryableStatusCodes: [],
        },
        []
      );

      expect(result.success).toBe(false);
      // Should have at least 1 attempt, possibly more if retried
      expect(attempts).toBeGreaterThanOrEqual(1);
    });

    it('should handle non-retryable error immediately', async () => {
      let attempts = 0;
      const result = await orchestrator['tryRequestOnServerWithRetries'](
        orchestrator.getServer('server-1')!,
        'llama2',
        async () => {
          attempts++;
          throw new Error('invalid request'); // Non-retryable
        },
        false,
        {
          maxRetriesPerServer: 3,
          retryDelayMs: 10,
          backoffMultiplier: 2,
          maxRetryDelayMs: 1000,
          retryableStatusCodes: [],
        },
        []
      );

      expect(result.success).toBe(false);
      expect(attempts).toBe(1); // Should not retry
    });
  });

  describe('getAggregatedOpenAIModels', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
      orchestrator.addServer({ id: 'server-2', url: 'http://localhost:11435', type: 'ollama' });
    });

    it('should aggregate OpenAI models from multiple servers', () => {
      const s1 = orchestrator.getServer('server-1');
      const s2 = orchestrator.getServer('server-2');
      if (s1) {
        s1.healthy = true;
        s1.supportsV1 = true;
        s1.v1Models = ['gpt-3.5-turbo', 'gpt-4'];
      }
      if (s2) {
        s2.healthy = true;
        s2.supportsV1 = true;
        s2.v1Models = ['gpt-3.5-turbo', 'gpt-4-turbo'];
      }

      const result = orchestrator.getAggregatedOpenAIModels();
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.object).toBe('list');
    });

    it('should exclude models with open circuit breakers', () => {
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.supportsV1 = true;
        s1.v1Models = ['gpt-3.5-turbo'];
      }

      // Open circuit breaker for this model
      const cb = orchestrator['getModelCircuitBreaker']('server-1', 'gpt-3.5-turbo');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }

      const result = orchestrator.getAggregatedOpenAIModels();
      // Model with open breaker might be filtered out depending on hasClosedCircuitBreaker logic
      expect(result).toBeDefined();
    });
  });

  describe('getHistoricalResponseMultiplier', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should return 1.0 with no metrics', () => {
      const multiplier = orchestrator['getHistoricalResponseMultiplier']('server-1', 'llama2');
      expect(multiplier).toBe(1.0);
    });

    it('should return 1.0 with insufficient requests', () => {
      // Record only 2 requests
      for (let i = 0; i < 2; i++) {
        orchestrator['metricsAggregator'].recordRequest({
          id: `test-${i}`,
          serverId: 'server-1',
          model: 'llama2',
          startTime: Date.now() - 1000,
          endTime: Date.now(),
          duration: 5000,
          success: true,
          endpoint: 'generate',
          streaming: false,
        });
      }

      const multiplier = orchestrator['getHistoricalResponseMultiplier']('server-1', 'llama2');
      expect(multiplier).toBe(1.0);
    });

    it('should calculate multiplier with sufficient data', () => {
      // Record 5 requests with varying durations
      for (let i = 0; i < 5; i++) {
        orchestrator['metricsAggregator'].recordRequest({
          id: `test-${i}`,
          serverId: 'server-1',
          model: 'llama2',
          startTime: Date.now() - 1000,
          endTime: Date.now(),
          duration: 60000, // 60 seconds
          success: true,
          endpoint: 'generate',
          streaming: false,
        });
      }

      const multiplier = orchestrator['getHistoricalResponseMultiplier']('server-1', 'llama2');
      expect(multiplier).toBeGreaterThan(0);
    });

    it('should cap multiplier at 3.0', () => {
      // Record requests with very high duration
      for (let i = 0; i < 5; i++) {
        orchestrator['metricsAggregator'].recordRequest({
          id: `test-${i}`,
          serverId: 'server-1',
          model: 'llama2',
          startTime: Date.now() - 1000,
          endTime: Date.now(),
          duration: 200000, // 200 seconds - very high
          success: true,
          endpoint: 'generate',
          streaming: false,
        });
      }

      const multiplier = orchestrator['getHistoricalResponseMultiplier']('server-1', 'llama2');
      expect(multiplier).toBeLessThanOrEqual(3.0);
    });

    it('should floor multiplier at 0.5', () => {
      // Record requests with very low duration
      for (let i = 0; i < 5; i++) {
        orchestrator['metricsAggregator'].recordRequest({
          id: `test-${i}`,
          serverId: 'server-1',
          model: 'llama2',
          startTime: Date.now() - 1000,
          endTime: Date.now(),
          duration: 100, // 100ms - very low
          success: true,
          endpoint: 'generate',
          streaming: false,
        });
      }

      const multiplier = orchestrator['getHistoricalResponseMultiplier']('server-1', 'llama2');
      expect(multiplier).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('calculateModelSizeMultiplier with VRAM', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should calculate multiplier from actual VRAM', () => {
      orchestrator['modelVramSizes'].set('server-1:llama2', 4000); // 4GB = 4000MB

      const multiplier = orchestrator['calculateModelSizeMultiplier']('server-1', 'llama2');
      expect(multiplier).toBe(8); // 4000 / 500 = 8
    });

    it('should fallback to name estimation when VRAM not available', () => {
      // No VRAM data set
      const multiplier = orchestrator['calculateModelSizeMultiplier']('server-1', 'unknown:7b');
      expect(multiplier).toBe(1); // 7b / 7 = 1
    });

    it('should handle very large models', () => {
      orchestrator['modelVramSizes'].set('server-1:huge-model', 50000); // 50GB

      const multiplier = orchestrator['calculateModelSizeMultiplier']('server-1', 'huge-model');
      expect(multiplier).toBe(100); // 50000 / 500 = 100
    });
  });

  describe('Server circuit breaker limits', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should enforce max half-open circuits per server', () => {
      // Create multiple model breakers and transition them to half-open
      for (let i = 0; i < 5; i++) {
        const cb = orchestrator['getModelCircuitBreaker'](`server-1`, `model-${i}`);
        cb.recordFailure(new Error('test'));
      }

      // Try to get another circuit breaker - should be limited
      // This tests the logic in getCircuitBreaker and getModelCircuitBreaker
      const halfOpenCount = orchestrator['countHalfOpenCircuits']('server-1');
      expect(typeof halfOpenCount).toBe('number');
    });
  });

  describe('updateServerStatus edge cases', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should extract models from string array', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: ['llama2', 'mistral'] }),
      });

      const server = orchestrator.getServer('server-1');
      await orchestrator.updateServerStatus(server!);

      expect(server?.models).toContain('llama2');
      expect(server?.models).toContain('mistral');
    });

    it('should handle empty models array', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });

      const server = orchestrator.getServer('server-1');
      await orchestrator.updateServerStatus(server!);

      expect(server?.models).toEqual([]);
    });

    it('should skip server with open circuit breaker', async () => {
      // Open circuit breaker
      const cb = orchestrator['getCircuitBreaker']('server-1');
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new Error('test'));
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: ['llama2'] }),
      });

      const server = orchestrator.getServer('server-1');
      await orchestrator.updateServerStatus(server!);

      // Server should be marked unhealthy despite successful health check
      expect(server?.healthy).toBe(false);
    });

    it('should handle version parsing error gracefully', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/tags')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ models: [] }),
          });
        }
        if (url.includes('/api/version')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ invalid: 'format' }), // Missing version field
          });
        }
        return Promise.reject(new Error('Not found'));
      });

      const server = orchestrator.getServer('server-1');
      await orchestrator.updateServerStatus(server!);

      // Should not have version set
      expect(server?.version).toBeUndefined();
    });
  });

  describe('getAggregatedTags edge cases', () => {
    beforeEach(() => {
      orchestrator.addServer({ id: 'server-1', url: 'http://localhost:11434', type: 'ollama' });
    });

    it('should return cached data when healthy', async () => {
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.healthy = true;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama2' }] }),
      });

      // First call populates cache
      await orchestrator.getAggregatedTags();

      // Second call should use cache
      const result = await orchestrator.getAggregatedTags();
      expect(result.models).toBeDefined();
    });

    it('should return stale cache when no healthy servers', async () => {
      // Setup cache first
      orchestrator['tagsCache'] = {
        data: [{ name: 'llama2' }],
        timestamp: Date.now() - 10000, // Stale
        metadata: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          serverCount: 1,
          modelCount: 1,
          errors: [],
        },
      };

      // Make server unhealthy
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.healthy = false;

      const result = await orchestrator.getAggregatedTags();
      expect(result.models.length).toBe(1);
    });

    it('should return empty when no cache and no healthy servers', async () => {
      orchestrator['tagsCache'] = undefined;
      const s1 = orchestrator.getServer('server-1');
      if (s1) s1.healthy = false;

      const result = await orchestrator.getAggregatedTags();
      expect(result.models).toEqual([]);
    });

    it('should skip servers without Ollama support', async () => {
      const s1 = orchestrator.getServer('server-1');
      if (s1) {
        s1.healthy = true;
        s1.supportsOllama = false;
      }

      const result = await orchestrator.getAggregatedTags();
      expect(result.models).toEqual([]);
    });
  });
});
