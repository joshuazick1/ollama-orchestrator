import { Radio, BarChart2, Zap, Gauge } from 'lucide-react';
import { formatDurationMs } from '../../utils/formatting';

interface StreamingTabProps {
  metricsData?: {
    global?: {
      streaming?: {
        totalStreamingRequests?: number;
        avgChunkCount?: number;
        avgTTFT?: number;
        streamingPercentage?: number;
        avgStreamingDuration?: number;
        avgChunkSizeBytes?: number;
        p95ChunkGap?: number;
      };
    };
    servers?: Record<
      string,
      {
        models: Record<
          string,
          {
            streamingMetrics?: {
              recentTTFTs?: number[];
              avgTTFT?: number;
              avgChunkCount?: number;
              maxChunkGapPercentiles?: { p50?: number; p95?: number; p99?: number };
            };
          }
        >;
      }
    >;
  };
}

export const StreamingTab = ({ metricsData }: StreamingTabProps) => {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Global Streaming Stats */}
      {metricsData?.global?.streaming && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-xl border border-cyan-500/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Streaming Requests</p>
                <p className="text-3xl font-bold text-cyan-400">
                  {metricsData.global.streaming.totalStreamingRequests || 0}
                </p>
              </div>
              <Radio className="w-10 h-10 text-cyan-500/50" />
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-teal-500/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Avg Chunks/Request</p>
                <p className="text-3xl font-bold text-teal-400">
                  {(metricsData.global.streaming.avgChunkCount || 0).toFixed(1)}
                </p>
              </div>
              <BarChart2 className="w-10 h-10 text-teal-500/50" />
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-yellow-500/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Avg TTFT</p>
                <p className="text-3xl font-bold text-yellow-400">
                  {Math.round(metricsData.global.streaming.avgTTFT || 0)}ms
                </p>
              </div>
              <Zap className="w-10 h-10 text-yellow-500/50" />
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl border border-purple-500/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Streaming %</p>
                <p className="text-3xl font-bold text-purple-400">
                  {(metricsData.global.streaming.streamingPercentage || 0).toFixed(1)}%
                </p>
              </div>
              <Gauge className="w-10 h-10 text-purple-500/50" />
            </div>
          </div>
        </div>
      )}

      {/* Streaming Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TTFT Distribution */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">TTFT Distribution</h3>
          {metricsData?.global?.streaming ? (
            <div className="space-y-4">
              {[
                {
                  label: 'Avg TTFT',
                  value: `${Math.round(metricsData.global.streaming.avgTTFT || 0)}ms`,
                  color: 'bg-yellow-500',
                },
                {
                  label: 'Avg Duration',
                  value: formatDurationMs(metricsData.global.streaming.avgStreamingDuration || 0),
                  color: 'bg-blue-500',
                },
                {
                  label: 'Avg Chunk Size',
                  value: `${((metricsData.global.streaming.avgChunkSizeBytes || 0) / 1024).toFixed(1)}KB`,
                  color: 'bg-cyan-500',
                },
                {
                  label: 'P95 Chunk Gap',
                  value: `${metricsData.global.streaming.p95ChunkGap || 0}ms`,
                  color: 'bg-red-500',
                },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">{item.label}</span>
                  <span className="text-white font-mono font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-center py-8">No streaming data available</div>
          )}
        </div>

        {/* Server:Model Streaming Breakdown */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Streaming by Server:Model</h3>
          {metricsData?.servers && Object.keys(metricsData.servers).length > 0 ? (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {Object.entries(metricsData.servers)
                .map(([serverId, serverData]) =>
                  Object.entries(serverData.models).map(([model, modelData]) => {
                    const streaming = (
                      modelData as {
                        streamingMetrics?: {
                          recentTTFTs?: number[];
                          avgTTFT?: number;
                          avgChunkCount?: number;
                          maxChunkGapPercentiles?: { p50?: number; p95?: number; p99?: number };
                        };
                      }
                    ).streamingMetrics;
                    if (!streaming) return null;
                    return (
                      <div key={`${serverId}:${model}`} className="bg-gray-900 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white text-sm font-medium truncate">
                            {serverId}:{model}
                          </span>
                          <span className="text-cyan-400 text-sm font-mono">
                            {streaming.recentTTFTs?.length || 0} streams
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">Avg TTFT</span>
                            <div className="text-yellow-400 font-mono">
                              {Math.round(streaming.avgTTFT || 0)}ms
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-500">Avg Chunks</span>
                            <div className="text-teal-400 font-mono">
                              {(streaming.avgChunkCount || 0).toFixed(1)}
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-500">P95 Gap</span>
                            <div className="text-red-400 font-mono">
                              {streaming.maxChunkGapPercentiles?.p95 || 0}ms
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )
                .filter(Boolean)}
            </div>
          ) : (
            <div className="text-gray-500 text-center py-8">
              No server:model streaming data available
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
