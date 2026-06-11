import { describe, it, expect } from 'vitest';

import { classifyOrchestratorRoutingError } from '../../src/utils/orchestrator-error-classifier.js';

describe('classifyOrchestratorRoutingError', () => {
  it('should detect no servers error', () => {
    const result = classifyOrchestratorRoutingError('No healthy servers available for this model');
    expect(result.isNoServersError).toBe(true);
    expect(result.isConcurrencySaturated).toBe(false);
    expect(result.isAccessDenied).toBe(false);
  });

  it('should detect concurrency saturated error', () => {
    const result = classifyOrchestratorRoutingError('Server srv-1 is at max concurrency');
    expect(result.isNoServersError).toBe(false);
    expect(result.isConcurrencySaturated).toBe(true);
    expect(result.isAccessDenied).toBe(false);
  });

  it('should detect access denied error', () => {
    const result = classifyOrchestratorRoutingError('Access denied to server srv-1');
    expect(result.isNoServersError).toBe(false);
    expect(result.isConcurrencySaturated).toBe(false);
    expect(result.isAccessDenied).toBe(true);
  });

  it('should detect circuit breaker as no servers error', () => {
    const result = classifyOrchestratorRoutingError('circuit breaker open for srv-1');
    expect(result.isNoServersError).toBe(true);
  });

  it('should return all false for unknown error', () => {
    const result = classifyOrchestratorRoutingError('Some random error');
    expect(result.isNoServersError).toBe(false);
    expect(result.isConcurrencySaturated).toBe(false);
    expect(result.isAccessDenied).toBe(false);
  });
});
