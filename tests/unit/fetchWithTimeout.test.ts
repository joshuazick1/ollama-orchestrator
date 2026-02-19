import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWithTimeout,
  createActivityTimeoutController,
  createFetchWithTimeout,
} from '../../src/utils/fetchWithTimeout';

describe('fetchWithTimeout', () => {
  it('should resolve fetch without timeout', async () => {
    const mockResponse = { ok: true, status: 200 } as unknown as Response;
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const promise = fetchWithTimeout('http://localhost:3000/test');

    await expect(promise).resolves.toBe(mockResponse);
  });
});

describe('createActivityTimeoutController', () => {
  it('should create controller with abort signal', () => {
    const controller = createActivityTimeoutController(1000);

    expect(controller.controller).toBeDefined();
    expect(controller.controller.signal).toBeDefined();
    expect(typeof controller.resetTimeout).toBe('function');
    expect(typeof controller.clearTimeout).toBe('function');
  });

  it('should reset timeout when resetTimeout is called', () => {
    vi.useFakeTimers();

    const controller = createActivityTimeoutController(1000);

    const abortSpy = vi.spyOn(controller.controller, 'abort');

    vi.advanceTimersByTime(500);
    controller.resetTimeout();
    vi.advanceTimersByTime(500);

    expect(abortSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);

    expect(abortSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('should clear timeout when clearTimeout is called', () => {
    vi.useFakeTimers();

    const controller = createActivityTimeoutController(1000);

    const abortSpy = vi.spyOn(controller.controller, 'abort');

    vi.advanceTimersByTime(500);
    controller.clearTimeout();
    vi.advanceTimersByTime(2000);

    expect(abortSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('should abort after timeout without reset', () => {
    vi.useFakeTimers();

    const controller = createActivityTimeoutController(1000);

    vi.advanceTimersByTime(1500);

    expect(controller.controller.signal.aborted).toBe(true);

    vi.useRealTimers();
  });
});

describe('createFetchWithTimeout', () => {
  it('should return a function', () => {
    const fetchFn = createFetchWithTimeout(30000);
    expect(typeof fetchFn).toBe('function');
  });

  it('should create fetch function with custom default timeout', () => {
    const fetchFn = createFetchWithTimeout(5000);
    expect(fetchFn).toBeDefined();
  });

  it('should accept different timeout values', () => {
    const fetchFn1 = createFetchWithTimeout(1000);
    const fetchFn2 = createFetchWithTimeout(30000);
    const fetchFn3 = createFetchWithTimeout(60000);

    expect(fetchFn1).toBeDefined();
    expect(fetchFn2).toBeDefined();
    expect(fetchFn3).toBeDefined();
  });
});
