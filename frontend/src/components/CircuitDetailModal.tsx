import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Activity,
  Zap,
  Radio,
  AlertTriangle,
  RefreshCw,
  Shield,
  History,
  TrendingUp,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import {
  getServerModelMetrics,
  getCircuitBreakers,
  getServerRequestHistory,
  getServerRequestStats,
  getDecisionHistory,
  type CircuitBreakerInfo,
} from '../api';
import { StatCard } from '../components/StatCard';
import { formatDuration, formatTimeAgo } from '../utils/formatting';
import { Modal } from './Modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { cn } from '../lib/utils';

// Zod schemas for validating API responses
const realtimeMetricsSchema = z.object({
  inFlight: z.number().optional(),
  queued: z.number().optional(),
});

const percentilesSchema = z.object({
  p50: z.number().optional(),
  p95: z.number().optional(),
  p99: z.number().optional(),
});

const derivedMetricsSchema = z.object({
  successRate: z.number().optional(),
  throughput: z.number().optional(),
  avgTokensPerRequest: z.number().optional(),
});

const streamingMetricsSchema = z.object({
  avgTTFT: z.number().optional(),
  avgTotalDuration: z.number().optional(),
  avgStreamingDuration: z.number().optional(),
  totalTokens: z.number().optional(),
  avgChunkCount: z.number().optional(),
  avgChunkSizeBytes: z.number().optional(),
});

const historicalWindowSchema = z.object({
  streamingMetrics: streamingMetricsSchema.optional(),
});

const metricsResponseSchema = z.object({
  realtime: realtimeMetricsSchema.optional(),
  percentiles: percentilesSchema.optional(),
  derived: derivedMetricsSchema.optional(),
  historical: z.record(z.string(), historicalWindowSchema).optional(),
  streamingMetrics: streamingMetricsSchema.optional(),
});

// Schema for the raw API response from getServerModelMetrics
const serverModelMetricsApiResponseSchema = z.object({
  success: z.boolean(),
  serverId: z.string(),
  model: z.string(),
  metrics: metricsResponseSchema,
});

// Schema for getDecisionHistory API response
const decisionEventSchema = z.object({
  timestamp: z.number(),
  model: z.string(),
  selectedServerId: z.string(),
  algorithm: z.string(),
  candidates: z.unknown(),
  selectionReason: z.string().optional(),
});

const decisionHistoryApiResponseSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  events: z.array(decisionEventSchema),
});

// Schema for getServerRequestHistory API response
const requestEventSchema = z.object({
  id: z.string(),
  timestamp: z.number().optional(),
  model: z.string(),
  endpoint: z.string().optional(),
  streaming: z.boolean().optional(),
  duration: z.number().optional(),
  success: z.boolean(),
  tokensGenerated: z.number().optional(),
  tokensPrompt: z.number().optional(),
  errorType: z.string().optional(),
  ttft: z.number().optional(),
  streamingDuration: z.number().optional(),
  queueWaitTime: z.number().optional(),
});

const requestHistoryApiResponseSchema = z.object({
  success: z.boolean(),
  serverId: z.string(),
  model: z.string().nullable(),
  count: z.number(),
  requests: z.array(requestEventSchema),
});

interface CircuitDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  model: string;
}

interface Percentiles {
  p50?: number;
  p95?: number;
  p99?: number;
  [key: string]: number | undefined;
}

interface CircuitMetricsData {
  metrics?: {
    realtime?: {
      inFlight?: number;
      queued?: number;
    };
    percentiles?: Percentiles;
    derived?: {
      successRate?: number;
      throughput?: number;
      avgTokensPerRequest?: number;
    };
    historical?: Record<
      string,
      {
        streamingMetrics?: StreamingMetrics;
      }
    >;
    streamingMetrics?: StreamingMetrics;
  };
  [key: string]: unknown;
}

interface StreamingMetrics {
  avgTTFT?: number;
  avgTotalDuration?: number;
  avgStreamingDuration?: number;
  totalTokens?: number;
  avgChunkCount?: number;
  avgChunkSizeBytes?: number;
  maxChunkGapPercentiles?: Percentiles;
  chunkCountPercentiles?: Percentiles;
  ttftPercentiles?: Percentiles;
  totalPercentiles?: Percentiles;
  [key: string]: number | Percentiles | undefined;
}

interface RequestHistoryItem {
  id: string;
  endpoint?: string;
  timestamp?: number;
  startTime?: number;
  duration?: number;
  success: boolean;
  tokensGenerated?: number;
  error?: string;
  chunkCount?: number;
}

interface DecisionHistoryItem {
  id: string;
  timestamp: number;
  serverId: string;
  model: string;
  decision: string;
  reason?: string;
  latency?: number;
  selected?: boolean;
  algorithm?: string;
  score?: number;
}

interface RequestHistoryResponse {
  requests: RequestHistoryItem[];
}

interface DecisionHistoryResponse {
  decisions: DecisionHistoryItem[];
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
      const parsed = serverModelMetricsApiResponseSchema.safeParse(data);
      if (!parsed.success) {
        return undefined;
      }
      return parsed.data.metrics as CircuitMetricsData | undefined;
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
            <OverviewTab metricsData={metricsData} circuitBreaker={circuitBreaker} />
          </TabsContent>
          <TabsContent value="performance" className="flex-1 overflow-y-auto p-6 mt-0">
            <PerformanceTab metricsData={metricsData} />
          </TabsContent>
          <TabsContent value="streaming" className="flex-1 overflow-y-auto p-6 mt-0">
            <StreamingTab metricsData={metricsData} />
          </TabsContent>
          <TabsContent value="history" className="flex-1 overflow-y-auto p-6 mt-0">
            <HistoryTab serverId={serverId} model={model} />
          </TabsContent>
          <TabsContent value="trends" className="flex-1 overflow-y-auto p-6 mt-0">
            <TrendsTab serverId={serverId} model={model} />
          </TabsContent>
        </Tabs>
      </div>
    </Modal>
  );
};

// Overview Tab Component
const OverviewTab = ({
  metricsData,
  circuitBreaker,
}: {
  metricsData?: CircuitMetricsData;
  circuitBreaker?: CircuitBreakerInfo;
}) => {
  const percentiles = metricsData?.metrics?.percentiles;
  const derived = metricsData?.metrics?.derived;

  return (
    <div className="space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="In Flight"
          value={metricsData?.metrics?.realtime?.inFlight || 0}
          subtext="Currently active"
          icon={Activity}
          color="text-blue-400"
        />
        <StatCard
          title="Success Rate"
          value={derived?.successRate ? `${(derived.successRate * 100).toFixed(1)}%` : 'N/A'}
          subtext="Overall"
          icon={Shield}
          color={(derived?.successRate ?? 0) > 0.9 ? 'text-green-400' : 'text-yellow-400'}
        />
        <StatCard
          title="Throughput"
          value={derived?.throughput?.toFixed(1) || '0'}
          subtext="req/min"
          icon={Zap}
          color="text-purple-400"
        />
        <StatCard
          title="Avg Tokens"
          value={derived?.avgTokensPerRequest?.toFixed(0) || '0'}
          subtext="per request"
          icon={Activity}
          color="text-cyan-400"
        />
      </div>

      {/* Circuit Breaker Details */}
      {circuitBreaker && (
        <div className="bg-surface-raised rounded-lg p-4">
          <h3 className="text-lg font-semibold text-text-base mb-4">Circuit Breaker</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <span className="text-gray-500 text-xs">State</span>
              <div
                className={`font-mono font-medium ${
                  circuitBreaker.state === 'CLOSED'
                    ? 'text-green-400'
                    : circuitBreaker.state === 'HALF-OPEN'
                      ? 'text-yellow-400'
                      : 'text-red-400'
                }`}
              >
                {circuitBreaker.state}
              </div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Failures</span>
              <div className="font-mono font-medium text-red-400">
                {circuitBreaker.failureCount}
              </div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Successes</span>
              <div className="font-mono font-medium text-green-400">
                {circuitBreaker.successCount}
              </div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Consecutive OK</span>
              <div className="font-mono font-medium text-text-base">
                {circuitBreaker.consecutiveSuccesses}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Latency Percentiles */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4">Latency Percentiles</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-gray-500 text-xs">p50</span>
            <div className="font-mono text-lg text-text-base">{percentiles?.p50 || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p95</span>
            <div className="font-mono text-lg text-text-base">{percentiles?.p95 || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p99</span>
            <div className="font-mono text-lg text-text-base">{percentiles?.p99 || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Max</span>
            <div className="font-mono text-lg text-text-base">{percentiles?.max || 0}ms</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Performance Tab Component
const PerformanceTab = ({ metricsData }: { metricsData?: CircuitMetricsData }) => {
  const percentiles = metricsData?.metrics?.percentiles;
  const derived = metricsData?.metrics?.derived;

  return (
    <div className="space-y-6">
      {/* Latency Breakdown */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4">Latency Distribution</h3>
        <div className="space-y-3">
          {[
            { label: 'p50', value: percentiles?.p50 || 0, color: 'bg-green-500' },
            { label: 'p90', value: percentiles?.p90 || 0, color: 'bg-blue-500' },
            { label: 'p95', value: percentiles?.p95 || 0, color: 'bg-yellow-500' },
            { label: 'p99', value: percentiles?.p99 || 0, color: 'bg-orange-500' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-text-muted text-sm w-12">{item.label}</span>
              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${item.color}`}
                  style={{
                    width: `${Math.min((item.value / (percentiles?.p99 || 1)) * 100, 100)}%`,
                  }}
                />
              </div>
              <span className="text-text-base font-mono w-20 text-right">{item.value}ms</span>
            </div>
          ))}
        </div>
      </div>

      {/* Throughput & Tokens */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-raised rounded-lg p-4">
          <h4 className="text-sm font-medium text-text-muted mb-2">Throughput</h4>
          <div className="text-2xl font-bold text-text-base">
            {derived?.throughput?.toFixed(2) || 0}
          </div>
          <div className="text-sm text-gray-500">requests/minute</div>
        </div>
        <div className="bg-surface-raised rounded-lg p-4">
          <h4 className="text-sm font-medium text-text-muted mb-2">Avg Tokens/Request</h4>
          <div className="text-2xl font-bold text-text-base">
            {derived?.avgTokensPerRequest?.toFixed(0) || 0}
          </div>
          <div className="text-sm text-gray-500">tokens</div>
        </div>
      </div>
    </div>
  );
};

// Streaming Tab Component
const StreamingTab = ({ metricsData }: { metricsData?: CircuitMetricsData }) => {
  const streaming =
    metricsData?.metrics?.historical?.['5m']?.streamingMetrics ||
    metricsData?.metrics?.streamingMetrics;

  if (!streaming) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <Radio className="w-12 h-12 mb-4 opacity-50" />
        <p>No streaming data available</p>
        <p className="text-sm mt-2">Streaming metrics will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* TTFT Stats */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          Time to First Token
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-gray-500 text-xs">Average</span>
            <div className="font-mono text-xl text-text-base">{streaming.avgTTFT || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p50</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.ttftPercentiles?.p50 || 0}ms
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p95</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.ttftPercentiles?.p95 || 0}ms
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p99</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.ttftPercentiles?.p99 || 0}ms
            </div>
          </div>
        </div>
      </div>

      {/* Chunk Stats */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyan-400" />
          Chunk Statistics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-gray-500 text-xs">Avg Chunks/Request</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.avgChunkCount?.toFixed(1) || 0}
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Avg Chunk Size</span>
            <div className="font-mono text-xl text-text-base">
              {((streaming.avgChunkSizeBytes || 0) / 1024).toFixed(1)}KB
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p95 Chunk Gap</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.maxChunkGapPercentiles?.p95 || 0}ms
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Avg Duration</span>
            <div className="font-mono text-xl text-text-base">
              {formatDuration(streaming.avgStreamingDuration || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* Chunk Count Distribution */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h4 className="text-sm font-medium text-text-muted mb-2">Chunk Count Distribution</h4>
        <div className="space-y-2">
          {[
            {
              label: 'p50',
              value: streaming.chunkCountPercentiles?.p50 || 0,
              color: 'bg-green-500',
            },
            {
              label: 'p95',
              value: streaming.chunkCountPercentiles?.p95 || 0,
              color: 'bg-blue-500',
            },
            {
              label: 'p99',
              value: streaming.chunkCountPercentiles?.p99 || 0,
              color: 'bg-yellow-500',
            },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-text-muted text-sm w-12">{item.label}</span>
              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${item.color}`}
                  style={{
                    width: `${Math.min(
                      (item.value / (streaming.chunkCountPercentiles?.p99 || 1)) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
              <span className="text-text-base font-mono w-16 text-right">{item.value} chunks</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// History Tab Component
const HistoryTab = ({ serverId, model }: { serverId: string; model: string }) => {
  const [timeRange, setTimeRange] = useState(24);

  const { data: requestHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['request-history', serverId, model, timeRange],
    queryFn: async () => {
      const data = await getServerRequestHistory(serverId, { limit: 20 });
      const parsed = requestHistoryApiResponseSchema.safeParse(data);
      if (!parsed.success) {
        return undefined;
      }
      return { requests: parsed.data.requests } as RequestHistoryResponse | undefined;
    },
    refetchInterval: 30000,
  });

  const { data: decisions, isLoading: decisionsLoading } = useQuery({
    queryKey: ['decisions', serverId, model, timeRange],
    queryFn: async () => {
      const data = await getDecisionHistory({ serverId, model, limit: 20, hours: timeRange });
      const parsed = decisionHistoryApiResponseSchema.safeParse(data);
      if (!parsed.success) {
        return undefined;
      }
      return {
        decisions: parsed.data.events.map(event => ({
          id: `${event.selectedServerId}-${event.timestamp}`,
          timestamp: event.timestamp,
          serverId: event.selectedServerId,
          model: event.model,
          decision: event.selectionReason || event.algorithm,
          reason: event.selectionReason,
          algorithm: event.algorithm,
          selected: true,
        })),
      } as DecisionHistoryResponse | undefined;
    },
    refetchInterval: 30000,
  });

  const requests = requestHistory?.requests || [];
  const decisionList = decisions?.decisions || [];

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Time Range:</span>
        {[1, 6, 24, 72].map(hours => (
          <button
            key={hours}
            onClick={() => setTimeRange(hours)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              timeRange === hours
                ? 'bg-blue-600 text-text-base'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {hours}h
          </button>
        ))}
      </div>

      {/* Recent Requests */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <History className="w-5 h-5 text-blue-400" />
          Recent Requests
        </h3>
        {historyLoading ? (
          <div className="text-gray-500">Loading...</div>
        ) : requests.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {requests.slice(0, 10).map((req: RequestHistoryItem, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-surface rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {req.success ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <div>
                    <div className="text-sm text-text-base">{req.endpoint || 'generate'}</div>
                    <div className="text-xs text-gray-500">
                      {req.duration ? `${req.duration}ms` : 'N/A'}
                      {req.chunkCount !== undefined && ` • ${req.chunkCount} chunks`}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {req.startTime ? formatTimeAgo(req.startTime) : 'N/A'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-sm">No requests in this time range</div>
        )}
      </div>

      {/* Load Balancer Decisions */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-400" />
          Load Balancer Decisions
        </h3>
        {decisionsLoading ? (
          <div className="text-gray-500">Loading...</div>
        ) : decisionList.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {decisionList.slice(0, 10).map((decision: DecisionHistoryItem, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-surface rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {decision.selected ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <div>
                    <div className="text-sm text-text-base">{decision.algorithm || 'default'}</div>
                    <div className="text-xs text-gray-500">
                      Score: {decision.score?.toFixed(1) || 'N/A'}
                      {decision.reason && ` • ${decision.reason}`}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {decision.timestamp ? formatTimeAgo(decision.timestamp) : 'N/A'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-sm">No decisions in this time range</div>
        )}
      </div>
    </div>
  );
};

// Trends Tab Component
const TrendsTab = ({ serverId, model }: { serverId: string; model: string }) => {
  const [timeRange, setTimeRange] = useState(24);

  const { data: requestStats } = useQuery({
    queryKey: ['request-stats', serverId, timeRange],
    queryFn: () => getServerRequestStats(serverId, timeRange),
    refetchInterval: 60000,
  });

  const { data: decisions } = useQuery({
    queryKey: ['decisions-trend', serverId, model, timeRange],
    queryFn: () => getDecisionHistory({ serverId, model, hours: timeRange, limit: 100 }),
    refetchInterval: 60000,
  });

  const stats = requestStats || {};
  const decisionList = decisions?.decisions || [];

  // Calculate trends
  const totalDecisions = decisionList.length;
  const selectedCount = decisionList.filter((d: DecisionHistoryItem) => d.selected).length;
  const selectionRate = totalDecisions > 0 ? (selectedCount / totalDecisions) * 100 : 0;

  // Calculate success rate from recent requests
  const successRate = stats?.successRate || 0;
  const avgLatency = stats?.avgLatency || 0;
  const p95Latency = stats?.p95Latency || 0;
  const throughput = stats?.requestsPerMinute || 0;

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Time Range:</span>
        {[1, 6, 24, 72].map(hours => (
          <button
            key={hours}
            onClick={() => setTimeRange(hours)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              timeRange === hours
                ? 'bg-blue-600 text-text-base'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {hours}h
          </button>
        ))}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-raised rounded-lg p-4">
          <div className="text-gray-500 text-xs mb-1">Selection Rate</div>
          <div className="text-2xl font-bold text-text-base">{selectionRate.toFixed(1)}%</div>
          <div className="text-xs text-gray-500">
            {selectedCount}/{totalDecisions} selected
          </div>
        </div>
        <div className="bg-surface-raised rounded-lg p-4">
          <div className="text-gray-500 text-xs mb-1">Success Rate</div>
          <div
            className={`text-2xl font-bold ${successRate > 0.9 ? 'text-green-400' : successRate > 0.7 ? 'text-yellow-400' : 'text-red-400'}`}
          >
            {(successRate * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500">request success</div>
        </div>
        <div className="bg-surface-raised rounded-lg p-4">
          <div className="text-gray-500 text-xs mb-1">Avg Latency</div>
          <div className="text-2xl font-bold text-text-base">{avgLatency}ms</div>
          <div className="text-xs text-gray-500">p95: {p95Latency}ms</div>
        </div>
        <div className="bg-surface-raised rounded-lg p-4">
          <div className="text-gray-500 text-xs mb-1">Throughput</div>
          <div className="text-2xl font-bold text-text-base">{throughput.toFixed(1)}</div>
          <div className="text-xs text-gray-500">req/min</div>
        </div>
      </div>

      {/* Performance Over Time */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-400" />
          Performance Metrics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <span className="text-gray-500 text-xs">Total Requests</span>
            <div className="text-xl font-bold text-text-base">
              {stats?.totalRequests?.toLocaleString() || 0}
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Total Errors</span>
            <div className="text-xl font-bold text-red-400">
              {stats?.totalErrors?.toLocaleString() || 0}
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Total Tokens</span>
            <div className="text-xl font-bold text-cyan-400">
              {stats?.totalTokens?.toLocaleString() || 0}
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Avg Tokens/Request</span>
            <div className="text-xl font-bold text-purple-400">
              {stats?.avgTokensPerRequest?.toFixed(0) || 0}
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">P50 Latency</span>
            <div className="text-xl font-bold text-text-base">{stats?.p50Latency || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">P99 Latency</span>
            <div className="text-xl font-bold text-text-base">{stats?.p99Latency || 0}ms</div>
          </div>
        </div>
      </div>

      {/* Decision Trend */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-400" />
          Selection Trends
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-sm">Total Decisions</span>
            <span className="text-text-base font-mono">{totalDecisions}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-sm">Selected</span>
            <span className="text-green-400 font-mono">{selectedCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-sm">Rejected</span>
            <span className="text-red-400 font-mono">{totalDecisions - selectedCount}</span>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Selection Rate</span>
              <span>{selectionRate.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-green-500" style={{ width: `${selectionRate}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
