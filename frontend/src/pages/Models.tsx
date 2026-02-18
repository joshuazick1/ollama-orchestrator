import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getModelMap,
  getServers,
  getCircuitBreakers,
  getInFlightByServer,
  warmupModel,
  getWarmupRecommendations,
} from '../api';
import {
  Server,
  Box,
  Layers,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Zap,
  Lock,
  RefreshCw,
  Activity,
  Loader2,
  Flame,
} from 'lucide-react';
import type { AIServer } from '../types';
import { useState, useMemo } from 'react';
import type { CircuitBreakerInfo } from '../api';
import { toastSuccess, toastError } from '../utils/toast';

type SortKey = 'name' | 'replicas';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

interface InFlightServer {
  serverId: string;
  serverUrl: string;
  healthy: boolean;
  count: number;
  total: number;
  byModel: Record<string, { regular: number; bypass: number }>;
}

const SortIcon = ({ columnKey, sortConfig }: { columnKey: SortKey; sortConfig: SortConfig }) => {
  if (sortConfig.key !== columnKey) return <ArrowUpDown className="w-4 h-4 text-gray-600" />;
  return sortConfig.direction === 'asc' ? (
    <ArrowUp className="w-4 h-4 text-blue-400" />
  ) : (
    <ArrowDown className="w-4 h-4 text-blue-400" />
  );
};

const ServerBadge = ({
  server,
  model,
  circuitBreaker,
  inFlightData,
}: {
  server: AIServer;
  model: string;
  circuitBreaker?: CircuitBreakerInfo;
  inFlightData?: InFlightServer;
}) => {
  // Get in-flight count for this server:model
  const inFlightCount = inFlightData?.byModel?.[model]?.regular || 0;
  const bypassCount = inFlightData?.byModel?.[model]?.bypass || 0;
  const totalInFlight = inFlightCount + bypassCount;

  // Determine state
  const isCircuitOpen = circuitBreaker?.state === 'OPEN';
  const isCircuitHalfOpen = circuitBreaker?.state === 'HALF-OPEN';
  const isTesting = isCircuitHalfOpen && (circuitBreaker?.activeTestsInProgress || 0) > 0;
  const hasInFlight = totalInFlight > 0;

  // Determine badge styling based on priority
  // Priority: Testing > Open > Half-Open > In-Flight > Normal
  let badgeClass = 'bg-gray-700 text-gray-300';
  let icon = <Server className="w-3 h-3" />;
  const label = server.url;
  let tooltip = `${server.url} - Normal`;

  if (isTesting) {
    // D: Half-open with active test (highest priority)
    badgeClass = 'bg-purple-500/20 text-purple-400 border border-purple-500/50';
    icon = <Loader2 className="w-3 h-3 animate-spin" />;
    tooltip = `${server.url} - Testing (Half-Open)`;
  } else if (isCircuitOpen) {
    // B: Circuit open
    badgeClass = 'bg-red-500/20 text-red-400 border border-red-500/50';
    icon = <Lock className="w-3 h-3" />;
    tooltip = `${server.url} - Circuit OPEN`;
  } else if (isCircuitHalfOpen) {
    // C: Circuit half-open (no active test)
    badgeClass = 'bg-amber-500/20 text-amber-400 border border-amber-500/50';
    icon = <RefreshCw className="w-3 h-3" />;
    tooltip = `${server.url} - Circuit Half-Open`;
  } else if (hasInFlight) {
    // A: In-flight requests
    badgeClass = 'bg-blue-500/20 text-blue-400 border border-blue-500/50';
    icon = <Zap className="w-3 h-3" />;
    tooltip = `${server.url} - ${totalInFlight} in-flight request${totalInFlight !== 1 ? 's' : ''}`;
  }

  return (
    <div
      className={`flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded-md transition-all ${badgeClass} ${hasInFlight ? 'animate-pulse' : ''}`}
      title={tooltip}
    >
      {icon}
      <span className="truncate max-w-[150px]">{label}</span>
      {totalInFlight > 0 && (
        <span className="ml-1 px-1.5 py-0.5 bg-black/20 rounded text-[10px] font-mono">
          {totalInFlight}
        </span>
      )}
      {isCircuitOpen && <span className="ml-1 text-[10px] font-medium uppercase">Open</span>}
      {isTesting && <span className="ml-1 text-[10px] font-medium uppercase">Testing</span>}
      {isCircuitHalfOpen && !isTesting && (
        <span className="ml-1 text-[10px] font-medium uppercase">Half</span>
      )}
    </div>
  );
};

const Legend = () => (
  <div className="flex flex-wrap gap-4 text-xs text-gray-400 bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
    <div className="flex items-center space-x-2">
      <div className="w-3 h-3 rounded-full bg-blue-500/20 border border-blue-500/50" />
      <span>In-Flight</span>
    </div>
    <div className="flex items-center space-x-2">
      <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
      <span>Circuit Open</span>
    </div>
    <div className="flex items-center space-x-2">
      <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50" />
      <span>Half-Open</span>
    </div>
    <div className="flex items-center space-x-2">
      <div className="w-3 h-3 rounded-full bg-purple-500/20 border border-purple-500/50" />
      <span>Testing</span>
    </div>
    <div className="flex items-center space-x-2">
      <div className="w-3 h-3 rounded-full bg-gray-700" />
      <span>Normal</span>
    </div>
  </div>
);

export const Models = () => {
  const queryClient = useQueryClient();
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: 'name',
    direction: 'asc',
  });

  const { data: modelMap, isLoading: mapLoading } = useQuery({
    queryKey: ['modelMap'],
    queryFn: getModelMap,
    refetchInterval: 5000,
  });

  const { data: servers, isLoading: serversLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
    refetchInterval: 5000,
  });

  const { data: circuitBreakersData, isLoading: circuitLoading } = useQuery({
    queryKey: ['circuitBreakers'],
    queryFn: getCircuitBreakers,
    refetchInterval: 2000,
  });

  const { data: inFlightData, isLoading: inFlightLoading } = useQuery({
    queryKey: ['in-flight'],
    queryFn: getInFlightByServer,
    refetchInterval: 2000,
  });

  const { data: recommendations } = useQuery({
    queryKey: ['warmup-recommendations'],
    queryFn: getWarmupRecommendations,
    refetchInterval: 60000,
  });

  const warmupMutation = useMutation({
    mutationFn: ({ model, servers }: { model: string; servers?: string[] }) =>
      warmupModel(model, servers),
    onSuccess: (_data, variables) => {
      toastSuccess(`Warmup started for ${variables.model}`);
      queryClient.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (error, variables) => {
      toastError(error instanceof Error ? error.message : `Failed to warmup ${variables.model}`);
    },
  });

  // Create lookup maps for efficient access
  const circuitBreakerMap = useMemo(() => {
    const map = new Map<string, CircuitBreakerInfo>();
    circuitBreakersData?.circuitBreakers?.forEach((cb: CircuitBreakerInfo) => {
      map.set(cb.serverId, cb);
    });
    return map;
  }, [circuitBreakersData]);

  const inFlightMap = useMemo(() => {
    const map = new Map<string, InFlightServer>();
    inFlightData?.inFlight?.forEach((server: InFlightServer) => {
      map.set(server.serverId, server);
    });
    return map;
  }, [inFlightData]);

  if (mapLoading || serversLoading || circuitLoading || inFlightLoading) {
    return <div className="text-white">Loading...</div>;
  }

  const rawModels = Object.keys(modelMap || {});

  const handleSort = (key: SortKey) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortedModels = () => {
    return [...rawModels].sort((a, b) => {
      if (sortConfig.key === 'name') {
        return sortConfig.direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
      } else {
        const countA = (modelMap?.[a] || []).length;
        const countB = (modelMap?.[b] || []).length;
        return sortConfig.direction === 'asc' ? countA - countB : countB - countA;
      }
    });
  };

  const models = getSortedModels();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Models</h2>
          <p className="text-gray-400">Available models and their distribution</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const recommended = recommendations?.recommendations?.[0];
              if (recommended) {
                warmupMutation.mutate({ model: recommended.model });
              } else {
                toastError('No models available for warmup');
              }
            }}
            disabled={warmupMutation.isPending || !recommendations?.recommendations?.length}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <Flame className="w-4 h-4" />
            <span>Warmup Recommended</span>
          </button>
          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <Activity className="w-4 h-4" />
            <span>Live updates</span>
          </div>
        </div>
      </div>

      <Legend />

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
          <table className="w-full text-left min-w-[500px]">
            <thead className="bg-gray-900 text-gray-400 uppercase text-xs font-semibold">
              <tr>
                <th
                  className="px-6 py-4 cursor-pointer hover:text-white transition-colors group"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center space-x-2">
                    <span>Model Name</span>
                    <SortIcon columnKey="name" sortConfig={sortConfig} />
                  </div>
                </th>
                <th
                  className="px-6 py-4 cursor-pointer hover:text-white transition-colors group"
                  onClick={() => handleSort('replicas')}
                >
                  <div className="flex items-center space-x-2">
                    <span>Replicas</span>
                    <SortIcon columnKey="replicas" sortConfig={sortConfig} />
                  </div>
                </th>
                <th className="px-6 py-4">Servers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {models.map(model => {
                const serverIds = modelMap[model] || [];
                const modelServers =
                  servers?.filter((s: AIServer) => serverIds.includes(s.id)) || [];

                return (
                  <tr key={model} className="hover:bg-gray-750 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                          <Box className="w-5 h-5" />
                        </div>
                        <span className="font-medium text-white">{model}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${modelServers.length > 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}
                        >
                          {modelServers.length} Nodes
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-2">
                        {modelServers.map((server: AIServer) => (
                          <ServerBadge
                            key={server.id}
                            server={server}
                            model={model}
                            circuitBreaker={circuitBreakerMap.get(`${server.id}:${model}`)}
                            inFlightData={inFlightMap.get(server.id)}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {models.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-gray-500">
                    <Layers className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p>No models detected across connected servers.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
