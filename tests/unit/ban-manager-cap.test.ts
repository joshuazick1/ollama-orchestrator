import { describe, it, expect, beforeEach, vi } from 'vitest';

import { BanManager } from '../../src/utils/ban-manager.js';

vi.mock('../../src/config/config.js', () => ({
  getConfigManager: vi.fn(() => ({
    getConfig: vi.fn(() => ({
      cooldown: { failureCooldownMs: 60000 },
    })),
  })),
}));

vi.mock('../../src/storage/operational-store.js', () => ({
  getOperationalStore: vi.fn(() => ({
    addBan: vi.fn(),
    removeBan: vi.fn(),
    removeServerBans: vi.fn(),
    removeModelBans: vi.fn(),
    clearAllBans: vi.fn(),
    getActiveBans: vi.fn(() => []),
  })),
}));

describe('BanManager - cap permanentBan size', () => {
  it('should cap permanentBan at 10,000 entries', () => {
    const mgr = new BanManager();
    for (let i = 0; i < 20000; i++) {
      mgr.addBan(`srv-${i}`, `model-${i}`);
    }
    expect(mgr.getPermanentBanCount()).toBeLessThanOrEqual(10000);
  });

  it('should evict oldest entries first (FIFO)', () => {
    const mgr = new BanManager();
    for (let i = 0; i < 10000; i++) {
      mgr.addBan(`srv-${i}`, `model-${i}`);
    }
    mgr.addBan('srv-newest', 'model-newest');
    expect(mgr.isBanned('srv-0', 'model-0')).toBe(false);
    expect(mgr.isBanned('srv-newest', 'model-newest')).toBe(true);
  });
});
