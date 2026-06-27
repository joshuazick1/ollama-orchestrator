import { useMemo, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Server, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { Card } from '../components/Card';
import { ServerHealthCard } from '../components/cluster/ServerHealthCard';
import { EmptyState } from '../components/EmptyState';
import { getClusterStatus } from '../api';

export const ClusterStatus = memo(() => {
  const { data: clusterStatusData, isLoading: clusterLoading } = useQuery({
    queryKey: ['clusterStatus'],
    queryFn: getClusterStatus,
    refetchInterval: 10000,
  });

  const cluster = clusterStatusData;
  const servers = useMemo(() => cluster?.servers || [], [cluster?.servers]);

  const serversByStatus = useMemo(() => {
    const healthy = servers.filter(s => s.status === 'healthy');
    const degraded = servers.filter(s => s.status === 'degraded');
    const down = servers.filter(s => s.status === 'down');
    return { healthy, degraded, down };
  }, [servers]);

  const formatResponseTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (clusterLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!cluster || servers.length === 0) {
    return (
      <EmptyState
        type="empty"
        title="No cluster data available"
        message="Cluster status will appear when servers are registered"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-text-base tracking-tight">Cluster Status</h2>
        <p className="text-text-muted mt-1">Real-time health overview of your server fleet</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-surface-border">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Total Servers</p>
              <h3 className="text-3xl font-bold mt-2 text-text-base">{cluster.totalServers}</h3>
              <p className="text-text-subtle text-sm mt-1">registered servers</p>
            </div>
            <div className="p-3 rounded-lg bg-blue-500/20">
              <Server className="w-6 h-6 text-blue-400" />
            </div>
          </div>
        </Card>

        <Card className="border-green-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Healthy</p>
              <h3 className="text-3xl font-bold mt-2 text-green-400">{cluster.healthyServers}</h3>
              <p className="text-text-subtle text-sm mt-1">
                {serversByStatus.healthy.length > 0 ? 'operational' : 'no healthy servers'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-green-500/20">
              <CheckCircle className="w-6 h-6 text-green-400" />
            </div>
          </div>
        </Card>

        <Card className="border-yellow-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Degraded</p>
              <h3 className="text-3xl font-bold mt-2 text-yellow-400">{cluster.degradedServers}</h3>
              <p className="text-text-subtle text-sm mt-1">reduced performance</p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-500/20">
              <AlertTriangle className="w-6 h-6 text-yellow-400" />
            </div>
          </div>
        </Card>

        <Card className="border-red-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Down</p>
              <h3 className="text-3xl font-bold mt-2 text-red-400">{cluster.downServers}</h3>
              <p className="text-text-subtle text-sm mt-1">unreachable</p>
            </div>
            <div className="p-3 rounded-lg bg-red-500/20">
              <XCircle className="w-6 h-6 text-red-400" />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-surface-border">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Avg Response Time</p>
              <h3 className="text-2xl font-bold mt-2 text-text-base">
                {formatResponseTime(cluster.averageResponseTime)}
              </h3>
            </div>
          </div>
        </Card>

        <Card className="border-surface-border">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Total In-Flight</p>
              <h3 className="text-2xl font-bold mt-2 text-text-base">{cluster.totalInFlight}</h3>
            </div>
          </div>
        </Card>

        <Card className="border-surface-border">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Error Rate</p>
              <h3
                className={`text-2xl font-bold mt-2 ${
                  cluster.errorRate > 0.1
                    ? 'text-red-400'
                    : cluster.errorRate > 0.05
                      ? 'text-yellow-400'
                      : 'text-green-400'
                }`}
              >
                {(cluster.errorRate * 100).toFixed(2)}%
              </h3>
            </div>
          </div>
        </Card>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-text-base mb-4">Server Health</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map(server => (
            <ServerHealthCard key={server.serverId} server={server} />
          ))}
        </div>
      </div>
    </div>
  );
});

export default ClusterStatus;
