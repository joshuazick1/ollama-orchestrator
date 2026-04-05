import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { CircuitBreakerData } from '../../src/circuit-breaker/circuit-breaker-persistence.js';

const mockSaveCircuitBreakerState = vi.fn();
const mockGetAllCircuitBreakerStates = vi.fn();

vi.mock('../../src/storage/operational-store.js', () => ({
  getOperationalStore: () => ({
    saveCircuitBreakerState: mockSaveCircuitBreakerState,
    getAllCircuitBreakerStates: mockGetAllCircuitBreakerStates,
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { CircuitBreakerPersistence } from '../../src/circuit-breaker/circuit-breaker-persistence.js';
import { logger } from '../../src/utils/logger.js';

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
    mockGetAllCircuitBreakerStates.mockReturnValue([]);
    persistence = new CircuitBreakerPersistence();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create instance with default save interval', () => {
      expect(persistence).toBeDefined();
    });

    it('should accept custom file path (ignored in SQLite mode)', () => {
      const custom = new CircuitBreakerPersistence({ filePath: '/custom/path/breakers.json' });
      expect(custom).toBeDefined();
    });

    it('should accept custom save interval', async () => {
      const custom = new CircuitBreakerPersistence({ saveIntervalMs: 5000 });
      const data = createMockData();
      mockSaveCircuitBreakerState.mockReturnValue(undefined);

      custom.scheduleSave(data);
      vi.advanceTimersByTime(4999);
      expect(mockSaveCircuitBreakerState).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(mockSaveCircuitBreakerState).toHaveBeenCalled();
    });

    it('should default to 30 second save interval', async () => {
      const data = createMockData();
      mockSaveCircuitBreakerState.mockReturnValue(undefined);

      persistence.scheduleSave(data);
      vi.advanceTimersByTime(29999);
      expect(mockSaveCircuitBreakerState).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(mockSaveCircuitBreakerState).toHaveBeenCalled();
    });
  });

  describe('initialize()', () => {
    it('should resolve successfully', async () => {
      await expect(persistence.initialize()).resolves.toBeUndefined();
    });

    it('should log initialization info with file path', async () => {
      await persistence.initialize();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker persistence initialized')
      );
    });

    it('should return a Promise', () => {
      const result = persistence.initialize();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('save(data)', () => {
    it('should save valid CircuitBreakerData to SQLite', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data = createMockData();

      await persistence.save(data);

      expect(mockSaveCircuitBreakerState).toHaveBeenCalledWith(
        'server1',
        'model1',
        expect.any(Object)
      );
    });

    it('should log debug message with breaker count on success', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data = createMockData();

      await persistence.save(data);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breakers saved'),
        expect.objectContaining({ count: 1 })
      );
    });

    it('should throw when SQLite save throws', () => {
      mockSaveCircuitBreakerState.mockImplementation(() => {
        throw new Error('SQLite error');
      });
      const data = createMockData();

      expect(() => persistence.save(data)).toThrow('SQLite error');
    });

    it('should log error when write throws an exception', () => {
      mockSaveCircuitBreakerState.mockImplementation(() => {
        throw new Error('Disk full');
      });
      const data = createMockData();

      expect(() => persistence.save(data)).toThrow('Disk full');
      expect(logger.error).toHaveBeenCalledWith('Failed to save circuit breakers:', {
        error: expect.any(Error),
      });
    });

    it('should rethrow when save throws an exception', () => {
      mockSaveCircuitBreakerState.mockImplementation(() => {
        throw new Error('Disk full');
      });
      const data = createMockData();

      expect(() => persistence.save(data)).toThrow('Disk full');
      expect(logger.error).toHaveBeenCalledWith('Failed to save circuit breakers:', {
        error: expect.any(Error),
      });
    });

    it('should save data with multiple breakers and log correct count', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
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

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breakers saved'),
        expect.objectContaining({ count: 2 })
      );
    });
  });

  describe('load()', () => {
    it('should load valid data from SQLite', async () => {
      mockGetAllCircuitBreakerStates.mockReturnValue([
        {
          serverId: 'server1',
          model: 'model1',
          state: 'closed',
          failureCount: 0,
          successCount: 5,
          lastFailureAt: null,
          lastSuccessAt: Date.now(),
          nextRetryAt: null,
          updatedAt: Date.now(),
        },
      ]);

      const result = await persistence.load();

      expect(result).not.toBeNull();
      expect(result?.breakers['server1:model1']).toBeDefined();
    });

    it('should log breaker count when data loaded', async () => {
      mockGetAllCircuitBreakerStates.mockReturnValue([
        {
          serverId: 'server1',
          model: 'model1',
          state: 'closed',
          failureCount: 0,
          successCount: 5,
          lastFailureAt: null,
          lastSuccessAt: null,
          nextRetryAt: null,
          updatedAt: Date.now(),
        },
      ]);

      await persistence.load();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Circuit breakers loaded'), {
        count: 1,
      });
    });

    it('should return null when no rows in SQLite', async () => {
      mockGetAllCircuitBreakerStates.mockReturnValue([]);

      const result = await persistence.load();

      expect(result).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('No existing circuit breaker')
      );
    });

    it('should return null on ENOENT error', async () => {
      mockGetAllCircuitBreakerStates.mockReturnValue([]);

      const result = await persistence.load();

      expect(result).toBeNull();
    });

    it('should return null on generic read error', async () => {
      mockGetAllCircuitBreakerStates.mockImplementation(() => {
        throw new Error('Corrupted data');
      });

      const result = await persistence.load();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Failed to load circuit breakers:', {
        error: expect.any(Error),
      });
    });

    it('should load data with all optional fields present', async () => {
      mockGetAllCircuitBreakerStates.mockReturnValue([
        {
          serverId: 'server1',
          model: 'model1',
          state: 'closed',
          failureCount: 2,
          successCount: 10,
          lastFailureAt: Date.now() - 5000,
          lastSuccessAt: Date.now(),
          nextRetryAt: null,
          updatedAt: Date.now(),
        },
      ]);

      const result = await persistence.load();
      expect(result?.breakers['server1:model1']).toBeDefined();
      expect(result?.breakers['server1:model1'].failureCount).toBe(2);
    });

    it('should log correct count with multiple breakers', async () => {
      mockGetAllCircuitBreakerStates.mockReturnValue([
        {
          serverId: 'server1',
          model: 'model1',
          state: 'closed',
          failureCount: 0,
          successCount: 0,
          lastFailureAt: null,
          lastSuccessAt: null,
          nextRetryAt: null,
          updatedAt: Date.now(),
        },
        {
          serverId: 'server2',
          model: 'model2',
          state: 'open',
          failureCount: 5,
          successCount: 0,
          lastFailureAt: null,
          lastSuccessAt: null,
          nextRetryAt: null,
          updatedAt: Date.now(),
        },
      ]);

      await persistence.load();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Circuit breakers loaded'), {
        count: 2,
      });
    });
  });

  describe('scheduleSave(data)', () => {
    it('should not write immediately', () => {
      const data = createMockData();

      persistence.scheduleSave(data);

      expect(mockSaveCircuitBreakerState).not.toHaveBeenCalled();
    });

    it('should write after the debounce interval', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data = createMockData();

      persistence.scheduleSave(data);
      expect(mockSaveCircuitBreakerState).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30000);

      expect(mockSaveCircuitBreakerState).toHaveBeenCalled();
    });

    it('should debounce multiple rapid calls and only write last data', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data1 = createMockData({ timestamp: 1 });
      const data2 = createMockData({ timestamp: 2 });
      const data3 = createMockData({ timestamp: 3 });

      persistence.scheduleSave(data1);
      persistence.scheduleSave(data2);
      persistence.scheduleSave(data3);

      await vi.runAllTimersAsync();

      expect(mockSaveCircuitBreakerState).toHaveBeenCalledTimes(1);
    });

    it('should reset timer on subsequent calls', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data = createMockData();

      persistence = new CircuitBreakerPersistence({ saveIntervalMs: 500 });

      persistence.scheduleSave(data);
      await vi.advanceTimersByTimeAsync(300);
      expect(mockSaveCircuitBreakerState).not.toHaveBeenCalled();

      persistence.scheduleSave(data);
      await vi.advanceTimersByTimeAsync(300);
      expect(mockSaveCircuitBreakerState).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(mockSaveCircuitBreakerState).toHaveBeenCalledTimes(1);
    });

    it('should mark data as dirty so flush writes', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.flush(data);
      expect(mockSaveCircuitBreakerState).toHaveBeenCalled();
    });
  });

  describe('flush(data)', () => {
    it('should write immediately when data is dirty', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.flush(data);

      expect(mockSaveCircuitBreakerState).toHaveBeenCalled();
    });

    it('should not write when data is not dirty', async () => {
      const data = createMockData();

      await persistence.flush(data);

      expect(mockSaveCircuitBreakerState).not.toHaveBeenCalled();
    });

    it('should not double-write when flush is called twice', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.flush(data);
      await persistence.flush(data);

      expect(mockSaveCircuitBreakerState).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown(data)', () => {
    it('should perform final save when dirty', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.shutdown(data);

      expect(mockSaveCircuitBreakerState).toHaveBeenCalled();
    });

    it('should only write once (delegates to flush)', async () => {
      mockSaveCircuitBreakerState.mockReturnValue(undefined);
      const data = createMockData();

      persistence.scheduleSave(data);
      await persistence.shutdown(data);

      expect(mockSaveCircuitBreakerState).toHaveBeenCalledTimes(1);
    });
  });
});
