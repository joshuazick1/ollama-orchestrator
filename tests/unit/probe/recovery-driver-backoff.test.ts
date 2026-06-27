import { describe, it, expect, beforeEach, vi } from 'vitest';

import { BackoffSchedule } from '../../../src/probe/recovery-driver.js';
import { DEFAULT_PROBE_CONFIG } from '../../../src/probe/types.js';
import type { Tuple } from '../../../src/probe/types.js';

const DEFAULT_SCHEDULE = DEFAULT_PROBE_CONFIG.recoveryBackoffMs;
const TUPLE: Tuple = { serverId: 'srv1', model: 'llama3', endpoint: 'ollama_chat' };
const TUPLE2: Tuple = { serverId: 'srv2', model: 'llama3', endpoint: 'ollama_chat' };

describe('BackoffSchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  // -------------------------------------------------------------------------
  // Test 1: getNextProbeTime with recoveryAttempts=0 returns now + 10000
  // -------------------------------------------------------------------------
  it('getNextProbeTime with recoveryAttempts=0 returns now + 10000', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const result = schedule.getNextProbeTime(TUPLE, 0);
    expect(result).toBe(10_000);
  });

  // -------------------------------------------------------------------------
  // Test 2: getNextProbeTime with recoveryAttempts=4 returns now + 900000
  // -------------------------------------------------------------------------
  it('getNextProbeTime with recoveryAttempts=4 returns now + 900000', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const result = schedule.getNextProbeTime(TUPLE, 4);
    expect(result).toBe(900_000);
  });

  // -------------------------------------------------------------------------
  // Test 3: getNextProbeTime with recoveryAttempts=5 returns now + 1800000
  //         (first exponential: max(1800000, 900000*2) = 1800000)
  // -------------------------------------------------------------------------
  it('getNextProbeTime with recoveryAttempts=5 returns now + 1800000 (first exponential)', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const result = schedule.getNextProbeTime(TUPLE, 5);
    expect(result).toBe(1_800_000);
  });

  // -------------------------------------------------------------------------
  // Test 4: getNextProbeTime with recoveryAttempts=6 returns now + 3600000
  //         (capped at 1h: max(3600000, 1800000*2) = 3600000)
  // -------------------------------------------------------------------------
  it('getNextProbeTime with recoveryAttempts=6 returns now + 3600000 (capped at 1h)', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const result = schedule.getNextProbeTime(TUPLE, 6);
    expect(result).toBe(3_600_000);
  });

  // -------------------------------------------------------------------------
  // Test 5: getNextProbeTime with recoveryAttempts=10 returns now + 3600000
  //         (still capped at 1h)
  // -------------------------------------------------------------------------
  it('getNextProbeTime with recoveryAttempts=10 returns now + 3600000 (still capped)', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    const result = schedule.getNextProbeTime(TUPLE, 10);
    expect(result).toBe(3_600_000);
  });

  // -------------------------------------------------------------------------
  // Test 6: recordRecoveryAttempt increments the counter
  // -------------------------------------------------------------------------
  it('recordRecoveryAttempt increments the counter', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(0);
    schedule.recordRecoveryAttempt(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(1);
    schedule.recordRecoveryAttempt(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Test 7: resetRecoveryAttempts sets counter to 0
  // -------------------------------------------------------------------------
  it('resetRecoveryAttempts sets counter to 0', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    schedule.recordRecoveryAttempt(TUPLE);
    schedule.recordRecoveryAttempt(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(2);
    schedule.resetRecoveryAttempts(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 8: Different tuples have independent counters
  // -------------------------------------------------------------------------
  it('Different tuples have independent counters', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    schedule.recordRecoveryAttempt(TUPLE);
    schedule.recordRecoveryAttempt(TUPLE);
    schedule.recordRecoveryAttempt(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(3);
    expect(schedule.getRecoveryAttempts(TUPLE2)).toBe(0);
    schedule.recordRecoveryAttempt(TUPLE2);
    expect(schedule.getRecoveryAttempts(TUPLE2)).toBe(1);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test 9: getRecoveryAttempts returns current count
  // -------------------------------------------------------------------------
  it('getRecoveryAttempts returns current count', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(0);
    schedule.recordRecoveryAttempt(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(1);
    schedule.recordRecoveryAttempt(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(2);
    schedule.recordRecoveryAttempt(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(3);
    schedule.recordRecoveryAttempt(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(4);
    schedule.recordRecoveryAttempt(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Test 10: After reset, next getNextProbeTime uses 10000 (not exponential)
  // -------------------------------------------------------------------------
  it('After reset, next getNextProbeTime uses 10000 (not exponential)', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    // Simulate many failed attempts to drive into exponential regime
    for (let i = 0; i < 10; i++) {
      schedule.recordRecoveryAttempt(TUPLE);
    }
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(10);
    // Next probe time would be capped at 1h
    const beforeReset = schedule.getNextProbeTime(TUPLE, 10);
    expect(beforeReset).toBe(3_600_000);

    schedule.resetRecoveryAttempts(TUPLE);
    expect(schedule.getRecoveryAttempts(TUPLE)).toBe(0);
    // After reset, back to the beginning of the schedule
    const afterReset = schedule.getNextProbeTime(TUPLE, 0);
    expect(afterReset).toBe(10_000);
  });

  // -------------------------------------------------------------------------
  // Additional: verify the full config schedule is used correctly
  // -------------------------------------------------------------------------
  it('uses full config schedule for attempts 0-4', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    expect(schedule.getNextProbeTime(TUPLE, 0)).toBe(DEFAULT_SCHEDULE[0]);
    expect(schedule.getNextProbeTime(TUPLE, 1)).toBe(DEFAULT_SCHEDULE[1]);
    expect(schedule.getNextProbeTime(TUPLE, 2)).toBe(DEFAULT_SCHEDULE[2]);
    expect(schedule.getNextProbeTime(TUPLE, 3)).toBe(DEFAULT_SCHEDULE[3]);
    expect(schedule.getNextProbeTime(TUPLE, 4)).toBe(DEFAULT_SCHEDULE[4]);
  });

  // -------------------------------------------------------------------------
  // Additional: verify exponential growth for attempts 5-6
  // -------------------------------------------------------------------------
  it('grows exponentially for attempts 5 and 6', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    // attempt 5: 900000 * 2 = 1800000
    expect(schedule.getNextProbeTime(TUPLE, 5)).toBe(1_800_000);
    // attempt 6: 1800000 * 2 = 3600000 (capped)
    expect(schedule.getNextProbeTime(TUPLE, 6)).toBe(3_600_000);
  });

  // -------------------------------------------------------------------------
  // Additional: verify cap holds for very high attempt counts
  // -------------------------------------------------------------------------
  it('remains capped at 1h for very high attempt counts', () => {
    const schedule = new BackoffSchedule(DEFAULT_PROBE_CONFIG);
    // attempts 7+ are all capped at 1h
    for (let attempts = 7; attempts <= 20; attempts++) {
      expect(schedule.getNextProbeTime(TUPLE, attempts)).toBe(3_600_000);
    }
  });
});
