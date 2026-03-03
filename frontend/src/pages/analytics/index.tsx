import { useState, useMemo } from 'react';
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
  getMetrics,
  getSummarySnapshots,
} from '../../api';
import {
  BarChart2,
  Server,
  Activity,
  HeartPulse,
  GitBranch,
  TrendingUp,
  Radio,
} from 'lucide-react';

import { ExportDropdown } from './ExportDropdown';
import { OverviewTab } from './OverviewTab';
import { PerformanceTab } from './PerformanceTab';
import { HealthTab } from './HealthTab';
import { DecisionsTab } from './DecisionsTab';
import { RequestsTab } from './RequestsTab';
import { RecoveryTab } from './RecoveryTab';
import { StreamingTab } from './StreamingTab';
import { TrendsTab } from './TrendsTab';

interface ExpandedRequest {
  [key: string]: boolean;
}

type TabId =
  | 'overview'
  | 'performance'
  | 'health'
  | 'decisions'
  | 'requests'
  | 'recovery'
  | 'streaming'
  | 'trends';

export const Analytics = () => {
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h' | '7d'>('24h');
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [expandedRequests, setExpandedRequests] = useState<ExpandedRequest>({});
  const [page, setPage] = useState(0);
  const ITEMS_PER_PAGE = 50;

  const hours = timeRange === '1h' ? 1 : timeRange === '6h' ? 6 : timeRange === '24h' ? 24 : 168;

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

  const { data: circuitBreakersData, isLoading: circuitBreakersLoading } = useQuery({
    queryKey: ['circuitBreakers'],
    queryFn: getCircuitBreakers,
    refetchInterval: activeTab === 'health' ? 5000 : false,
  });

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

  const { data: serversWithHistory, isLoading: serversHistoryLoading } = useQuery({
    queryKey: ['serversWithHistory'],
    queryFn: getServersWithHistory,
  });

  const { data: requestTimeline, isLoading: requestTimelineLoading } = useQuery({
    queryKey: ['requestTimeline', hours],
    queryFn: () => getRequestTimeline({ hours }),
  });

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

  const { data: metricsData, isLoading: metricsLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
    refetchInterval: activeTab === 'streaming' ? 30000 : false,
  });

  const { data: summarySnapshotsData } = useQuery({
    queryKey: ['summarySnapshots'],
    queryFn: getSummarySnapshots,
    refetchInterval: activeTab === 'trends' ? 60000 : false,
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
    circuitBreakersLoading ||
    metricsLoading;

  const topModelsData = useMemo(
    () =>
      topModels?.map((item: { model: string; requests: number }) => ({
        name: item.model,
        requests: item.requests,
      })) || [],
    [topModels]
  );

  const requestData = useMemo(
    () =>
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
      ) || [],
    [requestTimeline]
  );

  const circuitBreakers = circuitBreakersData?.circuitBreakers || [];

  const tabs = [
    { id: 'overview' as TabId, label: 'Overview' },
    { id: 'performance' as TabId, label: 'Performance' },
    { id: 'health' as TabId, label: 'Health' },
    { id: 'decisions' as TabId, label: 'Decisions' },
    { id: 'requests' as TabId, label: 'Logs' },
    { id: 'recovery' as TabId, label: 'Recovery' },
    { id: 'streaming' as TabId, label: 'Streaming' },
    { id: 'trends' as TabId, label: 'Trends' },
  ];

  const toggleRequestExpansion = (requestId: string) => {
    setExpandedRequests(prev => ({
      ...prev,
      [requestId]: !prev[requestId],
    }));
  };

  if (isLoading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-white text-lg animate-pulse">Loading analytics data...</div>
      </div>
    );

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
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                {tab.id === 'overview' && <TrendingUp className="w-4 h-4 inline mr-2" />}
                {tab.id === 'performance' && <BarChart2 className="w-4 h-4 inline mr-2" />}
                {tab.id === 'health' && <HeartPulse className="w-4 h-4 inline mr-2" />}
                {tab.id === 'decisions' && <GitBranch className="w-4 h-4 inline mr-2" />}
                {tab.id === 'requests' && <Server className="w-4 h-4 inline mr-2" />}
                {tab.id === 'recovery' && <Activity className="w-4 h-4 inline mr-2" />}
                {tab.id === 'streaming' && <Radio className="w-4 h-4 inline mr-2" />}
                {tab.id === 'trends' && <TrendingUp className="w-4 h-4 inline mr-2" />}
                {tab.label}
                {tab.id === 'recovery' &&
                  recoverySummary &&
                  recoverySummary.serversWithFailures > 0 && (
                    <span className="ml-2 bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full text-xs">
                      {recoverySummary.serversWithFailures}
                    </span>
                  )}
              </button>
            ))}
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
        <OverviewTab
          summary={summary}
          topModels={topModelsData}
          requestData={requestData}
          capacityAnalysis={capacityAnalysis}
          circuitBreakers={circuitBreakers}
        />
      )}

      {/* Performance Tab */}
      {activeTab === 'performance' && (
        <PerformanceTab serverPerformance={serverPerformance} requestData={requestData} />
      )}

      {/* Health Tab */}
      {activeTab === 'health' && (
        <HealthTab errorAnalysis={errorAnalysis} circuitBreakers={circuitBreakers} />
      )}

      {/* Decisions Tab */}
      {activeTab === 'decisions' && (
        <DecisionsTab
          decisionHistory={decisionHistory}
          algorithmStats={algorithmStats}
          scoreTimeline={scoreTimeline}
          metricsImpact={metricsImpact}
          selectionStats={selectionStats}
        />
      )}

      {/* Requests Tab */}
      {activeTab === 'requests' && (
        <RequestsTab
          serversWithHistory={serversWithHistory}
          selectedServer={selectedServer}
          onSelectServer={setSelectedServer}
          serverRequestHistory={serverRequestHistory}
          serverRequestStats={serverRequestStats}
          expandedRequests={expandedRequests}
          onToggleExpansion={toggleRequestExpansion}
          page={page}
          onPageChange={setPage}
          isLoading={requestHistoryLoading}
        />
      )}

      {/* Recovery Tab */}
      {activeTab === 'recovery' && (
        <RecoveryTab recoverySummary={recoverySummary} recoveryStats={recoveryStats} />
      )}

      {/* Streaming Tab */}
      {activeTab === 'streaming' && <StreamingTab metricsData={metricsData} />}

      {/* Trends Tab */}
      {activeTab === 'trends' && <TrendsTab summarySnapshotsData={summarySnapshotsData} />}
    </div>
  );
};

export default Analytics;
