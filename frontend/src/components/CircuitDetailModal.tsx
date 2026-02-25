import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
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
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const { data: metricsData } = useQuery({
    queryKey: ['circuit-metrics', serverId, model],
    queryFn: () => getServerModelMetrics(serverId, model),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-xl border border-gray-700 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                circuitBreaker?.state === 'CLOSED'
                  ? 'bg-green-400'
                  : circuitBreaker?.state === 'HALF-OPEN'
                    ? 'bg-yellow-400'
                    : 'bg-red-400'
              }`}
            />
            <div>
              <h2 className="text-xl font-bold text-white">
                {serverId} : {model}
              </h2>
              <p className="text-sm text-gray-400">Circuit Detail</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

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
              <span className="text-gray-400">
                Failures:{' '}
                <span className="text-white font-mono">{circuitBreaker.failureCount}</span>
              </span>
              <span className="text-gray-400">
                Successes:{' '}
                <span className="text-white font-mono">{circuitBreaker.successCount}</span>
              </span>
              <span className="text-gray-400">
                Error Rate:{' '}
                <span className="text-white font-mono">
                  {(circuitBreaker.errorRate * 100).toFixed(1)}%
                </span>
              </span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-700 px-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <OverviewTab metricsData={metricsData} circuitBreaker={circuitBreaker} />
          )}
          {activeTab === 'performance' && <PerformanceTab metricsData={metricsData} />}
          {activeTab === 'streaming' && <StreamingTab metricsData={metricsData} />}
          {activeTab === 'history' && <HistoryTab serverId={serverId} model={model} />}
          {activeTab === 'trends' && <TrendsTab serverId={serverId} model={model} />}
        </div>
      </div>
    </div>
  );
};

// Overview Tab Component
const OverviewTab = ({
  metricsData,
  circuitBreaker,
}: {
  metricsData?: any;
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
          color={derived?.successRate > 0.9 ? 'text-green-400' : 'text-yellow-400'}
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
        <div className="bg-gray-900 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Circuit Breaker</h3>
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
              <div className="font-mono font-medium text-white">
                {circuitBreaker.consecutiveSuccesses}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Latency Percentiles */}
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Latency Percentiles</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-gray-500 text-xs">p50</span>
            <div className="font-mono text-lg text-white">{percentiles?.p50 || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p95</span>
            <div className="font-mono text-lg text-white">{percentiles?.p95 || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p99</span>
            <div className="font-mono text-lg text-white">{percentiles?.p99 || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Max</span>
            <div className="font-mono text-lg text-white">{percentiles?.max || 0}ms</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Performance Tab Component
const PerformanceTab = ({ metricsData }: { metricsData?: any }) => {
  const percentiles = metricsData?.metrics?.percentiles;
  const derived = metricsData?.metrics?.derived;

  return (
    <div className="space-y-6">
      {/* Latency Breakdown */}
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Latency Distribution</h3>
        <div className="space-y-3">
          {[
            { label: 'p50', value: percentiles?.p50 || 0, color: 'bg-green-500' },
            { label: 'p90', value: percentiles?.p90 || 0, color: 'bg-blue-500' },
            { label: 'p95', value: percentiles?.p95 || 0, color: 'bg-yellow-500' },
            { label: 'p99', value: percentiles?.p99 || 0, color: 'bg-orange-500' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-gray-400 text-sm w-12">{item.label}</span>
              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${item.color}`}
                  style={{
                    width: `${Math.min((item.value / (percentiles?.p99 || 1)) * 100, 100)}%`,
                  }}
                />
              </div>
              <span className="text-white font-mono w-20 text-right">{item.value}ms</span>
            </div>
          ))}
        </div>
      </div>

      {/* Throughput & Tokens */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-900 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Throughput</h4>
          <div className="text-2xl font-bold text-white">
            {derived?.throughput?.toFixed(2) || 0}
          </div>
          <div className="text-sm text-gray-500">requests/minute</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Avg Tokens/Request</h4>
          <div className="text-2xl font-bold text-white">
            {derived?.avgTokensPerRequest?.toFixed(0) || 0}
          </div>
          <div className="text-sm text-gray-500">tokens</div>
        </div>
      </div>
    </div>
  );
};

// Streaming Tab Component
const StreamingTab = ({ metricsData }: { metricsData?: any }) => {
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
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          Time to First Token
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-gray-500 text-xs">Average</span>
            <div className="font-mono text-xl text-white">{streaming.avgTTFT || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p50</span>
            <div className="font-mono text-xl text-white">
              {streaming.ttftPercentiles?.p50 || 0}ms
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p95</span>
            <div className="font-mono text-xl text-white">
              {streaming.ttftPercentiles?.p95 || 0}ms
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p99</span>
            <div className="font-mono text-xl text-white">
              {streaming.ttftPercentiles?.p99 || 0}ms
            </div>
          </div>
        </div>
      </div>

      {/* Chunk Stats */}
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyan-400" />
          Chunk Statistics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-gray-500 text-xs">Avg Chunks/Request</span>
            <div className="font-mono text-xl text-white">
              {streaming.avgChunkCount?.toFixed(1) || 0}
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Avg Chunk Size</span>
            <div className="font-mono text-xl text-white">
              {((streaming.avgChunkSizeBytes || 0) / 1024).toFixed(1)}KB
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p95 Chunk Gap</span>
            <div className="font-mono text-xl text-white">
              {streaming.maxChunkGapPercentiles?.p95 || 0}ms
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Avg Duration</span>
            <div className="font-mono text-xl text-white">
              {formatDuration(streaming.avgStreamingDuration || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* Chunk Count Distribution */}
      <div className="bg-gray-900 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-400 mb-2">Chunk Count Distribution</h4>
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
              <span className="text-gray-400 text-sm w-12">{item.label}</span>
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
              <span className="text-white font-mono w-16 text-right">{item.value} chunks</span>
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
    queryFn: () => getServerRequestHistory(serverId, { limit: 20 }),
    refetchInterval: 30000,
  });

  const { data: decisions, isLoading: decisionsLoading } = useQuery({
    queryKey: ['decisions', serverId, model, timeRange],
    queryFn: () => getDecisionHistory({ serverId, model, limit: 20, hours: timeRange }),
    refetchInterval: 30000,
  });

  const requests = requestHistory?.requests || [];
  const decisionList = decisions?.decisions || [];

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">Time Range:</span>
        {[1, 6, 24, 72].map(hours => (
          <button
            key={hours}
            onClick={() => setTimeRange(hours)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              timeRange === hours
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {hours}h
          </button>
        ))}
      </div>

      {/* Recent Requests */}
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <History className="w-5 h-5 text-blue-400" />
          Recent Requests
        </h3>
        {historyLoading ? (
          <div className="text-gray-500">Loading...</div>
        ) : requests.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {requests.slice(0, 10).map((req: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-gray-800 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {req.success ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <div>
                    <div className="text-sm text-white">{req.endpoint || 'generate'}</div>
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
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-400" />
          Load Balancer Decisions
        </h3>
        {decisionsLoading ? (
          <div className="text-gray-500">Loading...</div>
        ) : decisionList.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {decisionList.slice(0, 10).map((decision: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-gray-800 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {decision.selected ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <div>
                    <div className="text-sm text-white">{decision.algorithm || 'default'}</div>
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
  const selectedCount = decisionList.filter((d: any) => d.selected).length;
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
        <span className="text-sm text-gray-400">Time Range:</span>
        {[1, 6, 24, 72].map(hours => (
          <button
            key={hours}
            onClick={() => setTimeRange(hours)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              timeRange === hours
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {hours}h
          </button>
        ))}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="text-gray-500 text-xs mb-1">Selection Rate</div>
          <div className="text-2xl font-bold text-white">{selectionRate.toFixed(1)}%</div>
          <div className="text-xs text-gray-500">
            {selectedCount}/{totalDecisions} selected
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="text-gray-500 text-xs mb-1">Success Rate</div>
          <div
            className={`text-2xl font-bold ${successRate > 0.9 ? 'text-green-400' : successRate > 0.7 ? 'text-yellow-400' : 'text-red-400'}`}
          >
            {(successRate * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500">request success</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="text-gray-500 text-xs mb-1">Avg Latency</div>
          <div className="text-2xl font-bold text-white">{avgLatency}ms</div>
          <div className="text-xs text-gray-500">p95: {p95Latency}ms</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="text-gray-500 text-xs mb-1">Throughput</div>
          <div className="text-2xl font-bold text-white">{throughput.toFixed(1)}</div>
          <div className="text-xs text-gray-500">req/min</div>
        </div>
      </div>

      {/* Performance Over Time */}
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-400" />
          Performance Metrics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <span className="text-gray-500 text-xs">Total Requests</span>
            <div className="text-xl font-bold text-white">
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
            <div className="text-xl font-bold text-white">{stats?.p50Latency || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">P99 Latency</span>
            <div className="text-xl font-bold text-white">{stats?.p99Latency || 0}ms</div>
          </div>
        </div>
      </div>

      {/* Decision Trend */}
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-400" />
          Selection Trends
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Total Decisions</span>
            <span className="text-white font-mono">{totalDecisions}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Selected</span>
            <span className="text-green-400 font-mono">{selectedCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Rejected</span>
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
