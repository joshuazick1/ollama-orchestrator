// Extracted from CircuitDetailModal.tsx - CircuitActionsTab component (Trends tab)
import { useState, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Shield } from 'lucide-react';
import { getServerRequestStats, getDecisionHistory } from '../../../api';

interface DecisionHistoryItem {
  id: string;
  timestamp: number;
  serverId: string;
  model: string;
  decision: string;
  reason?: string;
  selected?: boolean;
  algorithm?: string;
  score?: number;
}

interface CircuitActionsTabProps {
  serverId: string;
  model: string;
}

export const CircuitActionsTab = memo<CircuitActionsTabProps>(({ serverId, model }) => {
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

  const totalDecisions = decisionList.length;
  const selectedCount = decisionList.filter((d: DecisionHistoryItem) => d.selected).length;
  const selectionRate = totalDecisions > 0 ? (selectedCount / totalDecisions) * 100 : 0;

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
              <div className={`h-full bg-green-500 w-[${selectionRate}%]`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

CircuitActionsTab.displayName = 'CircuitActionsTab';
