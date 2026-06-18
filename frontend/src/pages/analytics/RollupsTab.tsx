import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Calendar, Clock, TrendingUp } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getHourlyRollups, getDailyRollups, type HourlyRollup, type DailyRollup } from '../../api';
import { chartColors, uiColors } from '../../constants/colors';

interface RollupsTabProps {
  servers?: Array<{ id: string; name?: string }>;
  models?: string[];
}

type TimeRange = '24h' | '7d' | '30d';

function getStartTimeMs(range: TimeRange): number {
  const rangeMs: Record<TimeRange, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return Date.now() - rangeMs[range];
}

export const RollupsTab = ({ servers, models }: RollupsTabProps) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [serverFilter, setServerFilter] = useState<string>('');
  const [modelFilter, setModelFilter] = useState<string>('');

  const { data: hourlyData, isLoading: hourlyLoading } = useQuery({
    queryKey: ['hourlyRollups', timeRange, serverFilter, modelFilter],
    queryFn: () =>
      getHourlyRollups({
        startTime: getStartTimeMs(timeRange),
        serverId: serverFilter || undefined,
        model: modelFilter || undefined,
      }),
    enabled: true,
  });

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ['dailyRollups', timeRange, serverFilter, modelFilter],
    queryFn: () =>
      getDailyRollups({
        startTime: getStartTimeMs(timeRange),
        serverId: serverFilter || undefined,
        model: modelFilter || undefined,
      }),
    enabled: true,
  });

  const hourlyChartData = useMemo(() => {
    if (!hourlyData?.rollups) return [];
    return hourlyData.rollups
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(rollup => ({
        timestamp: new Date(rollup.timestamp).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        }),
        requests: rollup.requests,
        avgLatency: rollup.avgLatency,
        errorRate: (rollup.errorRate * 100).toFixed(1),
        p95Latency: rollup.p95Latency,
      }));
  }, [hourlyData]);

  const dailyChartData = useMemo(() => {
    if (!dailyData?.rollups) return [];
    return dailyData.rollups
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(rollup => ({
        timestamp: new Date(rollup.timestamp).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        requests: rollup.requests,
        avgLatency: rollup.avgLatency,
        errorRate: (rollup.errorRate * 100).toFixed(1),
        p95Latency: rollup.p95Latency,
      }));
  }, [dailyData]);

  const renderTable = (rollups: HourlyRollup[] | DailyRollup[], loading: boolean) => {
    if (loading) {
      return <div className="text-center py-8 text-text-muted">Loading rollup data...</div>;
    }

    if (!rollups || rollups.length === 0) {
      return (
        <div className="text-center py-8 text-text-muted">
          No rollup data available for the selected filters
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              <th className="text-left py-3 px-4 text-text-muted font-medium">Timestamp</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Server</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Model</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">Requests</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">Avg Latency</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">Error Rate</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">P95 Latency</th>
            </tr>
          </thead>
          <tbody>
            {rollups.map((rollup, idx) => (
              <tr
                key={`${rollup.serverId}-${rollup.model}-${rollup.timestamp}-${idx}`}
                className="border-b border-surface-border/50 hover:bg-surface-raised/50"
              >
                <td className="py-3 px-4 text-text-base font-mono text-xs">
                  {new Date(rollup.timestamp).toLocaleString()}
                </td>
                <td className="py-3 px-4 text-text-base">{rollup.serverId}</td>
                <td className="py-3 px-4 text-text-base truncate max-w-[150px]">{rollup.model}</td>
                <td className="py-3 px-4 text-right text-text-base font-mono">
                  {rollup.requests.toLocaleString()}
                </td>
                <td className="py-3 px-4 text-right text-text-base font-mono">
                  {Math.round(rollup.avgLatency)}ms
                </td>
                <td className="py-3 px-4 text-right">
                  <span
                    className={
                      rollup.errorRate > 0.05
                        ? 'text-red-400 font-mono'
                        : rollup.errorRate > 0.01
                          ? 'text-yellow-400 font-mono'
                          : 'text-green-400 font-mono'
                    }
                  >
                    {(rollup.errorRate * 100).toFixed(2)}%
                  </span>
                </td>
                <td className="py-3 px-4 text-right text-text-base font-mono">
                  {Math.round(rollup.p95Latency)}ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-lg font-semibold text-text-base">Request Rollups</h3>
          <p className="text-sm text-text-muted mt-1">Aggregated metrics by hour or day</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={timeRange}
            onChange={e => setTimeRange(e.target.value as TimeRange)}
            className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-text-base text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
          >
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>

          <select
            value={serverFilter}
            onChange={e => setServerFilter(e.target.value)}
            className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-text-base text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
          >
            <option value="">All Servers</option>
            {servers?.map(s => (
              <option key={s.id} value={s.id}>
                {s.name || s.id}
              </option>
            ))}
          </select>

          <select
            value={modelFilter}
            onChange={e => setModelFilter(e.target.value)}
            className="bg-surface border border-surface-border rounded-lg px-3 py-2 text-text-base text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
          >
            <option value="">All Models</option>
            {models?.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Tabs defaultValue="hourly" className="w-full">
        <TabsList>
          <TabsTrigger value="hourly" className="gap-2">
            <Clock className="w-4 h-4" />
            Hourly
          </TabsTrigger>
          <TabsTrigger value="daily" className="gap-2">
            <Calendar className="w-4 h-4" />
            Daily
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hourly" className="space-y-6">
          <div className="bg-surface rounded-xl border border-surface-border p-6">
            <h4 className="text-base font-semibold text-text-base mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              Request Volume (Hourly)
            </h4>
            {hourlyChartData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyChartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={uiColors.gridLine}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="timestamp"
                      stroke={uiColors.axisLabel}
                      fontSize={11}
                      minTickGap={40}
                    />
                    <YAxis stroke={uiColors.axisLabel} fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: uiColors.surfaceDark,
                        borderColor: uiColors.surfaceBorder,
                        color: uiColors.textLight,
                        borderRadius: '0.5rem',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="requests"
                      stroke={chartColors.blue}
                      strokeWidth={2}
                      dot={false}
                      name="Requests"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-text-muted">
                No hourly data available
              </div>
            )}
          </div>

          <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
            <div className="p-4 border-b border-surface-border">
              <h4 className="text-base font-semibold text-text-base">Hourly Rollup Details</h4>
            </div>
            {renderTable(hourlyData?.rollups || [], hourlyLoading)}
          </div>
        </TabsContent>

        <TabsContent value="daily" className="space-y-6">
          <div className="bg-surface rounded-xl border border-surface-border p-6">
            <h4 className="text-base font-semibold text-text-base mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-500" />
              Request Volume (Daily)
            </h4>
            {dailyChartData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyChartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={uiColors.gridLine}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="timestamp"
                      stroke={uiColors.axisLabel}
                      fontSize={11}
                      minTickGap={40}
                    />
                    <YAxis stroke={uiColors.axisLabel} fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: uiColors.surfaceDark,
                        borderColor: uiColors.surfaceBorder,
                        color: uiColors.textLight,
                        borderRadius: '0.5rem',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="requests"
                      stroke={chartColors.green}
                      strokeWidth={2}
                      dot={false}
                      name="Requests"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-text-muted">
                No daily data available
              </div>
            )}
          </div>

          <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
            <div className="p-4 border-b border-surface-border">
              <h4 className="text-base font-semibold text-text-base">Daily Rollup Details</h4>
            </div>
            {renderTable(dailyData?.rollups || [], dailyLoading)}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
