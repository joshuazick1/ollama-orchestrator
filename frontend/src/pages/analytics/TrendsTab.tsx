import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { TrendingUp, Activity, Clock, AlertTriangle } from 'lucide-react';

interface TrendsTabProps {
  summarySnapshotsData?: {
    snapshots?: Array<{
      timestamp: number;
      servers: Record<
        string,
        Record<
          string,
          {
            requestCount: number;
            avgLatency: number;
            errorRate: number;
          }
        >
      >;
    }>;
  };
}

export const TrendsTab = ({ summarySnapshotsData }: TrendsTabProps) => {
  const snapshots = useMemo(() => summarySnapshotsData?.snapshots ?? [], [summarySnapshotsData]);

  const trendPoints = useMemo(() => {
    return snapshots
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(snap => {
        let totalRequests = 0;
        let latencySum = 0;
        let latencyCount = 0;
        let weightedErrorSum = 0;
        let errorWeightTotal = 0;
        for (const srv of Object.values(snap.servers)) {
          for (const m of Object.values(srv)) {
            totalRequests += m.requestCount;
            latencySum += m.avgLatency * m.requestCount;
            latencyCount += m.requestCount;
            // Weight error rate by request count to avoid low-volume models skewing results
            weightedErrorSum += m.errorRate * m.requestCount;
            errorWeightTotal += m.requestCount;
          }
        }
        return {
          timestamp: new Date(snap.timestamp).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
          }),
          requests: totalRequests,
          avgLatency: latencyCount > 0 ? latencySum / latencyCount : 0,
          errorRate: errorWeightTotal > 0 ? (weightedErrorSum / errorWeightTotal) * 100 : 0,
        };
      });
  }, [snapshots]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">30-Day Historical Trends</h3>
          <p className="text-sm text-gray-400 mt-1">
            Hourly snapshots — {snapshots.length} data point
            {snapshots.length !== 1 ? 's' : ''} stored
          </p>
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
          <TrendingUp className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">No historical snapshots yet</p>
          <p className="text-gray-500 text-sm mt-2">
            Hourly snapshots are recorded automatically. Check back in an hour.
          </p>
        </div>
      ) : (
        <>
          {/* Request Volume Trend */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h4 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              Request Volume Over Time
            </h4>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendPoints}>
                  <defs>
                    <linearGradient id="trendRequests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="timestamp" stroke="#9CA3AF" fontSize={11} minTickGap={40} />
                  <YAxis stroke="#9CA3AF" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1F2937',
                      borderColor: '#374151',
                      color: '#F3F4F6',
                      borderRadius: '0.5rem',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="requests"
                    stroke="#3B82F6"
                    fillOpacity={1}
                    fill="url(#trendRequests)"
                    strokeWidth={2}
                    name="Requests"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Latency Trend */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <h4 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-400" />
                Avg Latency Over Time
              </h4>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendPoints}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis dataKey="timestamp" stroke="#9CA3AF" fontSize={11} minTickGap={40} />
                    <YAxis stroke="#9CA3AF" fontSize={12} unit="ms" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1F2937',
                        borderColor: '#374151',
                        color: '#F3F4F6',
                        borderRadius: '0.5rem',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgLatency"
                      stroke="#A78BFA"
                      strokeWidth={2}
                      dot={false}
                      name="Avg Latency (ms)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Error Rate Trend */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <h4 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                Error Rate Over Time
              </h4>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendPoints}>
                    <defs>
                      <linearGradient id="trendErrors" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis dataKey="timestamp" stroke="#9CA3AF" fontSize={11} minTickGap={40} />
                    <YAxis stroke="#9CA3AF" fontSize={12} unit="%" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1F2937',
                        borderColor: '#374151',
                        color: '#F3F4F6',
                        borderRadius: '0.5rem',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="errorRate"
                      stroke="#EF4444"
                      fillOpacity={1}
                      fill="url(#trendErrors)"
                      strokeWidth={2}
                      name="Error Rate (%)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
