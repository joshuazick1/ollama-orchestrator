import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLiveUpdates } from '../useLiveUpdates';
import * as useWebSocketModule from '../useWebSocket';

const mockQueryClient = {
  invalidateQueries: vi.fn(),
};

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
}));

vi.mock('../useWebSocket', () => ({
  useWebSocket: vi.fn(() => ({
    status: 'disconnected',
    lastMessage: null,
    sendMessage: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

describe('useLiveUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connection status propagation', () => {
    it('should have isLive false when status is disconnected', () => {
      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockReturnValue({
        status: 'disconnected',
        lastMessage: null,
        sendMessage: vi.fn(),
        reconnect: vi.fn(),
        disconnect: vi.fn(),
      });

      const { result } = renderHook(() => useLiveUpdates());

      expect(result.current.isLive).toBe(false);
      expect(result.current.status).toBe('disconnected');
    });

    it('should have isLive true when status is connected', () => {
      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockReturnValue({
        status: 'connected',
        lastMessage: null,
        sendMessage: vi.fn(),
        reconnect: vi.fn(),
        disconnect: vi.fn(),
      });

      const { result } = renderHook(() => useLiveUpdates());

      expect(result.current.isLive).toBe(true);
      expect(result.current.status).toBe('connected');
    });

    it('should have isLive false when status is error', () => {
      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockReturnValue({
        status: 'error',
        lastMessage: null,
        sendMessage: vi.fn(),
        reconnect: vi.fn(),
        disconnect: vi.fn(),
      });

      const { result } = renderHook(() => useLiveUpdates());

      expect(result.current.isLive).toBe(false);
      expect(result.current.status).toBe('error');
    });

    it('should have isLive false when status is connecting', () => {
      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockReturnValue({
        status: 'connecting',
        lastMessage: null,
        sendMessage: vi.fn(),
        reconnect: vi.fn(),
        disconnect: vi.fn(),
      });

      const { result } = renderHook(() => useLiveUpdates());

      expect(result.current.isLive).toBe(false);
      expect(result.current.status).toBe('connecting');
    });
  });

  describe('message type detection', () => {
    it('should detect server_status message type', () => {
      const mockOnMessage = vi.fn();
      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockImplementation(
        ({
          onMessage,
        }: {
          onMessage?: (msg: { type?: string; payload?: unknown; timestamp?: number }) => void;
        }) => {
          act(() => {
            onMessage?.({ type: 'server_status', payload: { id: 'srv-1' }, timestamp: 1234567890 });
          });
          return {
            status: 'connected',
            lastMessage: null,
            sendMessage: vi.fn(),
            reconnect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      );

      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

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
      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockImplementation(
        ({
          onMessage,
        }: {
          onMessage?: (msg: { type?: string; payload?: unknown; timestamp?: number }) => void;
        }) => {
          act(() => {
            onMessage?.({
              type: 'model_status',
              payload: { model: 'llama2' },
              timestamp: 1234567891,
            });
          });
          return {
            status: 'connected',
            lastMessage: null,
            sendMessage: vi.fn(),
            reconnect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      );

      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      expect(mockOnMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'model_status',
        })
      );
    });

    it('should detect stats_update message type', () => {
      const mockOnMessage = vi.fn();
      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockImplementation(
        ({
          onMessage,
        }: {
          onMessage?: (msg: { type?: string; payload?: unknown; timestamp?: number }) => void;
        }) => {
          act(() => {
            onMessage?.({
              type: 'stats_update',
              payload: { requests: 100 },
              timestamp: 1234567892,
            });
          });
          return {
            status: 'connected',
            lastMessage: null,
            sendMessage: vi.fn(),
            reconnect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      );

      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      expect(mockOnMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stats_update',
        })
      );
    });

    it('should detect error message type', () => {
      const mockOnMessage = vi.fn();
      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockImplementation(
        ({
          onMessage,
        }: {
          onMessage?: (msg: { type?: string; payload?: unknown; timestamp?: number }) => void;
        }) => {
          act(() => {
            onMessage?.({
              type: 'error',
              payload: { message: 'Connection failed' },
              timestamp: 1234567893,
            });
          });
          return {
            status: 'connected',
            lastMessage: null,
            sendMessage: vi.fn(),
            reconnect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      );

      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      expect(mockOnMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        })
      );
    });

    it('should default to unknown for unrecognized message types', () => {
      const mockOnMessage = vi.fn();
      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockImplementation(
        ({
          onMessage,
        }: {
          onMessage?: (msg: { type?: string; payload?: unknown; timestamp?: number }) => void;
        }) => {
          act(() => {
            onMessage?.({ type: 'some_random_type', payload: {}, timestamp: 1234567894 });
          });
          return {
            status: 'connected',
            lastMessage: null,
            sendMessage: vi.fn(),
            reconnect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      );

      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

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

      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockImplementation(
        ({
          onMessage,
        }: {
          onMessage?: (msg: { type?: string; payload?: unknown; timestamp?: number }) => void;
        }) => {
          act(() => {
            onMessage?.(testMessage);
          });
          return {
            status: 'connected',
            lastMessage: null,
            sendMessage: vi.fn(),
            reconnect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      );

      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

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

      (useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>).mockImplementation(
        ({
          onMessage,
        }: {
          onMessage?: (msg: { type?: string; payload?: unknown; timestamp?: number }) => void;
        }) => {
          act(() => {
            onMessage?.({ type: 'stats_update', payload: testPayload, timestamp: 1111111111 });
          });
          return {
            status: 'connected',
            lastMessage: null,
            sendMessage: vi.fn(),
            reconnect: vi.fn(),
            disconnect: vi.fn(),
          };
        }
      );

      renderHook(() => useLiveUpdates({ onMessage: mockOnMessage }));

      const calledMessage = mockOnMessage.mock.calls[0][0];
      expect(calledMessage.type).toBe('stats_update');
      expect(calledMessage.payload).toEqual(testPayload);
      expect(calledMessage.timestamp).toBe(1111111111);
    });
  });

  describe('enabled flag', () => {
    it('should pass enabled=false to useWebSocket when disabled', () => {
      const mockUseWebSocket = useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>;
      mockUseWebSocket.mockReturnValue({
        status: 'disconnected',
        lastMessage: null,
        sendMessage: vi.fn(),
        reconnect: vi.fn(),
        disconnect: vi.fn(),
      });

      renderHook(() => useLiveUpdates({ enabled: false }));

      expect(mockUseWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
        })
      );
    });

    it('should pass enabled=true to useWebSocket when enabled', () => {
      const mockUseWebSocket = useWebSocketModule.useWebSocket as ReturnType<typeof vi.fn>;
      mockUseWebSocket.mockReturnValue({
        status: 'connected',
        lastMessage: null,
        sendMessage: vi.fn(),
        reconnect: vi.fn(),
        disconnect: vi.fn(),
      });

      renderHook(() => useLiveUpdates({ enabled: true }));

      expect(mockUseWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
        })
      );
    });
  });
});
