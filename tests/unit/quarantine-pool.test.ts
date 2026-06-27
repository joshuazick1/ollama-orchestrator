import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getQuarantinePool, type QuarantineEntry } from '../../src/utils/quarantine-pool.js';

vi.mock('../../src/storage/operational-store.js', () => ({
  getOperationalStore: vi.fn(() => ({
    getQuarantinedServers: vi.fn(() => []),
    quarantineServer: vi.fn(),
    deleteQuarantine: vi.fn(),
    updateQuarantineCleanCycles: vi.fn(),
  })),
}));

describe('QuarantinePool', () => {
  let pool: ReturnType<typeof getQuarantinePool>;

  beforeEach(() => {
    pool = getQuarantinePool();
    const store = pool as unknown as {
      entries: Map<string, QuarantineEntry>;
      initialized: boolean;
    };
    store.entries.clear();
    store.initialized = false;
  });

  describe('quarantine / unquarantine', () => {
    it('should quarantine a server and mark it as quarantined', () => {
      pool.quarantine('server-1', 'honeypot-flagged', null, false);
      expect(pool.isQuarantined('server-1')).toBe(true);
    });

    it('should quarantine with manual flag', () => {
      pool.quarantine('server-1', 'manual', null, true);
      const entry = pool.getEntry('server-1');
      expect(entry?.isManual).toBe(true);
      expect(entry?.reason).toBe('manual');
    });

    it('should store evidence when provided', () => {
      const evidence = { score: 85, probes: ['tier1', 'tier2'] };
      pool.quarantine('server-1', 'honeypot-flagged', evidence, false);
      const entry = pool.getEntry('server-1');
      expect(entry?.evidence).toEqual(evidence);
    });

    it('should unquarantine a quarantined server', () => {
      pool.quarantine('server-1', 'honeypot-flagged', null, false);
      const existed = pool.unquarantine('server-1');
      expect(existed).toBe(true);
      expect(pool.isQuarantined('server-1')).toBe(false);
    });

    it('should return false when unquarantining non-quarantined server', () => {
      const existed = pool.unquarantine('server-99');
      expect(existed).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all quarantined servers', () => {
      pool.quarantine('server-1', 'honeypot-flagged', null, false);
      pool.quarantine('server-2', 'manual', null, true);
      const all = pool.getAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('recordCleanCycle / resetCleanCycles', () => {
    it('should increment clean cycle count', () => {
      pool.quarantine('server-1', 'honeypot-flagged', null, false);
      const cycles1 = pool.recordCleanCycle('server-1');
      const cycles2 = pool.recordCleanCycle('server-1');
      expect(cycles1).toBe(1);
      expect(cycles2).toBe(2);
    });

    it('should reset clean cycles', () => {
      pool.quarantine('server-1', 'honeypot-flagged', null, false);
      pool.recordCleanCycle('server-1');
      pool.recordCleanCycle('server-1');
      pool.resetCleanCycles('server-1');
      const entry = pool.getEntry('server-1');
      expect(entry?.consecutiveCleanCycles).toBe(0);
    });

    it('should return 0 for unknown server', () => {
      expect(pool.recordCleanCycle('unknown')).toBe(0);
    });
  });
});
