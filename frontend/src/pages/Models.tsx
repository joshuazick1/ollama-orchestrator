import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getModelMap,
  getServers,
  getCircuitBreakers,
  getInFlightByServer,
  warmupModel,
  getWarmupRecommendations,
  resetCircuitBreaker,
  getAllModelsStatus,
} from '../api';
import { SkeletonTable } from '../components/skeletons';
import { ErrorState } from '../components/EmptyState';
import { DataToolbar } from '../components/DataToolbar';
import { useDataTable } from '../hooks/useDataTable';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import {
  Server,
  Box,
  Layers,
  Zap,
  Lock,
  RefreshCw,
  Activity,
  Loader2,
  Flame,
  HelpCircle,
} from 'lucide-react';
import type { AIServer } from '../types';
import { useState, useMemo, useEffect, useRef } from 'react';
import type { CircuitBreakerInfo } from '../api';
import { toastSuccess, toastError } from '../utils/toast';
import { safeArray } from '../utils/safeArray';
import { CircuitDetailModal } from '../components/CircuitDetailModal';
import { Badge } from '../components/Badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

type ProviderType =
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'groq'
  | 'vllm'
  | 'minimax'
  | 'bedrock'
  | 'azure'
  | 'custom';

const providerColors: Record<ProviderType, { bg: string; text: string }> = {
  ollama: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  openai: { bg: 'bg-green-500/20', text: 'text-green-400' },
  anthropic: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  deepseek: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  groq: { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  vllm: { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  minimax: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  bedrock: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  azure: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  custom: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
};

function ModelProviderBadge({
  provider,
  size = 'sm',
}: {
  provider: ProviderType;
  size?: 'sm' | 'md';
}) {
  const colors = providerColors[provider] || providerColors.ollama;
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs';
  return (
    <span
      className={`inline-flex items-center rounded border font-medium ${colors.bg} ${colors.text} border-transparent ${sizeClasses}`}
    >
      {provider.charAt(0).toUpperCase() + provider.slice(1)}
    </span>
  );
}

interface InFlightServer {
  serverId: string;
  serverUrl: string;
  healthy: boolean;
  count: number;
  total: number;
  byModel: Record<string, { regular: number; bypass: number }>;
}

interface ModelServerStatus {
  loaded: boolean;
  loading: boolean;
  lastUsed?: number;
  loadTime?: number;
  gpuMemory?: number;
}

interface ModelStatus {
  totalServers: number;
  loadedOn: number;
  loadingOn: number;
  notLoadedOn: number;
  failedOn: number;
  servers: Record<string, ModelServerStatus>;
}

const ServerBadge = ({
  server,
  model,
  circuitBreaker,
  inFlightData,
  modelStatus,
  onReset,
  onClick,
  scoreCache,
}: {
  server: AIServer;
  model: string;
  circuitBreaker?: CircuitBreakerInfo;
  inFlightData?: InFlightServer;
  modelStatus?: ModelServerStatus;
  onReset?: () => void;
  onClick?: () => void;
  scoreCache: React.MutableRefObject<Map<string, number>>;
}) => {
  // Get in-flight count for this server:model
  const inFlightCount = inFlightData?.byModel?.[model]?.regular || 0;
  const bypassCount = inFlightData?.byModel?.[model]?.bypass || 0;
  const totalInFlight = inFlightCount + bypassCount;

  // Check if model is loaded in memory
  const isLoaded = modelStatus?.loaded || false;
  const isLoading = modelStatus?.loading || false;

  const currentScore = circuitBreaker?.lbScore?.totalScore;
  const cachedScore = scoreCache.current.get(server.id);
  const displayScore = currentScore != null ? currentScore : cachedScore;

  // Determine state
  const isCircuitOpen = circuitBreaker?.state === 'OPEN';
  const isCircuitHalfOpen = circuitBreaker?.state === 'HALF-OPEN';
  const isTesting = isCircuitHalfOpen && (circuitBreaker?.activeTestsInProgress || 0) > 0;
  const hasInFlight = totalInFlight > 0;

  // Determine badge styling based on priority
  // Priority: Testing > Open > Half-Open > In-Flight > Loaded > Normal
  let badgeClass = 'bg-surface text-gray-300';
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
  } else if (isLoaded) {
    // E: Model loaded in memory
    badgeClass = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50';
    icon = <Box className="w-3 h-3" />;
    tooltip = `${server.url} - Model loaded in memory`;
  } else if (isLoading) {
    // Loading state
    badgeClass = 'bg-blue-500/20 text-blue-400 border border-blue-500/50';
    icon = <Loader2 className="w-3 h-3 animate-spin" />;
    tooltip = `${server.url} - Loading model`;
  }

  return (
    <div
      className={`flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded-md transition-all cursor-pointer hover:opacity-80 ${badgeClass} ${hasInFlight ? 'animate-pulse' : ''}`}
      title={tooltip}
      onClick={onClick}
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
      {(isCircuitOpen || isCircuitHalfOpen) && onReset && (
        <button
          onClick={e => {
            e.stopPropagation();
            onReset();
          }}
          className="ml-1 p-0.5 hover:bg-white/10 rounded text-text-base/60 hover:text-text-base"
          title="Reset circuit breaker"
          aria-label="Reset circuit breaker"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
      {displayScore != null && (
        <span
          className="ml-1 text-[10px] text-text-muted"
          title={`LB Score: ${displayScore.toFixed(1)}`}
        >
          ({displayScore.toFixed(0)})
        </span>
      )}
    </div>
  );
};

const Legend = () => (
  <div className="flex flex-wrap gap-4 text-xs text-text-muted bg-surface-raised/50 rounded-lg p-4 border border-surface-border/50">
    <div className="flex items-center space-x-2">
      <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/50" />
      <span>Loaded</span>
    </div>
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
      <div className="w-3 h-3 rounded-full bg-surface" />
      <span>Normal</span>
    </div>
  </div>
);

export const Models = () => {
  const queryClient = useQueryClient();
  const { isLive } = useLiveUpdates({
    invalidateQueries: [
      ['modelMap'],
      ['servers'],
      ['all-models-status'],
      ['circuitBreakers'],
      ['in-flight'],
    ],
  });
  const [selectedCircuit, setSelectedCircuit] = useState<{
    serverId: string;
    model: string;
  } | null>(null);

  const {
    data: modelMap,
    isLoading: mapLoading,
    error: mapError,
  } = useQuery({
    queryKey: ['modelMap'],
    queryFn: getModelMap,
    refetchInterval: 5000,
  });

  const {
    data: servers,
    isLoading: serversLoading,
    error: serversError,
  } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
    refetchInterval: 5000,
  });

  const {
    data: circuitBreakersData,
    isLoading: circuitLoading,
    error: circuitError,
  } = useQuery({
    queryKey: ['circuitBreakers'],
    queryFn: getCircuitBreakers,
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const {
    data: inFlightData,
    isLoading: inFlightLoading,
    error: inFlightError,
  } = useQuery({
    queryKey: ['in-flight'],
    queryFn: getInFlightByServer,
    refetchInterval: 5000,
    staleTime: 3000,
  });

  const { data: recommendations } = useQuery({
    queryKey: ['warmup-recommendations'],
    queryFn: getWarmupRecommendations,
    refetchInterval: 60000,
  });

  const { data: modelsStatusData } = useQuery({
    queryKey: ['all-models-status'],
    queryFn: getAllModelsStatus,
    refetchInterval: 5000,
  });

  // Enrich data for sorting/filtering
  const enrichedModels = useMemo(() => {
    return Object.keys(modelMap || {}).map(model => {
      const serverIds = modelMap[model] || [];
      const modelServers = servers?.filter((s: AIServer) => serverIds.includes(s.id)) || [];

      // Determine which providers serve this model on each server
      const serverProviderMap: Record<string, Set<string>> = {};
      modelServers.forEach(server => {
        const providers = new Set<string>();
        // Check if model is available via Ollama native API
        if (server.models?.includes(model)) {
          providers.add('ollama');
        }
        // Check if model is available via OpenAI-compatible API
        if (server.v1Models?.includes(model) || server.discoveredV1Models?.includes(model)) {
          providers.add('openai');
        }
        // Check if model is available via Anthropic API
        if (server.supportsAnthropic && providers.size === 0) {
          // Anthropic uses OpenAI-compatible endpoint, so if no other provider
          // but supportsAnthropic is true, assume anthropic
          providers.add('anthropic');
        }
        serverProviderMap[server.id] = providers;
      });

      return {
        name: model,
        replicas: serverIds.length,
        modelServers,
        serverProviderMap,
      };
    });
  }, [modelMap, servers]);

  const {
    searchQuery,
    setSearchQuery,
    sortConfig,
    handleSort,
    filters,
    handleFilter,
    processedData: filteredModels,
  } = useDataTable({
    data: enrichedModels,
    initialSort: { key: 'name', direction: 'asc' },
    searchKeys: ['name'],
    filterFn: (item, key, value) => {
      if (key === 'provider' && value) {
        // Filter: only show models available via the selected provider
        return item.modelServers.some(server => {
          const providers = item.serverProviderMap[server.id];
          return providers?.has(value);
        });
      }
      return true;
    },
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

  const resetCbMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model: string }) =>
      resetCircuitBreaker(serverId, model),
    onSuccess: (_data, variables) => {
      toastSuccess(`Circuit breaker reset for ${variables.model} on ${variables.serverId}`);
      queryClient.invalidateQueries({ queryKey: ['circuitBreakers'] });
    },
    onError: (error, variables) => {
      toastError(
        error instanceof Error
          ? error.message
          : `Failed to reset circuit breaker for ${variables.model}`
      );
    },
  });

  // Create lookup maps for efficient access
  const circuitBreakerMap = useMemo(() => {
    const map = new Map<string, CircuitBreakerInfo>();
    const breakers = circuitBreakersData?.circuitBreakers;
    safeArray<CircuitBreakerInfo>(breakers).forEach((cb: CircuitBreakerInfo) => {
      if (cb.serverId) {
        map.set(cb.serverId, cb);
      }
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

  const modelStatusMap = useMemo(() => {
    const map = new Map<string, Record<string, ModelServerStatus>>();
    const modelsData = modelsStatusData as { models?: Record<string, ModelStatus> } | undefined;
    if (modelsData?.models) {
      Object.entries(modelsData.models).forEach(([model, status]) => {
        map.set(model, status.servers);
      });
    }
    return map;
  }, [modelsStatusData]);

  const providerStats = useMemo(() => {
    const counts: Record<ProviderType, number> = {
      ollama: 0,
      openai: 0,
      anthropic: 0,
      deepseek: 0,
      groq: 0,
      vllm: 0,
      minimax: 0,
      bedrock: 0,
      azure: 0,
      custom: 0,
    };
    Object.values(enrichedModels).forEach(model => {
      Object.values(model.serverProviderMap).forEach(providers => {
        providers.forEach(p => {
          if (p in counts) counts[p as ProviderType]++;
        });
      });
    });
    return counts;
  }, [enrichedModels]);

  const scoreCache = useRef(new Map<string, number>());

  useEffect(() => {
    const breakers = circuitBreakersData?.circuitBreakers;
    safeArray<CircuitBreakerInfo>(breakers).forEach((cb: CircuitBreakerInfo) => {
      if (cb.lbScore?.totalScore != null) {
        scoreCache.current.set(cb.serverId, cb.lbScore.totalScore);
      }
    });
  }, [circuitBreakersData]);

  if (mapLoading || serversLoading || circuitLoading || inFlightLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-text-base">Models</h2>
            <p className="text-text-muted">View and manage models across your servers</p>
          </div>
        </div>
        <SkeletonTable rows={8} columns={4} />
      </div>
    );
  }

  const loadError = mapError || serversError || circuitError || inFlightError;
  if (loadError) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-text-base">Models</h2>
            <p className="text-text-muted">View and manage models across your servers</p>
          </div>
        </div>
        <ErrorState
          title="Failed to load data"
          message={
            loadError instanceof Error
              ? loadError.message
              : 'An error occurred while loading models'
          }
          action={{ label: 'Retry', onClick: () => window.location.reload() }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-base">Models</h2>
          <p className="text-text-muted">Available models and their distribution</p>
        </div>
        <Badge
          variant={isLive ? 'success' : 'neutral'}
          className={
            isLive
              ? 'bg-green-500/20 text-green-400 border-green-500/50 animate-pulse'
              : 'bg-gray-500/20 text-gray-400 border-gray-500/50'
          }
        >
          <span
            className={`mr-1.5 h-1.5 w-1.5 rounded-full ${isLive ? 'bg-green-400' : 'bg-gray-400'}`}
          />
          {isLive ? 'Live' : 'Offline'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {Object.entries(providerStats)
          .filter(([, count]) => count > 0)
          .map(([provider, count]) => (
            <div
              key={provider}
              className="bg-surface-raised/50 rounded-lg p-3 border border-surface-border flex items-center justify-between"
            >
              <ModelProviderBadge provider={provider as ProviderType} size="md" />
              <span className="text-lg font-semibold text-text-base">{count}</span>
            </div>
          ))}
      </div>

      <DataToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortConfig={sortConfig}
        onSortChange={handleSort}
        sortOptions={[
          { key: 'name', label: 'Model Name' },
          { key: 'replicas', label: 'Replicas' },
        ]}
        filterOptions={[
          {
            key: 'provider',
            label: 'Provider',
            options: [
              { label: 'Ollama', value: 'ollama' },
              { label: 'OpenAI', value: 'openai' },
              { label: 'Anthropic', value: 'anthropic' },
              { label: 'DeepSeek', value: 'deepseek' },
              { label: 'Groq', value: 'groq' },
              { label: 'vLLM', value: 'vllm' },
            ],
          },
        ]}
        filters={filters}
        onFilterChange={handleFilter}
      >
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
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-text-base rounded-lg transition-colors text-sm font-medium"
        >
          <Flame className="w-4 h-4" />
          <span>Warmup Recommended</span>
        </button>
        <div className="hidden md:flex items-center space-x-2 text-sm text-text-muted ml-2">
          <Activity className="w-4 h-4" />
          <span>Live updates</span>
        </div>
      </DataToolbar>

      <Legend />

      <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
          <table className="w-full text-left min-w-[500px]">
            <thead className="bg-surface-raised text-text-muted uppercase text-xs font-semibold">
              <tr>
                <th
                  className="px-6 py-4 cursor-pointer hover:text-text-base transition-colors group"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center space-x-2">
                    <span>Model Name</span>
                  </div>
                </th>
                <th
                  className="px-6 py-4 cursor-pointer hover:text-text-base transition-colors group"
                  onClick={() => handleSort('replicas')}
                >
                  <div className="flex items-center space-x-2">
                    <span>Replicas</span>
                  </div>
                </th>
                <th className="px-6 py-4">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center space-x-1 cursor-help">
                          <span>Source</span>
                          <HelpCircle className="w-3 h-3" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="font-medium mb-1">Provider Source</p>
                        <p className="text-xs text-text-muted">
                          <span className="text-orange-400">Ollama</span>: native /api/* endpoints
                        </p>
                        <p className="text-xs text-text-muted">
                          <span className="text-green-400">OpenAI</span>: /v1/chat/completions
                        </p>
                        <p className="text-xs text-text-muted">
                          <span className="text-blue-400">Anthropic</span>: /v1/messages
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </th>
                <th className="px-6 py-4">Servers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredModels.map(item => {
                const model = item.name;
                const { modelServers, serverProviderMap } = item;

                return (
                  <tr key={model} className="hover:bg-surface transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                          <Box className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col space-y-1">
                          <span className="font-medium text-text-base">{model}</span>
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              const allProviders = new Set<ProviderType>();
                              Object.values(item.serverProviderMap).forEach(ps => {
                                ps.forEach(p => allProviders.add(p as ProviderType));
                              });
                              return Array.from(allProviders)
                                .slice(0, 3)
                                .map(provider => (
                                  <ModelProviderBadge
                                    key={provider}
                                    provider={provider}
                                    size="sm"
                                  />
                                ));
                            })()}
                          </div>
                        </div>
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
                      <div className="flex flex-wrap gap-1">
                        {modelServers.map((server: AIServer) => {
                          const providers = serverProviderMap[server.id];
                          return (
                            <div key={server.id} className="flex items-center gap-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1">
                                      {providers?.has('ollama') && (
                                        <Badge
                                          variant="warning"
                                          size="sm"
                                          className="text-[10px] py-0 px-1.5"
                                        >
                                          O
                                        </Badge>
                                      )}
                                      {providers?.has('openai') && (
                                        <Badge
                                          variant="success"
                                          size="sm"
                                          className="text-[10px] py-0 px-1.5"
                                        >
                                          AI
                                        </Badge>
                                      )}
                                      {providers?.has('anthropic') && (
                                        <Badge
                                          variant="info"
                                          size="sm"
                                          className="text-[10px] py-0 px-1.5"
                                        >
                                          AN
                                        </Badge>
                                      )}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p className="text-xs">
                                      <span className="text-orange-400">O</span> Ollama:{' '}
                                      {server.models?.includes(model) ? 'native model' : 'N/A'}
                                    </p>
                                    <p className="text-xs">
                                      <span className="text-green-400">AI</span> OpenAI:{' '}
                                      {server.v1Models?.includes(model) ||
                                      server.discoveredV1Models?.includes(model)
                                        ? 'available'
                                        : 'N/A'}
                                    </p>
                                    <p className="text-xs">
                                      <span className="text-blue-400">AN</span> Anthropic:{' '}
                                      {server.supportsAnthropic ? 'supported' : 'N/A'}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <ServerBadge
                                server={server}
                                model={model}
                                circuitBreaker={circuitBreakerMap.get(server.id + ':' + model)}
                                inFlightData={inFlightMap.get(server.id)}
                                modelStatus={modelStatusMap.get(model)?.[server.id]}
                                onReset={() =>
                                  resetCbMutation.mutate({ serverId: server.id, model })
                                }
                                onClick={() => setSelectedCircuit({ serverId: server.id, model })}
                                scoreCache={scoreCache}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredModels.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-text-subtle">
                    <Layers className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p>No models found matching your search.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Circuit Detail Modal */}
      {selectedCircuit && (
        <CircuitDetailModal
          isOpen={!!selectedCircuit}
          onClose={() => setSelectedCircuit(null)}
          serverId={selectedCircuit.serverId}
          model={selectedCircuit.model}
        />
      )}
    </div>
  );
};
