/**
 * orchestrator-instance.test.ts
 * Tests for singleton orchestrator instance management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getOrchestratorInstance,
  resetOrchestratorInstance,
  hasOrchestratorInstance,
} from '../../src/orchestrator-instance.js';
import { AIOrchestrator } from '../../src/orchestrator.js';
import { getConfigManager } from '../../src/config/config.js';
import { logger } from '../../src/utils/logger.js';

vi.mock('../../src/config/config.js');
vi.mock('../../src/utils/logger.js');

describe('Orchestrator Instance', () => {
  beforeEach(() => {
    resetOrchestratorInstance();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetOrchestratorInstance();
  });

  describe('getOrchestratorInstance', () => {
    const mockConfigManager = () => ({
      getConfig: vi.fn().mockReturnValue({
        loadBalancer: { strategy: 'round-robin', healthCheckInterval: 30000 },
        queue: { maxSize: 1000, timeout: 30000 },
        circuitBreaker: { failureThreshold: 5, resetTimeout: 60000 },
        healthCheck: { enabled: true, interval: 30000, timeout: 5000 },
      }),
      registerComponentWatcher: vi.fn().mockReturnValue(vi.fn()),
    });

    it('should create instance when none exists', () => {
      (getConfigManager as any).mockReturnValue(mockConfigManager());

      const instance = getOrchestratorInstance();

      expect(instance).toBeInstanceOf(AIOrchestrator);
      expect(hasOrchestratorInstance()).toBe(true);
    });

    it('should return same instance on subsequent calls', () => {
      (getConfigManager as any).mockReturnValue(mockConfigManager());

      const instance1 = getOrchestratorInstance();
      const instance2 = getOrchestratorInstance();

      expect(instance1).toBe(instance2);
    });

    it('should verify initialization catch block exists', () => {
      const fs = require('fs');
      const path = require('path');
      const sourceFile = path.join(__dirname, '../../src/orchestrator-instance.ts');
      const content = fs.readFileSync(sourceFile, 'utf-8');

      expect(content).toContain('.catch((error: unknown) => {');
      expect(content).toContain('logger.error');
      expect(content).toContain('Failed to load persisted data');
    });
  });

  describe('resetOrchestratorInstance', () => {
    const mockConfigManager = () => ({
      getConfig: vi.fn().mockReturnValue({
        loadBalancer: { strategy: 'round-robin', healthCheckInterval: 30000 },
        queue: { maxSize: 1000, timeout: 30000 },
        circuitBreaker: { failureThreshold: 5, resetTimeout: 60000 },
        healthCheck: { enabled: true, interval: 30000, timeout: 5000 },
      }),
      registerComponentWatcher: vi.fn().mockReturnValue(vi.fn()),
    });

    it('should reset the singleton instance', () => {
      (getConfigManager as any).mockReturnValue(mockConfigManager());

      getOrchestratorInstance();
      expect(hasOrchestratorInstance()).toBe(true);

      resetOrchestratorInstance();

      expect(hasOrchestratorInstance()).toBe(false);
      expect(logger.info).toHaveBeenCalledWith('Orchestrator instance reset');
    });
  });

  describe('hasOrchestratorInstance', () => {
    const mockConfigManager = () => ({
      getConfig: vi.fn().mockReturnValue({
        loadBalancer: { strategy: 'round-robin', healthCheckInterval: 30000 },
        queue: { maxSize: 1000, timeout: 30000 },
        circuitBreaker: { failureThreshold: 5, resetTimeout: 60000 },
        healthCheck: { enabled: true, interval: 30000, timeout: 5000 },
      }),
      registerComponentWatcher: vi.fn().mockReturnValue(vi.fn()),
    });

    it('should return false when no instance exists', () => {
      expect(hasOrchestratorInstance()).toBe(false);
    });

    it('should return true when instance exists', () => {
      (getConfigManager as any).mockReturnValue(mockConfigManager());

      getOrchestratorInstance();
      expect(hasOrchestratorInstance()).toBe(true);
    });
  });
});
