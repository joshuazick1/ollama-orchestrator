import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
} from 'recharts';
import { GitBranch, Target } from 'lucide-react';

const COLORS = ['#60A5FA', '#34D399', '#A78BFA', '#F472B6', '#FBBF24', '#F87171'];

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
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-blue-400" />
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
                    fill="#8884d8"
                    paddingAngle={5}
                    dataKey="count"
                  >
                    {algorithmData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1F2937',
                      borderColor: '#374151',
                      color: '#F3F4F6',
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-gray-500">No decision data available</div>
            )}
          </div>
        </div>

        {/* Score Timeline */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-green-400" />
            Server Score Trends
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={scoreData}>
                <defs>
                  <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="timestamp" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1F2937',
                    borderColor: '#374151',
                    color: '#F3F4F6',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="avgScore"
                  stroke="#10B981"
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
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <Target className="w-5 h-5" />
            Metrics Impact on Load Balancer Decisions
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-gray-900 rounded-lg">
              <div className="text-sm text-gray-400 mb-2">Latency</div>
              <div className="text-2xl font-bold text-white">
                {(metricsImpact.impact.latency.correlation * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Weight: {(metricsImpact.impact.latency.weight * 100).toFixed(0)}%
              </div>
            </div>
            <div className="p-4 bg-gray-900 rounded-lg">
              <div className="text-sm text-gray-400 mb-2">Success Rate</div>
              <div className="text-2xl font-bold text-white">
                {(metricsImpact.impact.successRate.correlation * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Weight: {(metricsImpact.impact.successRate.weight * 100).toFixed(0)}%
              </div>
            </div>
            <div className="p-4 bg-gray-900 rounded-lg">
              <div className="text-sm text-gray-400 mb-2">Load</div>
              <div className="text-2xl font-bold text-white">
                {(metricsImpact.impact.load.correlation * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Weight: {(metricsImpact.impact.load.weight * 100).toFixed(0)}%
              </div>
            </div>
            <div className="p-4 bg-gray-900 rounded-lg">
              <div className="text-sm text-gray-400 mb-2">Capacity</div>
              <div className="text-2xl font-bold text-white">
                {(metricsImpact.impact.capacity.correlation * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Weight: {(metricsImpact.impact.capacity.weight * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selection Statistics */}
      {selectionStats?.stats && selectionStats.stats.length > 0 && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-6">Server Selection Statistics</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left text-gray-400 py-2">Server</th>
                  <th className="text-right text-gray-400 py-2">Selections</th>
                  <th className="text-right text-gray-400 py-2">Avg Score</th>
                  <th className="text-left text-gray-400 py-2 pl-4">By Model</th>
                </tr>
              </thead>
              <tbody>
                {selectionStats.stats.map(stat => (
                  <tr key={stat.serverId} className="border-b border-gray-700/50">
                    <td className="text-white py-3 font-mono">{stat.serverId}</td>
                    <td className="text-right text-white py-3">{stat.totalSelections}</td>
                    <td className="text-right text-white py-3">{stat.avgScore.toFixed(1)}</td>
                    <td className="text-left text-gray-400 py-3 pl-4 text-xs">
                      {Object.entries(stat.byModel).map(([model, count]) => (
                        <span
                          key={model}
                          className="mr-3 inline-block bg-gray-700/50 px-2 py-0.5 rounded"
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
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Recent Routing Decisions</h3>
        <div className="space-y-3">
          {decisionHistory?.events?.slice(0, 10).map((event, index) => (
            <div
              key={index}
              className="bg-gray-900/40 p-4 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors"
            >
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-white font-medium bg-gray-800 px-2 py-1 rounded text-sm">
                    {event.model}
                  </span>
                  <span className="text-gray-500 text-xs">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <span className="text-xs font-mono text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                  {event.algorithm}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">
                  Selected:{' '}
                  <span className="text-green-400 font-mono ml-1">{event.selectedServerId}</span>
                </span>
                <span className="text-xs text-gray-500">{event.selectionReason}</span>
              </div>
            </div>
          ))}
          {(!decisionHistory?.events || decisionHistory.events.length === 0) && (
            <div className="text-center text-gray-500 py-8">No decisions recorded yet</div>
          )}
        </div>
      </div>
    </div>
  );
};
