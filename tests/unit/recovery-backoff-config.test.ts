import { describe, it, expect } from 'vitest';

import {
  calculateRecoveryBackoff,
  DEFAULT_RECOVERY_BACKOFF,
} from '../../src/utils/recovery-backoff.js';

describe('Recovery backoff - configurable delays', () => {
  it('should use defaults when no config provided', () => {
    const result = calculateRecoveryBackoff({
      attempt: 0,
      failureReason: 'does not support generate',
    });
    expect(result.delayMs).toBe(30000);
  });

  it('should respect custom modelCapability config', () => {
    const customConfig = {
      ...DEFAULT_RECOVERY_BACKOFF,
      modelCapability: [5000, 10000],
    };
    const result0 = calculateRecoveryBackoff({
      attempt: 0,
      failureReason: 'does not support generate',
      recoveryBackoff: customConfig,
    });
    const result1 = calculateRecoveryBackoff({
      attempt: 1,
      failureReason: 'does not support generate',
      recoveryBackoff: customConfig,
    });
    expect(result0.delayMs).toBe(5000);
    expect(result1.delayMs).toBe(10000);
  });

  it('should respect custom permanent config', () => {
    const customConfig = {
      ...DEFAULT_RECOVERY_BACKOFF,
      permanent: [100000, 200000, 400000],
    };
    const result0 = calculateRecoveryBackoff({
      attempt: 0,
      errorType: 'permanent',
      recoveryBackoff: customConfig,
    });
    const result2 = calculateRecoveryBackoff({
      attempt: 2,
      errorType: 'permanent',
      recoveryBackoff: customConfig,
    });
    expect(result0.delayMs).toBe(100000);
    expect(result2.delayMs).toBe(400000);
  });
});
