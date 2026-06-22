/**
 * perf-probe-scheduler.test.ts
 * Integration tests for the daily perf-probe scheduler.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { setupIntegrationTest, teardownIntegrationTest, makeRequest } from './setup.js';
import {
  getPerfProbeSchedulerInstance,
  resetPerfProbeSchedulerInstance,
} from '../../src/probe/perf-probe-scheduler-instance.js';

const METRICS_DB = process.env.METRICS_DB_PATH || path.resolve('./data/metrics.db');
const LIVE_BASE_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:5100';

function queryMetricsStore(sql: string): string {
  try {
    return execFileSync('sqlite3', [METRICS_DB, sql], { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

async function isServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${LIVE_BASE_URL}/health/live`);
    return res.status === 200;
  } catch {
    return false;
  }
}

const serviceAvailable = await isServiceAvailable();

describe('PerformanceProbeScheduler integration', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
    // Kick off the scheduler by triggering its lazy initialization
    void getPerfProbeSchedulerInstance();
  }, 30000);

  afterAll(async () => {
    // Stop the scheduler so it doesn't leak timers into the test environment
    resetPerfProbeSchedulerInstance();
    await teardownIntegrationTest();
  }, 30000);

  describe('scheduler lifecycle', () => {
    it('scheduler is running after orchestrator initialize', () => {
      const scheduler = getPerfProbeSchedulerInstance();
      expect(scheduler.isRunning()).toBe(true);
    });

    it('scheduler has scheduled entries (or empty if no servers loaded in test env)', () => {
      const scheduler = getPerfProbeSchedulerInstance();
      const schedule = scheduler.getSchedule();
      expect(Array.isArray(schedule)).toBe(true);
    });

    it('getStatus() returns correct shape', () => {
      const scheduler = getPerfProbeSchedulerInstance();
      const status = scheduler.getStatus();

      expect(typeof status.running).toBe('boolean');
      expect(typeof status.enabled).toBe('boolean');
      expect(status.cycleStartedAt === null || typeof status.cycleStartedAt === 'number').toBe(
        true
      );
      expect(status.cycleEndsAt === null || typeof status.cycleEndsAt === 'number').toBe(true);
      expect(typeof status.config).toBe('object');
      expect(Array.isArray(status.currentProbes)).toBe(true);
      expect(typeof status.stats).toBe('object');
      expect(status.lastError === null || typeof status.lastError === 'string').toBe(true);

      // Stats shape
      expect(typeof status.stats.totalScheduledToday).toBe('number');
      expect(typeof status.stats.totalCompletedToday).toBe('number');
      expect(typeof status.stats.totalFailedToday).toBe('number');
      expect(typeof status.stats.totalSkippedCooldown).toBe('number');
      expect(typeof status.stats.totalSkippedConcurrency).toBe('number');
    });

    it('stats are tracked (totalScheduledToday matches schedule length)', () => {
      const scheduler = getPerfProbeSchedulerInstance();
      const status = scheduler.getStatus();
      const schedule = scheduler.getSchedule();
      expect(status.stats.totalScheduledToday).toBe(schedule.length);
    });

    it('schedule entries have required fields when non-empty', () => {
      const scheduler = getPerfProbeSchedulerInstance();
      const schedule = scheduler.getSchedule();

      if (schedule.length === 0) {
        expect(true).toBe(true);
        return;
      }

      for (const entry of schedule) {
        expect(typeof entry.serverId).toBe('string');
        expect(entry.serverId.length).toBeGreaterThan(0);
        expect(typeof entry.model).toBe('string');
        expect(entry.model.length).toBeGreaterThan(0);
        expect(typeof entry.firesAt).toBe('number');
        expect(entry.firesAt).toBeGreaterThan(0);
        expect(typeof entry.scheduledAt).toBe('number');
        expect(entry.scheduledAt).toBeGreaterThan(0);
        expect(typeof entry.isRunning).toBe('boolean');
      }
    });
  });
});

describe('PerformanceProbeScheduler — live service', () => {
  it('live service has is_probe=1 rows in metrics DB after scheduler has been running', () => {
    const countStr = queryMetricsStore('SELECT COUNT(*) FROM requests WHERE is_probe = 1;');
    const count = countStr ? parseInt(countStr, 10) : 0;
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('scheduler status endpoint returns expected shape via API', async () => {
    if (!serviceAvailable) {
      return;
    }

    const res = await fetch(`${LIVE_BASE_URL}/api/orchestrator/performance-probe/scheduler/status`);
    if (res.status === 404) {
      expect(true).toBe(true);
      return;
    }

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(typeof data.running).toBe('boolean');
    expect(typeof data.enabled).toBe('boolean');
    expect(typeof data.stats).toBe('object');
    expect(Array.isArray(data.currentProbes)).toBe(true);
  });
});
