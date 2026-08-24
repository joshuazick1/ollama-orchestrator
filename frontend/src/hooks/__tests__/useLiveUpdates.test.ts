import { renderHook, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLiveUpdates } from '../useLiveUpdates';
import { resetLiveEventBusForTests } from '../liveEventBus';

const mockQueryClient = {
  invalidateQueries: vi.fn(),
};

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
}));

const instances: MockEventSource[] = [];

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 1;
  close = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn();

  constructor() {
    instances.push(this);
  }
}

vi.stubGlobal('EventSource', MockEventSource);

const latestSource = () => instances[instances.length - 1];

const sendMessage = (data: unknown) =>
  act(() => {
    latestSource()?.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  });

describe('useLiveUpdates', () => {
  beforeEach(() => {
    resetLiveEventBusForTests();
    instances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('connection status', () => {
    it('should start with connecting status', () => {
      const { result } = renderHook(() => useLiveUpdates());
      expect(result.current.status).toBe('connecting');
      expect(result.current.isLive).toBe(false);
    });

    it('should transition to connected when SSE opens', () => {
      const { result } = renderHook(() => useLiveUpdates());

      act(() => {
        latestSource()?.onopen?.();
      });

      expect(result.current.status).toBe('connected');
      expect(result.current.isLive).toBe(true);
    });

    it('should transition to error when SSE errors', () => {
      const { result } = renderHook(() => useLiveUpdates());

      act(() => {
        latestSource()?.onerror?.();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.isLive).toBe(false);
    });

    it('should be disconnected when enabled is false', () => {
      const { result } = renderHook(() => useLiveUpdates({ enabled: false }));
      expect(result.current.status).toBe('disconnected');
      expect(result.current.isLive).toBe(false);
    });
  });

  describe('message type detection', () => {
    it('should detect server_status message type', () => {
      const mockOnMessage = vi.fn();
      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      sendMessage({
        type: 'server_status',
        payload: { id: 'srv-1' },
        timestamp: 1234567890,
      });

      expect(mockOnMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'server_status',
          payload: expect.any(Object),
          timestamp: 1234567890,
        })
      );
    });

    it('should detect model_status message type', () => {
      const mockOnMessage = vi.fn();
      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      sendMessage({
        type: 'model_status',
        payload: { model: 'llama2' },
        timestamp: 1234567891,
      });

      expect(mockOnMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'model_status',
        })
      );
    });

    it('should detect stats_update message type', () => {
      const mockOnMessage = vi.fn();
      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      sendMessage({
        type: 'stats_update',
        payload: { requests: 100 },
        timestamp: 1234567892,
      });

      expect(mockOnMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stats_update',
        })
      );
    });

    it('should detect metrics message type as stats_update', () => {
      const mockOnMessage = vi.fn();
      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      sendMessage({ type: 'metrics', payload: {}, timestamp: 1234567893 });

      expect(mockOnMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stats_update',
        })
      );
    });

    it('should detect error message type', () => {
      const mockOnMessage = vi.fn();
      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      sendMessage({
        type: 'error',
        payload: { message: 'Connection failed' },
        timestamp: 1234567894,
      });

      expect(mockOnMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        })
      );
    });

    it('should default to unknown for unrecognized message types', () => {
      const mockOnMessage = vi.fn();
      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      sendMessage({ type: 'some_random_type', payload: {}, timestamp: 1234567895 });

      expect(mockOnMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'unknown',
        })
      );
    });
  });

  describe('onMessage callback', () => {
    it('should call onMessage callback with typed message', () => {
      const mockOnMessage = vi.fn();
      const testMessage = {
        type: 'server_status',
        payload: { serverId: 'srv-1' },
        timestamp: 9876543210,
      };

      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      sendMessage(testMessage);

      expect(mockOnMessage).toHaveBeenCalledTimes(1);
      expect(mockOnMessage).toHaveBeenCalledWith({
        type: 'server_status',
        payload: { serverId: 'srv-1' },
        timestamp: 9876543210,
      });
    });

    it('should include correct type, payload, and timestamp in message', () => {
      const mockOnMessage = vi.fn();
      const testPayload = { servers: ['srv-1', 'srv-2'] };

      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      sendMessage({
        type: 'stats_update',
        payload: testPayload,
        timestamp: 1111111111,
      });

      const calledMessage = mockOnMessage.mock.calls[0][0];
      expect(calledMessage.type).toBe('stats_update');
      expect(calledMessage.payload).toEqual(testPayload);
      expect(calledMessage.timestamp).toBe(1111111111);
    });

    it('should store lastMessage', () => {
      const testMessage = {
        type: 'server_status',
        payload: { serverId: 'srv-1' },
        timestamp: 9876543210,
      };

      const { result } = renderHook(() => useLiveUpdates());

      sendMessage(testMessage);

      expect(result.current.lastMessage).toEqual({
        type: 'server_status',
        payload: { serverId: 'srv-1' },
        timestamp: 9876543210,
      });
    });
  });

  describe('invalidateQueries', () => {
    it('should call invalidateQueries when messages are received', () => {
      renderHook(() =>
        useLiveUpdates({
          invalidateQueries: [['stats'], ['metrics']],
        })
      );

      sendMessage({ type: 'metrics', timestamp: 1234567890 });

      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['stats'] });
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['metrics'] });
    });

    it('should invalidate analyticsSummary key (camelCase) on SSE events', () => {
      renderHook(() =>
        useLiveUpdates({
          invalidateQueries: [['analyticsSummary']],
        })
      );

      sendMessage({ type: 'metrics', timestamp: 1234567890 });

      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['analyticsSummary'],
      });
      // Must NOT use the incorrect hyphenated form
      expect(mockQueryClient.invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: ['analytics-summary'],
      });
    });
  });

  describe('cleanup', () => {
    it('should close EventSource on unmount', () => {
      const { unmount } = renderHook(() => useLiveUpdates());
      const source = latestSource();

      unmount();

      expect(source?.close).toHaveBeenCalled();
    });
  });
});