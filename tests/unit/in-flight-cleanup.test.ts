import { describe, it, expect, beforeEach } from 'vitest';

import { InFlightManager } from '../../src/utils/in-flight-manager.js';

describe('InFlightManager.cleanupInFlightTracking (B22 fix)', () => {
  let manager: InFlightManager;

  beforeEach(() => {
    manager = new InFlightManager();
  });

  it('decrements in-flight and removes streaming request for a known request id', () => {
    manager.incrementInFlight('server-1', 'llama3:8b');
    manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');

    const result = manager.cleanupInFlightTracking('server-1', 'llama3:8b', 'req-1');

    expect(result.inFlightDecremented).toBe(true);
    expect(result.streamingRequestRemoved).toBe(true);
    expect(result.upstreamAborted).toBe(false);
    expect(result.alreadyCleaned).toBe(false);
    expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
    expect(manager.getStreamingRequestProgress('req-1')).toBeUndefined();
  });

  it('is idempotent: second call is a no-op for the same request id', () => {
    manager.incrementInFlight('server-1', 'llama3:8b');
    manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');

    const first = manager.cleanupInFlightTracking('server-1', 'llama3:8b', 'req-1');
    const second = manager.cleanupInFlightTracking('server-1', 'llama3:8b', 'req-1');

    expect(first.inFlightDecremented).toBe(true);
    expect(first.streamingRequestRemoved).toBe(true);
    expect(second.alreadyCleaned).toBe(true);
    expect(second.inFlightDecremented).toBe(false);
    expect(second.streamingRequestRemoved).toBe(false);
    expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
  });

  it('decrements in-flight even when no streaming request was registered', () => {
    manager.incrementInFlight('server-1', 'llama3:8b');

    const result = manager.cleanupInFlightTracking('server-1', 'llama3:8b');

    expect(result.inFlightDecremented).toBe(true);
    expect(result.streamingRequestRemoved).toBe(false);
    expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
  });

  it('does not underflow when in-flight count is already 0', () => {
    manager.cleanupInFlightTracking('server-1', 'llama3:8b', 'req-missing');
    expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
  });

  it('aborts the upstream AbortController exactly once', () => {
    const controller = new AbortController();
    manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');

    const first = manager.cleanupInFlightTracking('server-1', 'llama3:8b', 'req-1', controller);
    const second = manager.cleanupInFlightTracking('server-1', 'llama3:8b', 'req-1', controller);

    expect(first.upstreamAborted).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(second.upstreamAborted).toBe(false);
    expect(second.alreadyCleaned).toBe(true);
  });

  it('cleans up the bypass in-flight bucket when used', () => {
    manager.incrementInFlight('server-1', 'llama3:8b', true);
    manager.addStreamingRequest('req-bypass', 'server-1', 'llama3:8b');

    manager.cleanupInFlightTracking('server-1', 'llama3:8b', 'req-bypass');

    expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
  });

  it('handles 10 concurrent streaming disconnects without leaking', () => {
    for (let i = 0; i < 10; i++) {
      manager.incrementInFlight('server-1', 'llama3:8b');
      manager.addStreamingRequest(`req-${i}`, 'server-1', 'llama3:8b');
    }
    expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(10);

    for (let i = 0; i < 10; i++) {
      manager.cleanupInFlightTracking('server-1', 'llama3:8b', `req-${i}`);
    }

    expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
    expect(manager.getAllStreamingRequests()).toHaveLength(0);
  });

  it('increments the client_disconnect counter for cleanupInFlightTracking', () => {
    manager.incrementInFlight('server-1', 'llama3:8b');
    manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');

    manager.cleanupInFlightTracking(
      'server-1',
      'llama3:8b',
      'req-1',
      undefined,
      'client_disconnect'
    );

    const stats = manager.getCleanupStats();
    expect(stats.cleanupsByReason['client_disconnect']).toBe(1);
  });

  it('cleanupStaleStreamingRequests decrements in-flight and counts as leaks prevented', () => {
    manager.incrementInFlight('server-1', 'llama3:8b');
    manager.addStreamingRequest('req-stale', 'server-1', 'llama3:8b');

    const entry = manager.getStreamingRequestProgress('req-stale');
    if (entry) {
      entry.startTime = Date.now() - 11 * 60 * 1000;
    }

    const swept = manager.cleanupStaleStreamingRequests(10 * 60 * 1000);

    expect(swept).toBe(1);
    expect(manager.getInFlight('server-1', 'llama3:8b')).toBe(0);
    const stats = manager.getCleanupStats();
    expect(stats.leaksPrevented).toBe(1);
    expect(stats.cleanupsByReason['stale_sweep']).toBe(1);
  });

  it('removeStreamingRequest still bumps normal_completion counter (existing path)', () => {
    manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');
    manager.removeStreamingRequest('req-1');

    const stats = manager.getCleanupStats();
    expect(stats.cleanupsByReason['normal_completion']).toBe(1);
  });

  it('clear() resets all cleanup counters', () => {
    manager.incrementInFlight('server-1', 'llama3:8b');
    manager.addStreamingRequest('req-1', 'server-1', 'llama3:8b');
    manager.cleanupInFlightTracking('server-1', 'llama3:8b', 'req-1');
    manager.recordLeakPrevented(3);

    manager.clear();

    const stats = manager.getCleanupStats();
    expect(stats.cleanupsByReason['client_disconnect']).toBe(0);
    expect(stats.cleanupsByReason['normal_completion']).toBe(0);
    expect(stats.cleanupsByReason['stale_sweep']).toBe(0);
    expect(stats.leaksPrevented).toBe(0);
  });
});
