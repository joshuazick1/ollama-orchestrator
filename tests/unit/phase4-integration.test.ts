/**
 * phase4-integration.test.ts
 * Integration tests for Phase 4 Intelligence features
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AIOrchestrator } from '../../src/orchestrator.js';
import { ModelManager } from '../../src/model-manager.js';
import { AnalyticsEngine } from '../../src/analytics/analytics-engine.js';
import { resetModelManager, getModelManager } from '../../src/model-manager-instance.js';
import { resetAnalyticsEngine, getAnalyticsEngine } from '../../src/analytics-instance.js';

describe('Phase 4 Integration', () => {
  let orchestrator: AIOrchestrator;
  let modelManager: ModelManager;
  let analytics: AnalyticsEngine;

  beforeEach(() => {
    // Reset singletons
    resetModelManager();
    resetAnalyticsEngine();

    // Create a fresh orchestrator for tests (not from singleton to avoid persistence)
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
    modelManager = getModelManager();
    analytics = getAnalyticsEngine();
  });

  afterEach(() => {
    resetModelManager();
    resetAnalyticsEngine();
  });

  describe('Model Manager Integration', () => {
    it('should track model states across servers', () => {
      orchestrator.addServer({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 4,
      });

      modelManager.registerServer({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3:latest'],
        maxConcurrency: 4,
      });

      modelManager.updateModelState('server-1', 'llama3:latest', {
        loaded: true,
        loadTime: 5000,
      });

      expect(modelManager.isModelLoaded('server-1', 'llama3:latest')).toBe(true);
    });

    it('should find servers with model loaded', () => {
      // Create server objects directly for model manager testing
      const server1 = {
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama' as const,
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3:latest'],
        maxConcurrency: 4,
      };
      const server2 = {
        id: 'server-2',
        url: 'http://localhost:11435',
        type: 'ollama' as const,
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3:latest'],
        maxConcurrency: 4,
      };

      modelManager.registerServer(server1);
      modelManager.registerServer(server2);

      modelManager.updateModelState('server-1', 'llama3:latest', { loaded: true });
      modelManager.updateModelState('server-2', 'llama3:latest', { loaded: false });

      const loadedServers = modelManager.getServersWithModelLoaded('llama3:latest');
      expect(loadedServers).toContain('server-1');
      expect(loadedServers).not.toContain('server-2');
    });

    it('should recommend models for warmup', () => {
      // Create server object directly for model manager testing
      const server1 = {
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama' as const,
        healthy: true,
        lastResponseTime: 100,
        models: ['popular-model'],
        maxConcurrency: 4,
      };

      modelManager.registerServer(server1);

      // Simulate popular model on multiple servers
      modelManager.updateModelState('server-1', 'popular-model', {
        loaded: true,
        lastUsed: Date.now(),
      });

      const recommendations = modelManager.getRecommendedWarmupModels(1);
      expect(recommendations).toContain('popular-model');
    });
  });

  describe('Analytics Engine Integration', () => {
    it('should analyze metrics from orchestrator', () => {
      orchestrator.addServer({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 4,
      });

      // Update analytics with orchestrator metrics
      analytics.updateMetrics(orchestrator.getAllDetailedMetrics());

      const topModels = analytics.getTopModels();
      expect(Array.isArray(topModels)).toBe(true);
    });

    it('should track request history', () => {
      const request = {
        id: 'test-1',
        startTime: Date.now(),
        model: 'llama3:latest',
        endpoint: 'generate' as const,
        streaming: false,
        success: true,
        duration: 500,
        serverId: 'server-1',
      };

      analytics.recordRequest(request);

      // Error analysis should show the recorded error
      const errorRequest = {
        ...request,
        id: 'error-1',
        success: false,
        error: new Error('test error'),
      };
      analytics.recordRequest(errorRequest);

      const errorAnalysis = analytics.getErrorAnalysis('1h');
      expect(errorAnalysis.totalErrors).toBeGreaterThan(0);
    });

    it('should calculate capacity analysis', () => {
      orchestrator.addServer({
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama',
        maxConcurrency: 4,
      });

      analytics.updateMetrics(orchestrator.getAllDetailedMetrics());
      const capacity = analytics.getCapacityAnalysis(0, '24h');

      expect(capacity.current.totalCapacity).toBeGreaterThanOrEqual(0);
      expect(capacity.forecast.nextHour).toBeDefined();
      expect(capacity.recommendations).toBeInstanceOf(Array);
    });

    it('should provide error analysis', () => {
      const errorRequest = {
        id: 'error-1',
        startTime: Date.now(),
        model: 'llama3:latest',
        endpoint: 'generate' as const,
        streaming: false,
        success: false,
        error: new Error('timeout error'),
        serverId: 'server-1',
      };

      analytics.recordRequest(errorRequest);
      const errorAnalysis = analytics.getErrorAnalysis('1h');

      expect(errorAnalysis.totalErrors).toBeGreaterThan(0);
      expect(errorAnalysis.byType['timeout']).toBe(1);
    });
  });

  describe('End-to-End Phase 4 Flow', () => {
    it('should integrate model warmup with analytics', async () => {
      // Create server object directly for model manager testing
      const server1 = {
        id: 'server-1',
        url: 'http://localhost:11434',
        type: 'ollama' as const,
        healthy: true,
        lastResponseTime: 100,
        models: ['llama3:latest'],
        maxConcurrency: 4,
      };

      modelManager.registerServer(server1);

      // Warmup a model
      const warmupResult = await modelManager.warmupModel('llama3:latest');
      expect(warmupResult.model).toBe('llama3:latest');
      expect(warmupResult.jobs).toHaveLength(1);

      // Update model state as loaded (simulating warmup completion)
      modelManager.updateModelState('server-1', 'llama3:latest', {
        loaded: true,
        loadTime: 5000,
        lastUsed: Date.now(),
      });

      // Get warmup status
      const status = modelManager.getModelWarmupStatus('llama3:latest');
      expect(status.loadedOn).toBe(1);

      // Update analytics with the metrics
      analytics.updateMetrics(orchestrator.getAllDetailedMetrics());

      // Get analytics
      const topModels = analytics.getTopModels();
      expect(Array.isArray(topModels)).toBe(true);
    });
  });
});
