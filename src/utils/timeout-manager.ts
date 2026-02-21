import { logger } from './logger.js';

export interface TimeoutConfig {
  defaultTimeout: number;
  minTimeout: number;
  maxTimeout: number;
  activeTestMultiplier: number;
  slowRequestMultiplier: number;
}

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  defaultTimeout: 120000,
  minTimeout: 15000,
  maxTimeout: 600000,
  activeTestMultiplier: 3,
  slowRequestMultiplier: 2,
};

export interface TimeoutState {
  lastUpdated: number;
  baseTimeout: number;
  currentTimeout: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface PersistedTimeoutData {
  timeouts: Record<string, Omit<TimeoutState, 'consecutiveFailures' | 'consecutiveSuccesses'>>;
  version: number;
}

let managerInstance: TimeoutManager | undefined;

export class TimeoutManager {
  private timeouts: Map<string, TimeoutState> = new Map();
  private config: TimeoutConfig;

  constructor(config?: Partial<TimeoutConfig>) {
    this.config = { ...DEFAULT_TIMEOUT_CONFIG, ...config };
  }

  getTimeout(serverId: string, model: string): number {
    const key = `${serverId}:${model}`;
    const state = this.timeouts.get(key);

    if (state) {
      return state.currentTimeout;
    }

    return this.config.defaultTimeout;
  }

  setTimeout(serverId: string, model: string, timeoutMs: number): void {
    const key = `${serverId}:${model}`;
    const clampedTimeout = Math.max(
      this.config.minTimeout,
      Math.min(this.config.maxTimeout, timeoutMs)
    );

    const state = this.timeouts.get(key);

    if (state) {
      state.currentTimeout = clampedTimeout;
      state.baseTimeout = clampedTimeout;
      state.lastUpdated = Date.now();
    } else {
      this.timeouts.set(key, {
        lastUpdated: Date.now(),
        baseTimeout: clampedTimeout,
        currentTimeout: clampedTimeout,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      });
    }

    logger.debug(`Timeout set for ${key}: ${clampedTimeout}ms`);
  }

  updateFromResponseTime(
    serverId: string,
    model: string,
    responseTimeMs: number,
    isActiveTest: boolean
  ): void {
    const key = `${serverId}:${model}`;
    let state = this.timeouts.get(key);

    if (!state) {
      state = {
        lastUpdated: Date.now(),
        baseTimeout: this.config.defaultTimeout,
        currentTimeout: this.config.defaultTimeout,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      };
      this.timeouts.set(key, state);
    }

    const multiplier = isActiveTest
      ? this.config.activeTestMultiplier
      : this.config.slowRequestMultiplier;

    const newTimeout = TimeoutManager.calculateAdaptiveTimeout(
      responseTimeMs,
      multiplier,
      this.config.minTimeout,
      this.config.maxTimeout
    );

    state.currentTimeout = Math.max(state.baseTimeout, newTimeout);
    state.lastUpdated = Date.now();
    state.consecutiveSuccesses++;
    state.consecutiveFailures = 0;

    logger.info(
      `Timeout updated for ${key}: ${state.currentTimeout}ms (${multiplier}x ${responseTimeMs}ms, isActiveTest: ${isActiveTest})`
    );
  }

  recordFailure(serverId: string, model: string): void {
    const key = `${serverId}:${model}`;
    const state = this.timeouts.get(key);

    if (state) {
      state.consecutiveFailures++;
      state.consecutiveSuccesses = 0;
    }
  }

  reset(serverId: string, model: string): void {
    const key = `${serverId}:${model}`;
    this.timeouts.delete(key);
    logger.debug(`Timeout reset for ${key}`);
  }

  clearAll(): void {
    this.timeouts.clear();
    logger.info('All timeouts cleared');
  }

  updateDefaultTimeout(newDefaultMs: number): void {
    this.config.defaultTimeout = newDefaultMs;

    for (const [, state] of this.timeouts) {
      if (state.currentTimeout === state.baseTimeout) {
        state.baseTimeout = newDefaultMs;
        state.currentTimeout = newDefaultMs;
      }
    }

    logger.info('TimeoutManager default updated', { newDefault: newDefaultMs });
  }

  static calculateAdaptiveTimeout(
    responseTimeMs: number,
    multiplier: number,
    minTimeout: number,
    maxTimeout: number
  ): number {
    return Math.max(minTimeout, Math.min(maxTimeout, Math.floor(responseTimeMs * multiplier)));
  }

  getTimeoutState(serverId: string, model: string): TimeoutState | undefined {
    return this.timeouts.get(`${serverId}:${model}`);
  }

  getAllTimeoutStates(): Map<string, TimeoutState> {
    return new Map(this.timeouts);
  }

  getConfig(): TimeoutConfig {
    return { ...this.config };
  }

  loadFromPersistedData(data: PersistedTimeoutData): void {
    if (!data.timeouts) {
      return;
    }

    for (const [key, savedState] of Object.entries(data.timeouts)) {
      this.timeouts.set(key, {
        ...savedState,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      });
    }

    logger.info(`Loaded ${Object.keys(data.timeouts).length} timeouts from persistence`);
  }

  toPersistedData(): PersistedTimeoutData {
    const timeouts: Record<
      string,
      Omit<TimeoutState, 'consecutiveFailures' | 'consecutiveSuccesses'>
    > = {};

    for (const [key, state] of this.timeouts) {
      timeouts[key] = {
        lastUpdated: state.lastUpdated,
        baseTimeout: state.baseTimeout,
        currentTimeout: state.currentTimeout,
      };
    }

    return {
      timeouts,
      version: 1,
    };
  }
}

export function getTimeoutManager(): TimeoutManager {
  if (!managerInstance) {
    managerInstance = new TimeoutManager();
  }
  return managerInstance;
}

export function resetTimeoutManager(): void {
  managerInstance = undefined;
}

export function createTimeoutManager(config?: Partial<TimeoutConfig>): TimeoutManager {
  return new TimeoutManager(config);
}
