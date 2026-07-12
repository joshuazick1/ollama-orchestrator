import { describe, it, expect, beforeEach } from 'vitest';
import { AIOrchestrator } from '../../../src/orchestrator/orchestrator.js';

describe('computeRetryBudgetForModel', () => {
  let orchestrator: AIOrchestrator;

  beforeEach(() => {
    orchestrator = new AIOrchestrator(undefined, undefined, {
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
    orchestrator.setSuppressPersistence(true);
  });

  describe('cloud models', () => {
    it('returns cloudModelRetryBudget when set', () => {
      (orchestrator as unknown as { config: { routing: { cloudModelRetryBudget: number; cloudModelMaxCandidates: number }; retry: { maxBudget: number } } }).config = {
        routing: { cloudModelRetryBudget: 75, cloudModelMaxCandidates: 100 },
        retry: { maxBudget: 10 },
      } as never;
      expect(orchestrator.computeRetryBudgetForModel('minimax-m3:cloud')).toBe(75);
    });

    it('falls back to cloudModelMaxCandidates when cloudModelRetryBudget is not set', () => {
      (orchestrator as unknown as { config: { routing: { cloudModelMaxCandidates: number }; retry: { maxBudget: number } } }).config = {
        routing: { cloudModelMaxCandidates: 200 },
        retry: { maxBudget: 10 },
      } as never;
      expect(orchestrator.computeRetryBudgetForModel('minimax-m3:cloud')).toBe(200);
    });

    it('uses default 100 when neither override is set', () => {
      (orchestrator as unknown as { config: { routing: Record<string, never>; retry: { maxBudget: number } } }).config = {
        routing: {},
        retry: { maxBudget: 10 },
      } as never;
      expect(orchestrator.computeRetryBudgetForModel('minimax-m3:cloud')).toBe(100);
    });

    it('does NOT use retry.maxBudget (10) for cloud models', () => {
      (orchestrator as unknown as { config: { routing: Record<string, never>; retry: { maxBudget: number } } }).config = {
        routing: {},
        retry: { maxBudget: 10 },
      } as never;
      const budget = orchestrator.computeRetryBudgetForModel('minimax-m3:cloud');
      expect(budget).toBeGreaterThan(10);
    });

    it('handles the default config (cloudModelRetryBudget: 50)', () => {
      (orchestrator as unknown as { config: { routing: { cloudModelRetryBudget: number; cloudModelMaxCandidates: number }; retry: { maxBudget: number } } }).config = {
        routing: { cloudModelRetryBudget: 50, cloudModelMaxCandidates: 100 },
        retry: { maxBudget: 10 },
      } as never;
      expect(orchestrator.computeRetryBudgetForModel('minimax-m3:cloud')).toBe(50);
    });

    it('matches :cloud, cloud-, and meta-cloud model names', () => {
      (orchestrator as unknown as { config: { routing: { cloudModelRetryBudget: number }; retry: { maxBudget: number } } }).config = {
        routing: { cloudModelRetryBudget: 50 },
        retry: { maxBudget: 10 },
      } as never;
      expect(orchestrator.computeRetryBudgetForModel('deepseek-v3.2:cloud')).toBe(50);
      expect(orchestrator.computeRetryBudgetForModel('cloud-gpt-4')).toBe(50);
      expect(orchestrator.computeRetryBudgetForModel('meta-cloud')).toBe(50);
    });
  });

  describe('non-cloud models', () => {
    it('returns retry.maxBudget when set', () => {
      (orchestrator as unknown as { config: { routing: Record<string, never>; retry: { maxBudget: number } } }).config = {
        routing: {},
        retry: { maxBudget: 25 },
      } as never;
      expect(orchestrator.computeRetryBudgetForModel('llama3:8b')).toBe(25);
    });

    it('uses default 10 when retry.maxBudget not set', () => {
      (orchestrator as unknown as { config: { routing: Record<string, never>; retry: Record<string, never> } }).config = {
        routing: {},
        retry: {},
      } as never;
      expect(orchestrator.computeRetryBudgetForModel('llama3:8b')).toBe(10);
    });

    it('does NOT use cloudModelRetryBudget for non-cloud models', () => {
      (orchestrator as unknown as { config: { routing: { cloudModelRetryBudget: number }; retry: { maxBudget: number } } }).config = {
        routing: { cloudModelRetryBudget: 999 },
        retry: { maxBudget: 10 },
      } as never;
      expect(orchestrator.computeRetryBudgetForModel('llama3:8b')).toBe(10);
    });
  });
});
