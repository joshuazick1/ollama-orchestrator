import { useEffect, useRef, useState, useCallback } from 'react';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface WebSocketMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

interface UseWebSocketOptions {
  url: string;
  onMessage?: (message: WebSocketMessage) => void;
  onStatusChange?: (status: WebSocketStatus) => void;
  reconnectAttempts?: number;
  reconnectInterval?: number;
  enabled?: boolean;
}

interface UseWebSocketReturn {
  status: WebSocketStatus;
  lastMessage: WebSocketMessage | null;
  sendMessage: (message: unknown) => void;
  reconnect: () => void;
  disconnect: () => void;
}

export const useWebSocket = ({
  url,
  onMessage,
  onStatusChange,
  reconnectAttempts = 5,
  reconnectInterval = 3000,
  enabled = true,
}: UseWebSocketOptions): UseWebSocketReturn => {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!enabled || !url) return;

    try {
      setStatus('connecting');
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setStatus('connected');
        reconnectCountRef.current = 0;
        onStatusChange?.('connected');
      };

      ws.onmessage = event => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);
          onMessage?.(message);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onerror = () => {
        setStatus('error');
        onStatusChange?.('error');
      };

      ws.onclose = () => {
        setStatus('disconnected');
        onStatusChange?.('disconnected');

        if (enabled && reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      wsRef.current = ws;
    } catch (e) {
      setStatus('error');
      onStatusChange?.('error');
    }
  }, [url, enabled, reconnectAttempts, reconnectInterval, onMessage, onStatusChange]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  const sendMessage = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const reconnect = useCallback(() => {
    reconnectCountRef.current = 0;
    disconnect();
    connect();
  }, [connect, disconnect]);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    status,
    lastMessage,
    sendMessage,
    reconnect,
    disconnect,
  };
};

export const useRealTimeUpdates = (
  onUpdate: (data: Record<string, unknown>) => void,
  enabled = true
) => {
  const [connectionStatus, setConnectionStatus] = useState<WebSocketStatus>('disconnected');

  useEffect(() => {
    if (!enabled) return;

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`;

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        setConnectionStatus('connecting');
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setConnectionStatus('connected');
        };

        ws.onmessage = event => {
          try {
            const data = JSON.parse(event.data);
            onUpdate(data);
          } catch (e) {
            console.error('Failed to parse real-time update:', e);
          }
        };

        ws.onerror = () => {
          setConnectionStatus('error');
        };

        ws.onclose = () => {
          setConnectionStatus('disconnected');
          reconnectTimeout = setTimeout(connect, 5000);
        };
      } catch (e) {
        setConnectionStatus('error');
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close();
      }
    };
  }, [enabled, onUpdate]);

  return { connectionStatus };
};

export const createEventEmitter = () => {
  const listeners: Map<string, Set<(data: unknown) => void>> = new Map();

  return {
    on(event: string, callback: (data: unknown) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);
    },
    off(event: string, callback: (data: unknown) => void) {
      listeners.get(event)?.delete(callback);
    },
    emit(event: string, data: unknown) {
      listeners.get(event)?.forEach(callback => callback(data));
    },
    clear() {
      listeners.clear();
    },
  };
};

export type { WebSocketMessage, UseWebSocketOptions, UseWebSocketReturn };
