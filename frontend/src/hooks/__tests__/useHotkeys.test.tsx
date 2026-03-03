import { renderHook } from '@testing-library/react';
import { useHotkeys } from '../useHotkeys';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('useHotkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call the callback when the hotkey is pressed', () => {
    const callback = vi.fn();
    renderHook(() => useHotkeys('cmd+k, ctrl+k', callback));

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    });

    // Dispatch event on window
    window.dispatchEvent(event);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should not call the callback if disabled', () => {
    const callback = vi.fn();
    renderHook(() => useHotkeys('cmd+k', callback, { enabled: false }));

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    });

    window.dispatchEvent(event);

    expect(callback).not.toHaveBeenCalled();
  });

  it('should not call the callback if modifier is missing', () => {
    const callback = vi.fn();
    renderHook(() => useHotkeys('cmd+k', callback));

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: false, // missing cmd/meta
      bubbles: true,
    });

    window.dispatchEvent(event);

    expect(callback).not.toHaveBeenCalled();
  });

  it('should handle multiple modifiers', () => {
    const callback = vi.fn();
    renderHook(() => useHotkeys('shift+meta+k', callback));

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      shiftKey: true,
      metaKey: true,
      bubbles: true,
    });

    window.dispatchEvent(event);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
