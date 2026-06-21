import { useMemo } from 'react';
import { Radio, BarChart2, Zap, Gauge, Layers, Timer } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { formatDurationMs } from '../../utils/formatting';
import { chartColors, uiColors } from '../../constants/colors';

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
        ttftPercentiles?: { p50?: number; p95?: number; p99?: number };
        chunkCountPercentiles?: { p50?: number; p95?: number; p99?: number };
        streamingDurationPercentiles?: { p50?: number; p95?: number; p99?: number };
        recentChunkCounts?: number[];
        recentStreamingDurations?: number[];
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
              avgStreamingDuration?: number;
              avgChunkSizeBytes?: number;
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
          <div className="bg-surface rounded-xl border border-cyan-500/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-muted text-sm">Streaming Requests</p>
                <p className="text-3xl font-bold text-cyan-400">
                  {metricsData.global.streaming.totalStreamingRequests || 0}
                </p>
              </div>
              <Radio className="w-10 h-10 text-cyan-500/50" />
            </div>
          </div>
          <div className="bg-surface rounded-xl border border-teal-500/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-muted text-sm">Avg Chunks/Request</p>
                <p className="text-3xl font-bold text-teal-400">
                  {(metricsData.global.streaming.avgChunkCount || 0).toFixed(1)}
                </p>
              </div>
              <BarChart2 className="w-10 h-10 text-teal-500/50" />
            </div>
          </div>
          <div className="bg-surface rounded-xl border border-yellow-500/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-muted text-sm">Avg TTFT</p>
                <p className="text-3xl font-bold text-yellow-400">
                  {Math.round(metricsData.global.streaming.avgTTFT || 0)}ms
                </p>
              </div>
              <Zap className="w-10 h-10 text-yellow-500/50" />
            </div>
          </div>
          <div className="bg-surface rounded-xl border border-purple-500/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-muted text-sm">Streaming %</p>
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
        <div className="bg-surface rounded-xl border border-surface-border p-6">
          <h3 className="text-lg font-semibold text-text-base mb-4">TTFT Distribution</h3>
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
                  <span className="text-text-muted text-sm">{item.label}</span>
                  <span className="text-text-base font-mono font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-text-subtle text-center py-8">No streaming data available</div>
          )}
        </div>

        {/* Server:Model Streaming Breakdown */}
        <div className="bg-surface rounded-xl border border-surface-border p-6">
          <h3 className="text-lg font-semibold text-text-base mb-4">Streaming by Server:Model</h3>
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
                          avgStreamingDuration?: number;
                          avgChunkSizeBytes?: number;
                          maxChunkGapPercentiles?: { p50?: number; p95?: number; p99?: number };
                        };
                      }
                    ).streamingMetrics;
                    if (!streaming) return null;
                    return (
                      <div
                        key={`${serverId}:${model}`}
                        className="bg-surface-raised rounded-lg p-3"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-text-base text-sm font-medium truncate">
                            {serverId}:{model}
                          </span>
                          <span className="text-cyan-400 text-sm font-mono">
                            {streaming.recentTTFTs?.length || 0} samples
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="text-text-subtle">Avg TTFT</span>
                            <div className="text-yellow-400 font-mono">
                              {Math.round(streaming.avgTTFT || 0)}ms
                            </div>
                          </div>
                          <div>
                            <span className="text-text-subtle">Avg Chunks</span>
                            <div className="text-teal-400 font-mono">
                              {(streaming.avgChunkCount || 0).toFixed(1)}
                            </div>
                          </div>
                          <div>
                            <span className="text-text-subtle">P95 Gap</span>
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
            <div className="text-text-subtle text-center py-8">
              No server:model streaming data available
            </div>
          )}
        </div>
      </div>

      {/* TTFT Percentile Histogram */}
      {metricsData?.global?.streaming?.ttftPercentiles && (
        <div className="bg-surface rounded-xl border border-surface-border p-6">
          <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            TTFT Percentiles
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { label: 'P50', value: metricsData.global.streaming.ttftPercentiles?.p50 || 0 },
                  { label: 'P95', value: metricsData.global.streaming.ttftPercentiles?.p95 || 0 },
                  { label: 'P99', value: metricsData.global.streaming.ttftPercentiles?.p99 || 0 },
                ]}
                layout="vertical"
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={uiColors.gridLine}
                  horizontal={true}
                  vertical={false}
                />
                <XAxis type="number" stroke={uiColors.axisLabel} fontSize={12} unit="ms" />
                <YAxis
                  type="category"
                  dataKey="label"
                  stroke={uiColors.axisLabel}
                  fontSize={12}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: uiColors.surfaceDark,
                    borderColor: uiColors.surfaceBorder,
                    color: uiColors.textLight,
                    borderRadius: '0.5rem',
                  }}
                  formatter={(value: number | undefined) => [`${Math.round(value ?? 0)}ms`, 'TTFT']}
                />
                <Bar dataKey="value" name="TTFT" radius={[0, 4, 4, 0]}>
                  {[chartColors.green, chartColors.yellow, chartColors.red].map((color, index) => (
                    <Cell key={`cell-${index}`} fill={color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Chunk Count Distribution */}
      {metricsData?.global?.streaming?.recentChunkCounts &&
        metricsData.global.streaming.recentChunkCounts.length > 0 && (
          <div className="bg-surface rounded-xl border border-surface-border p-6">
            <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
              <Layers className="w-5 h-5 text-teal-500" />
              Chunk Count Distribution
            </h3>
            <ChunkDistributionChart chunkCounts={metricsData.global.streaming.recentChunkCounts} />
          </div>
        )}

      {/* Stream Duration Distribution */}
      {metricsData?.global?.streaming?.recentStreamingDurations &&
        metricsData.global.streaming.recentStreamingDurations.length > 0 && (
          <div className="bg-surface rounded-xl border border-surface-border p-6">
            <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
              <Timer className="w-5 h-5 text-purple-500" />
              Stream Duration Distribution
            </h3>
            <StreamDurationChart
              durations={metricsData.global.streaming.recentStreamingDurations}
            />
          </div>
        )}

      {/* Per-Server Streaming Metrics Table */}
      {metricsData?.servers && Object.keys(metricsData.servers).length > 0 && (
        <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
          <div className="p-4 border-b border-surface-border">
            <h3 className="text-lg font-semibold text-text-base">Per-Server Streaming Metrics</h3>
          </div>
          <PerServerStreamingTable servers={metricsData.servers} />
        </div>
      )}
    </div>
  );
};

function ChunkDistributionChart({ chunkCounts }: { chunkCounts: number[] }) {
  const buckets = useMemo(() => {
    const min = Math.min(...chunkCounts);
    const max = Math.max(...chunkCounts);
    const bucketCount = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(chunkCounts.length))));
    const bucketSize = (max - min) / bucketCount || 1;

    const counts: number[] = new Array(bucketCount).fill(0);
    chunkCounts.forEach(count => {
      const bucketIdx = Math.min(Math.floor((count - min) / bucketSize), bucketCount - 1);
      counts[bucketIdx]++;
    });

    return Array.from({ length: bucketCount }, (_, i) => ({
      range: `${Math.round(min + i * bucketSize)}-${Math.round(min + (i + 1) * bucketSize)}`,
      count: counts[i],
    }));
  }, [chunkCounts]);

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets}>
          <CartesianGrid strokeDasharray="3 3" stroke={uiColors.gridLine} vertical={false} />
          <XAxis dataKey="range" stroke={uiColors.axisLabel} fontSize={11} />
          <YAxis stroke={uiColors.axisLabel} fontSize={12} />
          <Tooltip
            contentStyle={{
              backgroundColor: uiColors.surfaceDark,
              borderColor: uiColors.surfaceBorder,
              color: uiColors.textLight,
              borderRadius: '0.5rem',
            }}
            formatter={(value: number | undefined) => [value ?? 0, 'Requests']}
          />
          <Bar dataKey="count" fill={chartColors.teal} radius={[4, 4, 0, 0]} name="Requests" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StreamDurationChart({ durations }: { durations: number[] }) {
  const buckets = useMemo(() => {
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    const bucketCount = Math.min(10, Math.max(5, Math.ceil(Math.sqrt(durations.length))));
    const bucketSize = (max - min) / bucketCount || 1;

    const counts: number[] = new Array(bucketCount).fill(0);
    durations.forEach(dur => {
      const bucketIdx = Math.min(Math.floor((dur - min) / bucketSize), bucketCount - 1);
      counts[bucketIdx]++;
    });

    return Array.from({ length: bucketCount }, (_, i) => ({
      range: `${formatDurationMs(min + i * bucketSize)}-${formatDurationMs(min + (i + 1) * bucketSize)}`,
      count: counts[i],
    }));
  }, [durations]);

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets}>
          <CartesianGrid strokeDasharray="3 3" stroke={uiColors.gridLine} vertical={false} />
          <XAxis dataKey="range" stroke={uiColors.axisLabel} fontSize={11} />
          <YAxis stroke={uiColors.axisLabel} fontSize={12} />
          <Tooltip
            contentStyle={{
              backgroundColor: uiColors.surfaceDark,
              borderColor: uiColors.surfaceBorder,
              color: uiColors.textLight,
              borderRadius: '0.5rem',
            }}
            formatter={(value: number | undefined) => [value ?? 0, 'Requests']}
          />
          <Bar dataKey="count" fill={chartColors.purple} radius={[4, 4, 0, 0]} name="Requests" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface ServerModels {
  models: Record<
    string,
    {
      streamingMetrics?: {
        recentTTFTs?: number[];
        avgTTFT?: number;
        avgStreamingDuration?: number;
        avgChunkSizeBytes?: number;
      };
    }
  >;
}

function PerServerStreamingTable({ servers }: { servers: Record<string, ServerModels> }) {
  const rows = useMemo(() => {
    const result: Array<{
      serverId: string;
      model: string;
      avgTTFT: number;
      avgDuration: number;
      avgChunkSize: number;
      sampleCount: number;
    }> = [];

    Object.entries(servers).forEach(([serverId, serverData]) => {
      Object.entries(serverData.models).forEach(([model, modelData]) => {
        const streaming = (
          modelData as {
            streamingMetrics?: {
              recentTTFTs?: number[];
              avgTTFT?: number;
              avgStreamingDuration?: number;
              avgChunkSizeBytes?: number;
            };
          }
        ).streamingMetrics;

        if (streaming) {
          result.push({
            serverId,
            model,
            avgTTFT: streaming.avgTTFT || 0,
            avgDuration: streaming.avgStreamingDuration || 0,
            avgChunkSize: streaming.avgChunkSizeBytes || 0,
            sampleCount: streaming.recentTTFTs?.length || 0,
          });
        }
      });
    });

    return result;
  }, [servers]);

  if (rows.length === 0) {
    return <div className="text-center py-8 text-text-muted">No streaming metrics available</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border">
            <th className="text-left py-3 px-4 text-text-muted font-medium">Server</th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">Model</th>
            <th className="text-right py-3 px-4 text-text-muted font-medium">Avg TTFT</th>
            <th className="text-right py-3 px-4 text-text-muted font-medium">Avg Duration</th>
            <th className="text-right py-3 px-4 text-text-muted font-medium">Avg Chunk Size</th>
            <th className="text-right py-3 px-4 text-text-muted font-medium">Samples</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: (typeof rows)[number]) => (
            <tr
              key={`${row.serverId}:${row.model}`}
              className="border-b border-surface-border/50 hover:bg-surface-raised/50"
            >
              <td className="py-3 px-4 text-text-base">{row.serverId}</td>
              <td className="py-3 px-4 text-text-base truncate max-w-[150px]">{row.model}</td>
              <td className="py-3 px-4 text-right text-yellow-400 font-mono">
                {Math.round(row.avgTTFT)}ms
              </td>
              <td className="py-3 px-4 text-right text-blue-400 font-mono">
                {formatDurationMs(row.avgDuration)}
              </td>
              <td className="py-3 px-4 text-right text-teal-400 font-mono">
                {(row.avgChunkSize / 1024).toFixed(1)}KB
              </td>
              <td className="py-3 px-4 text-right text-text-muted font-mono">{row.sampleCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
