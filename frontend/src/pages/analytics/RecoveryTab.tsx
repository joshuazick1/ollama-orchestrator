import { Server, AlertTriangle, Minus, TrendingUp, Activity } from 'lucide-react';
import { formatTimeAgo } from '../../utils/formatting';

interface RecoveryTabProps {
  recoverySummary?: {
    totalServers?: number;
    serversWithFailures?: number;
    totalFailures?: number;
    recentFailures?: number;
  };
  recoveryStats?: Array<{
    serverId: string;
    failureCount: number;
    lastFailure: number;
    recoveryAttempts: number;
    successfulRecoveries: number;
  }>;
}

export const RecoveryTab = ({ recoverySummary, recoveryStats }: RecoveryTabProps) => {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Servers</p>
              <p className="text-3xl font-bold text-white">{recoverySummary?.totalServers || 0}</p>
            </div>
            <Server className="w-10 h-10 text-blue-500/50" />
          </div>
        </div>
        <div className="bg-gray-800 rounded-xl border border-red-500/30 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Servers with Failures</p>
              <p className="text-3xl font-bold text-red-400">
                {recoverySummary?.serversWithFailures || 0}
              </p>
            </div>
            <AlertTriangle className="w-10 h-10 text-red-500/50" />
          </div>
        </div>
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Failures</p>
              <p className="text-3xl font-bold text-white">{recoverySummary?.totalFailures || 0}</p>
            </div>
            <Minus className="w-10 h-10 text-gray-500/50" />
          </div>
        </div>
        <div className="bg-gray-800 rounded-xl border border-yellow-500/30 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Recent Failures</p>
              <p className="text-3xl font-bold text-yellow-400">
                {recoverySummary?.recentFailures || 0}
              </p>
            </div>
            <TrendingUp className="w-10 h-10 text-yellow-500/50" />
          </div>
        </div>
      </div>

      {/* Server Recovery Stats Table */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="p-6 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">Server Recovery Statistics</h3>
          <p className="text-sm text-gray-400 mt-1">Failure and recovery metrics per server</p>
        </div>
        {recoveryStats && recoveryStats.length > 0 ? (
          <table className="w-full">
            <thead className="bg-gray-900">
              <tr>
                <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Server
                </th>
                <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Failures
                </th>
                <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Last Failure
                </th>
                <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Recovery Attempts
                </th>
                <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Successful Recoveries
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {recoveryStats.map(server => (
                <tr key={server.serverId} className="hover:bg-gray-750">
                  <td className="px-6 py-4 text-sm text-white font-mono">{server.serverId}</td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        server.failureCount > 0
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-green-500/20 text-green-400'
                      }`}
                    >
                      {server.failureCount}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-400">
                    {server.lastFailure > 0 ? formatTimeAgo(server.lastFailure) : 'Never'}
                  </td>
                  <td className="px-6 py-4 text-sm text-white">{server.recoveryAttempts}</td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`${
                        server.successfulRecoveries > 0 ? 'text-green-400' : 'text-gray-400'
                      }`}
                    >
                      {server.successfulRecoveries}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-12 text-center text-gray-500">
            <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No recovery data available</p>
            <p className="text-sm mt-1">
              Recovery statistics will appear here when servers experience failures
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
