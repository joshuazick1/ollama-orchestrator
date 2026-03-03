import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../useWebSocket';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('useWebSocket', () => {
  let wsMock: any;
  let originalWebSocket: any;

  beforeEach(() => {
    vi.useFakeTimers();

    wsMock = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 0, // CONNECTING
    };

    class MockWebSocket {
      url: string;
      onopen: any;
      onmessage: any;
      onerror: any;
      onclose: any;
      send = wsMock.send;
      close = wsMock.close;
      get readyState() {
        return wsMock.readyState;
      }
      constructor(url: string) {
        this.url = url;
        wsMock.onopen = (...args: any[]) => this.onopen?.(...args);
        wsMock.onmessage = (...args: any[]) => this.onmessage?.(...args);
        wsMock.onerror = (...args: any[]) => this.onerror?.(...args);
        wsMock.onclose = (...args: any[]) => this.onclose?.(...args);
        mockConstructor(url);
      }
    }

    const mockConstructor = vi.fn();
    (MockWebSocket as any).CONNECTING = 0;
    (MockWebSocket as any).OPEN = 1;
    (MockWebSocket as any).CLOSING = 2;
    (MockWebSocket as any).CLOSED = 3;

    originalWebSocket = globalThis.WebSocket;
    (globalThis as any).WebSocket = MockWebSocket;
    (globalThis as any).mockWebSocketConstructor = mockConstructor;
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).WebSocket = originalWebSocket;
    delete (globalThis as any).mockWebSocketConstructor;
    vi.clearAllMocks();
  });

  it('should initialize and connect to websocket', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://localhost/test' }));

    expect((globalThis as any).mockWebSocketConstructor).toHaveBeenCalledWith(
      'ws://localhost/test'
    );
    expect(result.current.status).toBe('connecting');
  });

  it('should update status on open', () => {
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test', onStatusChange }));

    act(() => {
      wsMock.onopen();
    });

    expect(result.current.status).toBe('connected');
    expect(onStatusChange).toHaveBeenCalledWith('connected');
  });

  it('should handle messages', () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() => useWebSocket({ url: 'ws://test', onMessage }));

    const messageData = { type: 'test', payload: 'data', timestamp: 123 };

    act(() => {
      wsMock.onmessage({ data: JSON.stringify(messageData) });
    });

    expect(result.current.lastMessage).toEqual(messageData);
    expect(onMessage).toHaveBeenCalledWith(messageData);
  });

  it('should reconnect on close if enabled', () => {
    renderHook(() => useWebSocket({ url: 'ws://test', reconnectInterval: 100 }));

    expect((globalThis as any).mockWebSocketConstructor).toHaveBeenCalledTimes(1);

    act(() => {
      wsMock.onclose();
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // It should have tried to reconnect
    expect((globalThis as any).mockWebSocketConstructor).toHaveBeenCalledTimes(2);
  });
});
