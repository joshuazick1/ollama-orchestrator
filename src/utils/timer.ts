/**
 * timer.ts
 * High-precision timer utility for consistent duration tracking
 * Replaces scattered Date.now() calls throughout the codebase
 */

export interface TimerLap {
  name: string;
  elapsed: number;
  timestamp: number;
}

export class Timer {
  private startTime: number;
  private laps: Map<string, TimerLap> = new Map();
  private lastLapTime: number;

  constructor() {
    this.startTime = performance.now();
    this.lastLapTime = this.startTime;
  }

  /**
   * Get total elapsed time in milliseconds
   */
  elapsed(): number {
    return Math.round(performance.now() - this.startTime);
  }

  /**
   * Record a named lap time
   */
  lap(name: string): TimerLap {
    const now = performance.now();
    const lap: TimerLap = {
      name,
      elapsed: Math.round(now - this.startTime),
      timestamp: now,
    };
    this.laps.set(name, lap);
    this.lastLapTime = now;
    return lap;
  }

  /**
   * Get a specific lap's elapsed time
   */
  getLap(name: string): number | undefined {
    return this.laps.get(name)?.elapsed;
  }

  /**
   * Get all recorded laps
   */
  getAllLaps(): TimerLap[] {
    return Array.from(this.laps.values());
  }

  /**
   * Get time since last lap
   */
  sinceLastLap(): number {
    return Math.round(performance.now() - this.lastLapTime);
  }

  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = performance.now();
    this.lastLapTime = this.startTime;
    this.laps.clear();
  }
}

/**
 * Convenience function for one-off timing
 */
export function timed<T>(fn: () => T): { result: T; duration: number } {
  const timer = new Timer();
  const result = fn();
  return { result, duration: timer.elapsed() };
}

/**
 * Convenience function for async operations
 */
export async function timedAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const timer = new Timer();
  const result = await fn();
  return { result, duration: timer.elapsed() };
}
