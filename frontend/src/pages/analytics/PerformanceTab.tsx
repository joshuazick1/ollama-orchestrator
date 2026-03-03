import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Clock } from 'lucide-react';

interface PerformanceTabProps {
  serverPerformance?: Array<{
    id: string;
    requests: number;
    avgLatency: number;
    p95Latency: number;
    errorRate: number;
    throughput: number;
    score: number;
  }>;
  requestData?: Array<{
    timestamp: string;
    count: number;
    successCount: number;
    errorCount: number;
    avgDuration: number;
  }>;
}

export const PerformanceTab = ({ serverPerformance, requestData }: PerformanceTabProps) => {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Server Performance Metrics</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 py-3 pl-4 font-medium uppercase text-xs tracking-wider">
                  Server
                </th>
                <th className="text-right text-gray-400 py-3 font-medium uppercase text-xs tracking-wider">
                  Requests
                </th>
                <th className="text-right text-gray-400 py-3 font-medium uppercase text-xs tracking-wider">
                  Avg Latency
                </th>
                <th className="text-right text-gray-400 py-3 font-medium uppercase text-xs tracking-wider">
                  P95
                </th>
                <th className="text-right text-gray-400 py-3 font-medium uppercase text-xs tracking-wider">
                  Error Rate
                </th>
                <th className="text-right text-gray-400 py-3 font-medium uppercase text-xs tracking-wider">
                  Throughput
                </th>
                <th className="text-right text-gray-400 py-3 pr-4 font-medium uppercase text-xs tracking-wider">
                  Score
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {serverPerformance?.map(server => (
                <tr key={server.id} className="hover:bg-gray-700/30 transition-colors">
                  <td className="text-white py-4 pl-4 font-mono font-medium">{server.id}</td>
                  <td className="text-right text-white py-4">{server.requests.toLocaleString()}</td>
                  <td className="text-right text-white py-4">{server.avgLatency}ms</td>
                  <td className="text-right text-gray-300 py-4">{server.p95Latency}ms</td>
                  <td className="text-right py-4">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${server.errorRate > 0.05 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}
                    >
                      {(server.errorRate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="text-right text-white py-4">
                    {server.throughput.toFixed(1)}{' '}
                    <span className="text-gray-500 text-xs">rpm</span>
                  </td>
                  <td className="text-right py-4 pr-4">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24 bg-gray-700 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            server.score >= 80
                              ? 'bg-green-500'
                              : server.score >= 60
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                          }`}
                          style={{ width: `${server.score}%` }}
                        ></div>
                      </div>
                      <span className="font-medium text-white w-8">{server.score}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-400" />
          Latency Distribution Over Time
        </h3>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={requestData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="timestamp" stroke="#9CA3AF" />
              <YAxis stroke="#9CA3AF" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1F2937',
                  borderColor: '#374151',
                  color: '#F3F4F6',
                }}
              />
              <Line
                type="monotone"
                dataKey="avgDuration"
                stroke="#818CF8"
                strokeWidth={2}
                dot={false}
                name="Avg Latency (ms)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
