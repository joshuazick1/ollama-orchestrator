import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
  Rectangle,
} from 'recharts';
import { GitBranch, Target } from 'lucide-react';
import { CHART_PALETTE, chartColors, uiColors } from '../../constants/colors';

interface PieCellProps {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  fill?: string;
  index?: number;
}

const ColoredPieCell = (props: PieCellProps) => (
  <Rectangle {...props} fill={CHART_PALETTE[props.index ?? 0 % CHART_PALETTE.length]} />
);

interface DecisionsTabProps {
  decisionHistory?: {
    events?: Array<{
      model: string;
      selectedServerId: string;
      algorithm: string;
      timestamp: string;
      selectionReason: string;
    }>;
  };
  algorithmStats?: {
    algorithms?: Record<string, { count: number; percentage: number }>;
  };
  scoreTimeline?: {
    dataPoints?: Array<{
      timestamp: string;
      avgScore: number;
      minScore: number;
      maxScore: number;
    }>;
  };
  metricsImpact?: {
    impact?: {
      latency: { correlation: number; weight: number };
      successRate: { correlation: number; weight: number };
      load: { correlation: number; weight: number };
      capacity: { correlation: number; weight: number };
    };
  };
  selectionStats?: {
    stats?: Array<{
      serverId: string;
      totalSelections: number;
      avgScore: number;
      byModel: Record<string, number>;
    }>;
  };
}

export const DecisionsTab = ({
  decisionHistory,
  algorithmStats,
  scoreTimeline,
  metricsImpact,
  selectionStats,
}: DecisionsTabProps) => {
  const algorithmData = useMemo(
    () =>
      algorithmStats?.algorithms
        ? Object.entries(algorithmStats.algorithms).map(([name, data]) => {
            const d = data as { count: number; percentage: number };
            return {
              name,
              count: d.count,
              percentage: d.percentage,
            };
          })
        : [],
    [algorithmStats]
  );

  const scoreData = useMemo(
    () =>
      scoreTimeline?.dataPoints?.map(point => ({
        timestamp: new Date(point.timestamp).toLocaleTimeString(),
        avgScore: point.avgScore,
        minScore: point.minScore,
        maxScore: point.maxScore,
      })) || [],
    [scoreTimeline]
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Algorithm Usage */}
        <div className="bg-surface rounded-xl border border-surface-border p-6">
          <h3 className="text-lg font-semibold text-text-base mb-6 flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-blue-500" />
            Algorithm Distribution
          </h3>
          <div className="h-64 flex items-center justify-center">
            {algorithmData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={algorithmData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    fill={chartColors.purple}
                    paddingAngle={5}
                    dataKey="count"
                    shape={<ColoredPieCell />}
                  ></Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: uiColors.surfaceDark,
                      borderColor: uiColors.surfaceBorder,
                      color: uiColors.textLight,
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-text-subtle">No decision data available</div>
            )}
          </div>
        </div>

        {/* Score Timeline */}
        <div className="bg-surface rounded-xl border border-surface-border p-6">
          <h3 className="text-lg font-semibold text-text-base mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-green-500" />
            Server Score Trends
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={scoreData}>
                <defs>
                  <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors.teal} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColors.teal} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={uiColors.gridLine} vertical={false} />
                <XAxis dataKey="timestamp" stroke={uiColors.axisLabel} />
                <YAxis stroke={uiColors.axisLabel} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: uiColors.surfaceDark,
                    borderColor: uiColors.surfaceBorder,
                    color: uiColors.textLight,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="avgScore"
                  stroke={chartColors.teal}
                  fillOpacity={1}
                  fill="url(#colorScore)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Metrics Impact */}
      {metricsImpact?.impact && (
        <div className="bg-surface rounded-xl border border-surface-border p-6">
          <h3 className="text-lg font-semibold text-text-base mb-6 flex items-center gap-2">
            <Target className="w-5 h-5" />
            Metrics Impact on Load Balancer Decisions
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-surface-raised rounded-lg">
              <div className="text-sm text-text-muted mb-2">Latency</div>
              <div className="text-2xl font-bold text-text-base">
                {(metricsImpact.impact.latency.correlation * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-text-subtle mt-1">
                Weight: {(metricsImpact.impact.latency.weight * 100).toFixed(0)}%
              </div>
            </div>
            <div className="p-4 bg-surface-raised rounded-lg">
              <div className="text-sm text-text-muted mb-2">Success Rate</div>
              <div className="text-2xl font-bold text-text-base">
                {(metricsImpact.impact.successRate.correlation * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-text-subtle mt-1">
                Weight: {(metricsImpact.impact.successRate.weight * 100).toFixed(0)}%
              </div>
            </div>
            <div className="p-4 bg-surface-raised rounded-lg">
              <div className="text-sm text-text-muted mb-2">Load</div>
              <div className="text-2xl font-bold text-text-base">
                {(metricsImpact.impact.load.correlation * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-text-subtle mt-1">
                Weight: {(metricsImpact.impact.load.weight * 100).toFixed(0)}%
              </div>
            </div>
            <div className="p-4 bg-surface-raised rounded-lg">
              <div className="text-sm text-text-muted mb-2">Capacity</div>
              <div className="text-2xl font-bold text-text-base">
                {(metricsImpact.impact.capacity.correlation * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-text-subtle mt-1">
                Weight: {(metricsImpact.impact.capacity.weight * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selection Statistics */}
      {selectionStats?.stats && selectionStats.stats.length > 0 && (
        <div className="bg-surface rounded-xl border border-surface-border p-6">
          <h3 className="text-lg font-semibold text-text-base mb-6">Server Selection Statistics</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left text-text-muted py-2">Server</th>
                  <th className="text-right text-text-muted py-2">Selections</th>
                  <th className="text-right text-text-muted py-2">Avg Score</th>
                  <th className="text-left text-text-muted py-2 pl-4">By Model</th>
                </tr>
              </thead>
              <tbody>
                {selectionStats.stats.map(stat => (
                  <tr key={stat.serverId} className="border-b border-surface-border/50">
                    <td className="text-text-base py-3 font-mono">{stat.serverId}</td>
                    <td className="text-right text-text-base py-3">{stat.totalSelections}</td>
                    <td className="text-right text-text-base py-3">{stat.avgScore.toFixed(1)}</td>
                    <td className="text-left text-text-muted py-3 pl-4 text-xs">
                      {Object.entries(stat.byModel).map(([model, count]) => (
                        <span
                          key={model}
                          className="mr-3 inline-block bg-surface/50 px-2 py-0.5 rounded"
                        >
                          {model}: {count as number}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Decisions List */}
      <div className="bg-surface rounded-xl border border-surface-border p-6">
        <h3 className="text-lg font-semibold text-text-base mb-6">Recent Routing Decisions</h3>
        <div className="space-y-3">
          {decisionHistory?.events?.slice(0, 10).map((event, index) => (
            <div
              key={index}
              className="bg-surface-raised/40 p-4 rounded-lg border border-gray-800 hover:border-surface-border transition-colors"
            >
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-text-base font-medium bg-surface px-2 py-1 rounded text-sm">
                    {event.model}
                  </span>
                  <span className="text-text-subtle text-xs">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <span className="text-xs font-mono text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                  {event.algorithm}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">
                  Selected:{' '}
                  <span className="text-green-400 font-mono ml-1">{event.selectedServerId}</span>
                </span>
                <span className="text-xs text-text-subtle">{event.selectionReason}</span>
              </div>
            </div>
          ))}
          {(!decisionHistory?.events || decisionHistory.events.length === 0) && (
            <div className="text-center text-text-subtle py-8">No decisions recorded yet</div>
          )}
        </div>
      </div>
    </div>
  );
};
