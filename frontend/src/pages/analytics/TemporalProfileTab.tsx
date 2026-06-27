import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Grid3X3, Settings2, Lightbulb, AlertCircle } from 'lucide-react';
import { getTemporalProfile, getTemporalAdjustment } from '../../api';

interface TemporalProfileTabProps {
  servers?: Array<{ id: string; name?: string }>;
  models?: string[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export const TemporalProfileTab = ({ servers, models }: TemporalProfileTabProps) => {
  const [serverFilter, setServerFilter] = useState<string>('');
  const [modelFilter, setModelFilter] = useState<string>('');

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ['temporalProfile', serverFilter, modelFilter],
    queryFn: () =>
      getTemporalProfile({
        serverId: serverFilter || servers?.[0]?.id || '',
        model: modelFilter || models?.[0] || '',
      }),
    enabled: !!(serverFilter || servers?.[0]?.id) && !!(modelFilter || models?.[0]),
  });

  const { data: adjustmentData, isLoading: adjustmentLoading } = useQuery({
    queryKey: ['temporalAdjustment', modelFilter || models?.[0]],
    queryFn: () =>
      getTemporalAdjustment({
        model: modelFilter || models?.[0] || '',
        serverIds: serverFilter ? [serverFilter] : undefined,
      }),
    enabled: !!(modelFilter || models?.[0]),
  });

  const heatmapData = useMemo(() => {
    if (!profileData?.profile) return [];

    const grid: Record<string, number> = {};
    let maxCount = 0;

    profileData.profile.forEach(p => {
      const key = `${p.dayOfWeek}-${p.hourOfDay}`;
      grid[key] = (grid[key] || 0) + p.requestCount;
      maxCount = Math.max(maxCount, grid[key]);
    });

    const cells = [];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const key = `${day}-${hour}`;
        const count = grid[key] || 0;
        cells.push({
          day,
          hour,
          count,
          intensity: maxCount > 0 ? count / maxCount : 0,
        });
      }
    }
    return cells;
  }, [profileData]);

  const insights = useMemo(() => {
    if (!adjustmentData?.adjustments || adjustmentData.adjustments.length === 0) {
      return [];
    }

    const insightsList = [];
    const adjustments = adjustmentData.adjustments;

    const highLatencyServers = adjustments.filter(a => a.latencyMultiplier > 1.2);
    if (highLatencyServers.length > 0) {
      insightsList.push({
        type: 'warning',
        message: `${highLatencyServers.length} server(s) show >20% latency increase - consider routing to faster alternatives`,
      });
    }

    const lowSuccessServers = adjustments.filter(a => a.successMultiplier < 0.95);
    if (lowSuccessServers.length > 0) {
      insightsList.push({
        type: 'error',
        message: `${lowSuccessServers.length} server(s) have reduced success rates during certain time periods`,
      });
    }

    const highThroughputServers = adjustments.filter(a => a.throughputMultiplier > 1.3);
    if (highThroughputServers.length > 0) {
      insightsList.push({
        type: 'success',
        message: `${highThroughputServers.length} server(s) show >30% throughput improvement during peak hours`,
      });
    }

    const avgLatencyMultiplier =
      adjustments.reduce((sum, a) => sum + a.latencyMultiplier, 0) / adjustments.length;
    if (avgLatencyMultiplier > 1.1) {
      insightsList.push({
        type: 'info',
        message: `Average latency multiplier across servers is ${(avgLatencyMultiplier * 100 - 100).toFixed(0)}% - consider this for capacity planning`,
      });
    }

    return insightsList;
  }, [adjustmentData]);

  const getHeatmapColor = (intensity: number) => {
    if (intensity === 0) return 'bg-surface-raised';
    if (intensity < 0.25) return 'bg-blue-900/50';
    if (intensity < 0.5) return 'bg-blue-700/60';
    if (intensity < 0.75) return 'bg-blue-500/70';
    return 'bg-blue-400/80';
  };

  const renderHeatmap = () => {
    if (profileLoading) {
      return (
        <div className="text-center py-12 text-text-muted">Loading temporal profile data...</div>
      );
    }

    if (heatmapData.length === 0) {
      return (
        <div className="text-center py-12 text-text-muted">No temporal profile data available</div>
      );
    }

    return (
      <div className="space-y-2">
        <div className="flex">
          <div className="w-12" />
          <div className="flex-1 grid grid-cols-24 gap-0.5">
            {HOURS.map(hour => (
              <div key={hour} className="text-center text-xs text-text-subtle text-[10px]">
                {hour}
              </div>
            ))}
          </div>
        </div>

        {DAYS.map((day, dayIdx) => (
          <div key={day} className="flex items-center">
            <div className="w-12 text-sm text-text-muted">{day}</div>
            <div className="flex-1 grid grid-cols-24 gap-0.5">
              {HOURS.map(hour => {
                const cell = heatmapData.find(c => c.day === dayIdx && c.hour === hour);
                return (
                  <div
                    key={hour}
                    className={`aspect-square rounded-sm ${getHeatmapColor(cell?.intensity || 0)} transition-colors`}
                    title={`${day} ${hour}:00 - ${cell?.count || 0} requests`}
                  />
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-end gap-2 mt-4">
          <span className="text-xs text-text-subtle">Low</span>
          <div className="flex gap-0.5">
            <div className="w-4 h-4 bg-surface-raised rounded-sm" />
            <div className="w-4 h-4 bg-blue-900/50 rounded-sm" />
            <div className="w-4 h-4 bg-blue-700/60 rounded-sm" />
            <div className="w-4 h-4 bg-blue-500/70 rounded-sm" />
            <div className="w-4 h-4 bg-blue-400/80 rounded-sm" />
          </div>
          <span className="text-xs text-text-subtle">High</span>
        </div>
      </div>
    );
  };

  const renderAdjustmentsTable = () => {
    if (adjustmentLoading) {
      return <div className="text-center py-8 text-text-muted">Loading adjustment data...</div>;
    }

    if (!adjustmentData?.adjustments || adjustmentData.adjustments.length === 0) {
      return <div className="text-center py-8 text-text-muted">No adjustment data available</div>;
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border">
              <th className="text-left py-3 px-4 text-text-muted font-medium">Server</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">Latency Mult</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">Success Mult</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">Throughput Mult</th>
              <th className="text-right py-3 px-4 text-text-muted font-medium">Samples</th>
            </tr>
          </thead>
          <tbody>
            {adjustmentData.adjustments.map(adj => (
              <tr
                key={adj.serverId}
                className="border-b border-surface-border/50 hover:bg-surface-raised/50"
              >
                <td className="py-3 px-4 text-text-base">{adj.serverId}</td>
                <td className="py-3 px-4 text-right">
                  <span
                    className={
                      adj.latencyMultiplier > 1.2
                        ? 'text-red-400 font-mono'
                        : adj.latencyMultiplier > 1.05
                          ? 'text-yellow-400 font-mono'
                          : 'text-green-400 font-mono'
                    }
                  >
                    {adj.latencyMultiplier.toFixed(2)}x
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  <span
                    className={
                      adj.successMultiplier < 0.95
                        ? 'text-red-400 font-mono'
                        : adj.successMultiplier < 0.98
                          ? 'text-yellow-400 font-mono'
                          : 'text-green-400 font-mono'
                    }
                  >
                    {adj.successMultiplier.toFixed(2)}x
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  <span
                    className={
                      adj.throughputMultiplier > 1.2
                        ? 'text-green-400 font-mono'
                        : adj.throughputMultiplier < 0.8
                          ? 'text-red-400 font-mono'
                          : 'text-text-base font-mono'
                    }
                  >
                    {adj.throughputMultiplier.toFixed(2)}x
                  </span>
                </td>
                <td className="py-3 px-4 text-right text-text-muted font-mono">
                  {adj.sampleCount.toLocaleString()}
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
          <h3 className="text-lg font-semibold text-text-base">Temporal Profile</h3>
          <p className="text-sm text-text-muted mt-1">
            Request distribution by day/hour with adjustment factors
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
            <option value="">Select Model</option>
            {models?.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-surface rounded-xl border border-surface-border p-6">
          <h4 className="text-base font-semibold text-text-base mb-4 flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-purple-500" />
            Request Heatmap (7 days × 24 hours)
          </h4>
          {renderHeatmap()}
        </div>

        <div className="bg-surface rounded-xl border border-surface-border p-6">
          <h4 className="text-base font-semibold text-text-base mb-4 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-yellow-500" />
            Insights
          </h4>
          {insights.length > 0 ? (
            <div className="space-y-3">
              {insights.map((insight, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border ${
                    insight.type === 'error'
                      ? 'bg-red-500/10 border-red-500/30 text-red-400'
                      : insight.type === 'warning'
                        ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                        : insight.type === 'success'
                          ? 'bg-green-500/10 border-green-500/30 text-green-400'
                          : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{insight.message}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-text-muted">No insights available yet</div>
          )}
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
        <div className="p-4 border-b border-surface-border">
          <h4 className="text-base font-semibold text-text-base flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-teal-500" />
            Per-Server Adjustment Factors
          </h4>
        </div>
        {renderAdjustmentsTable()}
      </div>
    </div>
  );
};
