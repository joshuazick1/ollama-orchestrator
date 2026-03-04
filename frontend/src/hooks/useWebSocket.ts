import { useEffect, useRef, useState, useCallback } from 'react';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface WebSocketMessage {
  type: string;
  payload: unknown;
  timestamp: number;
  [key: string]: unknown;
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
  const connectRef = useRef<() => void>(() => {});

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
          const parsed = JSON.parse(event.data);
          const message: WebSocketMessage = {
            type: parsed.type ?? 'unknown',
            payload: parsed.payload ?? parsed,
            timestamp: parsed.timestamp ?? Date.now(),
          };
          setLastMessage(message);
          onMessage?.(message);
        } catch {
          const message: WebSocketMessage = {
            type: 'unknown',
            payload: event.data,
            timestamp: Date.now(),
          };
          setLastMessage(message);
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
            connectRef.current();
          }, reconnectInterval);
        }
      };

      wsRef.current = ws;
    } catch {
      setStatus('error');
      onStatusChange?.('error');
    }
  }, [url, enabled, reconnectAttempts, reconnectInterval, onMessage, onStatusChange]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
): { connectionStatus: WebSocketStatus } => {
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`;

  const handleMessage = useCallback((message: WebSocketMessage) => {
    onUpdateRef.current(message as unknown as Record<string, unknown>);
  }, []);

  const { status: connectionStatus } = useWebSocket({
    url: wsUrl,
    enabled,
    onMessage: handleMessage,
  });

  return { connectionStatus };
};

export { createEventEmitter } from '../utils/eventEmitter';

export type { WebSocketMessage, UseWebSocketOptions, UseWebSocketReturn };
