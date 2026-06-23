import React, { useState, useMemo, memo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  History,
  Clock,
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
} from 'lucide-react';
import { Card } from '../components/Card';
import { Badge as ShadcnBadge } from '../components/ui/badge';
import { Badge } from '../components/Badge';
import { Skeleton } from '../components/skeletons';
import { EmptyState } from '../components/EmptyState';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../components/ui/tooltip';
import { chartColors, uiColors } from '../constants/colors';
import { getServers } from '../api/servers';
import { listServerModels } from '../api/servers';
import {
  getPerfProbeHistory,
  getPerfProbeSchedulerStatus,
  getPerfProbeCoverageGrid,
  exportPerfProbeHistory,
  type PerfProbeHistoryParams,
  type PerfProbeDataPoint,
  type SchedulerStatusResponse,
  type PerfProbeCoverageGridResponse,
} from '../api/perf-probe';
import { formatTimeUntil } from '../utils/formatting';
import { toastSuccess, toastError } from '../utils/toast';

type TimeRange = '1h' | '24h' | '7d' | '30d';

interface TimeRangeConfig {
  label: string;
  durationMs: number;
  intervalMinutes: number;
}

const TIME_RANGE_CONFIGS: Record<TimeRange, TimeRangeConfig> = {
  '1h': { label: '1 Hour', durationMs: 1 * 3600 * 1000, intervalMinutes: 1 },
  '24h': { label: '24 Hours', durationMs: 24 * 3600 * 1000, intervalMinutes: 15 },
  '7d': { label: '7 Days', durationMs: 7 * 86400 * 1000, intervalMinutes: 60 },
  '30d': { label: '30 Days', durationMs: 30 * 86400 * 1000, intervalMinutes: 360 },
};

interface MetricToggle {
  key: 'ttft' | 'latency' | 'tokens' | 'success';
  label: string;
  color: string;
  checked: boolean;
}

const DEFAULT_METRICS: MetricToggle[] = [
  { key: 'ttft', label: 'TTFT avg (ms)', color: chartColors.blue, checked: true },
  { key: 'latency', label: 'Latency avg (ms)', color: chartColors.violet, checked: true },
  { key: 'tokens', label: 'Tokens/sec', color: chartColors.green, checked: false },
  { key: 'success', label: 'Success rate (%)', color: chartColors.orange, checked: false },
];

const formatXAxis = (timestamp: number, range: TimeRange): string => {
  const date = new Date(timestamp);
  if (range === '1h' || range === '24h') {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatTooltipTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const PerfProbeHistory = memo(() => {
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [metrics, setMetrics] = useState<MetricToggle[]>(DEFAULT_METRICS);
  const [coverageDays, setCoverageDays] = useState<number>(7);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');

  const { data: serversData, isLoading: serversLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
  });

  const servers = useMemo(() => serversData ?? [], [serversData]);

  const { data: modelsData, isLoading: modelsLoading } = useQuery({
    queryKey: ['server-models', selectedServer],
    queryFn: () => listServerModels(selectedServer),
    enabled: !!selectedServer,
  });

  interface ServerModelsResponse {
    models?: Array<{ name: string }>;
  }

  const models = useMemo(
    () => (modelsData as ServerModelsResponse | undefined)?.models?.map(m => m.name) ?? [],
    [modelsData]
  );

  const effectiveServerId = selectedServer || servers[0]?.id || '';
  const effectiveModelId = selectedModel || models[0] || '';

  const timeConfig = TIME_RANGE_CONFIGS[timeRange];

  const {
    data: historyData,
    isLoading: historyLoading,
    isError: historyError,
  } = useQuery({
    queryKey: ['perf-probe-history', effectiveServerId, effectiveModelId, timeRange],
    queryFn: () => {
      const now = Date.now();
      const params: PerfProbeHistoryParams = {
        serverId: effectiveServerId,
        model: effectiveModelId || undefined,
        startTime: now - timeConfig.durationMs,
        endTime: now,
        intervalMinutes: timeConfig.intervalMinutes,
      };
      return getPerfProbeHistory(params);
    },
    enabled: !!effectiveServerId,
    refetchInterval: 60000,
  });

  const { data: schedulerData, isLoading: schedulerLoading } = useQuery<SchedulerStatusResponse>({
    queryKey: ['perf-probe-scheduler-status'],
    queryFn: getPerfProbeSchedulerStatus,
    refetchInterval: 30000,
  });

  const { data: coverageData, isLoading: coverageLoading } =
    useQuery<PerfProbeCoverageGridResponse>({
      queryKey: ['perf-probe-coverage-grid', coverageDays, effectiveServerId],
      queryFn: () =>
        getPerfProbeCoverageGrid({ days: coverageDays, serverId: effectiveServerId || undefined }),
      refetchInterval: 120000,
    });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const now = Date.now();
      const { blob, filename } = await exportPerfProbeHistory({
        serverId: effectiveServerId,
        model: effectiveModelId || undefined,
        startTime: now - timeConfig.durationMs,
        endTime: now,
        format: exportFormat,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toastSuccess('Export downloaded successfully'),
    onError: (err: unknown) => toastError(err instanceof Error ? err.message : 'Export failed'),
  });

  const toggleMetric = (key: 'ttft' | 'latency' | 'tokens' | 'success') => {
    setMetrics(prev => prev.map(m => (m.key === key ? { ...m, checked: !m.checked } : m)));
  };

  const chartData: PerfProbeDataPoint[] = historyData?.dataPoints ?? [];

  const cycleEndsIn = schedulerData?.cycleEndsAt
    ? formatTimeUntil(schedulerData.cycleEndsAt)
    : 'N/A';

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-text-base tracking-tight">
            Performance Probe History
          </h2>
          <p className="text-text-muted mt-1">Historical probe results per server</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-text-base focus:outline-none focus:ring-2 focus:ring-ring"
            value={exportFormat}
            onChange={e => setExportFormat(e.target.value as 'csv' | 'json')}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <button
            onClick={() => exportMutation.mutate()}
            disabled={!effectiveServerId || exportMutation.isPending}
            className="flex items-center gap-2 h-9 px-4 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {exportMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Export
          </button>
        </div>
      </div>

      <Card padding="md">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1.5 min-w-[180px]">
            <label className="text-sm text-text-muted">Server</label>
            {serversLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <select
                className="h-9 w-full rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-text-base focus:outline-none focus:ring-2 focus:ring-ring"
                value={effectiveServerId}
                onChange={e => {
                  setSelectedServer(e.target.value);
                  setSelectedModel('');
                }}
              >
                <option value="">Select server</option>
                {servers.map(server => (
                  <option key={server.id} value={server.id}>
                    {server.id}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1.5 min-w-[180px]">
            <label className="text-sm text-text-muted">Model</label>
            {modelsLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <select
                className="h-9 w-full rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-text-base focus:outline-none focus:ring-2 focus:ring-ring"
                value={effectiveModelId}
                onChange={e => setSelectedModel(e.target.value)}
                disabled={!effectiveServerId}
              >
                <option value="">All models</option>
                {models.map(model => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-text-muted">Time Range</label>
            <div className="flex gap-1 bg-surface rounded-md p-1 border border-surface-border">
              {(Object.keys(TIME_RANGE_CONFIGS) as TimeRange[]).map(range => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    timeRange === range
                      ? 'bg-primary text-text-base'
                      : 'text-text-muted hover:text-text-base hover:bg-surface-raised'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card padding="md">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-text-base flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-500" />
            Metrics Over Time
          </h3>
        </div>

        <div className="flex flex-wrap gap-4 mb-6">
          {metrics.map(metric => (
            <label key={metric.key} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={metric.checked}
                onChange={() => toggleMetric(metric.key)}
                className="w-4 h-4 rounded border-surface-border bg-surface text-primary focus:ring-primary"
              />
              <span className="text-sm text-text-base flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded-full bg-[${metric.color}]`} />
                {metric.label}
              </span>
            </label>
          ))}
        </div>

        {historyLoading ? (
          <div className="h-80 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : historyError || chartData.length === 0 ? (
          <EmptyState
            type="empty"
            title="No probe data available"
            message="There is no probe history data for the selected server and time range."
          />
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={uiColors.gridLine} vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={ts => formatXAxis(ts, timeRange)}
                  stroke={uiColors.axisLabel}
                />
                <YAxis stroke={uiColors.axisLabel} />
                <ChartTooltip
                  contentStyle={{
                    backgroundColor: uiColors.surfaceDark,
                    borderColor: uiColors.surfaceBorder,
                    color: uiColors.textLight,
                    borderRadius: '8px',
                  }}
                  labelFormatter={ts => formatTooltipTime(ts as number)}
                />
                {metrics.find(m => m.key === 'ttft')?.checked && (
                  <Line
                    type="monotone"
                    dataKey="ttft_avg"
                    stroke={chartColors.blue}
                    name="TTFT avg (ms)"
                    dot={false}
                    connectNulls
                  />
                )}
                {metrics.find(m => m.key === 'latency')?.checked && (
                  <Line
                    type="monotone"
                    dataKey="latency_avg"
                    stroke={chartColors.violet}
                    name="Latency avg (ms)"
                    dot={false}
                    connectNulls
                  />
                )}
                {metrics.find(m => m.key === 'tokens')?.checked && (
                  <Line
                    type="monotone"
                    dataKey="tokens_per_sec_avg"
                    stroke={chartColors.green}
                    name="Tokens/sec"
                    dot={false}
                    connectNulls
                  />
                )}
                {metrics.find(m => m.key === 'success')?.checked && (
                  <Line
                    type="monotone"
                    dataKey="success_rate"
                    stroke={chartColors.orange}
                    name="Success rate (%)"
                    dot={false}
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card padding="md">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-base flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-500" />
            Probe Coverage Heatmap
          </h3>
          <div className="flex gap-1 bg-surface rounded-md p-1 border border-surface-border">
            {[7, 14, 30].map(d => (
              <button
                key={d}
                onClick={() => setCoverageDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  coverageDays === d
                    ? 'bg-primary text-text-base'
                    : 'text-text-muted hover:text-text-base hover:bg-surface-raised'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {coverageLoading ? (
          <div className="h-48 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : coverageData?.grid && coverageData.grid.length > 0 ? (
          <div>
            <div className="grid grid-cols-[auto_repeat(24,1fr)] gap-0.5">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, dayIdx) => (
                <React.Fragment key={dayIdx}>
                  <div className="text-xs text-text-muted pr-2 flex items-center">{day}</div>
                  {Array.from({ length: 24 }).map((_, hour) => {
                    const cell = coverageData.grid.find(
                      c => c.dayOfWeek === dayIdx && c.hourOfDay === hour
                    );
                    const count = cell?.count ?? 0;
                    const maxCount = Math.max(...coverageData.grid.map(c => c.count), 1);
                    const intensity =
                      maxCount > 0 ? Math.log(count + 1) / Math.log(maxCount + 1) : 0;
                    const bgClass =
                      intensity > 0
                        ? intensity < 0.3
                          ? 'bg-blue-400'
                          : intensity < 0.6
                            ? 'bg-blue-500'
                            : intensity < 0.85
                              ? 'bg-blue-600'
                              : 'bg-blue-700'
                        : 'bg-gray-800';
                    return (
                      <div
                        key={hour}
                        className={`aspect-square rounded-sm cursor-default relative group ${bgClass}`}
                        title={`${day} ${hour.toString().padStart(2, '0')}:00 — ${count} probe${count !== 1 ? 's' : ''}`}
                      >
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-surface-dark border border-surface-border rounded px-2 py-1 text-xs text-text-light whitespace-nowrap z-10 pointer-events-none">
                          {day} {hour.toString().padStart(2, '0')}:00 — {count} probe
                          {count !== 1 ? 's' : ''}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-text-muted">
              <span>Coverage intensity</span>
              <div className="flex items-center gap-1">
                <span className="text-xs">Low</span>
                {[0.1, 0.3, 0.5, 0.7, 1.0].map((_, i) => (
                  <div
                    key={i}
                    className={
                      i === 0
                        ? 'w-3 h-3 rounded-sm bg-blue-400/40'
                        : i === 1
                          ? 'w-3 h-3 rounded-sm bg-blue-400/60'
                          : i === 2
                            ? 'w-3 h-3 rounded-sm bg-blue-400/80'
                            : i === 3
                              ? 'w-3 h-3 rounded-sm bg-blue-400'
                              : 'w-3 h-3 rounded-sm bg-blue-600'
                    }
                  />
                ))}
                <span className="text-xs">High</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center">
            <p className="text-text-muted text-sm">No probe coverage data available.</p>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card padding="md">
          <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-500" />
            Scheduler Status
          </h3>

          {schedulerLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          ) : schedulerData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-surface-raised rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {schedulerData.running ? (
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-gray-500" />
                    )}
                    <span className="text-xs text-text-muted uppercase tracking-wider">Status</span>
                  </div>
                  <p className="text-lg font-semibold text-text-base">
                    {schedulerData.running ? 'Running' : 'Stopped'}
                  </p>
                </div>

                <div className="bg-surface-raised rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-xs text-text-muted uppercase tracking-wider">
                      Cycle Ends
                    </span>
                  </div>
                  <p className="text-lg font-semibold text-text-base">{cycleEndsIn}</p>
                </div>

                <div className="bg-surface-raised rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-xs text-text-muted uppercase tracking-wider">
                      Completed
                    </span>
                  </div>
                  <p className="text-lg font-semibold text-text-base">
                    {schedulerData.stats.totalCompletedToday.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-surface-raised rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs text-text-muted uppercase tracking-wider">
                      Scheduled
                    </span>
                  </div>
                  <p className="text-lg font-semibold text-text-base">
                    {schedulerData.stats.totalScheduledToday.toLocaleString()}
                  </p>
                </div>

                <div className="bg-surface-raised rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-xs text-text-muted uppercase tracking-wider">Failed</span>
                  </div>
                  <p className="text-lg font-semibold text-text-base">
                    {schedulerData.stats.totalFailedToday.toLocaleString()}
                  </p>
                </div>

                <div className="bg-surface-raised rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                    <span className="text-xs text-text-muted uppercase tracking-wider">
                      Cooldown Skip
                    </span>
                  </div>
                  <p className="text-lg font-semibold text-text-base">
                    {schedulerData.stats.totalSkippedCooldown.toLocaleString()}
                  </p>
                </div>
              </div>

              <TooltipProvider>
                <div className="mt-4">
                  <h4 className="text-sm font-semibold mb-2">Skip Reasons</h4>
                  {schedulerData.stats.totalSkippedCooldown === 0 &&
                  schedulerData.stats.totalSkippedConcurrency === 0 &&
                  schedulerData.stats.totalFailedToday === 0 ? (
                    <p className="text-xs text-text-muted">No skips recorded</p>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="neutral" size="sm">
                            Cooldown: {schedulerData.stats.totalSkippedCooldown.toLocaleString()}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          Skipped because the same (server, model) was probed within the last 5
                          minutes (likely by an on-demand probe)
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="warning" size="sm">
                            Concurrency:{' '}
                            {schedulerData.stats.totalSkippedConcurrency.toLocaleString()}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          Skipped because the global probe concurrency cap was reached. Try
                          increasing PERF_PROBE_MAX_CONCURRENT.
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="danger" size="sm">
                            Failed: {schedulerData.stats.totalFailedToday.toLocaleString()}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          All attempts failed including cross-model fallback. Check the server's
                          health.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </TooltipProvider>
            </div>
          ) : (
            <p className="text-text-muted text-sm">Unable to load scheduler status.</p>
          )}
        </Card>

        <Card padding="md">
          <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-500" />
            Current Probes
          </h3>

          {schedulerLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : schedulerData?.currentProbes && schedulerData.currentProbes.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {schedulerData.currentProbes.map((probe, idx) => (
                <div
                  key={`${probe.serverId}-${probe.model}-${idx}`}
                  className="flex items-center justify-between bg-surface-raised rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-text-base">{probe.serverId}</span>
                    <span className="text-text-subtle">/</span>
                    <span className="text-sm text-text-base">{probe.model}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {probe.isRunning ? (
                      <ShadcnBadge variant="outline" className="text-blue-400 border-blue-400/50">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mr-1.5 animate-pulse" />
                        running
                      </ShadcnBadge>
                    ) : (
                      <ShadcnBadge
                        variant="outline"
                        className="text-text-muted border-surface-border"
                      >
                        fires in {formatTimeUntil(probe.firesAt)}
                      </ShadcnBadge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-text-muted text-sm">No probes currently scheduled.</p>
          )}
        </Card>
      </div>
    </div>
  );
});

export default PerfProbeHistory;
