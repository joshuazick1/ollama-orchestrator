import { describe, it, expect } from 'vitest';

import { classifyOrchestratorError } from '../../src/utils/orchestrator-error-classifier.js';

describe('classifyOrchestratorError', () => {
  it('should detect no servers error', () => {
    const result = classifyOrchestratorError('No healthy servers available for this model');
    expect(result.isNoServersError).toBe(true);
    expect(result.isConcurrencySaturated).toBe(false);
    expect(result.isAccessDenied).toBe(false);
  });

  it('should detect concurrency saturated error', () => {
    const result = classifyOrchestratorError('Server srv-1 is at max concurrency');
    expect(result.isNoServersError).toBe(false);
    expect(result.isConcurrencySaturated).toBe(true);
    expect(result.isAccessDenied).toBe(false);
  });

  it('should detect access denied error', () => {
    const result = classifyOrchestratorError('Access denied to server srv-1');
    expect(result.isNoServersError).toBe(false);
    expect(result.isConcurrencySaturated).toBe(false);
    expect(result.isAccessDenied).toBe(true);
  });

  it('should detect circuit breaker as no servers error', () => {
    const result = classifyOrchestratorError('circuit breaker open for srv-1');
    expect(result.isNoServersError).toBe(true);
  });

  it('should return all false for unknown error', () => {
    const result = classifyOrchestratorError('Some random error');
    expect(result.isNoServersError).toBe(false);
    expect(result.isConcurrencySaturated).toBe(false);
    expect(result.isAccessDenied).toBe(false);
  });
});
