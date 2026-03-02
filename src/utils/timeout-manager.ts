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

    const alpha = 0.3;
    state.currentTimeout = alpha * newTimeout + (1 - alpha) * state.currentTimeout;
    state.currentTimeout = Math.max(state.currentTimeout, this.config.minTimeout);
    state.lastUpdated = Date.now();
    state.consecutiveSuccesses++;
    state.consecutiveFailures = 0;

    logger.info(
      `Timeout updated for ${key}: ${state.currentTimeout}ms (${multiplier}x ${responseTimeMs}ms, isActiveTest: ${isActiveTest})`
    );
  }

  recordFailure(serverId: string, model: string, errorType?: string): void {
    const key = `${serverId}:${model}`;
    const state = this.timeouts.get(key);

    if (state && errorType === 'timeout') {
      state.currentTimeout = Math.min(state.currentTimeout * 1.5, this.config.maxTimeout);
      logger.info(`Timeout escalated for ${key}: ${state.currentTimeout}ms`);
    }

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

/**
 * Resolve the effective request timeout, honouring an optional `X-Request-Timeout`
 * header sent by the client.
 *
 * The header value (milliseconds as a decimal integer string) is clamped to
 * `[1, maxAllowedTimeoutMs]`.  If the header is absent or unparseable the
 * `orchestratorTimeoutMs` value (from TimeoutManager) is returned unchanged.
 *
 * @param headers         - Express-compatible headers object (req.headers)
 * @param orchestratorTimeoutMs - Timeout from TimeoutManager for this server:model
 * @param maxAllowedTimeoutMs   - Upper bound for client-supplied values (default: 600 000 ms)
 */
export function resolveRequestTimeout(
  headers: Record<string, string | string[] | undefined>,
  orchestratorTimeoutMs: number,
  maxAllowedTimeoutMs: number = DEFAULT_TIMEOUT_CONFIG.maxTimeout
): number {
  const headerValue = headers['x-request-timeout'];
  if (!headerValue) {
    return orchestratorTimeoutMs;
  }
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return orchestratorTimeoutMs;
  }
  return Math.min(parsed, maxAllowedTimeoutMs);
}
