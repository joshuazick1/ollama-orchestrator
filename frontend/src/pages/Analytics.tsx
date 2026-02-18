import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getTopModels,
  getAnalyticsSummary,
  getServerPerformance,
  getErrorAnalysis,
  getCapacityAnalysis,
  getDecisionHistory,
  getSelectionStats,
  getAlgorithmStats,
  getScoreTimeline,
  getMetricsImpact,
  getServersWithHistory,
  getRequestTimeline,
  getServerRequestHistory,
  getServerRequestStats,
  getCircuitBreakers,
  getRecoveryFailuresSummary,
  getAllServerRecoveryStats,
  type CircuitBreakerInfo,
} from '../api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
  Legend,
  PieChart,
  Pie,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  GitBranch,
  Server,
  Activity,
  Target,
  Clock,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Zap,
  BarChart2,
  HeartPulse,
  Download,
  FileSpreadsheet,
  FileJson,
  FileText,
} from 'lucide-react';
import { formatDurationMs, formatTimeAgo } from '../utils/formatting';
import { getCircuitBreakerStateColor } from '../utils/circuitBreaker';
import {
  exportPerformanceMetricsToCSV,
  exportTopModelsToCSV,
  exportCircuitBreakersToCSV,
  exportToHTMLReport,
  downloadJSON,
} from '../utils/export';

interface ExpandedRequest {
  [key: string]: boolean;
}

interface ExportDropdownProps {
  timeRange: string;
  serverPerformance?: Array<{
    id: string;
    requests: number;
    avgLatency: number;
    p95Latency: number;
    errorRate: number;
    throughput: number;
    score: number;
  }>;
  topModels?: Array<{ model: string; requests: number }>;
  circuitBreakers?: CircuitBreakerInfo[];
  summary?: {
    global?: {
      totalRequests: number;
      errorRate: number;
      avgLatency: number;
      requestsPerSecond: number;
    };
  };
}

const ExportDropdown = ({
  timeRange,
  serverPerformance,
  topModels,
  circuitBreakers,
  summary,
}: ExportDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = (type: 'csv' | 'json' | 'html') => {
    switch (type) {
      case 'csv':
        if (serverPerformance && serverPerformance.length > 0) {
          exportPerformanceMetricsToCSV(serverPerformance, timeRange);
        } else if (topModels && topModels.length > 0) {
          exportTopModelsToCSV(topModels, timeRange);
        } else if (circuitBreakers && circuitBreakers.length > 0) {
          exportCircuitBreakersToCSV(
            circuitBreakers.map(cb => ({
              serverId: cb.serverId,
              state: cb.state,
              failureCount: cb.failureCount,
              successCount: cb.successCount,
              errorRate: cb.errorRate,
              consecutiveSuccesses: cb.consecutiveSuccesses,
              lastFailure: cb.lastFailure ? new Date(cb.lastFailure).toISOString() : undefined,
            }))
          );
        }
        break;
      case 'json':
        downloadJSON(
          { serverPerformance, topModels, circuitBreakers, summary, timeRange },
          `analytics-${timeRange}-${Date.now()}`
        );
        break;
      case 'html':
        if (summary?.global) {
          exportToHTMLReport(
            'Analytics Report',
            [
              {
                title: 'Summary',
                content: [
                  ['Total Requests', String(summary.global.totalRequests)],
                  ['Error Rate', `${(summary.global.errorRate * 100).toFixed(2)}%`],
                  ['Avg Latency', `${summary.global.avgLatency.toFixed(2)}ms`],
                  ['Requests/sec', summary.global.requestsPerSecond.toFixed(2)],
                ],
              },
            ],
            timeRange,
            `analytics-report-${timeRange}`
          );
        }
        break;
    }
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm hover:border-gray-600 transition-colors"
      >
        <Download className="w-4 h-4" />
        Export
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
          <button
            onClick={() => handleExport('csv')}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 rounded-t-lg transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-green-400" />
            Export CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            <FileJson className="w-4 h-4 text-yellow-400" />
            Export JSON
          </button>
          <button
            onClick={() => handleExport('html')}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 rounded-b-lg transition-colors"
          >
            <FileText className="w-4 h-4 text-blue-400" />
            Export Report
          </button>
        </div>
      )}
    </div>
  );
};

export const Analytics = () => {
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h' | '7d'>('24h');
  const [activeTab, setActiveTab] = useState<
    'overview' | 'performance' | 'health' | 'decisions' | 'requests' | 'recovery'
  >('overview');
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [expandedRequests, setExpandedRequests] = useState<ExpandedRequest>({});
  const [page, setPage] = useState(0);
  const ITEMS_PER_PAGE = 50;

  const hours = timeRange === '1h' ? 1 : timeRange === '6h' ? 6 : timeRange === '24h' ? 24 : 168;

  // Existing queries
  const { data: topModels, isLoading: topModelsLoading } = useQuery({
    queryKey: ['topModels', timeRange],
    queryFn: () => getTopModels(),
    refetchInterval: 30000,
  });
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['analyticsSummary'],
    queryFn: getAnalyticsSummary,
    refetchInterval: 5000,
  });
  const { data: serverPerformance, isLoading: serverLoading } = useQuery({
    queryKey: ['serverPerformance', timeRange],
    queryFn: () => getServerPerformance(timeRange),
    refetchInterval: activeTab === 'performance' ? 10000 : false,
  });
  const { data: errorAnalysis, isLoading: errorLoading } = useQuery({
    queryKey: ['errorAnalysis', timeRange],
    queryFn: () => getErrorAnalysis(timeRange),
    refetchInterval: activeTab === 'health' ? 15000 : false,
  });
  const { data: capacityAnalysis, isLoading: capacityLoading } = useQuery({
    queryKey: ['capacityAnalysis', timeRange],
    queryFn: () => getCapacityAnalysis(timeRange),
    refetchInterval: activeTab === 'overview' ? 30000 : false,
  });

  // Circuit Breakers
  const { data: circuitBreakersData, isLoading: circuitBreakersLoading } = useQuery({
    queryKey: ['circuitBreakers'],
    queryFn: getCircuitBreakers,
    refetchInterval: activeTab === 'health' ? 5000 : false,
  });

  // New queries for decision history
  const { data: decisionHistory, isLoading: decisionsLoading } = useQuery({
    queryKey: ['decisionHistory', hours],
    queryFn: () => getDecisionHistory({ limit: 100, hours }),
  });
  const { data: selectionStats, isLoading: selectionLoading } = useQuery({
    queryKey: ['selectionStats', hours],
    queryFn: () => getSelectionStats(hours),
  });
  const { data: algorithmStats, isLoading: algorithmLoading } = useQuery({
    queryKey: ['algorithmStats', hours],
    queryFn: () => getAlgorithmStats(hours),
  });
  const { data: scoreTimeline, isLoading: timelineLoading } = useQuery({
    queryKey: ['scoreTimeline', hours],
    queryFn: () => getScoreTimeline(hours),
  });
  const { data: metricsImpact, isLoading: impactLoading } = useQuery({
    queryKey: ['metricsImpact', hours],
    queryFn: () => getMetricsImpact(hours),
  });

  // New queries for request history
  const { data: serversWithHistory, isLoading: serversHistoryLoading } = useQuery({
    queryKey: ['serversWithHistory'],
    queryFn: getServersWithHistory,
  });
  const { data: requestTimeline, isLoading: requestTimelineLoading } = useQuery({
    queryKey: ['requestTimeline', hours],
    queryFn: () => getRequestTimeline({ hours }),
  });

  // Query for selected server details
  const { data: serverRequestHistory, isLoading: requestHistoryLoading } = useQuery({
    queryKey: ['serverRequestHistory', selectedServer, page],
    queryFn: () =>
      getServerRequestHistory(selectedServer, {
        limit: ITEMS_PER_PAGE,
        offset: page * ITEMS_PER_PAGE,
      }),
    enabled: !!selectedServer && activeTab === 'requests',
  });

  const { data: serverRequestStats } = useQuery({
    queryKey: ['serverRequestStats', selectedServer, hours],
    queryFn: () => getServerRequestStats(selectedServer, hours),
    enabled: !!selectedServer && activeTab === 'requests',
  });

  // Recovery failure data
  const { data: recoverySummary } = useQuery({
    queryKey: ['recoveryFailuresSummary'],
    queryFn: getRecoveryFailuresSummary,
    refetchInterval: activeTab === 'recovery' ? 10000 : false,
  });

  const { data: recoveryStats } = useQuery({
    queryKey: ['allServerRecoveryStats'],
    queryFn: getAllServerRecoveryStats,
    refetchInterval: activeTab === 'recovery' ? 10000 : false,
  });

  const isLoading =
    topModelsLoading ||
    summaryLoading ||
    serverLoading ||
    errorLoading ||
    capacityLoading ||
    decisionsLoading ||
    selectionLoading ||
    algorithmLoading ||
    timelineLoading ||
    impactLoading ||
    serversHistoryLoading ||
    requestTimelineLoading ||
    circuitBreakersLoading;

  if (isLoading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-white text-lg animate-pulse">Loading analytics data...</div>
      </div>
    );

  const topModelsData =
    topModels?.map((item: { model: string; requests: number }) => ({
      name: item.model,
      requests: item.requests,
    })) || [];

  const COLORS = ['#60A5FA', '#34D399', '#A78BFA', '#F472B6', '#FBBF24', '#F87171'];

  // Process algorithm stats for chart
  const algorithmData = algorithmStats?.algorithms
    ? Object.entries(algorithmStats.algorithms).map(([name, data]) => {
        const d = data as { count: number; percentage: number };
        return {
          name,
          count: d.count,
          percentage: d.percentage,
        };
      })
    : [];

  // Process score timeline
  const scoreData =
    scoreTimeline?.dataPoints?.map(
      (point: { timestamp: string; avgScore: number; minScore: number; maxScore: number }) => ({
        timestamp: new Date(point.timestamp).toLocaleTimeString(),
        avgScore: point.avgScore,
        minScore: point.minScore,
        maxScore: point.maxScore,
      })
    ) || [];

  // Process request timeline
  const requestData =
    requestTimeline?.dataPoints?.map(
      (point: {
        timestamp: string;
        count: number;
        successCount: number;
        errorCount: number;
        avgDuration: number;
      }) => ({
        timestamp: new Date(point.timestamp).toLocaleTimeString(),
        count: point.count,
        successCount: point.successCount,
        errorCount: point.errorCount,
        avgDuration: point.avgDuration,
      })
    ) || [];

  const circuitBreakers = circuitBreakersData?.circuitBreakers || [];
  const openBreakers = circuitBreakers.filter((b: CircuitBreakerInfo) => b.state === 'OPEN').length;
  const halfOpenBreakers = circuitBreakers.filter(
    (b: CircuitBreakerInfo) => b.state === 'HALF-OPEN'
  ).length;
  const closedBreakers = circuitBreakers.filter(
    (b: CircuitBreakerInfo) => b.state === 'CLOSED'
  ).length;

  const toggleRequestExpansion = (requestId: string) => {
    setExpandedRequests(prev => ({
      ...prev,
      [requestId]: !prev[requestId],
    }));
  };

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Analytics Dashboard</h2>
          <p className="text-gray-400 mt-1">
            System performance, health metrics, and intelligent routing insights
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="bg-gray-800/50 backdrop-blur rounded-lg p-1 border border-gray-700/50 flex">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'overview'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('performance')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'performance'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <BarChart2 className="w-4 h-4 inline mr-2" />
              Performance
            </button>
            <button
              onClick={() => setActiveTab('health')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'health'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <HeartPulse className="w-4 h-4 inline mr-2" />
              Health
            </button>
            <button
              onClick={() => setActiveTab('decisions')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'decisions'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <GitBranch className="w-4 h-4 inline mr-2" />
              Decisions
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'requests'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <Server className="w-4 h-4 inline mr-2" />
              Logs
            </button>
            <button
              onClick={() => setActiveTab('recovery')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'recovery'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              <Activity className="w-4 h-4 inline mr-2" />
              Recovery
              {recoverySummary && recoverySummary.serversWithFailures > 0 && (
                <span className="ml-2 bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full text-xs">
                  {recoverySummary.serversWithFailures}
                </span>
              )}
            </button>
          </div>

          <select
            value={timeRange}
            onChange={e => setTimeRange(e.target.value as '1h' | '6h' | '24h' | '7d')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all hover:border-gray-600"
          >
            <option value="1h">Last Hour</option>
            <option value="6h">Last 6 Hours</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
          </select>

          <ExportDropdown
            timeRange={timeRange}
            serverPerformance={serverPerformance}
            topModels={topModels}
            circuitBreakers={circuitBreakers}
            summary={summary}
          />
        </div>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700/50 p-6 shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Zap className="w-16 h-16 text-blue-500" />
              </div>
              <div className="relative z-10">
                <p className="text-gray-400 text-sm font-medium">Req/Sec</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-white tracking-tight">
                    {summary?.global?.requestsPerSecond?.toFixed(2)}
                  </span>
                  <span className="text-xs text-blue-400 font-medium bg-blue-400/10 px-2 py-0.5 rounded-full">
                    Live
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700/50 p-6 shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Activity className="w-16 h-16 text-green-500" />
              </div>
              <div className="relative z-10">
                <p className="text-gray-400 text-sm font-medium">Success Rate</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-white tracking-tight">
                    {((1 - (summary?.global?.errorRate || 0)) * 100).toFixed(1)}%
                  </span>
                  {summary?.global?.errorRate > 0.05 ? (
                    <span className="text-xs text-red-400 font-medium bg-red-400/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" /> Degraded
                    </span>
                  ) : (
                    <span className="text-xs text-green-400 font-medium bg-green-400/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Healthy
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700/50 p-6 shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Shield className="w-16 h-16 text-purple-500" />
              </div>
              <div className="relative z-10">
                <p className="text-gray-400 text-sm font-medium">Circuit Breakers</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-white tracking-tight">
                    {openBreakers + halfOpenBreakers} / {circuitBreakers.length}
                  </span>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
                      openBreakers > 0
                        ? 'text-red-400 bg-red-400/10'
                        : 'text-green-400 bg-green-400/10'
                    }`}
                  >
                    {openBreakers > 0 ? 'Active' : 'All Clear'}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700/50 p-6 shadow-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Server className="w-16 h-16 text-orange-500" />
              </div>
              <div className="relative z-10">
                <p className="text-gray-400 text-sm font-medium">System Capacity</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-white tracking-tight">
                    {((capacityAnalysis?.current?.saturation || 0) * 100).toFixed(0)}%
                  </span>
                  <span className="text-xs text-gray-500 font-medium">Sat.</span>
                </div>
                <div className="w-full bg-gray-700/50 rounded-full h-1.5 mt-3 overflow-hidden">
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
            <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-blue-400" />
                Most Used Models
              </h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topModelsData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#374151"
                      horizontal={true}
                      vertical={false}
                    />
                    <XAxis type="number" stroke="#9CA3AF" />
                    <YAxis
                      dataKey="name"
                      type="category"
                      stroke="#9CA3AF"
                      width={100}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      contentStyle={{
                        backgroundColor: '#1F2937',
                        borderColor: '#374151',
                        color: '#F3F4F6',
                        borderRadius: '0.5rem',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                      }}
                      itemStyle={{ color: '#F3F4F6' }}
                    />
                    <Bar dataKey="requests" fill="#60A5FA" radius={[0, 4, 4, 0]}>
                      {topModelsData.map(
                        (_entry: { name: string; requests: number }, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        )
                      )}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Request Volume Trend */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-sm p-6">
              <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                <Activity className="w-5 h-5 text-purple-400" />
                Request Volume
              </h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={requestData}>
                    <defs>
                      <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis
                      dataKey="timestamp"
                      stroke="#9CA3AF"
                      fontSize={12}
                      tickMargin={10}
                      minTickGap={30}
                    />
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
                      dataKey="count"
                      stroke="#8B5CF6"
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
      )}

      {/* Performance Tab */}
      {activeTab === 'performance' && (
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
                  {serverPerformance?.map(
                    (server: {
                      id: string;
                      requests: number;
                      avgLatency: number;
                      p95Latency: number;
                      errorRate: number;
                      throughput: number;
                      score: number;
                    }) => (
                      <tr key={server.id} className="hover:bg-gray-700/30 transition-colors">
                        <td className="text-white py-4 pl-4 font-mono font-medium">{server.id}</td>
                        <td className="text-right text-white py-4">
                          {server.requests.toLocaleString()}
                        </td>
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
                    )
                  )}
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
                  <Legend />
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
      )}

      {/* Health Tab */}
      {activeTab === 'health' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Error Analysis */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                Error Analysis
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700/50">
                  <p className="text-gray-400 text-sm">Total Errors</p>
                  <p className="text-2xl font-bold text-white mt-1">
                    {errorAnalysis?.totalErrors || 0}
                  </p>
                </div>
                <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700/50">
                  <p className="text-gray-400 text-sm">Error Trend</p>
                  <div className="flex items-center gap-2 mt-1">
                    {errorAnalysis?.trend === 'increasing' && (
                      <TrendingUp className="w-5 h-5 text-red-400" />
                    )}
                    {errorAnalysis?.trend === 'decreasing' && (
                      <TrendingDown className="w-5 h-5 text-green-400" />
                    )}
                    {errorAnalysis?.trend === 'stable' && (
                      <Minus className="w-5 h-5 text-yellow-400" />
                    )}
                    <span
                      className={`capitalize font-medium ${
                        errorAnalysis?.trend === 'increasing'
                          ? 'text-red-400'
                          : errorAnalysis?.trend === 'decreasing'
                            ? 'text-green-400'
                            : 'text-yellow-400'
                      }`}
                    >
                      {errorAnalysis?.trend}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-300">Errors by Type</h4>
                {errorAnalysis?.byType && Object.entries(errorAnalysis.byType).length > 0 ? (
                  Object.entries(errorAnalysis.byType).map(([type, count]) => (
                    <div
                      key={type}
                      className="flex justify-between items-center bg-gray-700/20 p-3 rounded hover:bg-gray-700/30 transition-colors"
                    >
                      <span className="text-gray-300 capitalize text-sm">
                        {type.replace(/_/g, ' ')}
                      </span>
                      <span className="font-mono text-white bg-gray-700 px-2 py-0.5 rounded text-xs">
                        {count as number}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-gray-500 py-4">
                    No errors recorded in this period
                  </div>
                )}
              </div>
            </div>

            {/* Circuit Breaker Status */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-400" />
                Circuit Breaker Status
              </h3>

              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                  <div className="text-2xl font-bold text-red-400">{openBreakers}</div>
                  <div className="text-xs text-red-300/70 uppercase font-medium mt-1">Open</div>
                </div>
                <div className="text-center p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                  <div className="text-2xl font-bold text-yellow-400">{halfOpenBreakers}</div>
                  <div className="text-xs text-yellow-300/70 uppercase font-medium mt-1">
                    Half-Open
                  </div>
                </div>
                <div className="text-center p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <div className="text-2xl font-bold text-green-400">{closedBreakers}</div>
                  <div className="text-xs text-green-300/70 uppercase font-medium mt-1">Closed</div>
                </div>
              </div>

              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {circuitBreakers.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">No circuit breakers active</div>
                ) : (
                  circuitBreakers
                    .sort((a: CircuitBreakerInfo, b: CircuitBreakerInfo) => {
                      const stateOrder = { OPEN: 0, 'HALF-OPEN': 1, CLOSED: 2 };
                      return stateOrder[a.state] - stateOrder[b.state];
                    })
                    .map((breaker: CircuitBreakerInfo, idx: number) => (
                      <div
                        key={idx}
                        className={`p-3 rounded border flex justify-between items-center ${getCircuitBreakerStateColor(breaker.state)}`}
                      >
                        <div className="flex flex-col">
                          <span className="font-mono text-sm font-medium text-white">
                            {breaker.serverId}
                          </span>
                          <span className="text-xs opacity-70 mt-0.5">
                            Failures: {breaker.failureCount} | Success: {breaker.successCount}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {breaker.state === 'OPEN' && <ShieldAlert className="w-4 h-4" />}
                          {breaker.state === 'HALF-OPEN' && <ShieldQuestion className="w-4 h-4" />}
                          {breaker.state === 'CLOSED' && <ShieldCheck className="w-4 h-4" />}
                          <span className="text-xs font-bold uppercase">{breaker.state}</span>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Decisions Tab */}
      {activeTab === 'decisions' && (
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
                    {selectionStats.stats.map(
                      (stat: {
                        serverId: string;
                        totalSelections: number;
                        avgScore: number;
                        byModel: Record<string, number>;
                      }) => (
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
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Decisions List */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-white mb-6">Recent Routing Decisions</h3>
            <div className="space-y-3">
              {decisionHistory?.events?.slice(0, 10).map(
                (
                  event: {
                    model: string;
                    selectedServerId: string;
                    algorithm: string;
                    timestamp: string;
                    selectionReason: string;
                  },
                  index: number
                ) => (
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
                        <span className="text-green-400 font-mono ml-1">
                          {event.selectedServerId}
                        </span>
                      </span>
                      <span className="text-xs text-gray-500">{event.selectionReason}</span>
                    </div>
                  </div>
                )
              )}
              {(!decisionHistory?.events || decisionHistory.events.length === 0) && (
                <div className="text-center text-gray-500 py-8">No decisions recorded yet</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Requests Tab */}
      {activeTab === 'requests' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Server className="w-5 h-5 text-gray-400" />
                Detailed Request Logs
              </h3>
              <select
                value={selectedServer}
                onChange={e => {
                  setSelectedServer(e.target.value);
                  setPage(0);
                }}
                className="bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white min-w-[200px]"
              >
                <option value="">Select a server...</option>
                {serversWithHistory?.serverIds?.map((serverId: string) => (
                  <option key={serverId} value={serverId}>
                    {serverId}
                  </option>
                ))}
              </select>
            </div>

            {/* Server Request Stats Summary */}
            {selectedServer && serverRequestStats?.stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-900/50 p-3 rounded border border-gray-700/50">
                  <div className="text-xs text-gray-500 uppercase">Total Requests</div>
                  <div className="text-xl font-bold text-white">
                    {serverRequestStats.stats.totalRequests}
                  </div>
                </div>
                <div className="bg-gray-900/50 p-3 rounded border border-gray-700/50">
                  <div className="text-xs text-gray-500 uppercase">Success Rate</div>
                  <div
                    className={`text-xl font-bold ${serverRequestStats.stats.errorRate > 0.05 ? 'text-red-400' : 'text-green-400'}`}
                  >
                    {((1 - serverRequestStats.stats.errorRate) * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="bg-gray-900/50 p-3 rounded border border-gray-700/50">
                  <div className="text-xs text-gray-500 uppercase">Avg Latency</div>
                  <div className="text-xl font-bold text-blue-400">
                    {formatDurationMs(serverRequestStats.stats.avgDuration)}
                  </div>
                </div>
                <div className="bg-gray-900/50 p-3 rounded border border-gray-700/50">
                  <div className="text-xs text-gray-500 uppercase">Avg Tokens</div>
                  <div className="text-xl font-bold text-purple-400">
                    {Math.round(serverRequestStats.stats.avgTokensGenerated || 0)}
                  </div>
                </div>
              </div>
            )}

            {selectedServer && serverRequestHistory?.requests ? (
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700 text-gray-400">
                        <th className="w-8 py-3"></th>
                        <th className="text-left py-3">Time</th>
                        <th className="text-left py-3">Model</th>
                        <th className="text-right py-3">Duration</th>
                        <th className="text-center py-3">Status</th>
                        <th className="text-right py-3">Tokens</th>
                      </tr>
                    </thead>
                    <tbody
                      className={requestHistoryLoading ? 'opacity-50 pointer-events-none' : ''}
                    >
                      {serverRequestHistory.requests.map(
                        (req: {
                          id: string;
                          model: string;
                          duration: number;
                          timestamp: string;
                          success: boolean;
                          tokensGenerated?: number;
                          tokensPrompt?: number;
                          ttft?: number;
                          errorType?: string;
                          errorMessage?: string;
                        }) => (
                          <>
                            <tr
                              key={req.id}
                              className="border-b border-gray-800 hover:bg-gray-700/30 cursor-pointer transition-colors"
                              onClick={() => toggleRequestExpansion(req.id)}
                            >
                              <td className="py-3 text-center">
                                {expandedRequests[req.id] ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </td>
                              <td className="py-3 text-gray-300 font-mono text-xs">
                                {new Date(req.timestamp).toLocaleTimeString()}
                              </td>
                              <td className="py-3 text-white font-medium">{req.model}</td>
                              <td className="py-3 text-right text-gray-300 font-mono">
                                {formatDurationMs(req.duration)}
                              </td>
                              <td className="py-3 text-center">
                                {req.success ? (
                                  <CheckCircle className="w-4 h-4 text-green-500 inline" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-500 inline" />
                                )}
                              </td>
                              <td className="py-3 text-right text-gray-300 font-mono">
                                {req.tokensGenerated || '-'}
                              </td>
                            </tr>
                            {expandedRequests[req.id] && (
                              <tr className="bg-gray-900/50">
                                <td colSpan={6} className="p-4">
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs font-mono text-gray-400">
                                    <div>
                                      <span className="text-gray-600 block mb-1">ID</span> {req.id}
                                    </div>
                                    <div>
                                      <span className="text-gray-600 block mb-1">TTFT</span>{' '}
                                      {req.ttft ? formatDurationMs(req.ttft) : '-'}
                                    </div>
                                    <div>
                                      <span className="text-gray-600 block mb-1">
                                        Prompt Tokens
                                      </span>{' '}
                                      {req.tokensPrompt || '-'}
                                    </div>
                                    {req.errorType && (
                                      <div className="col-span-full mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-300">
                                        <span className="font-bold">{req.errorType}:</span>{' '}
                                        {req.errorMessage}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex justify-between items-center border-t border-gray-700 pt-4">
                  <div className="text-sm text-gray-400">
                    Showing {page * ITEMS_PER_PAGE + 1}-
                    {page * ITEMS_PER_PAGE + serverRequestHistory.requests.length} requests
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0 || requestHistoryLoading}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm text-white transition-colors"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(p => p + 1)}
                      disabled={
                        serverRequestHistory.requests.length < ITEMS_PER_PAGE ||
                        requestHistoryLoading
                      }
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm text-white transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                {selectedServer
                  ? 'No requests found for this server.'
                  : 'Please select a server to view logs.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recovery Tab */}
      {activeTab === 'recovery' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Total Servers</p>
                  <p className="text-3xl font-bold text-white">
                    {recoverySummary?.totalServers || 0}
                  </p>
                </div>
                <Server className="w-10 h-10 text-blue-500/50" />
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl border border-red-500/30 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Servers with Failures</p>
                  <p className="text-3xl font-bold text-red-400">
                    {recoverySummary?.serversWithFailures || 0}
                  </p>
                </div>
                <AlertTriangle className="w-10 h-10 text-red-500/50" />
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Total Failures</p>
                  <p className="text-3xl font-bold text-white">
                    {recoverySummary?.totalFailures || 0}
                  </p>
                </div>
                <Minus className="w-10 h-10 text-gray-500/50" />
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl border border-yellow-500/30 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Recent Failures</p>
                  <p className="text-3xl font-bold text-yellow-400">
                    {recoverySummary?.recentFailures || 0}
                  </p>
                </div>
                <TrendingUp className="w-10 h-10 text-yellow-500/50" />
              </div>
            </div>
          </div>

          {/* Server Recovery Stats Table */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="p-6 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white">Server Recovery Statistics</h3>
              <p className="text-sm text-gray-400 mt-1">Failure and recovery metrics per server</p>
            </div>
            {recoveryStats && recoveryStats.length > 0 ? (
              <table className="w-full">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      Server
                    </th>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      Failures
                    </th>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      Last Failure
                    </th>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      Recovery Attempts
                    </th>
                    <th className="text-left text-gray-400 text-xs font-medium uppercase tracking-wider px-6 py-3">
                      Successful Recoveries
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {recoveryStats.map(
                    (server: {
                      serverId: string;
                      failureCount: number;
                      lastFailure: number;
                      recoveryAttempts: number;
                      successfulRecoveries: number;
                    }) => (
                      <tr key={server.serverId} className="hover:bg-gray-750">
                        <td className="px-6 py-4 text-sm text-white font-mono">
                          {server.serverId}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              server.failureCount > 0
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-green-500/20 text-green-400'
                            }`}
                          >
                            {server.failureCount}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-400">
                          {server.lastFailure > 0 ? formatTimeAgo(server.lastFailure) : 'Never'}
                        </td>
                        <td className="px-6 py-4 text-sm text-white">{server.recoveryAttempts}</td>
                        <td className="px-6 py-4 text-sm">
                          <span
                            className={`${
                              server.successfulRecoveries > 0 ? 'text-green-400' : 'text-gray-400'
                            }`}
                          >
                            {server.successfulRecoveries}
                          </span>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            ) : (
              <div className="p-12 text-center text-gray-500">
                <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No recovery data available</p>
                <p className="text-sm mt-1">
                  Recovery statistics will appear here when servers experience failures
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;
