import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Rectangle,
} from 'recharts';
import { Zap, Activity, Shield, Server, BarChart2 } from 'lucide-react';
import type { CircuitBreakerInfo } from '../../api';
import { safeArray } from '../../utils/safeArray';
import { chartColors, CHART_PALETTE, uiColors } from '../../constants/colors';

const COLORS = CHART_PALETTE;

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  index?: number;
}

const ColoredBar = (props: BarShapeProps) => (
  <Rectangle {...props} fill={COLORS[props.index ?? 0 % COLORS.length]} />
);

interface OverviewTabProps {
  summary?: {
    global?: {
      totalRequests?: number;
      errorRate?: number;
      avgLatency?: number;
      requestsPerSecond?: number;
    };
  };
  topModels?: Array<{ model: string; requests: number }>;
  requestData?: Array<{
    timestamp: string;
    count: number;
    successCount: number;
    errorCount: number;
    avgDuration: number;
  }>;
  capacityAnalysis?: {
    current?: {
      saturation?: number;
    };
  };
  circuitBreakers?: CircuitBreakerInfo[];
}

export const OverviewTab = ({
  summary,
  topModels,
  requestData,
  capacityAnalysis,
  circuitBreakers,
}: OverviewTabProps) => {
  const openBreakers =
    safeArray<CircuitBreakerInfo>(circuitBreakers).filter(b => b.state === 'OPEN').length ?? 0;
  const halfOpenBreakers =
    safeArray<CircuitBreakerInfo>(circuitBreakers).filter(b => b.state === 'HALF-OPEN').length ?? 0;

  const topModelsData =
    topModels?.map(item => ({
      name: item.model,
      requests: item.requests,
    })) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-surface-border/50 p-6 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Zap className="w-16 h-16 text-blue-500" />
          </div>
          <div className="relative z-10">
            <p className="text-text-muted text-sm font-medium">Req/Sec</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-text-base tracking-tight">
                {summary?.global?.requestsPerSecond?.toFixed(2)}
              </span>
              <span className="text-xs text-blue-500 font-medium bg-blue-500/10 px-2 py-0.5 rounded-full">
                Live
              </span>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-surface-border/50 p-6 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Activity className="w-16 h-16 text-green-500" />
          </div>
          <div className="relative z-10">
            <p className="text-text-muted text-sm font-medium">Success Rate</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-text-base tracking-tight">
                {((1 - (summary?.global?.errorRate || 0)) * 100).toFixed(1)}%
              </span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  (summary?.global?.errorRate || 0) > 0.1
                    ? 'text-red-500 bg-red-500/10'
                    : (summary?.global?.errorRate || 0) > 0.05
                      ? 'text-yellow-500 bg-yellow-500/10'
                      : 'text-green-500 bg-green-500/10'
                }`}
              >
                {(summary?.global?.errorRate || 0) > 0.1
                  ? 'Degraded'
                  : (summary?.global?.errorRate || 0) > 0.05
                    ? 'Warning'
                    : 'Healthy'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-surface-border/50 p-6 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Shield className="w-16 h-16 text-purple-500" />
          </div>
          <div className="relative z-10">
            <p className="text-text-muted text-sm font-medium">Circuit Breakers</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-text-base tracking-tight">
                {openBreakers + halfOpenBreakers} / {circuitBreakers?.length ?? 0}
              </span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  openBreakers > 0 ? 'text-red-500 bg-red-500/10' : 'text-green-500 bg-green-500/10'
                }`}
              >
                {openBreakers > 0 ? 'Active' : 'All Clear'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-surface-border/50 p-6 shadow-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Server className="w-16 h-16 text-orange-500" />
          </div>
          <div className="relative z-10">
            <p className="text-text-muted text-sm font-medium">System Capacity</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-text-base tracking-tight">
                {((capacityAnalysis?.current?.saturation || 0) * 100).toFixed(0)}%
              </span>
              <span className="text-xs text-text-subtle font-medium">Sat.</span>
            </div>
            <div className="w-full bg-surface/50 rounded-full h-1.5 mt-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  (capacityAnalysis?.current?.saturation || 0) > 0.8
                    ? 'bg-red-500'
                    : (capacityAnalysis?.current?.saturation || 0) > 0.6
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                }`}
                style={{ width: `${(capacityAnalysis?.current?.saturation || 0) * 100}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Models */}
        <div className="bg-surface rounded-xl border border-surface-border shadow-sm p-6">
          <h3 className="text-lg font-semibold text-text-base mb-6 flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-blue-500" />
            Most Used Models
          </h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topModelsData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={uiColors.gridLine}
                  horizontal={true}
                  vertical={false}
                />
                <XAxis type="number" stroke={uiColors.axisLabel} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke={uiColors.axisLabel}
                  width={100}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{
                    backgroundColor: uiColors.surfaceDark,
                    borderColor: uiColors.surfaceBorder,
                    color: uiColors.textLight,
                    borderRadius: '0.5rem',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                  }}
                  itemStyle={{ color: uiColors.textLight }}
                />
                <Bar
                  dataKey="requests"
                  shape={<ColoredBar />}
                  fill={chartColors.sky}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Request Volume Trend */}
        <div className="bg-surface rounded-xl border border-surface-border shadow-sm p-6">
          <h3 className="text-lg font-semibold text-text-base mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-500" />
            Request Volume
          </h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={requestData}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors.violet} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColors.violet} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={uiColors.gridLine} vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  stroke={uiColors.axisLabel}
                  fontSize={12}
                  tickMargin={10}
                  minTickGap={30}
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
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={chartColors.violet}
                  fillOpacity={1}
                  fill="url(#colorCount)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
