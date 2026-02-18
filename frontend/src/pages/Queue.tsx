import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueueStatus, getInFlightByServer, pauseQueue, resumeQueue } from '../api';
import { Clock, Layers, Zap, Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { StatCard } from '../components/StatCard';
import { formatDuration } from '../utils/formatting';
import { toastSuccess, toastError } from '../utils/toast';

export const Queue = () => {
  const [activeTab, setActiveTab] = useState<'queued' | 'inflight'>('queued');
  const queryClient = useQueryClient();

  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ['queue-detailed'],
    queryFn: getQueueStatus,
    refetchInterval: 2000,
  });

  const { data: inFlightData, isLoading: inFlightLoading } = useQuery({
    queryKey: ['in-flight'],
    queryFn: getInFlightByServer,
    refetchInterval: 2000,
  });

  const pauseMutation = useMutation({
    mutationFn: pauseQueue,
    onSuccess: () => {
      toastSuccess('Queue paused');
      queryClient.invalidateQueries({ queryKey: ['queue-detailed'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to pause queue');
    },
  });

  const resumeMutation = useMutation({
    mutationFn: resumeQueue,
    onSuccess: () => {
      toastSuccess('Queue resumed');
      queryClient.invalidateQueries({ queryKey: ['queue-detailed'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to resume queue');
    },
  });

  const queue = queueData?.queue;
  const inFlight = inFlightData?.inFlight || [];
  const totalInFlight = inFlightData?.total || 0;
  const isPaused = queue?.paused ?? false;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Request Queue</h2>
          <p className="text-gray-400">Monitor queued requests and in-flight operations</p>
        </div>
        <div className="flex items-center gap-2">
          {isPaused ? (
            <button
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <Play className="w-4 h-4" />
              <span>Resume Queue</span>
            </button>
          ) : (
            <button
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <Pause className="w-4 h-4" />
              <span>Pause Queue</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Queue Size"
          value={queue?.currentSize || 0}
          subtext={`Max: ${queue?.maxSize || 1000}`}
          icon={Layers}
          color="text-yellow-400"
        />
        <StatCard
          title="Total In-Flight"
          value={totalInFlight}
          subtext="Active requests"
          icon={Zap}
          color="text-blue-400"
        />
        <StatCard
          title="Avg Wait Time"
          value={formatDuration(queue?.avgWaitTime || 0)}
          subtext="For completed requests"
          icon={Clock}
          color="text-purple-400"
        />
        <StatCard
          title="Queue Status"
          value={queue?.paused ? 'Paused' : 'Active'}
          subtext={queue?.paused ? 'Not accepting new requests' : 'Processing normally'}
          icon={queue?.paused ? Pause : Play}
          color={queue?.paused ? 'text-red-400' : 'text-green-400'}
        />
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-gray-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('queued')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'queued' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          Queued Requests
        </button>
        <button
          onClick={() => setActiveTab('inflight')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'inflight' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          In-Flight by Server
        </button>
      </div>

      {/* Queued Requests Tab */}
      {activeTab === 'queued' && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="p-6 border-b border-gray-700">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-yellow-400" />
              Queued Requests
              {queue?.currentSize > 0 && (
                <span className="text-sm bg-yellow-400/20 text-yellow-400 px-2 py-1 rounded-full">
                  {queue.currentSize}
                </span>
              )}
            </h3>
          </div>

          {queueLoading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : queue?.items?.length > 0 ? (
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
              <table className="w-full min-w-[700px]">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      ID
                    </th>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      Model
                    </th>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      Endpoint
                    </th>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      Priority
                    </th>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      Wait Time
                    </th>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3 hidden md:table-cell">
                      Enqueued
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {queue.items.map(
                    (item: {
                      id: string;
                      model: string;
                      endpoint: string;
                      priority: number;
                      addedAt: string;
                      waitTime: number;
                      enqueueTime: string;
                    }) => (
                      <tr key={item.id} className="hover:bg-gray-750">
                        <td className="px-6 py-4 text-sm text-gray-300 font-mono">
                          {item.id.slice(0, 8)}...
                        </td>
                        <td className="px-6 py-4 text-sm text-white">{item.model}</td>
                        <td className="px-6 py-4 text-sm text-gray-400 capitalize">
                          {item.endpoint}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              item.priority >= 80
                                ? 'bg-red-400/20 text-red-400'
                                : item.priority >= 50
                                  ? 'bg-yellow-400/20 text-yellow-400'
                                  : 'bg-green-400/20 text-green-400'
                            }`}
                          >
                            {item.priority}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-300">
                          {formatDuration(item.waitTime)}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 hidden md:table-cell">
                          {new Date(item.enqueueTime).toLocaleTimeString()}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <Layers className="w-12 h-12 mb-4 opacity-50" />
              <p>Queue is empty</p>
              <p className="text-sm mt-2">No requests are currently waiting</p>
            </div>
          )}
        </div>
      )}

      {/* In-Flight Tab */}
      {activeTab === 'inflight' && (
        <div className="space-y-6">
          {inFlightLoading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : inFlight.length > 0 ? (
            inFlight.map(
              (server: {
                serverId: string;
                count: number;
                byModel: Record<string, { regular: number; bypass: number }>;
                healthy?: boolean;
                serverUrl?: string;
                total?: number;
              }) => (
                <div
                  key={server.serverId}
                  className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden"
                >
                  <div className="p-6 border-b border-gray-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-3 h-3 rounded-full ${server.healthy ? 'bg-green-400' : 'bg-red-400'}`}
                        />
                        <h3 className="text-lg font-semibold text-white">{server.serverId}</h3>
                        <span className="text-sm text-gray-400">{server.serverUrl}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-2xl font-bold text-white">{server.total}</span>
                        <span className="text-sm text-gray-400">in-flight</span>
                      </div>
                    </div>
                  </div>

                  {Object.entries(server.byModel).length > 0 && (
                    <div className="p-6">
                      <h4 className="text-sm font-medium text-gray-400 mb-4">Requests by Model</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {(
                          Object.entries(server.byModel) as [
                            string,
                            { regular: number; bypass: number },
                          ][]
                        ).map(([model, counts]) => {
                          const hasBypass = counts.bypass > 0;
                          return (
                            <div
                              key={model}
                              className={`rounded-lg p-4 ${hasBypass ? 'bg-gray-900 border-2 border-purple-500/50' : 'bg-gray-900'}`}
                            >
                              <div className="text-sm text-gray-400 truncate" title={model}>
                                {model}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <div className="text-xl font-bold text-white">
                                  {counts.regular + counts.bypass}
                                </div>
                                {hasBypass && (
                                  <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">
                                    {counts.bypass} test
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500">
                                {hasBypass
                                  ? `${counts.regular} req / ${counts.bypass} test`
                                  : 'requests'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-64 bg-gray-800 rounded-xl border border-gray-700 text-gray-500">
              <Zap className="w-12 h-12 mb-4 opacity-50" />
              <p>No in-flight requests</p>
              <p className="text-sm mt-2">All requests have completed</p>
            </div>
          )}
        </div>
      )}

      {/* Queue Stats by Model */}
      {queue?.byModel && Object.keys(queue.byModel).length > 0 && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Queue Distribution by Model</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {(Object.entries(queue.byModel) as [string, number][]).map(([model, count]) => (
              <div key={model} className="bg-gray-900 rounded-lg p-4">
                <div className="text-sm text-gray-400 truncate" title={model}>
                  {model}
                </div>
                <div className="text-2xl font-bold text-white mt-1">{count}</div>
                <div className="text-xs text-gray-500">queued</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
