/**
 * concurrency-atomicity.test.ts
 * Tests for REC-64: atomic tryIncrementInFlight never exceeds maxConcurrency
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { InFlightManager, resetInFlightManager } from '../../src/utils/in-flight-manager.js';

describe('Wave 3 REC-64: Atomic tryIncrementInFlight', () => {
  let manager: InFlightManager;

  beforeEach(() => {
    resetInFlightManager();
    manager = new InFlightManager();
  });

  it('should allow increment when under maxConcurrency', () => {
    const result = manager.tryIncrementInFlight('server-1', 'llama3', 4);
    expect(result).toBe(true);
    expect(manager.getTotalInFlight('server-1')).toBe(1);
  });

  it('should allow increments up to maxConcurrency', () => {
    const maxConcurrency = 3;
    let successCount = 0;
    for (let i = 0; i < maxConcurrency; i++) {
      if (manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency)) {
        successCount++;
      }
    }
    expect(successCount).toBe(maxConcurrency);
    expect(manager.getTotalInFlight('server-1')).toBe(maxConcurrency);
  });

  it('should reject increment when at maxConcurrency', () => {
    const maxConcurrency = 2;
    manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency);
    manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency);
    // At limit now
    const result = manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency);
    expect(result).toBe(false);
    expect(manager.getTotalInFlight('server-1')).toBe(maxConcurrency);
  });

  it('should never exceed maxConcurrency under rapid concurrent calls', () => {
    const maxConcurrency = 5;
    const totalAttempts = 20;
    let successCount = 0;

    // Simulate rapid concurrent calls (synchronous here, but testing the check-and-increment atomicity)
    for (let i = 0; i < totalAttempts; i++) {
      if (manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency)) {
        successCount++;
      }
    }

    expect(successCount).toBe(maxConcurrency);
    expect(manager.getTotalInFlight('server-1')).toBe(maxConcurrency);
    expect(manager.getTotalInFlight('server-1')).toBeLessThanOrEqual(maxConcurrency);
  });

  it('should check total in-flight across all models for same server', () => {
    const maxConcurrency = 3;

    // Add 2 requests for model-a
    manager.tryIncrementInFlight('server-1', 'model-a', maxConcurrency);
    manager.tryIncrementInFlight('server-1', 'model-a', maxConcurrency);

    // Total in-flight is 2, so model-b should succeed (1 slot left)
    const result1 = manager.tryIncrementInFlight('server-1', 'model-b', maxConcurrency);
    expect(result1).toBe(true);

    // Now at 3 total, model-b should fail
    const result2 = manager.tryIncrementInFlight('server-1', 'model-b', maxConcurrency);
    expect(result2).toBe(false);

    // Total never exceeds maxConcurrency
    expect(manager.getTotalInFlight('server-1')).toBe(maxConcurrency);
  });

  it('should allow increment again after decrement', () => {
    const maxConcurrency = 2;

    manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency);
    manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency);

    // Full — should reject
    expect(manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency)).toBe(false);

    // Decrement one
    manager.decrementInFlight('server-1', 'llama3');

    // Now should accept again
    expect(manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency)).toBe(true);
  });

  it('should not affect other servers when one is at max', () => {
    const maxConcurrency = 2;

    // Fill server-1
    manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency);
    manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency);
    expect(manager.tryIncrementInFlight('server-1', 'llama3', maxConcurrency)).toBe(false);

    // server-2 should still accept
    expect(manager.tryIncrementInFlight('server-2', 'llama3', maxConcurrency)).toBe(true);
    expect(manager.getTotalInFlight('server-2')).toBe(1);
  });
});
