import { useQuery } from '@tanstack/react-query';
import { getInFlightByServer, type StreamingRequestProgress } from '../api';
import { Zap, Radio, AlertTriangle } from 'lucide-react';
import { StatCard } from '../components/StatCard';
import { formatDuration } from '../utils/formatting';

export const InFlight = () => {
  const { data: inFlightData, isLoading: inFlightLoading } = useQuery({
    queryKey: ['in-flight'],
    queryFn: getInFlightByServer,
    refetchInterval: 2000,
  });

  const inFlight = inFlightData?.inFlight || [];
  const totalInFlight = inFlightData?.total || 0;

  // Calculate streaming stats
  const allStreamingRequests: StreamingRequestProgress[] = [];
  inFlight.forEach((server: { streamingRequests?: StreamingRequestProgress[] }) => {
    if (server.streamingRequests) {
      allStreamingRequests.push(...server.streamingRequests);
    }
  });
  const streamingCount = allStreamingRequests.length;
  const nonStreamingCount = totalInFlight - streamingCount;
  const stalledCount = allStreamingRequests.filter(r => r.isStalled).length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">In-Flight Requests</h2>
        <p className="text-gray-400">Monitor active in-flight operations by server</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Total In-Flight"
          value={totalInFlight}
          subtext="Active requests"
          icon={Zap}
          color="text-blue-400"
        />
        <StatCard
          title="Streaming Requests"
          value={streamingCount}
          subtext={`${nonStreamingCount} non-streaming`}
          icon={Radio}
          color="text-cyan-400"
        />
        {stalledCount > 0 ? (
          <StatCard
            title="Stalled Streams"
            value={stalledCount}
            subtext="Needs attention"
            icon={AlertTriangle}
            color="text-red-400"
          />
        ) : (
          <StatCard
            title="Active Streams"
            value={streamingCount}
            subtext="Currently streaming"
            icon={Zap}
            color="text-teal-400"
          />
        )}
      </div>

      {/* In-Flight by Server */}
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
              streamingRequests?: StreamingRequestProgress[];
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

                {/* Streaming Requests */}
                {server.streamingRequests && server.streamingRequests.length > 0 && (
                  <div className="p-6 border-b border-gray-700 bg-cyan-900/10">
                    <h4 className="text-sm font-medium text-cyan-400 mb-4 flex items-center gap-2">
                      <Radio className="w-4 h-4" />
                      Streaming Requests
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {server.streamingRequests.map((req: StreamingRequestProgress) => {
                        const duration = Date.now() - req.startTime;
                        const chunksPerSec =
                          req.chunkCount > 0
                            ? (req.chunkCount / (duration / 1000)).toFixed(1)
                            : '0';
                        return (
                          <div
                            key={req.id}
                            className={`rounded-lg p-3 ${req.isStalled ? 'bg-red-900/30 border border-red-500/50' : 'bg-gray-900'}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="text-sm text-white truncate font-mono" title={req.id}>
                                {req.id.slice(0, 8)}...
                              </div>
                              {req.isStalled && (
                                <span className="text-xs px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  Stalled
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">{req.model}</div>
                            <div className="flex items-center gap-4 mt-2">
                              <div>
                                <span className="text-lg font-bold text-cyan-400">
                                  {req.chunkCount}
                                </span>
                                <span className="text-xs text-gray-500 ml-1">chunks</span>
                              </div>
                              <div>
                                <span className="text-lg font-bold text-teal-400">
                                  {chunksPerSec}
                                </span>
                                <span className="text-xs text-gray-500 ml-1">ch/s</span>
                              </div>
                              <div>
                                <span className="text-lg font-bold text-purple-400">
                                  {formatDuration(duration)}
                                </span>
                                <span className="text-xs text-gray-500 ml-1">duration</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

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
    </div>
  );
};
