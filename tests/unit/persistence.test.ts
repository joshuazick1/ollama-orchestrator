import { describe, it, expect, vi, beforeEach } from 'vitest';

import { serversConfig } from '../../src/config/config-manager.js';
import {
  loadServersFromDisk,
  saveServersToDisk,
  loadBansFromDisk,
  saveBansToDisk,
} from '../../src/orchestrator/orchestrator-persistence.js';
import { logger } from '../../src/utils/logger.js';

const mockGetActiveBans = vi.fn();

vi.mock('../../src/storage/operational-store.js', () => ({
  getOperationalStore: () => ({
    getActiveBans: mockGetActiveBans,
  }),
}));

vi.mock('../../src/config/config-manager.js');
vi.mock('../../src/utils/logger.js');

describe('Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveBans.mockReturnValue([]);
  });

  describe('Server Persistence', () => {
    it('should load empty array when no file exists', () => {
      (serversConfig.get as any).mockReturnValue(null);

      const servers = loadServersFromDisk();
      expect(Array.isArray(servers)).toBe(true);
      expect(servers).toHaveLength(0);
    });

    it('should load servers from disk', () => {
      const mockServers = [
        {
          id: 'server1',
          url: 'http://localhost:11434',
          type: 'ollama' as const,
          healthy: true,
          lastResponseTime: 0,
          models: [],
        },
      ];
      (serversConfig.get as any).mockReturnValue(mockServers);

      const servers = loadServersFromDisk();
      expect(servers).toEqual(mockServers);
    });

    it('should handle save without error', () => {
      const servers = [
        {
          id: 'test',
          url: 'http://test',
          type: 'ollama' as const,
          healthy: true,
          lastResponseTime: 0,
          models: [],
        },
      ];
      (serversConfig.set as any).mockReturnValue(true);

      expect(() => saveServersToDisk(servers)).not.toThrow();
    });

    it('should handle error when loading servers (line 59)', () => {
      (serversConfig.get as any).mockImplementation(() => {
        throw new Error('Disk read error');
      });

      expect(() => loadServersFromDisk()).toThrow('Disk read error');
    });

    it('should handle error when saving servers', () => {
      (serversConfig.set as any).mockImplementation(() => {
        throw new Error('Disk write error');
      });

      const servers = [
        {
          id: 'test',
          url: 'http://test',
          type: 'ollama' as const,
          healthy: true,
          lastResponseTime: 0,
          models: [],
        },
      ];
      expect(() => saveServersToDisk(servers)).not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should log error when save returns false', () => {
      (serversConfig.set as any).mockReturnValue(false);

      const servers = [
        {
          id: 'test',
          url: 'http://test',
          type: 'ollama' as const,
          healthy: true,
          lastResponseTime: 0,
          models: [],
        },
      ];
      saveServersToDisk(servers);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to save servers to disk - configManager.set() returned false'
      );
    });
  });

  describe('Ban Persistence', () => {
    it('should load empty set when no active bans in SQLite', () => {
      mockGetActiveBans.mockReturnValue([]);

      const bans = loadBansFromDisk();
      expect(bans).toBeInstanceOf(Set);
      expect(bans.size).toBe(0);
    });

    it('should load bans from SQLite', () => {
      mockGetActiveBans.mockReturnValue([
        { serverId: 'server1', model: 'model1' },
        { serverId: 'server2', model: 'model2' },
      ]);

      const bans = loadBansFromDisk();
      expect(bans).toBeInstanceOf(Set);
      expect(bans.size).toBe(2);
      expect(bans.has('server1:model1')).toBe(true);
    });

    it('should handle save without error (no-op)', () => {
      const bans = new Set(['server:model']);
      expect(() => saveBansToDisk(bans)).not.toThrow();
    });

    it('should log debug on save (no-op)', () => {
      const bans = new Set(['server:model']);
      saveBansToDisk(bans);
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should return a Set from loadBansFromDisk with multiple bans', () => {
      mockGetActiveBans.mockReturnValue([
        { serverId: 'srv', model: 'llama3' },
        { serverId: 'srv', model: 'mistral' },
      ]);

      const bans = loadBansFromDisk();
      expect(bans.has('srv:llama3')).toBe(true);
      expect(bans.has('srv:mistral')).toBe(true);
    });

    it('should log info on successful load', () => {
      mockGetActiveBans.mockReturnValue([{ serverId: 'srv', model: 'model' }]);

      loadBansFromDisk();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('ban'));
    });

    it('should format ban key as serverId:model', () => {
      mockGetActiveBans.mockReturnValue([{ serverId: 'my-server', model: 'gemma:2b' }]);

      const bans = loadBansFromDisk();
      expect(bans.has('my-server:gemma:2b')).toBe(true);
    });
  });
});
