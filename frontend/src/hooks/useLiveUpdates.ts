import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type LiveUpdateMessageType =
  | 'server_status'
  | 'model_status'
  | 'stats_update'
  | 'error'
  | 'unknown';

export interface LiveUpdateMessage {
  type: LiveUpdateMessageType;
  payload: Record<string, unknown>;
  timestamp: number;
}

interface UseLiveUpdatesOptions {
  enabled?: boolean;
  onMessage?: (message: LiveUpdateMessage) => void;
  invalidateQueries?: Array<readonly unknown[]>;
}

interface UseLiveUpdatesReturn {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastMessage: LiveUpdateMessage | null;
  isLive: boolean;
}

export function useLiveUpdates(options?: UseLiveUpdatesOptions): UseLiveUpdatesReturn {
  const { enabled = true, onMessage, invalidateQueries } = options ?? {};
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>(
    'disconnected'
  );
  const [lastMessage, setLastMessage] = useState<LiveUpdateMessage | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);
        let messageType: LiveUpdateMessageType = 'unknown';
        if (typeof parsed.type === 'string') {
          const t = parsed.type.toLowerCase();
          if (t === 'server_status' || t === 'server_status_change') {
            messageType = 'server_status';
          } else if (t === 'model_status' || t === 'model_status_change') {
            messageType = 'model_status';
          } else if (
            t === 'stats_update' ||
            t === 'metrics_update' ||
            t === 'stats' ||
            t === 'metrics'
          ) {
            messageType = 'stats_update';
          } else if (t === 'error') {
            messageType = 'error';
          }
        }

        const liveMessage: LiveUpdateMessage = {
          type: messageType,
          payload: (parsed.payload ?? parsed) as Record<string, unknown>,
          timestamp: parsed.timestamp ?? Date.now(),
        };

        setLastMessage(liveMessage);
        onMessage?.(liveMessage);

        if (invalidateQueries && invalidateQueries.length > 0) {
          void queryClient.invalidateQueries({ queryKey: invalidateQueries });
        }
      } catch {
        // Silently ignore parse errors for unrecognized SSE events
      }
    },
    [onMessage, invalidateQueries, queryClient]
  );

  useEffect(() => {
    if (!enabled) {
      queueMicrotask(() => setStatus('disconnected'));
      return;
    }

    queueMicrotask(() => setStatus('connecting'));

    const eventSource = new EventSource('/api/orchestrator/events');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setStatus('connected');
    };

    eventSource.onmessage = handleMessage;

    eventSource.onerror = () => {
      setStatus('error');
      eventSource.close();
      eventSourceRef.current = null;
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
      queueMicrotask(() => setStatus('disconnected'));
    };
  }, [enabled, handleMessage]);

  return {
    status,
    lastMessage,
    isLive: status === 'connected',
  };
}
