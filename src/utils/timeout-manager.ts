import { logger } from './logger.js';
import { recordTimeoutAdapted } from './timeout-telemetry.js';

export interface TimeoutConfig {
  defaultTimeout: number;
  minTimeout: number;
  maxTimeout: number;
  recoveryTestMultiplier: number;
  normalRequestMultiplier: number;
  decayRatePerMs: number;
}

const DEFAULT_DECAY_RATE_PER_MS = 1 - Math.pow(0.95, 1 / (5 * 60 * 1000));

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  defaultTimeout: 120000,
  minTimeout: 15000,
  maxTimeout: 600000,
  recoveryTestMultiplier: 3,
  normalRequestMultiplier: 2,
  decayRatePerMs: DEFAULT_DECAY_RATE_PER_MS,
};

export interface TimeoutState {
  lastUpdated: number;
  baseTimeout: number;
  currentTimeout: number;
}

export interface PersistedTimeoutData {
  timeouts: Record<string, TimeoutState>;
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
      };
      this.timeouts.set(key, state);
    }

    const multiplier = isActiveTest
      ? this.config.recoveryTestMultiplier
      : this.config.normalRequestMultiplier;

    const newTimeout = TimeoutManager.calculateAdaptiveTimeout(
      responseTimeMs,
      multiplier,
      this.config.minTimeout,
      this.config.maxTimeout
    );

    const alpha = 0.3;
    const previousTimeout = state.currentTimeout;
    state.currentTimeout = alpha * newTimeout + (1 - alpha) * state.currentTimeout;
    state.currentTimeout = Math.max(state.currentTimeout, this.config.minTimeout);
    state.lastUpdated = Date.now();

    logger.info(
      `Timeout updated for ${key}: ${state.currentTimeout}ms (${multiplier}x ${responseTimeMs}ms, isActiveTest: ${isActiveTest})`
    );

    recordTimeoutAdapted({
      serverId,
      model,
      previousTimeoutMs: previousTimeout,
      newTimeoutMs: state.currentTimeout,
      baseTimeoutMs: state.baseTimeout,
      trigger: 'response_time',
      observedResponseTimeMs: responseTimeMs,
      isActiveTest,
      multiplier,
    });
  }

  recordFailure(serverId: string, model: string, errorType?: string): void {
    const key = `${serverId}:${model}`;
    let state = this.timeouts.get(key);

    if (!state) {
      state = {
        lastUpdated: Date.now(),
        baseTimeout: this.config.defaultTimeout,
        currentTimeout: this.config.defaultTimeout,
      };
      this.timeouts.set(key, state);
    }

    if (errorType === 'timeout') {
      const previousTimeout = state.currentTimeout;
      state.currentTimeout = Math.min(state.currentTimeout * 1.5, this.config.maxTimeout);
      logger.info(`Timeout escalated for ${key}: ${state.currentTimeout}ms`);
      recordTimeoutAdapted({
        serverId,
        model,
        previousTimeoutMs: previousTimeout,
        newTimeoutMs: state.currentTimeout,
        baseTimeoutMs: state.baseTimeout,
        trigger: 'failure_escalation',
        isActiveTest: false,
        multiplier: 1.5,
      });
    }
  }

  recordActiveTestTimeout(serverId: string, model: string, testTimeoutMs: number): void {
    const key = `${serverId}:${model}`;
    const state = this.timeouts.get(key);

    if (!state) {
      return;
    }

    logger.debug(
      `Active test timeout for ${key}: ${testTimeoutMs}ms - not escalating adaptive timeout`
    );
    recordTimeoutAdapted({
      serverId,
      model,
      previousTimeoutMs: state.currentTimeout,
      newTimeoutMs: state.currentTimeout,
      baseTimeoutMs: state.baseTimeout,
      trigger: 'active_test_timeout',
      isActiveTest: true,
      multiplier: 1,
    });
  }

  resetAfterIdle(serverId: string, model: string, idleThresholdMs: number = 600000): void {
    const key = `${serverId}:${model}`;
    const state = this.timeouts.get(key);

    if (
      state &&
      Date.now() - state.lastUpdated > idleThresholdMs &&
      state.currentTimeout > state.baseTimeout
    ) {
      const previousTimeout = state.currentTimeout;
      state.currentTimeout = state.baseTimeout;
      state.lastUpdated = Date.now();

      logger.info(
        `Timeout reset after idle for ${key}: ${previousTimeout}ms → ${state.baseTimeout}ms`
      );
      recordTimeoutAdapted({
        serverId,
        model,
        previousTimeoutMs: previousTimeout,
        newTimeoutMs: state.baseTimeout,
        baseTimeoutMs: state.baseTimeout,
        trigger: 'idle_reset',
        isActiveTest: false,
        multiplier: 1,
      });
    }
  }

  resetAllAfterIdle(idleThresholdMs: number = 600000): void {
    const keysToProcess = Array.from(this.timeouts.keys());
    for (const key of keysToProcess) {
      const [serverId, model] = key.split(':');
      this.resetAfterIdle(serverId, model, idleThresholdMs);
    }
  }

  reset(serverId: string, model?: string): void {
    if (model) {
      const key = `${serverId}:${model}`;
      this.timeouts.delete(key);
      logger.debug(`Timeout reset for ${key}`);
    } else {
      const keysToDelete: string[] = [];
      for (const key of this.timeouts.keys()) {
        if (key.startsWith(`${serverId}:`)) {
          keysToDelete.push(key);
        }
      }
      for (const key of keysToDelete) {
        this.timeouts.delete(key);
      }
      logger.debug(
        `Timeout reset for all models on server ${serverId} (${keysToDelete.length} entries)`
      );
    }
  }

  clearAll(): void {
    this.timeouts.clear();
    logger.info('All timeouts cleared');
  }

  /**
   * Apply exponential decay toward baseTimeout for all tracked states.
   * Call on a periodic timer (e.g. every 5 minutes).
   * Decay amount is proportional to elapsed time since lastUpdated so that
   * calling more or less frequently produces the same steady-state behaviour.
   */
  applyDecay(): void {
    if (this.config.decayRatePerMs === 0) {
      return;
    }

    const now = Date.now();

    for (const [key, state] of this.timeouts) {
      if (state.currentTimeout <= state.baseTimeout) {
        continue;
      }

      const elapsedMs = now - state.lastUpdated;
      const decayFactor = Math.pow(1 - this.config.decayRatePerMs, elapsedMs);
      const decayed = state.baseTimeout + (state.currentTimeout - state.baseTimeout) * decayFactor;
      const previousTimeout = state.currentTimeout;
      state.currentTimeout = Math.max(state.baseTimeout, decayed);
      state.lastUpdated = now;

      logger.debug(`Timeout decayed for ${key}: ${Math.round(state.currentTimeout)}ms`);

      const [decayServerId, decayModel] = key.split(':');
      recordTimeoutAdapted({
        serverId: decayServerId,
        model: decayModel,
        previousTimeoutMs: previousTimeout,
        newTimeoutMs: state.currentTimeout,
        baseTimeoutMs: state.baseTimeout,
        trigger: 'decay',
        isActiveTest: false,
        multiplier: 1,
      });
    }
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
    recordTimeoutAdapted({
      serverId: '*',
      model: '*',
      previousTimeoutMs: 0,
      newTimeoutMs: newDefaultMs,
      baseTimeoutMs: newDefaultMs,
      trigger: 'default_update',
      isActiveTest: false,
      multiplier: 1,
    });
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
      this.timeouts.set(key, { ...savedState });
    }

    logger.info(`Loaded ${Object.keys(data.timeouts).length} timeouts from persistence`);
  }

  toPersistedData(): PersistedTimeoutData {
    const timeouts: Record<string, TimeoutState> = {};

    for (const [key, state] of this.timeouts) {
      timeouts[key] = { ...state };
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
