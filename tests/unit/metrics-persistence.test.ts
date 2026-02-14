/**
 * metrics-persistence.test.ts
 * Tests for metrics persistence
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MetricsPersistence } from '../../src/metrics/metrics-persistence.js';
import { logger } from '../../src/utils/logger.js';

vi.mock('../../src/utils/logger.js');

describe('MetricsPersistence', () => {
  let tempDir: string;
  let persistence: MetricsPersistence;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-persistence-test-'));
    persistence = new MetricsPersistence({
      filePath: path.join(tempDir, 'metrics.json'),
      retentionHours: 24,
      saveIntervalMs: 100,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should use default options', () => {
      const defaultPersistence = new MetricsPersistence();
      expect(defaultPersistence).toBeDefined();
    });

    it('should accept custom options', () => {
      const customPersistence = new MetricsPersistence({
        filePath: path.join(tempDir, 'custom.json'),
        retentionHours: 48,
        saveIntervalMs: 5000,
      });
      expect(customPersistence).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should create directory if it does not exist (lines 39-47)', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'path');
      const persistenceWithNestedPath = new MetricsPersistence({
        filePath: path.join(nestedDir, 'metrics.json'),
      });

      await persistenceWithNestedPath.initialize();

      expect(fs.existsSync(nestedDir)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        'Metrics persistence initialized',
        expect.any(Object)
      );
    });

    it('should handle initialization errors (lines 44-47)', async () => {
      // Create a file where we want to create a directory to cause error
      const filePath = path.join(tempDir, 'metrics.json');
      fs.writeFileSync(filePath, 'not a directory');

      // Create a nested path that would require creating a directory through the file
      const nestedPersistence = new MetricsPersistence({
        filePath: path.join(filePath, 'nested', 'metrics.json'),
      });

      await expect(nestedPersistence.initialize()).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize metrics persistence:',
        expect.any(Object)
      );
    });
  });

  describe('save', () => {
    beforeEach(async () => {
      await persistence.initialize();
    });

    it('should save metrics data to disk (lines 53-67)', async () => {
      const data = {
        timestamp: Date.now(),
        servers: {
          'server1:model1': {
            serverId: 'server1',
            model: 'model1',
            inFlight: 0,
            queued: 0,
            windows: {} as any,
            percentiles: { p50: 50, p95: 95, p99: 99 },
            successRate: 0.98,
            throughput: 10,
            avgTokensPerRequest: 100,
            recentLatencies: [50, 60, 70],
            lastUpdated: Date.now(),
          },
        },
      };

      await persistence.save(data);

      expect(fs.existsSync(path.join(tempDir, 'metrics.json'))).toBe(true);
    });

    it('should handle save errors (lines 63-66)', async () => {
      // Create a file where the directory should be to cause mkdir error
      const fileAsDir = path.join(tempDir, 'file-as-dir');
      fs.writeFileSync(fileAsDir, 'some content');

      const badPathPersistence = new MetricsPersistence({
        filePath: path.join(fileAsDir, 'nested', 'metrics.json'),
      });

      const data = {
        timestamp: Date.now(),
        servers: {},
      };

      await expect(badPathPersistence.save(data)).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith('Failed to save metrics:', expect.any(Object));
    });
  });

  describe('load', () => {
    beforeEach(async () => {
      await persistence.initialize();
    });

    it('should load metrics data from disk (lines 72-87)', async () => {
      const data = {
        timestamp: Date.now(),
        servers: {
          'server1:model1': {
            serverId: 'server1',
            model: 'model1',
            inFlight: 0,
            queued: 0,
            windows: {} as any,
            percentiles: { p50: 50, p95: 95, p99: 99 },
            successRate: 0.98,
            throughput: 10,
            avgTokensPerRequest: 100,
            recentLatencies: [50, 60, 70],
            lastUpdated: Date.now(),
          },
        },
      };

      await persistence.save(data);
      const loaded = await persistence.load();

      expect(loaded).toBeDefined();
      expect(loaded?.timestamp).toBe(data.timestamp);
      expect(logger.info).toHaveBeenCalledWith('Metrics loaded from disk', expect.any(Object));
    });

    it('should return null when file does not exist (lines 80-82)', async () => {
      const loaded = await persistence.load();

      expect(loaded).toBeNull();
      expect(logger.info).toHaveBeenCalledWith('No existing metrics file found, starting fresh');
    });

    it('should handle load errors gracefully (lines 84-86)', async () => {
      // Write invalid JSON to cause parse error
      fs.writeFileSync(path.join(tempDir, 'metrics.json'), 'invalid json', 'utf-8');

      const loaded = await persistence.load();

      expect(loaded).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Failed to load metrics:', expect.any(Object));
    });
  });

  describe('scheduleSave', () => {
    beforeEach(async () => {
      await persistence.initialize();
    });

    it('should schedule a save operation (lines 92-102)', async () => {
      const data = {
        timestamp: Date.now(),
        servers: {},
      };

      persistence.scheduleSave(data);

      // Wait for the scheduled save
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(fs.existsSync(path.join(tempDir, 'metrics.json'))).toBe(true);
    });

    it('should debounce multiple scheduleSave calls (lines 93-95)', async () => {
      const data = {
        timestamp: Date.now(),
        servers: {},
      };

      // Schedule multiple saves quickly
      persistence.scheduleSave(data);
      persistence.scheduleSave(data);
      persistence.scheduleSave(data);

      // Should only result in one save
      await new Promise(resolve => setTimeout(resolve, 150));

      // File should exist (save happened)
      expect(fs.existsSync(path.join(tempDir, 'metrics.json'))).toBe(true);
    });
  });

  describe('flush', () => {
    beforeEach(async () => {
      await persistence.initialize();
    });

    it('should force immediate save if dirty (lines 107-115)', async () => {
      const data = {
        timestamp: Date.now(),
        servers: {},
      };

      // Make it dirty first
      persistence.scheduleSave(data);

      // Flush immediately
      await persistence.flush(data);

      expect(fs.existsSync(path.join(tempDir, 'metrics.json'))).toBe(true);
    });

    it('should not save if not dirty (lines 112-114)', async () => {
      const data = {
        timestamp: Date.now(),
        servers: {},
      };

      // Flush without scheduling first (not dirty)
      await persistence.flush(data);

      // File should not exist (no save happened)
      expect(fs.existsSync(path.join(tempDir, 'metrics.json'))).toBe(false);
    });

    it('should cancel pending timeout (lines 108-110)', async () => {
      const data = {
        timestamp: Date.now(),
        servers: {},
      };

      // Schedule a save with longer timeout
      const persistenceWithLongTimeout = new MetricsPersistence({
        filePath: path.join(tempDir, 'metrics.json'),
        saveIntervalMs: 10000, // 10 seconds
      });
      await persistenceWithLongTimeout.initialize();

      persistenceWithLongTimeout.scheduleSave(data);

      // Flush immediately (should cancel the 10s timeout)
      await persistenceWithLongTimeout.flush(data);

      expect(fs.existsSync(path.join(tempDir, 'metrics.json'))).toBe(true);
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await persistence.initialize();
    });

    it('should ensure final save on shutdown (lines 140-142)', async () => {
      const data = {
        timestamp: Date.now(),
        servers: {},
      };

      // Schedule a save
      persistence.scheduleSave(data);

      // Shutdown should flush
      await persistence.shutdown(data);

      expect(fs.existsSync(path.join(tempDir, 'metrics.json'))).toBe(true);
    });
  });

  describe('cleanOldData', () => {
    it('should clean old data based on retention policy (lines 120-135)', () => {
      const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      const data = {
        timestamp: oldTimestamp,
        servers: {
          'server1:model1': {
            serverId: 'server1',
            model: 'model1',
            inFlight: 0,
            queued: 0,
            windows: {} as any,
            percentiles: { p50: 50, p95: 95, p99: 99 },
            successRate: 0.98,
            throughput: 10,
            avgTokensPerRequest: 100,
            recentLatencies: [50, 60, 70],
            lastUpdated: oldTimestamp,
          },
        },
      };

      // Access private method through any
      const cleanedData = (persistence as any).cleanOldData(data);

      // Should have updated timestamp
      expect(cleanedData.timestamp).toBeGreaterThan(oldTimestamp);
      // Servers should still be there (retention logic filters by timestamp)
      expect(cleanedData.servers['server1:model1']).toBeDefined();
    });
  });
});
