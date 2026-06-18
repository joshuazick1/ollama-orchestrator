import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from './useWebSocket';

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

  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`;

  const handleMessage = useCallback(
    (message: { type?: string; payload?: unknown; timestamp?: number }) => {
      let messageType: LiveUpdateMessageType = 'unknown';
      if (typeof message.type === 'string') {
        const t = message.type.toLowerCase();
        if (t === 'server_status' || t === 'server_status_change') {
          messageType = 'server_status';
        } else if (t === 'model_status' || t === 'model_status_change') {
          messageType = 'model_status';
        } else if (t === 'stats_update' || t === 'metrics_update' || t === 'stats') {
          messageType = 'stats_update';
        } else if (t === 'error') {
          messageType = 'error';
        }
      }

      const liveMessage: LiveUpdateMessage = {
        type: messageType,
        payload: (message.payload ?? {}) as Record<string, unknown>,
        timestamp: message.timestamp ?? Date.now(),
      };

      onMessage?.(liveMessage);

      if (invalidateQueries && invalidateQueries.length > 0) {
        void queryClient.invalidateQueries({ queryKey: invalidateQueries });
      }
    },
    [onMessage, invalidateQueries, queryClient]
  );

  const { status, lastMessage } = useWebSocket({
    url: wsUrl,
    enabled,
    onMessage: handleMessage,
  });

  return {
    status,
    lastMessage,
    isLive: status === 'connected',
  };
}
