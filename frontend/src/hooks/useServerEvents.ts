import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface ServerEvent {
  type: 'metrics';
  timestamp: number;
  stats: {
    totalServers: number;
    healthyServers: number;
    totalModels: number;
    inFlightRequests: number;
    circuitBreakers: Record<string, { state: string; failureCount: number }>;
  };
  metrics: {
    timestamp: number;
    global: {
      totalRequests: number;
      errorRate: number;
      avgLatency: number;
      requestsPerSecond: number;
    };
  };
  circuitBreakers: number;
  servers: Array<{
    id: string;
    url: string;
    healthy: boolean;
    lastResponseTime: number;
    models: string[];
    maxConcurrency: number;
    version: string;
    supportsOllama: boolean;
    supportsV1: boolean;
    v1Models: string[];
  }>;
  modelMap: {
    modelToServers: Record<string, string[]>;
    serverToModels: Record<string, string[]>;
  };
  inFlight: {
    total: number;
    inFlight: Array<{
      serverId: string;
      serverUrl?: string;
      healthy: boolean;
      total: number;
      byModel: Record<string, { regular: number; bypass: number }>;
      streamingRequests: Array<{
        id: string;
        serverId: string;
        model: string;
        startTime: number;
        chunkCount: number;
        lastChunkTime: number;
        isStalled: boolean;
      }>;
    }>;
  };
}

export function useServerEvents() {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  const handleEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent;

        if (data.type === 'metrics') {
          queryClient.setQueryData(['stats'], { stats: data.stats });
          queryClient.setQueryData(['metrics'], {
            timestamp: data.metrics.timestamp,
            global: data.metrics.global,
          });
          queryClient.setQueryData(['circuitBreakers'], {
            circuitBreakers: data.circuitBreakers,
          });
          queryClient.setQueryData(['servers'], data.servers);
          queryClient.setQueryData(['modelMap'], data.modelMap.modelToServers);
          queryClient.setQueryData(['in-flight'], data.inFlight);
        }
      } catch (error) {
        console.error('Failed to parse server event:', error);
      }
    },
    [queryClient]
  );

  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource('/api/orchestrator/events');
    eventSourceRef.current = eventSource;

    eventSource.onmessage = handleEvent;

    eventSource.onerror = () => {
      console.error('SSE connection error, closing...');
      eventSource.close();
      eventSourceRef.current = null;
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [handleEvent]);

  return null;
}
