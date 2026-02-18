import { useQuery } from '@tanstack/react-query';
import { getHealth, getQueueStatus, getAnalyticsSummary } from '../api';
import { Activity, Zap, Clock, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { StatCard } from '../components/StatCard';

export const Dashboard = () => {
  const {
    data: health,
    isLoading: healthLoading,
    error: healthError,
  } = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 5000,
  });
  const { data: queue, isLoading: queueLoading } = useQuery({
    queryKey: ['queue'],
    queryFn: getQueueStatus,
    refetchInterval: 2000,
  });
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: getAnalyticsSummary,
  });

  const activeServers = health?.orchestrator?.healthyServers || 0;
  const totalServers = health?.orchestrator?.totalServers || 0;
  const totalModels = health?.orchestrator?.totalModels || 0;
  const inFlightRequests = health?.orchestrator?.inFlightRequests || 0;
  const circuitBreakers = health?.orchestrator?.circuitBreakers || {};
  const openCircuitBreakers = Object.values(circuitBreakers).filter(
    (cb: unknown) => (cb as { state: string }).state === 'open'
  ).length;

  // Handle both old and new queue API response formats
  const queueLength = queue?.queue?.currentSize ?? queue?.currentSize ?? queue?.queueLength ?? 0;
  const queueItems = queue?.queue?.items ?? queue?.items ?? [];

  // Show loading state if any critical data is loading
  if (healthLoading) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Dashboard Overview</h2>
          <p className="text-gray-400">Loading system status...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-gray-800 rounded-xl p-6 border border-gray-700 animate-pulse"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="h-4 bg-gray-700 rounded w-24 mb-2"></div>
                  <div className="h-8 bg-gray-700 rounded w-16 mb-1"></div>
                  <div className="h-3 bg-gray-700 rounded w-32"></div>
                </div>
                <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Show error state if health check fails
  if (healthError) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Dashboard Overview</h2>
          <p className="text-gray-400">Unable to load system status</p>
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
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors"
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
        <h2 className="text-2xl font-bold text-white mb-2">Dashboard Overview</h2>
        <p className="text-gray-400">Real-time metrics and system status</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Active Servers"
          value={healthLoading ? '...' : `${activeServers}/${totalServers}`}
          subtext={
            healthLoading
              ? 'Loading...'
              : activeServers === totalServers
                ? 'All nodes healthy'
                : `${totalServers - activeServers} nodes unhealthy`
          }
          icon={
            healthLoading
              ? Activity
              : activeServers === totalServers
                ? CheckCircle
                : activeServers > 0
                  ? AlertCircle
                  : XCircle
          }
          color={
            healthLoading
              ? 'text-gray-400'
              : activeServers === totalServers
                ? 'text-green-400'
                : activeServers > 0
                  ? 'text-yellow-400'
                  : 'text-red-400'
          }
        />
        <StatCard
          title="Request Queue"
          value={queueLoading ? '...' : queueLength}
          subtext={queueLoading ? 'Loading...' : 'Pending requests'}
          icon={Clock}
          color={queueLoading ? 'text-gray-400' : 'text-yellow-400'}
        />
        <StatCard
          title="Total Requests"
          value={
            analyticsLoading ? '...' : analytics?.global?.totalRequests?.toLocaleString() || '0'
          }
          subtext={analyticsLoading ? 'Loading...' : 'Last 24 hours'}
          icon={Activity}
          color={analyticsLoading ? 'text-gray-400' : 'text-blue-400'}
        />
        <StatCard
          title="Avg Latency"
          value={analyticsLoading ? '...' : `${Math.round(analytics?.global?.avgLatency || 0)}ms`}
          subtext={analyticsLoading ? 'Loading...' : 'Global average'}
          icon={Zap}
          color={analyticsLoading ? 'text-gray-400' : 'text-purple-400'}
        />
      </div>

      {/* Quick Actions or Recent Activity could go here */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">System Health</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-900 rounded-lg">
              <span className="text-gray-300">Orchestrator Uptime</span>
              <span className="text-white font-mono">
                {Math.floor((health?.uptime || 0) / 3600)}h{' '}
                {Math.floor(((health?.uptime || 0) % 3600) / 60)}m
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-900 rounded-lg">
              <span className="text-gray-300">Active Models</span>
              <span className="text-white font-mono">{totalModels}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-900 rounded-lg">
              <span className="text-gray-300">In-Flight Requests</span>
              <span
                className={`font-mono ${inFlightRequests > 100 ? 'text-yellow-400' : 'text-blue-400'}`}
              >
                {inFlightRequests}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-900 rounded-lg">
              <span className="text-gray-300">Circuit Breakers</span>
              <span
                className={`font-mono ${openCircuitBreakers > 0 ? 'text-red-400' : 'text-green-400'}`}
              >
                {openCircuitBreakers > 0 ? `${openCircuitBreakers} open` : 'All closed'}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-900 rounded-lg">
              <span className="text-gray-300">Error Rate</span>
              <span
                className={`font-mono ${analytics?.global?.errorRate > 0.05 ? 'text-red-400' : 'text-green-400'}`}
              >
                {((analytics?.global?.errorRate || 0) * 100).toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">Request Queue</h3>
          {queueItems.length > 0 ? (
            <div className="space-y-2">
              {queueItems
                .slice(0, 5)
                .map(
                  (item: { id: string; model: string; addedAt: string; enqueueTime?: string }) => (
                    <div
                      key={item.id}
                      className="flex justify-between items-center p-3 bg-gray-900 rounded-lg text-sm"
                    >
                      <span className="text-gray-300 truncate max-w-[200px]">{item.model}</span>
                      <span className="text-gray-500 text-xs">
                        {item.enqueueTime ? new Date(item.enqueueTime).toLocaleTimeString() : 'N/A'}
                      </span>
                    </div>
                  )
                )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-40 text-gray-500">
              <Clock className="w-8 h-8 mb-2 opacity-50" />
              <p>Queue is empty</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
