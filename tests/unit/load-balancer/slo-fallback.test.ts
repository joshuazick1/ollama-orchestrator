import { describe, it, expect, beforeEach, vi } from 'vitest';

import { SLOFallbackMonitor } from '../../../src/load-balancer/slo-fallback.js';

describe('SLOFallbackMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('enters fallback mode when threshold exceeded for window duration', () => {
    const monitor = new SLOFallbackMonitor({
      enabled: true,
      ttftThresholdMs: 2000,
      p95WindowMs: 60000,
    });

    expect(monitor.getMode()).toBe('normal');

    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(6000);
      monitor.update({ server1: 2500, server2: 3000 });
    }

    expect(monitor.getMode()).toBe('fallback');
    expect(monitor.isActive()).toBe(true);
  });

  it('exits fallback mode when threshold restored', () => {
    const monitor = new SLOFallbackMonitor({
      enabled: true,
      ttftThresholdMs: 2000,
      p95WindowMs: 60000,
    });

    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(6000);
      monitor.update({ server1: 2500, server2: 3000 });
    }
    expect(monitor.getMode()).toBe('fallback');

    vi.advanceTimersByTime(120000);

    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(6000);
      monitor.update({ server1: 500, server2: 600 });
    }
    expect(monitor.getMode()).toBe('normal');
    expect(monitor.isActive()).toBe(false);
  });

  it('does not flap mode when entries mix above and below threshold', () => {
    const monitor = new SLOFallbackMonitor({
      enabled: true,
      ttftThresholdMs: 2000,
      p95WindowMs: 60000,
    });

    const values = [2500, 2600, 1500, 2700, 1800, 2400, 2100, 1900, 2300, 2200];
    for (const v of values) {
      vi.advanceTimersByTime(6000);
      monitor.update({ server1: v });
    }

    expect(monitor.getMode()).toBe('normal');
    expect(monitor.isActive()).toBe(false);
  });
});
