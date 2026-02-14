import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadServersFromDisk,
  saveServersToDisk,
  loadBansFromDisk,
  saveBansToDisk,
} from '../../src/orchestrator-persistence.js';
import { serversConfig, bansConfig } from '../../src/config/configManager.js';
import { logger } from '../../src/utils/logger.js';

vi.mock('../../src/config/configManager.js');
vi.mock('../../src/utils/logger.js');

describe('Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

      const servers = loadServersFromDisk();
      expect(Array.isArray(servers)).toBe(true);
      expect(servers).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
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
    it('should load empty set when no file exists', () => {
      (bansConfig.get as any).mockReturnValue(null);

      const bans = loadBansFromDisk();
      expect(bans).toBeInstanceOf(Set);
      expect(bans.size).toBe(0);
    });

    it('should load bans from disk', () => {
      const mockBans = ['server1:model1', 'server2:model2'];
      (bansConfig.get as any).mockReturnValue(mockBans);

      const bans = loadBansFromDisk();
      expect(bans).toBeInstanceOf(Set);
      expect(bans.size).toBe(2);
      expect(bans.has('server1:model1')).toBe(true);
    });

    it('should handle save without error', () => {
      (bansConfig.set as any).mockReturnValue(true);
      const bans = new Set(['server:model']);
      expect(() => saveBansToDisk(bans)).not.toThrow();
    });

    it('should handle error when loading bans with invalid data (lines 72-74)', () => {
      (bansConfig.get as any).mockReturnValue('invalid');

      const bans = loadBansFromDisk();
      expect(bans).toBeInstanceOf(Set);
      expect(bans.size).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith('No valid bans found on disk, returning empty set');
    });

    it('should handle error when loading bans throws (lines 76-78)', () => {
      (bansConfig.get as any).mockImplementation(() => {
        throw new Error('Disk read error');
      });

      const bans = loadBansFromDisk();
      expect(bans).toBeInstanceOf(Set);
      expect(bans.size).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle error when saving bans', () => {
      (bansConfig.set as any).mockImplementation(() => {
        throw new Error('Disk write error');
      });

      const bans = new Set(['server:model']);
      expect(() => saveBansToDisk(bans)).not.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should log error when save returns false', () => {
      (bansConfig.set as any).mockReturnValue(false);

      const bans = new Set(['server:model']);
      saveBansToDisk(bans);
      expect(logger.error).toHaveBeenCalledWith('Failed to save bans to disk');
    });
  });
});
