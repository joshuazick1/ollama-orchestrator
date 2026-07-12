import { describe, it, expect, beforeEach, vi } from 'vitest';

import { BanManager } from '../../../src/utils/ban-manager.js';

vi.mock('../../config/config.js', () => ({
  getConfigManager: vi.fn(() => ({
    getConfig: vi.fn(() => ({
      cooldown: { failureCooldownMs: 60000 },
    })),
  })),
}));

describe('BanManager Extended Cooldown', () => {
  let manager: BanManager;

  beforeEach(() => {
    manager = new BanManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('markExtendedCooldown + isInExtendedCooldown', () => {
    it('should return true within cooldown period', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-a')).toBe(true);
    });

    it('should return false after cooldown expires', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      vi.advanceTimersByTime(10_001);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-a')).toBe(false);
    });

    it('should return false when no cooldown was set', () => {
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-a')).toBe(false);
    });
  });

  describe('per-(server,model,user) isolation', () => {
    it('should not affect different users on same server+model', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-b')).toBe(false);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-a')).toBe(true);
    });

    it('should not affect same user on different server+model', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      expect(manager.isInExtendedCooldown('server-2', 'llama3:latest', 'user-a')).toBe(false);
      expect(manager.isInExtendedCooldown('server-1', 'codellama:7b', 'user-a')).toBe(false);
    });

    it('should track multiple independent extended cooldowns', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      manager.markExtendedCooldown('server-2', 'codellama:7b', 'user-b', 20_000);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-a')).toBe(true);
      expect(manager.isInExtendedCooldown('server-2', 'codellama:7b', 'user-b')).toBe(true);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-b')).toBe(false);
      expect(manager.isInExtendedCooldown('server-2', 'codellama:7b', 'user-a')).toBe(false);
    });
  });

  describe('cleanupExpiredCooldowns sweeps extended cooldown', () => {
    it('should remove only expired extended cooldowns', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      manager.markExtendedCooldown('server-2', 'llama3:latest', 'user-b', 30_000);
      vi.advanceTimersByTime(10_001);
      const cleaned = manager.cleanupExpiredCooldowns();
      expect(cleaned).toBe(1);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-a')).toBe(false);
      expect(manager.isInExtendedCooldown('server-2', 'llama3:latest', 'user-b')).toBe(true);
    });

    it('should return 0 when no expired entries', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      const cleaned = manager.cleanupExpiredCooldowns();
      expect(cleaned).toBe(0);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-a')).toBe(true);
    });
  });

  describe('idempotent re-marking', () => {
    it('should allow re-marking before expiry and still be in cooldown', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      vi.advanceTimersByTime(5_000);
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      vi.advanceTimersByTime(5_001);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-a')).toBe(true);
    });

    it('should reset expiry on re-marking', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      vi.advanceTimersByTime(5_000);
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 20_000);
      vi.advanceTimersByTime(15_001);
      expect(manager.isInExtendedCooldown('server-1', 'llama3:latest', 'user-a')).toBe(true);
    });
  });

  describe('getExtendedCooldownExpiry', () => {
    it('should return expiry timestamp', () => {
      const now = Date.now();
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 10_000);
      const expiry = manager.getExtendedCooldownExpiry('server-1', 'llama3:latest', 'user-a');
      expect(expiry).toBe(now + 10_000);
    });

    it('should return undefined when no cooldown set', () => {
      expect(manager.getExtendedCooldownExpiry('server-1', 'llama3:latest', 'user-a')).toBeUndefined();
    });

    it('should return expiry that is in the future during cooldown', () => {
      manager.markExtendedCooldown('server-1', 'llama3:latest', 'user-a', 60_000);
      vi.advanceTimersByTime(30_000);
      const expiry = manager.getExtendedCooldownExpiry('server-1', 'llama3:latest', 'user-a');
      expect(expiry).toBeDefined();
      expect(expiry! - Date.now()).toBeGreaterThan(0);
    });
  });
});
