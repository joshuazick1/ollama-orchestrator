import { memo } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Clock, Zap, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card } from '../Card';
import { Badge } from '../ui/badge';
import type { ClusterServerStatus } from '../../api/health';

interface ServerHealthCardProps {
  server: ClusterServerStatus;
}

export const ServerHealthCard = memo(({ server }: ServerHealthCardProps) => {
  const getStatusColor = () => {
    switch (server.status) {
      case 'healthy':
        return 'border-green-500/30';
      case 'degraded':
        return 'border-yellow-500/30';
      case 'down':
        return 'border-red-500/30';
      default:
        return 'border-surface-border';
    }
  };

  const getStatusBadge = () => {
    switch (server.status) {
      case 'healthy':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle className="w-3 h-3 mr-1" />
            Healthy
          </Badge>
        );
      case 'degraded':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Degraded
          </Badge>
        );
      case 'down':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Down
          </Badge>
        );
      default:
        return <Badge variant="outline">{server.status}</Badge>;
    }
  };

  const formatResponseTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <Link to={`/servers/${encodeURIComponent(server.serverId)}`}>
      <Card
        className={`border-2 ${getStatusColor()} hover:shadow-lg transition-all cursor-pointer`}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${
                server.status === 'healthy'
                  ? 'bg-green-500/20'
                  : server.status === 'degraded'
                    ? 'bg-yellow-500/20'
                    : 'bg-red-500/20'
              }`}
            >
              <Activity
                className={`w-5 h-5 ${
                  server.status === 'healthy'
                    ? 'text-green-400'
                    : server.status === 'degraded'
                      ? 'text-yellow-400'
                      : 'text-red-400'
                }`}
              />
            </div>
            <div>
              <h4 className="font-semibold text-text-base">{server.serverId}</h4>
              {getStatusBadge()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-raised rounded-lg p-3">
            <div className="flex items-center gap-2 text-text-muted mb-1">
              <Clock className="w-3 h-3" />
              <span className="text-xs">Response Time</span>
            </div>
            <p className="text-lg font-semibold text-text-base">
              {formatResponseTime(server.responseTime)}
            </p>
          </div>

          <div className="bg-surface-raised rounded-lg p-3">
            <div className="flex items-center gap-2 text-text-muted mb-1">
              <Zap className="w-3 h-3" />
              <span className="text-xs">In-Flight</span>
            </div>
            <p className="text-lg font-semibold text-text-base">{server.inFlight}</p>
          </div>

          <div className="bg-surface-raised rounded-lg p-3 col-span-2">
            <div className="flex items-center gap-2 text-text-muted mb-1">
              <AlertTriangle className="w-3 h-3" />
              <span className="text-xs">Error Rate</span>
            </div>
            <p
              className={`text-lg font-semibold ${
                server.errorRate > 0.1
                  ? 'text-red-400'
                  : server.errorRate > 0.05
                    ? 'text-yellow-400'
                    : 'text-green-400'
              }`}
            >
              {(server.errorRate * 100).toFixed(1)}%
            </p>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-surface-border text-xs text-text-muted">
          Last health check:{' '}
          {server.lastHealthCheck ? new Date(server.lastHealthCheck).toLocaleString() : 'Never'}
        </div>
      </Card>
    </Link>
  );
});

export default ServerHealthCard;
