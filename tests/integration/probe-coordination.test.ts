import { describe, it, expect, vi } from 'vitest';

import { probeCoordinator } from '../../src/utils/probe-coordinator.js';

describe('Probe coordination - no concurrent probes', () => {
  it('should serialize concurrent probes on same server', async () => {
    const events: string[] = [];

    const probeA = vi.fn().mockImplementation(async () => {
      expect(probeCoordinator.tryAcquire('srv-1', 'llama3')).toBe(true);
      events.push('A-start');
      await new Promise(r => setTimeout(r, 100));
      events.push('A-end');
      probeCoordinator.release('srv-1', 'llama3');
    });

    const probeB = vi.fn().mockImplementation(async () => {
      if (!probeCoordinator.tryAcquire('srv-1', 'llama3')) {
        events.push('B-rejected');
        return;
      }
      events.push('B-start');
      probeCoordinator.release('srv-1', 'llama3');
    });

    await Promise.all([probeA(), probeB()]);

    expect(events).toContain('A-start');
    expect(events).toContain('A-end');
    expect(events).toContain('B-rejected');
  });
});
