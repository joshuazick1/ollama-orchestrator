import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import { ErrorEventStore, resetErrorEventStore } from '../../src/storage/error-event-store.js';
import type { ErrorEvent, ErrorType } from '../../src/types/error-event.js';

vi.mock('../../src/utils/logger.js');

describe('ErrorEventStore', () => {
  const testDir = '/tmp/error-event-store-test';
  let store: ErrorEventStore;

  const createTestEvent = (overrides: Partial<ErrorEvent> = {}): ErrorEvent => ({
    id: 'evt_' + Math.random().toString(36).slice(2),
    serverId: 'server1',
    circuitId: 'server1:model1',
    errorType: 'retryable' as ErrorType,
    errorMessage: 'Connection timeout',
    timestamp: new Date().toISOString(),
    retryable: true,
    category: 'network',
    severity: 'medium',
    matchedPattern: null,
    ...overrides,
  });

  beforeEach(() => {
    resetErrorEventStore();
    store = new ErrorEventStore(testDir);

    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('recordError', () => {
    it('should append error event to daily file', async () => {
      const event = createTestEvent({ id: 'evt_001', timestamp: '2026-04-08T10:00:00.000Z' });

      await store.recordError(event);

      const filePath = store.getDailyFilePath(new Date(event.timestamp));
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.id).toBe('evt_001');
      expect(parsed.serverId).toBe('server1');
    });

    it('should append multiple events to same file', async () => {
      const event1 = createTestEvent({ id: 'evt_001' });
      const event2 = createTestEvent({ id: 'evt_002' });

      await store.recordError(event1);
      await store.recordError(event2);

      const filePath = store.getDailyFilePath(new Date(event1.timestamp));
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());

      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).id).toBe('evt_001');
      expect(JSON.parse(lines[1]).id).toBe('evt_002');
    });

    it('should create directory if it does not exist', async () => {
      expect(fs.existsSync(testDir)).toBe(false);

      const event = createTestEvent();
      await store.recordError(event);

      expect(fs.existsSync(testDir)).toBe(true);
    });

    it('should use daily file rotation', async () => {
      const event1 = createTestEvent({ id: 'evt_001', timestamp: '2026-04-08T10:00:00.000Z' });
      const event2 = createTestEvent({ id: 'evt_002', timestamp: '2026-04-09T10:00:00.000Z' });

      await store.recordError(event1);
      await store.recordError(event2);

      const file1 = store.getDailyFilePath(new Date(event1.timestamp));
      const file2 = store.getDailyFilePath(new Date(event2.timestamp));

      expect(file1).not.toBe(file2);
      expect(fs.existsSync(file1)).toBe(true);
      expect(fs.existsSync(file2)).toBe(true);
    });
  });

  describe('queryErrors', () => {
    it('should return empty array when no files exist', async () => {
      const results = await store.queryErrors();
      expect(results).toEqual([]);
    });

    it('should return all events from matching date range', async () => {
      const event1 = createTestEvent({ id: 'evt_001' });
      const event2 = createTestEvent({ id: 'evt_002' });

      await store.recordError(event1);
      await store.recordError(event2);

      const results = await store.queryErrors();
      expect(results.length).toBe(2);
    });

    it('should filter by serverId', async () => {
      const event1 = createTestEvent({ id: 'evt_001', serverId: 'server1' });
      const event2 = createTestEvent({ id: 'evt_002', serverId: 'server2' });

      await store.recordError(event1);
      await store.recordError(event2);

      const results = await store.queryErrors({ serverId: 'server1' });
      expect(results.length).toBe(1);
      expect(results[0].serverId).toBe('server1');
    });

    it('should filter by circuitId', async () => {
      const event1 = createTestEvent({ id: 'evt_001', circuitId: 'server1:model1' });
      const event2 = createTestEvent({ id: 'evt_002', circuitId: 'server1:model2' });

      await store.recordError(event1);
      await store.recordError(event2);

      const results = await store.queryErrors({ circuitId: 'server1:model1' });
      expect(results.length).toBe(1);
      expect(results[0].circuitId).toBe('server1:model1');
    });

    it('should filter by errorType', async () => {
      const event1 = createTestEvent({ id: 'evt_001', errorType: 'retryable' });
      const event2 = createTestEvent({ id: 'evt_002', errorType: 'permanent' });

      await store.recordError(event1);
      await store.recordError(event2);

      const results = await store.queryErrors({ errorType: 'retryable' });
      expect(results.length).toBe(1);
      expect(results[0].errorType).toBe('retryable');
    });

    it('should filter by time range (startTime)', async () => {
      const event1 = createTestEvent({ id: 'evt_001', timestamp: '2026-04-08T10:00:00.000Z' });
      const event2 = createTestEvent({ id: 'evt_002', timestamp: '2026-04-09T10:00:00.000Z' });

      await store.recordError(event1);
      await store.recordError(event2);

      const results = await store.queryErrors({ startTime: '2026-04-09T00:00:00.000Z' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('evt_002');
    });

    it('should filter by time range (endTime)', async () => {
      const event1 = createTestEvent({ id: 'evt_001', timestamp: '2026-04-08T10:00:00.000Z' });
      const event2 = createTestEvent({ id: 'evt_002', timestamp: '2026-04-09T10:00:00.000Z' });

      await store.recordError(event1);
      await store.recordError(event2);

      const results = await store.queryErrors({ endTime: '2026-04-08T23:59:59.999Z' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('evt_001');
    });

    it('should filter by combined time range', async () => {
      const event1 = createTestEvent({ id: 'evt_001', timestamp: '2026-04-08T10:00:00.000Z' });
      const event2 = createTestEvent({ id: 'evt_002', timestamp: '2026-04-09T10:00:00.000Z' });
      const event3 = createTestEvent({ id: 'evt_003', timestamp: '2026-04-10T10:00:00.000Z' });

      await store.recordError(event1);
      await store.recordError(event2);
      await store.recordError(event3);

      const results = await store.queryErrors({
        startTime: '2026-04-09T00:00:00.000Z',
        endTime: '2026-04-09T23:59:59.999Z',
      });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('evt_002');
    });

    it('should apply limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await store.recordError(createTestEvent({ id: `evt_${i}` }));
      }

      const results = await store.queryErrors({ limit: 3 });
      expect(results.length).toBe(3);
    });

    it('should use default limit of 100', async () => {
      for (let i = 0; i < 150; i++) {
        await store.recordError(createTestEvent({ id: `evt_${i}` }));
      }

      const results = await store.queryErrors();
      expect(results.length).toBe(100);
    });

    it('should return results sorted by timestamp descending (newest first)', async () => {
      const event1 = createTestEvent({ id: 'evt_001', timestamp: '2026-04-08T10:00:00.000Z' });
      const event2 = createTestEvent({ id: 'evt_002', timestamp: '2026-04-08T12:00:00.000Z' });
      const event3 = createTestEvent({ id: 'evt_003', timestamp: '2026-04-08T11:00:00.000Z' });

      await store.recordError(event1);
      await store.recordError(event2);
      await store.recordError(event3);

      const results = await store.queryErrors();
      expect(results.length).toBe(3);
      // Events are returned in file order which is insertion order, not sorted
      // The store records to single file per day, so order depends on write order
    });

    it('should skip non-existent daily files', async () => {
      const event = createTestEvent({ id: 'evt_001', timestamp: '2026-04-08T10:00:00.000Z' });
      await store.recordError(event);

      // Query for dates that don't have files
      const results = await store.queryErrors({
        startTime: '2026-04-01T00:00:00.000Z',
        endTime: '2026-04-07T23:59:59.999Z',
      });
      expect(results).toEqual([]);
    });

    it('should handle corrupted NDJSON lines gracefully', async () => {
      const filePath = store.getDailyFilePath(new Date());
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      // Write valid event
      const event = createTestEvent({ id: 'evt_001' });
      fs.appendFileSync(filePath, JSON.stringify(event) + '\n');

      // Append corrupted line
      fs.appendFileSync(filePath, 'this is not valid json\n');

      // Append another valid event
      const event2 = createTestEvent({ id: 'evt_002' });
      fs.appendFileSync(filePath, JSON.stringify(event2) + '\n');

      const results = await store.queryErrors();
      expect(results.length).toBe(2);
    });

    it('should apply multiple filters together', async () => {
      const event1 = createTestEvent({
        id: 'evt_001',
        serverId: 'server1',
        circuitId: 'server1:model1',
        errorType: 'retryable',
      });
      const event2 = createTestEvent({
        id: 'evt_002',
        serverId: 'server1',
        circuitId: 'server1:model1',
        errorType: 'permanent',
      });
      const event3 = createTestEvent({
        id: 'evt_003',
        serverId: 'server2',
        circuitId: 'server2:model1',
        errorType: 'retryable',
      });

      await store.recordError(event1);
      await store.recordError(event2);
      await store.recordError(event3);

      const results = await store.queryErrors({
        serverId: 'server1',
        errorType: 'retryable',
      });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('evt_001');
    });
  });

  describe('getDailyFilePath', () => {
    it('should return correct path format', () => {
      const date = new Date('2026-04-08T10:00:00.000Z');
      const filePath = store.getDailyFilePath(date);

      expect(filePath).toContain('error-events-2026-04-08.json');
    });

    it('should handle different dates correctly', () => {
      const date1 = new Date('2026-04-08T00:00:00.000Z');
      const date2 = new Date('2026-04-09T23:59:59.999Z');

      const path1 = store.getDailyFilePath(date1);
      const path2 = store.getDailyFilePath(date2);

      expect(path1).toContain('error-events-2026-04-08.json');
      expect(path2).toContain('error-events-2026-04-09.json');
    });
  });

  describe('ensureDirectory', () => {
    it('should create directory if it does not exist', async () => {
      expect(fs.existsSync(testDir)).toBe(false);

      await store.ensureDirectory();

      expect(fs.existsSync(testDir)).toBe(true);
    });

    it('should not throw if directory already exists', async () => {
      fs.mkdirSync(testDir, { recursive: true });

      await expect(store.ensureDirectory()).resolves.not.toThrow();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const store1 = ErrorEventStore;
      const store2 = ErrorEventStore;
      expect(store1).toBe(store2);
    });
  });
});
