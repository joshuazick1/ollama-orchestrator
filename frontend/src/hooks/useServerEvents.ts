import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeLiveEvents, type LiveUpdateMessage } from './liveEventBus';

interface ServerEvent {
  type: 'metrics';
  schemaVersion?: string;
  sequence?: number;
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
  /** Rich circuit-breaker state map (added in schemaVersion '1'). */
  circuitBreakerDetails?: Record<string, {
    state: string;
    consecutiveSuccesses: number;
    consecutiveFailures: number;
    errorWindow: number[];
    lastTransition: number;
    lastProbeAt: number;
    nextProbeAt: number;
    recoveryAttempts: number;
    lastErrorKind?: string;
  }>;
}

function isMetricsEvent(message: LiveUpdateMessage): message is LiveUpdateMessage & { payload: ServerEvent } {
  return (message.payload as unknown as ServerEvent)?.type === 'metrics';
}

export function useServerEvents() {
  const queryClient = useQueryClient();

  const handleEvent = useCallback(
    (message: LiveUpdateMessage) => {
      if (!isMetricsEvent(message)) return;

      try {
        const data = message.payload as unknown as ServerEvent;

        queryClient.setQueryData(['stats'], { stats: data.stats });
        queryClient.setQueryData(['metrics'], (old: { timestamp?: number; global?: object } | undefined) => ({
          ...(old ?? {}),
          timestamp: data.metrics.timestamp,
          global: data.metrics.global,
        }));
        if (data.circuitBreakerDetails) {
          queryClient.setQueryData(['circuitBreakers'], {
            circuitBreakers: data.circuitBreakers,
            details: data.circuitBreakerDetails,
          });
        } else {
          queryClient.setQueryData(['circuitBreakers'], {
            circuitBreakers: data.circuitBreakers,
          });
        }
        queryClient.setQueryData(['servers'], data.servers);
        queryClient.setQueryData(['modelMap'], data.modelMap.modelToServers);
        queryClient.setQueryData(['in-flight'], data.inFlight);
      } catch (error) {
        console.error('Failed to parse server event:', error);
      }
    },
    [queryClient]
  );

  useEffect(() => subscribeLiveEvents({ onMessage: handleEvent }), [handleEvent]);

  return null;
}