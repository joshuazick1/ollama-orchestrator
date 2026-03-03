import { ChevronDown, ChevronRight, CheckCircle, XCircle } from 'lucide-react';
import { formatDurationMs } from '../../utils/formatting';

interface ExpandedRequest {
  [key: string]: boolean;
}

interface RequestsTabProps {
  serversWithHistory?: {
    serverIds?: string[];
  };
  selectedServer: string;
  onSelectServer: (server: string) => void;
  serverRequestHistory?: {
    requests: Array<{
      id: string;
      model: string;
      duration: number;
      timestamp: string;
      success: boolean;
      tokensGenerated?: number;
      tokensPrompt?: number;
      ttft?: number;
      errorType?: string;
      errorMessage?: string;
    }>;
  };
  serverRequestStats?: {
    stats: {
      totalRequests: number;
      errorRate: number;
      avgDuration: number;
      avgTokensGenerated?: number;
    };
  };
  expandedRequests: ExpandedRequest;
  onToggleExpansion: (id: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}

const ITEMS_PER_PAGE = 50;

export const RequestsTab = ({
  serversWithHistory,
  selectedServer,
  onSelectServer,
  serverRequestHistory,
  serverRequestStats,
  expandedRequests,
  onToggleExpansion,
  page,
  onPageChange,
  isLoading,
}: RequestsTabProps) => {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
          <h3 className="text-lg font-semibold text-white">Detailed Request Logs</h3>
          <select
            value={selectedServer}
            onChange={e => {
              onSelectServer(e.target.value);
              onPageChange(0);
            }}
            className="bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white min-w-[200px]"
          >
            <option value="">Select a server...</option>
            {serversWithHistory?.serverIds?.map(serverId => (
              <option key={serverId} value={serverId}>
                {serverId}
              </option>
            ))}
          </select>
        </div>

        {/* Server Request Stats Summary */}
        {selectedServer && serverRequestStats?.stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-900/50 p-3 rounded border border-gray-700/50">
              <div className="text-xs text-gray-500 uppercase">Total Requests</div>
              <div className="text-xl font-bold text-white">
                {serverRequestStats.stats.totalRequests}
              </div>
            </div>
            <div className="bg-gray-900/50 p-3 rounded border border-gray-700/50">
              <div className="text-xs text-gray-500 uppercase">Success Rate</div>
              <div
                className={`text-xl font-bold ${serverRequestStats.stats.errorRate > 0.05 ? 'text-red-400' : 'text-green-400'}`}
              >
                {((1 - serverRequestStats.stats.errorRate) * 100).toFixed(1)}%
              </div>
            </div>
            <div className="bg-gray-900/50 p-3 rounded border border-gray-700/50">
              <div className="text-xs text-gray-500 uppercase">Avg Latency</div>
              <div className="text-xl font-bold text-blue-400">
                {formatDurationMs(serverRequestStats.stats.avgDuration)}
              </div>
            </div>
            <div className="bg-gray-900/50 p-3 rounded border border-gray-700/50">
              <div className="text-xs text-gray-500 uppercase">Avg Tokens</div>
              <div className="text-xl font-bold text-purple-400">
                {Math.round(serverRequestStats.stats.avgTokensGenerated || 0)}
              </div>
            </div>
          </div>
        )}

        {selectedServer && serverRequestHistory?.requests ? (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400">
                    <th className="w-8 py-3"></th>
                    <th className="text-left py-3">Time</th>
                    <th className="text-left py-3">Model</th>
                    <th className="text-right py-3">Duration</th>
                    <th className="text-center py-3">Status</th>
                    <th className="text-right py-3">Tokens</th>
                  </tr>
                </thead>
                <tbody className={isLoading ? 'opacity-50 pointer-events-none' : ''}>
                  {serverRequestHistory.requests.map(req => (
                    <>
                      <tr
                        key={req.id}
                        className="border-b border-gray-800 hover:bg-gray-700/30 cursor-pointer transition-colors"
                        onClick={() => onToggleExpansion(req.id)}
                      >
                        <td className="py-3 text-center">
                          {expandedRequests[req.id] ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </td>
                        <td className="py-3 text-gray-300 font-mono text-xs">
                          {new Date(req.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-3 text-white font-medium">{req.model}</td>
                        <td className="py-3 text-right text-gray-300 font-mono">
                          {formatDurationMs(req.duration)}
                        </td>
                        <td className="py-3 text-center">
                          {req.success ? (
                            <CheckCircle className="w-4 h-4 text-green-500 inline" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-500 inline" />
                          )}
                        </td>
                        <td className="py-3 text-right text-gray-300 font-mono">
                          {req.tokensGenerated || '-'}
                        </td>
                      </tr>
                      {expandedRequests[req.id] && (
                        <tr className="bg-gray-900/50">
                          <td colSpan={6} className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs font-mono text-gray-400">
                              <div>
                                <span className="text-gray-600 block mb-1">ID</span> {req.id}
                              </div>
                              <div>
                                <span className="text-gray-600 block mb-1">TTFT</span>{' '}
                                {req.ttft ? formatDurationMs(req.ttft) : '-'}
                              </div>
                              <div>
                                <span className="text-gray-600 block mb-1">Prompt Tokens</span>{' '}
                                {req.tokensPrompt || '-'}
                              </div>
                              {req.errorType && (
                                <div className="col-span-full mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-300">
                                  <span className="font-bold">{req.errorType}:</span>{' '}
                                  {req.errorMessage}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex justify-between items-center border-t border-gray-700 pt-4">
              <div className="text-sm text-gray-400">
                Showing {page * ITEMS_PER_PAGE + 1}-
                {page * ITEMS_PER_PAGE + serverRequestHistory.requests.length} requests
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onPageChange(Math.max(0, page - 1))}
                  disabled={page === 0 || isLoading}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm text-white transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => onPageChange(page + 1)}
                  disabled={serverRequestHistory.requests.length < ITEMS_PER_PAGE || isLoading}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm text-white transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            {selectedServer
              ? 'No requests found for this server.'
              : 'Please select a server to view logs.'}
          </div>
        )}
      </div>
    </div>
  );
};
