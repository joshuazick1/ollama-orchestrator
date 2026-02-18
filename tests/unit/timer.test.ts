/**
 * timer.test.ts
 * Tests for Timer utility class
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Timer, timed, timedAsync } from '../../src/utils/timer.js';

describe('Timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with current time', () => {
      vi.advanceTimersByTime(100);
      const timer = new Timer();
      expect(timer.elapsed()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('elapsed', () => {
    it('should return elapsed time in milliseconds', () => {
      const timer = new Timer();
      vi.advanceTimersByTime(100);
      const elapsed = timer.elapsed();
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });
  });

  describe('lap', () => {
    it('should record a lap with name and elapsed time', () => {
      const timer = new Timer();
      vi.advanceTimersByTime(50);

      const lap = timer.lap('test-lap');

      expect(lap.name).toBe('test-lap');
      expect(lap.elapsed).toBeGreaterThanOrEqual(50);
      expect(lap.timestamp).toBeGreaterThan(0);
    });

    it('should store lap for later retrieval', () => {
      const timer = new Timer();
      timer.lap('first');

      const result = timer.getLap('first');
      expect(result).toBeDefined();
    });
  });

  describe('getLap', () => {
    it('should return undefined for non-existent lap', () => {
      const timer = new Timer();
      const result = timer.getLap('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return elapsed time for existing lap', () => {
      const timer = new Timer();
      vi.advanceTimersByTime(100);
      timer.lap('test');

      const result = timer.getLap('test');
      expect(result).toBeGreaterThanOrEqual(100);
    });
  });

  describe('getAllLaps', () => {
    it('should return all recorded laps', () => {
      const timer = new Timer();
      timer.lap('lap1');
      timer.lap('lap2');

      const laps = timer.getAllLaps();
      expect(laps).toHaveLength(2);
    });
  });

  describe('sinceLastLap', () => {
    it('should return time since last lap', () => {
      const timer = new Timer();
      timer.lap('first');
      vi.advanceTimersByTime(100);

      const result = timer.sinceLastLap();
      expect(result).toBeGreaterThanOrEqual(100);
    });
  });

  describe('reset', () => {
    it('should reset all timer state', () => {
      const timer = new Timer();
      vi.advanceTimersByTime(100);
      timer.lap('test');
      timer.reset();

      expect(timer.getAllLaps()).toHaveLength(0);
      expect(timer.elapsed()).toBeLessThan(10);
    });
  });
});

describe('timed', () => {
  it('should return result and duration', () => {
    const { result, duration } = timed(() => 42);
    expect(result).toBe(42);
    expect(duration).toBeGreaterThanOrEqual(0);
  });
});

describe('timedAsync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return result and duration for async function', async () => {
    const promise = timedAsync(async () => {
      vi.advanceTimersByTime(50);
      return 'done';
    });

    vi.advanceTimersByTime(50);
    const result = await promise;

    expect(result.result).toBe('done');
    expect(result.duration).toBeGreaterThanOrEqual(50);
  });
});
