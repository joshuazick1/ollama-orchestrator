import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AlertTriangle,
  RefreshCw,
  Shield,
  Activity,
  Radio,
  History,
  TrendingUp,
} from 'lucide-react';
import { getServerModelMetrics, getCircuitBreakers, type CircuitBreakerInfo } from '../api';
import { Modal } from './Modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { cn } from '../lib/utils';
import { CircuitOverviewTab } from './circuit-breakers/detail/CircuitOverviewTab';
import { CircuitMetricsTab } from './circuit-breakers/detail/CircuitMetricsTab';
import { CircuitHistoryTab } from './circuit-breakers/detail/CircuitHistoryTab';
import { CircuitDecisionsTab } from './circuit-breakers/detail/CircuitDecisionsTab';
import { CircuitActionsTab } from './circuit-breakers/detail/CircuitActionsTab';

interface CircuitMetricsData {
  metrics?: {
    realtime?: {
      inFlight?: number;
      queued?: number;
    };
    percentiles?: {
      p50?: number;
      p95?: number;
      p99?: number;
      max?: number;
      [key: string]: number | undefined;
    };
    derived?: {
      successRate?: number;
      throughput?: number;
      avgTokensPerRequest?: number;
    };
    historical?: Record<string, { streamingMetrics?: unknown }>;
    streamingMetrics?: unknown;
  };
  [key: string]: unknown;
}

const circuitMetricsDataSchema = z
  .object({
    inFlight: z.number(),
    queued: z.number(),
    percentiles: z.object({
      p50: z.number(),
      p95: z.number(),
      p99: z.number(),
    }),
    successRate: z.number(),
    throughput: z.number(),
    avgTokensPerRequest: z.number(),
    streamingMetrics: z.unknown().optional(),
  })
  .transform(
    (data): CircuitMetricsData => ({
      metrics: {
        realtime: {
          inFlight: data.inFlight,
          queued: data.queued,
        },
        percentiles: {
          p50: data.percentiles.p50,
          p95: data.percentiles.p95,
          p99: data.percentiles.p99,
        },
        derived: {
          successRate: data.successRate,
          throughput: data.throughput,
          avgTokensPerRequest: data.avgTokensPerRequest,
        },
        streamingMetrics: data.streamingMetrics,
      },
    })
  );

interface CircuitDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  model: string;
}

type TabId = 'overview' | 'performance' | 'streaming' | 'history' | 'trends';

export const CircuitDetailModal = ({
  isOpen,
  onClose,
  serverId,
  model,
}: CircuitDetailModalProps) => {
  const { data: metricsData } = useQuery({
    queryKey: ['circuit-metrics', serverId, model],
    queryFn: async () => {
      const data = await getServerModelMetrics(serverId, model);
      const result = circuitMetricsDataSchema.safeParse(data);
      return result.success ? result.data : undefined;
    },
    enabled: isOpen,
    refetchInterval: 30000,
  });

  const { data: breakersData } = useQuery({
    queryKey: ['circuit-breakers'],
    queryFn: getCircuitBreakers,
    enabled: isOpen,
    refetchInterval: 10000,
  });

  const circuitBreaker = breakersData?.circuitBreakers?.find(
    (cb: CircuitBreakerInfo) => cb.serverId === `${serverId}:${model}`
  );

  if (!isOpen) return null;

  const tabs = [
    { id: 'overview' as TabId, label: 'Overview', icon: Shield },
    { id: 'performance' as TabId, label: 'Performance', icon: Activity },
    { id: 'streaming' as TabId, label: 'Streaming', icon: Radio },
    { id: 'history' as TabId, label: 'History', icon: History },
    { id: 'trends' as TabId, label: 'Trends', icon: TrendingUp },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Circuit Detail - ${serverId} : ${model}`}
      size="xl"
      className="max-h-[90vh]"
      closeOnOverlayClick={false}
    >
      <div className="flex flex-col h-full -mx-6 -mb-6">
        {/* Circuit State Banner */}
        {circuitBreaker && circuitBreaker.state !== 'CLOSED' && (
          <div
            className={`px-6 py-3 flex items-center justify-between ${
              circuitBreaker.state === 'OPEN' ? 'bg-red-900/20' : 'bg-yellow-900/20'
            }`}
          >
            <div className="flex items-center gap-2">
              {circuitBreaker.state === 'OPEN' ? (
                <AlertTriangle className="w-5 h-5 text-red-400" />
              ) : (
                <RefreshCw className="w-5 h-5 text-yellow-400 animate-spin" />
              )}
              <span
                className={`font-medium ${
                  circuitBreaker.state === 'OPEN' ? 'text-red-400' : 'text-yellow-400'
                }`}
              >
                Circuit {circuitBreaker.state}
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-text-muted">
                Failures:{' '}
                <span className="text-text-base font-mono">{circuitBreaker.failureCount}</span>
              </span>
              <span className="text-text-muted">
                Successes:{' '}
                <span className="text-text-base font-mono">{circuitBreaker.successCount}</span>
              </span>
              <span className="text-text-muted">
                Error Rate:{' '}
                <span className="text-text-base font-mono">
                  {(circuitBreaker.errorRate * 100).toFixed(1)}%
                </span>
              </span>
            </div>
          </div>
        )}

        <Tabs defaultValue="overview" className="flex flex-col h-full">
          <TabsList className="flex border-b border-surface-border px-6 bg-transparent rounded-none justify-start h-auto p-0">
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors rounded-none data-[state=active]:border-blue-500 data-[state=active]:text-blue-400',
                  'border-transparent text-text-muted hover:text-text-base'
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-y-auto p-6 mt-0">
            <CircuitOverviewTab metricsData={metricsData} circuitBreaker={circuitBreaker} />
          </TabsContent>
          <TabsContent value="performance" className="flex-1 overflow-y-auto p-6 mt-0">
            <CircuitMetricsTab metricsData={metricsData} />
          </TabsContent>
          <TabsContent value="streaming" className="flex-1 overflow-y-auto p-6 mt-0">
            <CircuitHistoryTab
              metricsData={
                metricsData as unknown as {
                  metrics?: {
                    historical?: Record<
                      string,
                      {
                        streamingMetrics?: {
                          avgTTFT?: number;
                          avgTotalDuration?: number;
                          avgStreamingDuration?: number;
                          totalTokens?: number;
                          avgChunkCount?: number;
                          avgChunkSizeBytes?: number;
                        };
                      }
                    >;
                    streamingMetrics?: {
                      avgTTFT?: number;
                      avgTotalDuration?: number;
                      avgStreamingDuration?: number;
                      totalTokens?: number;
                      avgChunkCount?: number;
                      avgChunkSizeBytes?: number;
                    };
                  };
                }
              }
            />
          </TabsContent>
          <TabsContent value="history" className="flex-1 overflow-y-auto p-6 mt-0">
            <CircuitDecisionsTab serverId={serverId} model={model} />
          </TabsContent>
          <TabsContent value="trends" className="flex-1 overflow-y-auto p-6 mt-0">
            <CircuitActionsTab serverId={serverId} model={model} />
          </TabsContent>
        </Tabs>
      </div>
    </Modal>
  );
};
