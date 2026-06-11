import { describe, it, expect } from 'vitest';

import { ProbeCoordinator } from '../../src/utils/probe-coordinator.js';

describe('ProbeCoordinator - mutex behavior', () => {
  it('should allow first tryAcquire to succeed', () => {
    const coord = new ProbeCoordinator();
    expect(coord.tryAcquire('srv-1')).toBe(true);
  });

  it('should reject second tryAcquire while held', () => {
    const coord = new ProbeCoordinator();
    coord.tryAcquire('srv-1');
    expect(coord.tryAcquire('srv-1')).toBe(false);
  });

  it('should allow tryAcquire after release', () => {
    const coord = new ProbeCoordinator();
    coord.tryAcquire('srv-1');
    coord.release('srv-1');
    expect(coord.tryAcquire('srv-1')).toBe(true);
  });

  it('should distinguish by model', () => {
    const coord = new ProbeCoordinator();
    expect(coord.tryAcquire('srv-1', 'llama3')).toBe(true);
    expect(coord.tryAcquire('srv-1', 'mistral')).toBe(true);
  });
});
