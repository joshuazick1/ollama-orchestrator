import { useQuery } from '@tanstack/react-query';
import { getCircuitBreakers, type CircuitBreakerInfo } from '../api';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Server,
} from 'lucide-react';
import { useState } from 'react';

interface CircuitBreakerResponse {
  success: boolean;
  circuitBreakers: CircuitBreakerInfo[];
}

interface GroupedBreakers {
  serverId: string;
  serverBreaker: CircuitBreakerInfo | null;
  modelBreakers: CircuitBreakerInfo[];
  hasOpenCircuit: boolean;
  totalFailures: number;
}

const getStateIcon = (state: string) => {
  switch (state) {
    case 'OPEN':
      return <ShieldAlert className="w-6 h-6 text-red-500" />;
    case 'CLOSED':
      return <ShieldCheck className="w-6 h-6 text-green-500" />;
    case 'HALF-OPEN':
      return <ShieldQuestion className="w-6 h-6 text-yellow-500" />;
    default:
      return <Shield className="w-6 h-6 text-gray-500" />;
  }
};

const getStateColor = (state: string) => {
  switch (state) {
    case 'OPEN':
      return 'bg-red-500/20 text-red-400 border-red-500/50';
    case 'CLOSED':
      return 'bg-green-500/20 text-green-400 border-green-500/50';
    case 'HALF-OPEN':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
  }
};

const formatTimeAgo = (timestamp: number) => {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const formatTimeUntil = (timestamp: number) => {
  if (!timestamp || timestamp <= Date.now()) return 'Now';
  const seconds = Math.floor((timestamp - Date.now()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
};

const groupBreakersByServer = (breakers: CircuitBreakerInfo[]): GroupedBreakers[] => {
  const groups = new Map<string, GroupedBreakers>();

  for (const breaker of breakers) {
    // Parse serverId - could be "server1" or "server1:model"
    const parts = breaker.serverId.split(':');
    const serverId = parts[0];
    const model = parts.length > 1 ? parts.slice(1).join(':') : null;

    if (!groups.has(serverId)) {
      groups.set(serverId, {
        serverId,
        serverBreaker: null,
        modelBreakers: [],
        hasOpenCircuit: false,
        totalFailures: 0,
      });
    }

    const group = groups.get(serverId)!;

    if (model) {
      group.modelBreakers.push(breaker);
    } else {
      group.serverBreaker = breaker;
    }

    // Check if any circuit is open
    if (breaker.state === 'OPEN') {
      group.hasOpenCircuit = true;
    }

    group.totalFailures += breaker.failureCount;
  }

  // Sort: servers with open circuits first, then by total failures
  return Array.from(groups.values()).sort((a, b) => {
    if (a.hasOpenCircuit && !b.hasOpenCircuit) return -1;
    if (!a.hasOpenCircuit && b.hasOpenCircuit) return 1;
    return b.totalFailures - a.totalFailures;
  });
};

const CircuitBreakerCard = ({
  breaker,
  isModel = false,
}: {
  breaker: CircuitBreakerInfo;
  isModel?: boolean;
}) => {
  const modelName = isModel ? breaker.serverId.split(':').slice(1).join(':') : null;

  return (
    <div
      className={`rounded-lg border p-4 ${
        breaker.state === 'OPEN'
          ? 'bg-red-500/10 border-red-500/30'
          : breaker.state === 'HALF-OPEN'
            ? 'bg-yellow-500/10 border-yellow-500/30'
            : 'bg-gray-700/30 border-gray-600/30'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {getStateIcon(breaker.state)}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-medium">{isModel ? modelName : 'Server Level'}</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium border ${getStateColor(
                  breaker.state
                )}`}
              >
                {breaker.state}
              </span>
              {breaker.modelType && (
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${breaker.modelType === 'embedding' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}
                >
                  {breaker.modelType}
                </span>
              )}
            </div>
            {isModel && <p className="text-gray-500 text-xs mt-0.5">Model-specific circuit</p>}
          </div>
        </div>

        {breaker.state === 'OPEN' && (
          <div className="flex items-center gap-2 text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg text-sm">
            <Clock className="w-4 h-4" />
            <span className="font-medium">Retry in {formatTimeUntil(breaker.nextRetryAt)}</span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 text-sm">
        <div>
          <span className="text-gray-500 text-xs block">Failures</span>
          <span className="text-white font-mono">{breaker.failureCount}</span>
        </div>
        <div>
          <span className="text-gray-500 text-xs block">Successes</span>
          <span className="text-white font-mono">{breaker.successCount}</span>
        </div>
        <div>
          <span className="text-gray-500 text-xs block">Error Rate</span>
          <span
            className={`font-mono ${breaker.errorRate > 0.5 ? 'text-red-400' : 'text-green-400'}`}
          >
            {(breaker.errorRate * 100).toFixed(1)}%
          </span>
        </div>
        <div>
          <span className="text-gray-500 text-xs block">Consecutive OK</span>
          <span className="text-white font-mono">{breaker.consecutiveSuccesses}</span>
        </div>
      </div>

      {/* Error Breakdown */}
      {breaker.errorCounts && Object.values(breaker.errorCounts).some(count => count > 0) && (
        <div className="mt-3 pt-3 border-t border-gray-600/30">
          <div className="flex flex-wrap gap-2">
            {Object.entries(breaker.errorCounts).map(([type, count]) => {
              if (count === 0) return null;
              return (
                <span
                  key={type}
                  className={`px-2 py-0.5 rounded text-xs ${
                    type === 'permanent'
                      ? 'bg-red-500/20 text-red-400'
                      : type === 'non-retryable'
                        ? 'bg-orange-500/20 text-orange-400'
                        : type === 'transient'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  {type}: {count}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Last Failure Reason */}
      {breaker.lastFailureReason && (
        <div className="mt-3 pt-3 border-t border-gray-600/30">
          <span className="text-gray-500 text-xs block mb-1">Last Failure Reason</span>
          <span className="text-red-400 text-xs font-mono break-all">
            {breaker.lastFailureReason}
          </span>
        </div>
      )}

      {/* Recovery Testing Info (for half-open state) */}
      {breaker.state === 'HALF-OPEN' && (
        <div className="mt-3 pt-3 border-t border-gray-600/30">
          <div className="flex items-center gap-2 text-yellow-400 text-xs">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span className="font-medium">Recovery Testing</span>
            {breaker.halfOpenAttempts !== undefined && breaker.halfOpenAttempts > 0 && (
              <span className="text-yellow-400/70">({breaker.halfOpenAttempts} attempts)</span>
            )}
          </div>
          {breaker.halfOpenStartedAt && breaker.halfOpenStartedAt > 0 && (
            <span className="text-gray-500 text-xs block mt-1">
              Started {formatTimeAgo(breaker.halfOpenStartedAt)}
            </span>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div className="mt-3 pt-3 border-t border-gray-600/30 flex gap-4 text-xs text-gray-500">
        {breaker.lastFailure > 0 && <span>Last failure: {formatTimeAgo(breaker.lastFailure)}</span>}
        {breaker.lastSuccess > 0 && <span>Last success: {formatTimeAgo(breaker.lastSuccess)}</span>}
      </div>
    </div>
  );
};

export const CircuitBreakers = () => {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch } = useQuery<CircuitBreakerResponse>({
    queryKey: ['circuitBreakers'],
    queryFn: getCircuitBreakers,
    refetchInterval: 5000,
  });

  const toggleServer = (serverId: string) => {
    setExpandedServers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        newSet.add(serverId);
      }
      return newSet;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const breakers = data?.circuitBreakers || [];
  const groupedServers = groupBreakersByServer(breakers);

  const openCount = breakers.filter(b => b.state === 'OPEN').length;
  const halfOpenCount = breakers.filter(b => b.state === 'HALF-OPEN').length;
  const closedCount = breakers.filter(b => b.state === 'CLOSED').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">Circuit Breakers</h2>
          <p className="text-gray-400">Monitor circuit breaker status grouped by server</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 rounded-xl border border-red-500/30 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Open Circuits</p>
              <p className="text-3xl font-bold text-red-400">{openCount}</p>
            </div>
            <ShieldAlert className="w-12 h-12 text-red-500/50" />
          </div>
          <p className="text-red-400/70 text-sm mt-2">
            {openCount > 0 ? 'Services are being protected' : 'All circuits closed'}
          </p>
        </div>

        <div className="bg-gray-800 rounded-xl border border-yellow-500/30 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Half-Open</p>
              <p className="text-3xl font-bold text-yellow-400">{halfOpenCount}</p>
            </div>
            <ShieldQuestion className="w-12 h-12 text-yellow-500/50" />
          </div>
          <p className="text-yellow-400/70 text-sm mt-2">
            {halfOpenCount > 0 ? 'Testing recovery' : 'No circuits testing'}
          </p>
        </div>

        <div className="bg-gray-800 rounded-xl border border-green-500/30 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Closed Circuits</p>
              <p className="text-3xl font-bold text-green-400">{closedCount}</p>
            </div>
            <ShieldCheck className="w-12 h-12 text-green-500/50" />
          </div>
          <p className="text-green-400/70 text-sm mt-2">Operating normally</p>
        </div>
      </div>

      {/* Server Groups */}
      <div className="space-y-4">
        {groupedServers.length === 0 ? (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
            <Shield className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Circuit Breakers Active</h3>
            <p className="text-gray-400">
              Circuit breakers will appear here as servers handle requests and failures occur.
            </p>
          </div>
        ) : (
          groupedServers.map(server => (
            <div
              key={server.serverId}
              className={`bg-gray-800 rounded-xl border overflow-hidden ${
                server.hasOpenCircuit
                  ? 'border-red-500/50 shadow-lg shadow-red-500/5'
                  : 'border-gray-700'
              }`}
            >
              {/* Server Header */}
              <button
                onClick={() => toggleServer(server.serverId)}
                className="w-full flex items-center justify-between p-6 hover:bg-gray-750 transition-colors"
              >
                <div className="flex items-center gap-4">
                  {expandedServers.has(server.serverId) ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                  <Server className="w-6 h-6 text-blue-400" />
                  <div>
                    <h3 className="text-lg font-semibold text-white font-mono">
                      {server.serverId}
                    </h3>
                    <p className="text-gray-400 text-sm">
                      {server.modelBreakers.length + (server.serverBreaker ? 1 : 0)} circuit
                      breaker(s)
                    </p>
                  </div>
                  {server.hasOpenCircuit && (
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/50">
                      HAS OPEN CIRCUIT
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <span className="text-gray-500 block text-xs">Total Failures</span>
                    <span className="text-white font-mono">{server.totalFailures}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500 block text-xs">Model Circuits</span>
                    <span className="text-white font-mono">{server.modelBreakers.length}</span>
                  </div>
                </div>
              </button>

              {/* Expanded Content */}
              {expandedServers.has(server.serverId) && (
                <div className="px-6 pb-6 space-y-4">
                  {/* Server-level breaker */}
                  {server.serverBreaker && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                        <Server className="w-4 h-4" />
                        Server-Level Circuit Breaker
                      </h4>
                      <CircuitBreakerCard breaker={server.serverBreaker} />
                    </div>
                  )}

                  {/* Model-level breakers */}
                  {server.modelBreakers.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        Model-Level Circuit Breakers
                      </h4>
                      <div className="space-y-3">
                        {server.modelBreakers
                          .sort((a, b) => {
                            // Sort by state: OPEN first, then HALF-OPEN, then CLOSED
                            const stateOrder = { OPEN: 0, 'HALF-OPEN': 1, CLOSED: 2 };
                            const stateDiff =
                              stateOrder[a.state as keyof typeof stateOrder] -
                              stateOrder[b.state as keyof typeof stateOrder];
                            if (stateDiff !== 0) return stateDiff;
                            // Then by failure count
                            return b.failureCount - a.failureCount;
                          })
                          .map(breaker => (
                            <CircuitBreakerCard
                              key={breaker.serverId}
                              breaker={breaker}
                              isModel={true}
                            />
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Info Section */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Circuit Breaker Behavior</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-white font-medium mb-2">When does a circuit open?</h4>
            <p className="text-gray-400 text-sm">
              A circuit opens when the failure count exceeds the threshold (default: 5 failures) OR
              when the error rate exceeds 50% within the monitoring window (1 minute).
            </p>
          </div>
          <div>
            <h4 className="text-white font-medium mb-2">When does a server become unhealthy?</h4>
            <p className="text-gray-400 text-sm">
              Servers are marked unhealthy after 3 consecutive transient/retryable failures.
              Permanent errors mark servers unhealthy only if they're server-wide issues (like disk
              full).
            </p>
          </div>
          <div>
            <h4 className="text-white font-medium mb-2">Recovery process</h4>
            <p className="text-gray-400 text-sm">
              After 30 seconds (open timeout), the circuit enters half-open state and allows test
              requests. If 3 consecutive requests succeed, the circuit closes.
            </p>
          </div>
          <div>
            <h4 className="text-white font-medium mb-2">Server vs Model circuits</h4>
            <p className="text-gray-400 text-sm">
              Server-level circuits track overall server health. Model-level circuits track specific
              models on that server (useful for OOM errors affecting only certain models).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
