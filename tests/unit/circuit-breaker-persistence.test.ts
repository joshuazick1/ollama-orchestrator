import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { CircuitBreakerData } from '../../src/circuit-breaker/circuit-breaker-persistence.js';

const mockWrite = vi.fn();
const mockRead = vi.fn();

vi.mock('../../src/config/json-file-handler.js', () => {
  return {
    JsonFileHandler: class MockJsonFileHandler {
      filePath: string;
      constructor(filePath: string, options?: Record<string, unknown>) {
        this.filePath = filePath;
        MockJsonFileHandler.instances.push(this);
        MockJsonFileHandler.constructorCalls.push([filePath, options]);
      }
      write = mockWrite;
      read = mockRead;
      static instances: Array<{ filePath: string }> = [];
      static constructorCalls: unknown[][] = [];
      static reset() {
        MockJsonFileHandler.instances = [];
        MockJsonFileHandler.constructorCalls = [];
      }
    },
  };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { CircuitBreakerPersistence } from '../../src/circuit-breaker/circuit-breaker-persistence.js';
import { JsonFileHandler } from '../../src/config/json-file-handler.js';
import { logger } from '../../src/utils/logger.js';

const MockJsonFileHandler = JsonFileHandler as unknown as {
  instances: Array<{ filePath: string }>;
  constructorCalls: unknown[][];
  reset: () => void;
};

function createMockData(overrides: Partial<CircuitBreakerData> = {}): CircuitBreakerData {
  return {
    timestamp: Date.now(),
    breakers: {
      'server1:model1': {
        state: 'closed',
        failureCount: 0,
        successCount: 5,
        totalRequestCount: 10,
        blockedRequestCount: 0,
        lastFailure: 0,
        lastSuccess: Date.now(),
        nextRetryAt: 0,
        consecutiveSuccesses: 5,
        errorRate: 0,
        errorCounts: {},
        halfOpenStartedAt: 0,
      },
    },
    ...overrides,
  };
}

describe('CircuitBreakerPersistence', () => {
  let persistence: CircuitBreakerPersistence;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    MockJsonFileHandler.reset();
    persistence = new CircuitBreakerPersistence();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create JsonFileHandler with default path and backup options', () => {
      const calls = MockJsonFileHandler.constructorCalls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const [filePath, options] = calls[calls.length - 1] as [string, Record<string, unknown>];
      expect(filePath).toContain('circuit-breakers.json');
      expect(options).toEqual({ createBackups: true, maxBackups: 3 });
    });

    it('should accept custom file path', () => {
      MockJsonFileHandler.reset();
      new CircuitBreakerPersistence({ filePath: '/custom/path/breakers.json' });

      const calls = MockJsonFileHandler.constructorCalls;
      expect(calls).toHaveLength(1);
      const [filePath] = calls[0] as [string];
      expect(filePath).toBe('/custom/path/breakers.json');
    });

    it('should accept custom save interval', async () => {
      const custom = new CircuitBreakerPersistence({ saveIntervalMs: 5000 });
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      custom.scheduleSave(data);
      vi.advanceTimersByTime(4999);
      expect(mockWrite).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(mockWrite).toHaveBeenCalledWith(data);
    });

    it('should default to 30 second save interval', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence.scheduleSave(data);
      vi.advanceTimersByTime(29999);
      expect(mockWrite).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(mockWrite).toHaveBeenCalledWith(data);
    });
  });

  describe('initialize()', () => {
    it('should resolve successfully', async () => {
      await expect(persistence.initialize()).resolves.toBeUndefined();
    });

    it('should log initialization info with file path', async () => {
      await persistence.initialize();

      expect(logger.info).toHaveBeenCalledWith('Circuit breaker persistence initialized', {
        filePath: expect.anything(),
      });
    });

    it('should return a Promise', () => {
      const result = persistence.initialize();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('save(data)', () => {
    it('should save valid CircuitBreakerData to disk', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      await persistence.save(data);

      expect(mockWrite).toHaveBeenCalledWith(data);
    });

    it('should log debug message with breaker count on success', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      await persistence.save(data);

      expect(logger.debug).toHaveBeenCalledWith('Circuit breakers saved to disk', {
        count: 1,
      });
    });

    it('should throw when write returns false', () => {
      mockWrite.mockReturnValue(false);
      const data = createMockData();

      expect(() => persistence.save(data)).toThrow('Failed to write circuit breaker data');
    });

    it('should log error when write returns false', () => {
      mockWrite.mockReturnValue(false);
      const data = createMockData();

      expect(() => persistence.save(data)).toThrow();
      expect(logger.error).toHaveBeenCalledWith('Failed to save circuit breakers:', {
        error: expect.any(Error),
      });
    });

    it('should rethrow when write throws an exception', () => {
      mockWrite.mockImplementation(() => {
        throw new Error('Disk full');
      });
      const data = createMockData();

      expect(() => persistence.save(data)).toThrow('Disk full');
      expect(logger.error).toHaveBeenCalledWith('Failed to save circuit breakers:', {
        error: expect.any(Error),
      });
    });

    it('should save data with multiple breakers and log correct count', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData({
        breakers: {
          'server1:model1': {
            state: 'closed',
            failureCount: 0,
            successCount: 5,
            lastFailure: 0,
            lastSuccess: Date.now(),
            nextRetryAt: 0,
            consecutiveSuccesses: 5,
            errorRate: 0,
            errorCounts: {},
            halfOpenStartedAt: 0,
          },
          'server2:model2': {
            state: 'open',
            failureCount: 3,
            successCount: 0,
            lastFailure: Date.now(),
            lastSuccess: 0,
            nextRetryAt: Date.now() + 60000,
            consecutiveSuccesses: 0,
            errorRate: 1.0,
            errorCounts: { retryable: 3 },
            halfOpenStartedAt: 0,
            lastFailureReason: 'Connection timeout',
          },
        },
      });

      await persistence.save(data);

      expect(logger.debug).toHaveBeenCalledWith('Circuit breakers saved to disk', { count: 2 });
    });
  });

  describe('load()', () => {
    it('should load valid data from disk', async () => {
      const expectedData = createMockData();
      mockRead.mockReturnValue(expectedData);

      const result = await persistence.load();

      expect(result).toEqual(expectedData);
    });

    it('should log breaker count when data loaded', async () => {
      mockRead.mockReturnValue(createMockData());

      await persistence.load();

      expect(logger.info).toHaveBeenCalledWith('Circuit breakers loaded from disk', {
        count: 1,
      });
    });

    it('should return null when no file exists (read returns null)', async () => {
      mockRead.mockReturnValue(null);

      const result = await persistence.load();

      expect(result).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        'No existing circuit breaker file found, starting fresh'
      );
    });

    it('should return null on ENOENT error', async () => {
      const error = new Error('File not found') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockRead.mockImplementation(() => {
        throw error;
      });

      const result = await persistence.load();

      expect(result).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        'No existing circuit breaker file found, starting fresh'
      );
    });

    it('should return null on generic read error', async () => {
      mockRead.mockImplementation(() => {
        throw new Error('Corrupted file');
      });

      const result = await persistence.load();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Failed to load circuit breakers:', {
        error: expect.any(Error),
      });
    });

    it('should load data with all optional fields present', async () => {
      const data: CircuitBreakerData = {
        timestamp: Date.now(),
        breakers: {
          'server1:model1': {
            state: 'closed',
            failureCount: 2,
            successCount: 10,
            totalRequestCount: 12,
            blockedRequestCount: 0,
            lastFailure: Date.now() - 5000,
            lastSuccess: Date.now(),
            nextRetryAt: 0,
            consecutiveSuccesses: 10,
            errorRate: 0.1,
            errorCounts: { retryable: 2 },
            halfOpenStartedAt: 0,
            lastFailureReason: 'Connection timeout',
            modelType: 'generation',
            lastErrorType: 'transient',
          },
        },
      };
      mockRead.mockReturnValue(data);

      const result = await persistence.load();
      expect(result).toEqual(data);
    });

    it('should log correct count with multiple breakers', async () => {
      const data = createMockData({
        breakers: {
          'server1:model1': {
            state: 'closed',
            failureCount: 0,
            successCount: 0,
            lastFailure: 0,
            lastSuccess: 0,
            nextRetryAt: 0,
            consecutiveSuccesses: 0,
            errorRate: 0,
            errorCounts: {},
            halfOpenStartedAt: 0,
          },
          'server2:model2': {
            state: 'open',
            failureCount: 5,
            successCount: 0,
            lastFailure: 0,
            lastSuccess: 0,
            nextRetryAt: 0,
            consecutiveSuccesses: 0,
            errorRate: 1,
            errorCounts: {},
            halfOpenStartedAt: 0,
          },
        },
      });
      mockRead.mockReturnValue(data);

      await persistence.load();

      expect(logger.info).toHaveBeenCalledWith('Circuit breakers loaded from disk', { count: 2 });
    });
  });

  describe('scheduleSave(data)', () => {
    it('should not write immediately', () => {
      const data = createMockData();

      persistence.scheduleSave(data);

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should write after the debounce interval', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence.scheduleSave(data);
      expect(mockWrite).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30000);

      expect(mockWrite).toHaveBeenCalledWith(data);
    });

    it('should debounce multiple rapid calls and only write last data', async () => {
      mockWrite.mockReturnValue(true);
      const data1 = createMockData({ timestamp: 1 });
      const data2 = createMockData({ timestamp: 2 });
      const data3 = createMockData({ timestamp: 3 });

      persistence.scheduleSave(data1);
      persistence.scheduleSave(data2);
      persistence.scheduleSave(data3);

      await vi.runAllTimersAsync();

      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(mockWrite).toHaveBeenCalledWith(data3);
    });

    it('should reset timer on subsequent calls', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence = new CircuitBreakerPersistence({ saveIntervalMs: 500 });

      persistence.scheduleSave(data);
      await vi.advanceTimersByTimeAsync(300);
      expect(mockWrite).not.toHaveBeenCalled();

      persistence.scheduleSave(data);
      await vi.advanceTimersByTimeAsync(300);
      expect(mockWrite).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(mockWrite).toHaveBeenCalledTimes(1);
    });

    it('should mark data as dirty so flush writes', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.flush(data);
      expect(mockWrite).toHaveBeenCalledWith(data);
    });
  });

  describe('flush(data)', () => {
    it('should write immediately when data is dirty', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.flush(data);

      expect(mockWrite).toHaveBeenCalledWith(data);
    });

    it('should not write when data is not dirty', async () => {
      const data = createMockData();

      await persistence.flush(data);

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should clear pending scheduled save timeout', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.flush(data);

      mockWrite.mockClear();

      await vi.runAllTimersAsync();
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should not double-write when flush is called twice', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.flush(data);
      await persistence.flush(data);

      expect(mockWrite).toHaveBeenCalledTimes(1);
    });

    it('should not write when data was already saved via save()', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      await persistence.save(data);
      mockWrite.mockClear();

      await persistence.flush(data);
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('shutdown(data)', () => {
    it('should perform final save when dirty', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.shutdown(data);

      expect(mockWrite).toHaveBeenCalledWith(data);
    });

    it('should clear pending scheduled saves', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.shutdown(data);

      mockWrite.mockClear();

      await vi.runAllTimersAsync();
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should not write when no pending changes', async () => {
      const data = createMockData();

      await persistence.shutdown(data);

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should not write again after a prior successful save()', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      await persistence.save(data);
      mockWrite.mockClear();

      await persistence.shutdown(data);
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should only write once (delegates to flush)', async () => {
      mockWrite.mockReturnValue(true);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.shutdown(data);

      expect(mockWrite).toHaveBeenCalledTimes(1);
    });
  });
});
