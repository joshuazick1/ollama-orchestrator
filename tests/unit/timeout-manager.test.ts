import { describe, it, expect, beforeEach } from 'vitest';
import {
  TimeoutManager,
  getTimeoutManager,
  resetTimeoutManager,
  createTimeoutManager,
  DEFAULT_TIMEOUT_CONFIG,
  type TimeoutConfig,
  type PersistedTimeoutData,
} from '../../src/utils/timeout-manager.js';

describe('TimeoutManager', () => {
  let manager: TimeoutManager;

  beforeEach(() => {
    resetTimeoutManager();
    manager = new TimeoutManager();
  });

  describe('constructor', () => {
    it('should use default config when no config provided', () => {
      const m = new TimeoutManager();
      expect(m.getConfig()).toEqual(DEFAULT_TIMEOUT_CONFIG);
    });

    it('should allow custom config', () => {
      const customConfig: Partial<TimeoutConfig> = {
        defaultTimeout: 60000,
        maxTimeout: 300000,
      };
      const m = new TimeoutManager(customConfig);
      const config = m.getConfig();
      expect(config.defaultTimeout).toBe(60000);
      expect(config.maxTimeout).toBe(300000);
      expect(config.minTimeout).toBe(DEFAULT_TIMEOUT_CONFIG.minTimeout);
    });
  });

  describe('getTimeout', () => {
    it('should return default timeout for unknown server:model', () => {
      const timeout = manager.getTimeout('server-1', 'llama3:latest');
      expect(timeout).toBe(DEFAULT_TIMEOUT_CONFIG.defaultTimeout);
    });

    it('should return set timeout for known server:model', () => {
      manager.setTimeout('server-1', 'llama3:latest', 60000);
      const timeout = manager.getTimeout('server-1', 'llama3:latest');
      expect(timeout).toBe(60000);
    });
  });

  describe('setTimeout', () => {
    it('should set timeout for new server:model', () => {
      manager.setTimeout('server-1', 'llama3:latest', 90000);
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBe(90000);
    });

    it('should clamp timeout to minTimeout', () => {
      manager.setTimeout('server-1', 'llama3:latest', 5000);
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBe(
        DEFAULT_TIMEOUT_CONFIG.minTimeout
      );
    });

    it('should clamp timeout to maxTimeout', () => {
      manager.setTimeout('server-1', 'llama3:latest', 9999999);
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBe(
        DEFAULT_TIMEOUT_CONFIG.maxTimeout
      );
    });

    it('should update existing timeout', () => {
      manager.setTimeout('server-1', 'llama3:latest', 60000);
      manager.setTimeout('server-1', 'llama3:latest', 80000);
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBe(80000);
    });
  });

  describe('updateFromResponseTime', () => {
    it('should create new timeout state if not exists', () => {
      manager.updateFromResponseTime('server-1', 'llama3:latest', 50000, false);
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBeDefined();
    });

    it('should use slowRequestMultiplier for regular requests', () => {
      manager.updateFromResponseTime('server-1', 'llama3:latest', 50000, false);
      // 50000 * 2 = 100000, clamped to maxTimeout
      const timeout = manager.getTimeout('server-1', 'llama3:latest');
      expect(timeout).toBeLessThanOrEqual(DEFAULT_TIMEOUT_CONFIG.maxTimeout);
    });

    it('should use activeTestMultiplier for active test requests', () => {
      manager.updateFromResponseTime('server-1', 'llama3:latest', 10000, true);
      // 10000 * 3 = 30000
      const timeout = manager.getTimeout('server-1', 'llama3:latest');
      expect(timeout).toBeGreaterThanOrEqual(30000);
    });

    it('should increment consecutiveSuccesses', () => {
      manager.updateFromResponseTime('server-1', 'llama3:latest', 10000, false);
      manager.updateFromResponseTime('server-1', 'llama3:latest', 10000, false);
      const state = manager.getTimeoutState('server-1', 'llama3:latest');
      expect(state?.consecutiveSuccesses).toBe(2);
    });

    it('should reset consecutiveFailures on success', () => {
      manager.recordFailure('server-1', 'llama3:latest');
      manager.recordFailure('server-1', 'llama3:latest');
      manager.updateFromResponseTime('server-1', 'llama3:latest', 10000, false);
      const state = manager.getTimeoutState('server-1', 'llama3:latest');
      expect(state?.consecutiveFailures).toBe(0);
    });

    it('should not go below minTimeout', () => {
      manager.updateFromResponseTime('server-1', 'llama3:latest', 1000, false);
      const timeout = manager.getTimeout('server-1', 'llama3:latest');
      expect(timeout).toBeGreaterThanOrEqual(DEFAULT_TIMEOUT_CONFIG.minTimeout);
    });
  });

  describe('recordFailure', () => {
    it('should increment consecutiveFailures', () => {
      manager.setTimeout('server-1', 'llama3:latest', 60000);
      manager.recordFailure('server-1', 'llama3:latest');
      manager.recordFailure('server-1', 'llama3:latest');
      const state = manager.getTimeoutState('server-1', 'llama3:latest');
      expect(state?.consecutiveFailures).toBe(2);
    });

    it('should reset consecutiveSuccesses on failure', () => {
      manager.updateFromResponseTime('server-1', 'llama3:latest', 10000, false);
      manager.recordFailure('server-1', 'llama3:latest');
      const state = manager.getTimeoutState('server-1', 'llama3:latest');
      expect(state?.consecutiveSuccesses).toBe(0);
    });

    it('should do nothing for unknown server:model', () => {
      manager.recordFailure('server-1', 'llama3:latest');
      const state = manager.getTimeoutState('server-1', 'llama3:latest');
      expect(state).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should remove timeout for server:model', () => {
      manager.setTimeout('server-1', 'llama3:latest', 60000);
      manager.reset('server-1', 'llama3:latest');
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBe(
        DEFAULT_TIMEOUT_CONFIG.defaultTimeout
      );
    });
  });

  describe('clearAll', () => {
    it('should clear all timeouts', () => {
      manager.setTimeout('server-1', 'llama3:latest', 60000);
      manager.setTimeout('server-2', 'codellama:7b', 70000);
      manager.clearAll();
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBe(
        DEFAULT_TIMEOUT_CONFIG.defaultTimeout
      );
      expect(manager.getTimeout('server-2', 'codellama:7b')).toBe(
        DEFAULT_TIMEOUT_CONFIG.defaultTimeout
      );
    });
  });

  describe('updateDefaultTimeout', () => {
    it('should update default timeout', () => {
      manager.updateDefaultTimeout(90000);
      expect(manager.getConfig().defaultTimeout).toBe(90000);
    });

    it('should update timeouts that use default', () => {
      manager.setTimeout('server-1', 'llama3:latest', DEFAULT_TIMEOUT_CONFIG.defaultTimeout);
      manager.updateDefaultTimeout(90000);
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBe(90000);
    });

    it('should not update timeouts with custom base', () => {
      manager.setTimeout('server-1', 'llama3:latest', 60000);
      manager.updateDefaultTimeout(90000);
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBe(60000);
    });
  });

  describe('calculateAdaptiveTimeout', () => {
    it('should calculate with multiplier', () => {
      const timeout = TimeoutManager.calculateAdaptiveTimeout(10000, 2, 5000, 300000);
      expect(timeout).toBe(20000);
    });

    it('should respect minTimeout', () => {
      const timeout = TimeoutManager.calculateAdaptiveTimeout(1000, 2, 5000, 300000);
      expect(timeout).toBe(5000);
    });

    it('should respect maxTimeout', () => {
      const timeout = TimeoutManager.calculateAdaptiveTimeout(200000, 2, 5000, 300000);
      expect(timeout).toBe(300000);
    });
  });

  describe('getTimeoutState', () => {
    it('should return state for known server:model', () => {
      manager.setTimeout('server-1', 'llama3:latest', 60000);
      const state = manager.getTimeoutState('server-1', 'llama3:latest');
      expect(state).toBeDefined();
      expect(state?.baseTimeout).toBe(60000);
    });

    it('should return undefined for unknown server:model', () => {
      const state = manager.getTimeoutState('server-1', 'llama3:latest');
      expect(state).toBeUndefined();
    });
  });

  describe('getAllTimeoutStates', () => {
    it('should return all timeout states', () => {
      manager.setTimeout('server-1', 'llama3:latest', 60000);
      manager.setTimeout('server-2', 'codellama:7b', 70000);
      const states = manager.getAllTimeoutStates();
      expect(states.size).toBe(2);
    });

    it('should return empty map when no timeouts', () => {
      const states = manager.getAllTimeoutStates();
      expect(states.size).toBe(0);
    });
  });

  describe('loadFromPersistedData', () => {
    it('should load timeouts from persisted data', () => {
      const data: PersistedTimeoutData = {
        timeouts: {
          'server-1:llama3:latest': {
            lastUpdated: Date.now(),
            baseTimeout: 60000,
            currentTimeout: 80000,
          },
        },
        version: 1,
      };
      manager.loadFromPersistedData(data);
      expect(manager.getTimeout('server-1', 'llama3:latest')).toBe(80000);
    });

    it('should handle empty timeouts', () => {
      const data: PersistedTimeoutData = { timeouts: {}, version: 1 };
      manager.loadFromPersistedData(data);
      expect(manager.getAllTimeoutStates().size).toBe(0);
    });

    it('should handle undefined timeouts', () => {
      const data = { timeouts: undefined } as any;
      manager.loadFromPersistedData(data);
      expect(manager.getAllTimeoutStates().size).toBe(0);
    });

    it('should reset consecutive counters on load', () => {
      manager.recordFailure('server-1', 'llama3:latest');
      manager.recordFailure('server-1', 'llama3:latest');
      const data = manager.toPersistedData();
      const newManager = new TimeoutManager();
      newManager.loadFromPersistedData(data);
      const state = newManager.getTimeoutState('server-1', 'llama3:latest');
      expect(state?.consecutiveFailures).toBe(0);
    });
  });

  describe('toPersistedData', () => {
    it('should return persisted data', () => {
      manager.setTimeout('server-1', 'llama3:latest', 60000);
      const data = manager.toPersistedData();
      expect(data.timeouts['server-1:llama3:latest']).toBeDefined();
      expect(data.version).toBe(1);
    });

    it('should exclude consecutive counters', () => {
      manager.recordFailure('server-1', 'llama3:latest');
      manager.updateFromResponseTime('server-1', 'llama3:latest', 10000, false);
      const data = manager.toPersistedData();
      expect((data.timeouts['server-1:llama3:latest'] as any).consecutiveFailures).toBeUndefined();
    });
  });
});

describe('getTimeoutManager singleton', () => {
  beforeEach(() => {
    resetTimeoutManager();
  });

  it('should return same instance', () => {
    const m1 = getTimeoutManager();
    const m2 = getTimeoutManager();
    expect(m1).toBe(m2);
  });
});

describe('createTimeoutManager', () => {
  it('should create new instance', () => {
    const m = createTimeoutManager();
    expect(m).toBeDefined();
  });

  it('should allow custom config', () => {
    const m = createTimeoutManager({ defaultTimeout: 50000 });
    expect(m.getConfig().defaultTimeout).toBe(50000);
  });
});
