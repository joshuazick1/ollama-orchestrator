/**
 * auto-tuner.ts
 * Per-(server, model) adaptive concurrency tuner.
 *
 * Stability-optimal policy:
 *   - slow raise (require `raiseAfter` consecutive good ticks within the raise band,
 *     then bump +1 with a 30s cooldown)
 *   - fast decay (any error or p95 above the upper hysteresis band → bump -1, no cooldown)
 *   - hysteresis band between raise/lower to avoid oscillation
 *
 * The tuner is intentionally pure in `observe()` and `tick()` — no I/O. File persistence
 * is opt-in via `saveToDisk()` / `loadFromDisk()` so the caller can throttle and so unit
 * tests can run `tick()` thousands of times without disk churn.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import type { ConcurrencyTunerConfig } from '../config/config.js';

import { modelMemoryFloor } from './model-memory-budget.js';
import { logger } from '../utils/logger.js';

export type AutoTunerMode = 'off' | 'local-adaptive' | 'hybrid';

export interface AutoTunerOptions {
  /** When set, `loadFromDisk()` reads + parses this path. */
  persistencePath?: string;
  /** Partial override of `ConcurrencyTunerConfig`. Missing fields fall back to defaults. */
  config?: Partial<ConcurrencyTunerConfig>;
}

export interface PairKey {
  serverId: string;
  model: string;
}

export interface PairTelemetry {
  serverId: string;
  model: string;
  currentCap: number;
  floor: number;
  ollamaCeiling: number;
  targetP95Ms: number;
  windowErrorCount: number;
  lastAdjustMs: number;
  lastAdjustReason: 'raise' | 'lower-error' | 'lower-p95' | null;
  windowP50: number;
  windowP95: number;
  windowCount: number;
}

export interface TickResult {
  raises: number;
  lowers: number;
  skipped: number;
}

export interface SerializedPair {
  serverId: string;
  model: string;
  currentCap: number;
  floor: number;
  ollamaCeiling: number;
  raiseAccumulator: number;
  lastAdjustMs: number;
  lastAdjustReason: 'raise' | 'lower-error' | 'lower-p95' | null;
}

export interface SerializedState {
  version: 1;
  mode: AutoTunerMode;
  pairs: SerializedPair[];
}

/**
 * Internal per-(server, model) state.
 *
 * `windowLatencyMs` is a simple ring buffer (Array<number> with push/shift).
 * It is intentionally private — never leaked via telemetry or serialization.
 */
interface PairState {
  serverId: string;
  model: string;
  currentCap: number;
  floor: number;
  ollamaCeiling: number;
  targetP95Ms: number;
  windowLatencyMs: number[];
  windowErrorCount: number;
  raiseAccumulator: number;
  lastAdjustMs: number;
  lastAdjustReason: 'raise' | 'lower-error' | 'lower-p95' | null;
}

const DEFAULT_HARD_FLOOR = 1;
const DEFAULT_HARD_CEILING = 32;

function pairKey(serverId: string, model: string): string {
  return `${serverId}::${model}`;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0]!;
  }
  const clamped = Math.min(1, Math.max(0, p));
  const rank = clamped * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sortedValues[lower]!;
  }
  const fraction = rank - lower;
  return sortedValues[lower]! + (sortedValues[upper]! - sortedValues[lower]!) * fraction;
}

function computeFloor(model: string, hardFloor: number): number {
  const memoryFloor = modelMemoryFloor(model);
  return Math.max(hardFloor, memoryFloor);
}

function computeCeiling(state: PairState, hardCeiling: number, ollamaMultiplier: number): number {
  const ollamaCeilingAdjusted =
    state.ollamaCeiling > 0 ? Math.floor(state.ollamaCeiling * ollamaMultiplier) : hardCeiling;
  return Math.max(1, Math.min(hardCeiling, ollamaCeilingAdjusted));
}

export class AutoTuner {
  private config: ConcurrencyTunerConfig;
  private mode: AutoTunerMode;
  private readonly persistencePath?: string;
  private readonly pairs: Map<string, PairState> = new Map();

  constructor(options: AutoTunerOptions = {}) {
    this.config = {
      enabled: true,
      mode: 'local-adaptive',
      targetP95Ms: 3000,
      raiseAfter: 5,
      raiseCooldownMs: 30000,
      lowerCooldownMs: 0,
      hysteresisRatio: 1.5,
      windowSize: 50,
      hardCeiling: DEFAULT_HARD_CEILING,
      hardFloor: DEFAULT_HARD_FLOOR,
      rolloutPercent: 100,
      ollamaCeilingMultiplier: 1.0,
      ...(options.config ?? {}),
    };
    this.mode = this.config.mode;
    if (options.persistencePath) {
      this.persistencePath = options.persistencePath;
    }
  }

  /**
   * Append a single observation to the ring buffer.
   *
   * Fast-decay on error: if `ok` is false, decrement `currentCap` immediately (clamped to
   * `floor`) and reset `raiseAccumulator`. This is the "fast decay" half of the policy —
   * the periodic `tick()` handles raise + p95-based lowers, but errors should bite now.
   */
  observe(serverId: string, model: string, latencyMs: number, ok: boolean): void {
    const key = pairKey(serverId, model);
    let state = this.pairs.get(key);
    if (!state) {
      state = this.createPairState(serverId, model);
      this.pairs.set(key, state);
    }

    // Clamp latency to a sane range — negative or NaN values would poison the percentile.
    const safeLatency =
      Number.isFinite(latencyMs) && latencyMs >= 0 ? Math.min(latencyMs, 600_000) : 0;
    state.windowLatencyMs.push(safeLatency);
    if (state.windowLatencyMs.length > this.config.windowSize) {
      state.windowLatencyMs.shift();
    }

    if (!ok) {
      state.windowErrorCount += 1;
      // Fast decay: any error drops the cap by 1 immediately (no cooldown). Reset raise
      // accumulator so we don't immediately re-raise on the next good sample.
      state.raiseAccumulator = 0;
      if (state.currentCap > state.floor) {
        state.currentCap -= 1;
        state.lastAdjustMs = Date.now();
        state.lastAdjustReason = 'lower-error';
        logger.debug('[AutoTuner] Fast-decay on error', {
          serverId,
          model,
          currentCap: state.currentCap,
          floor: state.floor,
        });
      }
    }
  }

  /**
   * Periodic adjustment — called every ~10s by the orchestrator.
   *
   * Returns `{ raises, lowers, skipped }` for logging. Pure function: no I/O.
   */
  tick(now: number = Date.now()): TickResult {
    if (this.mode === 'off' || !this.config.enabled) {
      return { raises: 0, lowers: 0, skipped: this.pairs.size };
    }

    const raiseThreshold = this.config.targetP95Ms * 0.7;
    const lowerThreshold = this.config.targetP95Ms * this.config.hysteresisRatio;

    let raises = 0;
    let lowers = 0;
    let skipped = 0;

    for (const state of this.pairs.values()) {
      const windowCount = state.windowLatencyMs.length;
      if (windowCount === 0) {
        skipped += 1;
        continue;
      }

      // p95 over the current window. Snapshot + sort to avoid mutating the buffer order.
      const sortedLatency = [...state.windowLatencyMs].sort((a, b) => a - b);
      const p95 = percentile(sortedLatency, 0.95);

      const erroredThisWindow = state.windowErrorCount > 0;
      const sinceLastAdjust = now - state.lastAdjustMs;

      // LOWER band: p95 above the hysteresis ratio OR any error in the window.
      if (p95 > lowerThreshold || erroredThisWindow) {
        if (sinceLastAdjust >= this.config.lowerCooldownMs && state.currentCap > state.floor) {
          state.currentCap -= 1;
          state.lastAdjustMs = now;
          state.lastAdjustReason = erroredThisWindow ? 'lower-error' : 'lower-p95';
          state.raiseAccumulator = 0;
          lowers += 1;
          continue;
        }
        // Even if cooldown blocks a change, clear the accumulator so a single bad tick
        // doesn't burn through raise credits.
        state.raiseAccumulator = 0;
        continue;
      }

      // RAISE band: p95 well below target AND no errors AND enough consecutive good ticks.
      if (p95 < raiseThreshold && !erroredThisWindow) {
        state.raiseAccumulator += 1;
        const ceiling = computeCeiling(state, this.config.hardCeiling, this.config.ollamaCeilingMultiplier);
        if (
          state.raiseAccumulator >= this.config.raiseAfter &&
          sinceLastAdjust >= this.config.raiseCooldownMs &&
          state.currentCap < ceiling
        ) {
          state.currentCap += 1;
          state.lastAdjustMs = now;
          state.lastAdjustReason = 'raise';
          state.raiseAccumulator = 0;
          raises += 1;
          continue;
        }
        continue;
      }

      // NO-OP band: p95 ∈ [raiseThreshold, lowerThreshold]. Clear accumulator so an extended
      // no-op window doesn't cumulate raise credits that fire the moment we re-enter the
      // raise band on the next tick.
      state.raiseAccumulator = 0;
    }

    return { raises, lowers, skipped };
  }

  /**
   * Returns the effective concurrency cap for a (server, model) pair:
   *   min(learnedCap, ollamaCeiling * multiplier, serverMaxConcurrency)
   *
   * `serverMaxConcurrency` defaults to `Infinity` so callers that don't have a server
   * config handy (e.g. unit tests) can still call this method.
   */
  effectiveCap(serverId: string, model: string, serverMaxConcurrency: number = Infinity): number {
    const key = pairKey(serverId, model);
    const state = this.pairs.get(key);
    if (!state) {
      // No observations yet — fall back to the floor so we never overshoot a model we
      // haven't profiled.
      return computeFloor(model, this.config.hardFloor);
    }
    const ceiling = Math.min(
      computeCeiling(state, this.config.hardCeiling, this.config.ollamaCeilingMultiplier),
      serverMaxConcurrency
    );
    return Math.max(state.floor, Math.min(state.currentCap, ceiling));
  }

  setMode(mode: AutoTunerMode): void {
    if (this.mode === mode) {
      return;
    }
    logger.info('[AutoTuner] Mode change', { from: this.mode, to: mode });
    this.mode = mode;
  }

  updateConfig(partial: Partial<ConcurrencyTunerConfig>): void {
    const before = { ...this.config };
    this.config = { ...this.config, ...partial };
    const changed = (Object.keys(partial) as (keyof ConcurrencyTunerConfig)[]).filter(
      k => before[k] !== this.config[k]
    );
    if (changed.length > 0) {
      logger.info('[AutoTuner] Config updated', { changed, before, after: this.config });
    }
    if (this.config.targetP95Ms !== before.targetP95Ms) {
      for (const state of this.pairs.values()) {
        state.targetP95Ms = this.config.targetP95Ms;
      }
    }
  }

  getMode(): AutoTunerMode {
    return this.mode;
  }

  reset(): void {
    this.pairs.clear();
    logger.info('[AutoTuner] Reset — all pair state cleared');
  }

  /**
   * Seed `ollamaCeiling` from `/api/ps` response (`num_parallel`).
   * Idempotent — newer values overwrite older ones.
   */
  seedFromOllama(serverId: string, model: string, numParallel: number): void {
    const safeNum = Number.isFinite(numParallel) && numParallel > 0 ? Math.floor(numParallel) : 0;
    const key = pairKey(serverId, model);
    let state = this.pairs.get(key);
    if (!state) {
      state = this.createPairState(serverId, model);
      this.pairs.set(key, state);
    }
    if (state.ollamaCeiling === safeNum) {
      return;
    }
    state.ollamaCeiling = safeNum;
    // If we just learned the ceiling is lower than our current cap, clamp immediately so
    // we don't keep admitting requests above what the server can actually run.
    const ceiling = computeCeiling(state, this.config.hardCeiling, this.config.ollamaCeilingMultiplier);
    if (state.currentCap > ceiling) {
      logger.debug('[AutoTuner] Clamping cap to ollamaCeiling', {
        serverId,
        model,
        from: state.currentCap,
        to: ceiling,
        ollamaCeiling: safeNum,
      });
      state.currentCap = ceiling;
      state.lastAdjustReason = 'lower-p95';
      state.lastAdjustMs = Date.now();
    }
  }

  /**
   * Sanitized snapshot for the controller / telemetry endpoint.
   * MUST NOT include the raw ring buffer.
   */
  getStateForTelemetry(): PairTelemetry[] {
    const out: PairTelemetry[] = [];
    for (const state of this.pairs.values()) {
      const windowCount = state.windowLatencyMs.length;
      let windowP50 = 0;
      let windowP95 = 0;
      if (windowCount > 0) {
        const sortedLatency = [...state.windowLatencyMs].sort((a, b) => a - b);
        windowP50 = percentile(sortedLatency, 0.5);
        windowP95 = percentile(sortedLatency, 0.95);
      }
      out.push({
        serverId: state.serverId,
        model: state.model,
        currentCap: state.currentCap,
        floor: state.floor,
        ollamaCeiling: state.ollamaCeiling,
        targetP95Ms: state.targetP95Ms,
        windowErrorCount: state.windowErrorCount,
        lastAdjustMs: state.lastAdjustMs,
        lastAdjustReason: state.lastAdjustReason,
        windowP50,
        windowP95,
        windowCount,
      });
    }
    return out;
  }

  serialize(): SerializedState {
    const pairs: SerializedPair[] = [];
    for (const state of this.pairs.values()) {
      pairs.push({
        serverId: state.serverId,
        model: state.model,
        currentCap: state.currentCap,
        floor: state.floor,
        ollamaCeiling: state.ollamaCeiling,
        raiseAccumulator: state.raiseAccumulator,
        lastAdjustMs: state.lastAdjustMs,
        lastAdjustReason: state.lastAdjustReason,
      });
    }
    return {
      version: 1,
      mode: this.mode,
      pairs,
    };
  }

  /**
   * Restore state from a `SerializedState`. Replaces all in-memory pair state.
   * The windowed latency data is intentionally NOT restored — warm-restart picks up fresh
   * observations from the first request after boot, and persisting raw latency samples
   * would balloon the JSON file with negligible benefit.
   */
  loadState(state: SerializedState): void {
    if (!state || state.version !== 1) {
      logger.warn('[AutoTuner] Refusing to load state — unsupported version', {
        gotVersion: state?.version,
      });
      return;
    }
    this.pairs.clear();
    this.mode = state.mode;
    for (const persisted of state.pairs) {
      const key = pairKey(persisted.serverId, persisted.model);
      const next: PairState = {
        serverId: persisted.serverId,
        model: persisted.model,
        currentCap: persisted.currentCap,
        floor: persisted.floor,
        ollamaCeiling: persisted.ollamaCeiling,
        targetP95Ms: this.config.targetP95Ms,
        windowLatencyMs: [],
        windowErrorCount: 0,
        raiseAccumulator: persisted.raiseAccumulator,
        lastAdjustMs: persisted.lastAdjustMs,
        lastAdjustReason: persisted.lastAdjustReason,
      };
      this.pairs.set(key, next);
    }
    logger.info('[AutoTuner] Loaded persisted state', { pairs: state.pairs.length, mode: this.mode });
  }

  /**
   * Write the serialized state to disk. Safe to call concurrently because Node's
   * `writeFile` is atomic on POSIX within a filesystem (no partial reads).
   */
  async saveToDisk(path?: string): Promise<string> {
    const target = path ?? this.persistencePath;
    if (!target) {
      throw new Error('[AutoTuner] saveToDisk() called without a persistencePath');
    }
    const dir = dirname(target);
    await mkdir(dir, { recursive: true });
    const json = JSON.stringify(this.serialize(), null, 2);
    await writeFile(target, json, 'utf8');
    return target;
  }

  /**
   * Read and apply state from disk. No-op if the file does not exist (fresh boot).
   */
  async loadFromDisk(path?: string): Promise<boolean> {
    const target = path ?? this.persistencePath;
    if (!target) {
      throw new Error('[AutoTuner] loadFromDisk() called without a persistencePath');
    }
    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        logger.debug('[AutoTuner] No persisted state on disk — starting fresh', { path: target });
        return false;
      }
      throw err;
    }
    const parsed = JSON.parse(raw) as SerializedState;
    this.loadState(parsed);
    return true;
  }

  /** Convenience: default persistence path under `data/`. */
  static defaultPersistencePath(dataDir: string = './data'): string {
    return join(dataDir, 'concurrency-state.json');
  }

  // --- internal helpers --------------------------------------------------

  private createPairState(serverId: string, model: string): PairState {
    const floor = computeFloor(model, this.config.hardFloor);
    return {
      serverId,
      model,
      currentCap: floor,
      floor,
      ollamaCeiling: 0,
      targetP95Ms: this.config.targetP95Ms,
      windowLatencyMs: [],
      windowErrorCount: 0,
      raiseAccumulator: 0,
      lastAdjustMs: 0,
      lastAdjustReason: null,
    };
  }
}

/**
 * Module-level singleton accessor. The orchestrator owns the long-lived
 * AutoTuner instance via this accessor; controllers can read it without
 * holding a direct reference.
 */
let sharedInstance: AutoTuner | null = null;

export function getAutoTuner(options?: AutoTunerOptions): AutoTuner {
  if (!sharedInstance) {
    sharedInstance = new AutoTuner(options);
  }
  return sharedInstance;
}

export function resetAutoTuner(): void {
  sharedInstance = null;
}
