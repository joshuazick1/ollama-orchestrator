import { describe, it, expect } from 'vitest';

import { InFlightManager } from '../../src/utils/in-flight-manager.js';

describe('InFlightManager - prevent negative counts', () => {
  it('should not create entry when decrementing non-existent key', () => {
    const mgr = new InFlightManager();
    mgr.decrementInFlight('srv-1', 'llama3');
    expect(mgr.getCount('srv-1', 'llama3')).toBe(0);
    expect(mgr.getTotalEntries()).toBe(0);
  });

  it('should not create entry after 100 spurious decrements', () => {
    const mgr = new InFlightManager();
    for (let i = 0; i < 100; i++) {
      mgr.decrementInFlight('srv-1', 'llama3');
    }
    expect(mgr.getTotalEntries()).toBe(0);
  });

  it('should handle concurrent decrement storm correctly', () => {
    const mgr = new InFlightManager();
    mgr.incrementInFlight('srv-1', 'model');
    for (let i = 0; i < 100; i++) {
      mgr.decrementInFlight('srv-1', 'model');
    }
    expect(mgr.getCount('srv-1', 'model')).toBe(0);
    expect(mgr.getCount('srv-1', 'model')).not.toBeLessThan(0);
  });
});
