import { useQuery } from '@tanstack/react-query';
import { getStats, getAnalyticsSummary, getMetrics } from '../api';
import { Activity, Zap, AlertCircle, CheckCircle, XCircle, Radio } from 'lucide-react';
import { StatCard } from '../components/StatCard';

export const Dashboard = () => {
  const {
    data: statsData,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 5000,
  });
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: getAnalyticsSummary,
  });
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
    refetchInterval: 30000,
  });

  const stats = statsData?.stats;
  const activeServers = stats?.healthyServers || 0;
  const totalServers = stats?.totalServers || 0;
  const totalModels = stats?.totalModels || 0;
  const inFlightRequests = stats?.inFlightRequests || 0;
  const circuitBreakers = stats?.circuitBreakers || {};
  const openCircuitBreakers = Object.values(circuitBreakers).filter(
    (cb: unknown) => (cb as { state: string }).state === 'open'
  ).length;

  // Show loading state if any critical data is loading
  if (statsLoading) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-text-base mb-2">Dashboard Overview</h2>
          <p className="text-text-muted">Loading system status...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-xl p-6 border border-surface-border animate-pulse"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="h-4 bg-surface rounded w-24 mb-2"></div>
                  <div className="h-8 bg-surface rounded w-16 mb-1"></div>
                  <div className="h-3 bg-surface rounded w-32"></div>
                </div>
                <div className="w-12 h-12 bg-surface rounded-lg"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Show error state if health check fails
  if (statsError) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-text-base mb-2">Dashboard Overview</h2>
          <p className="text-text-muted">Unable to load system status</p>
        </div>
        <div className="bg-red-900/20 border border-red-500/20 rounded-xl p-6">
          <div className="flex items-center space-x-3 mb-4">
            <AlertCircle className="w-6 h-6 text-red-400" />
            <h3 className="text-lg font-semibold text-red-400">Connection Error</h3>
          </div>
          <p className="text-gray-300 mb-4">
            Unable to connect to the orchestrator. Please check if the service is running.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 hover:bg-red-700 text-text-base px-4 py-2 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-text-base mb-2">Dashboard Overview</h2>
        <p className="text-text-muted">Real-time metrics and system status</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="animate-slide-up stagger-1">
          <StatCard
            title="Active Servers"
            value={statsLoading ? '...' : `${activeServers}/${totalServers}`}
            subtext={
              statsLoading
                ? 'Loading...'
                : activeServers === totalServers
                  ? 'All nodes healthy'
                  : `${totalServers - activeServers} nodes unhealthy`
            }
            icon={
              statsLoading
                ? Activity
                : activeServers === totalServers
                  ? CheckCircle
                  : activeServers > 0
                    ? AlertCircle
                    : XCircle
            }
            color={
              statsLoading
                ? 'text-text-muted'
                : activeServers === totalServers
                  ? 'text-green-400'
                  : activeServers > 0
                    ? 'text-yellow-400'
                    : 'text-red-400'
            }
          />
        </div>
        <div className="animate-slide-up stagger-2">
          <StatCard
            title="In-Flight Requests"
            value={statsLoading ? '...' : inFlightRequests}
            subtext={statsLoading ? 'Loading...' : 'Active requests'}
            icon={Zap}
            color={
              statsLoading
                ? 'text-text-muted'
                : inFlightRequests > 100
                  ? 'text-yellow-400'
                  : 'text-blue-400'
            }
          />
        </div>
        <div className="animate-slide-up stagger-3">
          <StatCard
            title="Total Requests"
            value={
              analyticsLoading ? '...' : analytics?.global?.totalRequests?.toLocaleString() || '0'
            }
            subtext={analyticsLoading ? 'Loading...' : 'Last 1 hour'}
            icon={Activity}
            color={analyticsLoading ? 'text-text-muted' : 'text-blue-400'}
          />
        </div>
        <div className="animate-slide-up stagger-4">
          <StatCard
            title="Avg Latency"
            value={analyticsLoading ? '...' : `${Math.round(analytics?.global?.avgLatency || 0)}ms`}
            subtext={analyticsLoading ? 'Loading...' : 'Global average'}
            icon={Zap}
            color={analyticsLoading ? 'text-text-muted' : 'text-purple-400'}
          />
        </div>
      </div>

      {/* Streaming Stats */}
      {metrics?.global?.streaming && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="animate-slide-up stagger-5">
            <StatCard
              title="Streaming Requests"
              value={
                metricsLoading
                  ? '...'
                  : metrics.global.streaming?.totalStreamingRequests?.toLocaleString() || '0'
              }
              subtext={metricsLoading ? 'Loading...' : 'Last 5 minutes'}
              icon={Radio}
              color={metricsLoading ? 'text-text-muted' : 'text-cyan-400'}
            />
          </div>
          <div className="animate-slide-up stagger-6">
            <StatCard
              title="Avg Chunks/Request"
              value={
                metricsLoading ? '...' : (metrics.global.streaming?.avgChunkCount || 0).toFixed(1)
              }
              subtext={metricsLoading ? 'Loading...' : 'Chunks per stream'}
              icon={Activity}
              color={metricsLoading ? 'text-text-muted' : 'text-teal-400'}
            />
          </div>
          <div className="animate-slide-up stagger-7">
            <StatCard
              title="Avg TTFT"
              value={
                metricsLoading ? '...' : `${Math.round(metrics.global.streaming?.avgTTFT || 0)}ms`
              }
              subtext={metricsLoading ? 'Loading...' : 'Time to first token'}
              icon={Zap}
              color={metricsLoading ? 'text-text-muted' : 'text-indigo-400'}
            />
          </div>
          <div className="animate-slide-up stagger-8">
            <StatCard
              title="Streaming %"
              value={
                metricsLoading
                  ? '...'
                  : `${(metrics.global.streaming?.streamingPercentage || 0).toFixed(1)}%`
              }
              subtext={metricsLoading ? 'Loading...' : 'Of total requests'}
              icon={Radio}
              color={metricsLoading ? 'text-text-muted' : 'text-blue-400'}
            />
          </div>
        </div>
      )}

      {/* Quick Actions or Recent Activity could go here */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface rounded-xl p-6 border border-surface-border">
          <h3 className="text-lg font-semibold text-text-base mb-4">System Health</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-surface-raised rounded-lg">
              <span className="text-gray-300">Orchestrator Uptime</span>
              <span className="text-text-base font-mono">
                {Math.floor((stats?.uptime || 0) / 3600)}h{' '}
                {Math.floor(((stats?.uptime || 0) % 3600) / 60)}m
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-surface-raised rounded-lg">
              <span className="text-gray-300">Active Models</span>
              <span className="text-text-base font-mono">{totalModels}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-surface-raised rounded-lg">
              <span className="text-gray-300">In-Flight Requests</span>
              <span
                className={`font-mono ${inFlightRequests > 100 ? 'text-yellow-400' : 'text-blue-400'}`}
              >
                {inFlightRequests}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-surface-raised rounded-lg">
              <span className="text-gray-300">Circuit Breakers</span>
              <span
                className={`font-mono ${openCircuitBreakers > 0 ? 'text-red-400' : 'text-green-400'}`}
              >
                {openCircuitBreakers > 0 ? `${openCircuitBreakers} open` : 'All closed'}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-surface-raised rounded-lg">
              <span className="text-gray-300">Error Rate</span>
              <span
                className={`font-mono ${analytics?.global?.errorRate > 0.05 ? 'text-red-400' : 'text-green-400'}`}
              >
                {((analytics?.global?.errorRate || 0) * 100).toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        <div className="bg-surface rounded-xl p-6 border border-surface-border">
          <h3 className="text-lg font-semibold text-text-base mb-4">Active Models</h3>
          <div className="flex flex-col items-center justify-center h-40 text-text-subtle">
            <Activity className="w-8 h-8 mb-2 opacity-50" />
            <p className="font-mono text-2xl text-text-base">{totalModels}</p>
            <p className="text-sm mt-1">models available across all servers</p>
          </div>
        </div>
      </div>
    </div>
  );
};
