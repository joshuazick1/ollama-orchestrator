import { describe, it, expect } from 'vitest';

import { isServerLevelBreaker } from '../../src/recovery-test-coordinator.js';

describe('isServerLevelBreaker - colon parsing', () => {
  it('should return true for simple server ID (no colon)', () => {
    expect(isServerLevelBreaker('simple-server')).toBe(true);
  });

  it('should return false for server:model format', () => {
    expect(isServerLevelBreaker('srv:llama3')).toBe(false);
  });

  it('should return false for serverId with colons (model contains colons)', () => {
    expect(isServerLevelBreaker('srv:has:colon')).toBe(false);
    expect(isServerLevelBreaker('srv:qwen2.5:14b-instruct-q5_K_M')).toBe(false);
  });

  it('should return false for model with multiple colons', () => {
    expect(isServerLevelBreaker('srv:qwen2.5:14b')).toBe(false);
  });
});
