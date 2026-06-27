import { useState, useMemo, memo } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCircuitBreakers, resetCircuitBreaker, getBans, type CircuitBreakerInfo } from '../api';
import {
  resetBreakerForEndpoint,
  forceOpenForEndpoint,
  forceCloseForEndpoint,
} from '../api/circuit-breakers';
import type { ProbeEndpoint } from '../api/types';
import {
  Shield,
  RefreshCw,
  Ban,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Server,
} from 'lucide-react';
import { toastSuccess, toastError } from '../utils/toast';
import { safeArray } from '../utils/safeArray';
import { DataToolbar } from '../components/DataToolbar';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { useDataTable } from '../hooks/useDataTable';
import {
  CircuitBreakersSummary,
  CircuitBreakersEmptyState,
  CircuitBreakerBehaviorInfo,
} from '../components/circuit-breakers';
import { BansTab } from '../components/circuit-breakers/BansTab';
import { getStatePriority, sortByStatePriority } from '../utils/circuitBreaker';

// ==========================================
// Types
// ==========================================

interface ModelGroup {
  serverId: string;
  model: string;
  /** All endpoint breakers for this (serverId, model) */
  endpointBreakers: CircuitBreakerInfo[];
  worstState: CircuitBreakerInfo['uiState'];
  divergentCount: number;
}

interface ServerGroup {
  serverId: string;
  models: ModelGroup[];
  hasOpenCircuit: boolean;
}

// ==========================================
// Helpers
// ==========================================

const ENDPOINT_LABELS: Record<ProbeEndpoint, string> = {
  ollama_chat: 'Chat',
  ollama_generate: 'Generate',
  ollama_embeddings: 'Embeddings',
  openai_chat: 'OpenAI Chat',
  openai_completions: 'OpenAI Completions',
  openai_embeddings: 'OpenAI Embeddings',
  anthropic_messages: 'Anthropic',
};

const ENDPOINT_COLORS: Record<ProbeEndpoint, string> = {
  ollama_chat: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  ollama_generate: 'bg-green-500/20 text-green-400 border-green-500/50',
  ollama_embeddings: 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  openai_chat: 'bg-orange-500/20 text-orange-400 border-orange-500/50',
  openai_completions: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  openai_embeddings: 'bg-pink-500/20 text-pink-400 border-pink-500/50',
  anthropic_messages: 'bg-red-500/20 text-red-400 border-red-500/50',
};

const groupByServer = (breakers: CircuitBreakerInfo[]): ServerGroup[] => {
  const serverMap = new Map<string, ModelGroup[]>();

  for (const breaker of breakers) {
    if (!breaker.serverId || !breaker.model) continue;
    const modelKey = breaker.model;
    if (!serverMap.has(breaker.serverId)) {
      serverMap.set(breaker.serverId, []);
    }
    const modelGroups = serverMap.get(breaker.serverId)!;
    let modelGroup = modelGroups.find(mg => mg.model === modelKey);
    if (!modelGroup) {
      modelGroup = {
        serverId: breaker.serverId,
        model: modelKey,
        endpointBreakers: [],
        worstState: 'UNKNOWN',
        divergentCount: 0,
      };
      modelGroups.push(modelGroup);
    }
    if (breaker.endpoint) {
      modelGroup.endpointBreakers.push(breaker);
    }
  }

  // Compute worst state and divergent count per model group
  for (const modelGroups of serverMap.values()) {
    for (const mg of modelGroups) {
      const sorted = sortByStatePriority(mg.endpointBreakers);
      mg.worstState = sorted.length > 0 ? sorted[0].uiState : 'UNKNOWN';
      const worstPriority = getStatePriority(mg.worstState);
      mg.divergentCount = mg.endpointBreakers.filter(
        b => getStatePriority(b.uiState) !== worstPriority
      ).length;
    }
  }

  const serverGroups: ServerGroup[] = [];
  for (const [serverId, modelGroups] of serverMap) {
    const hasOpenCircuit = modelGroups.some(mg => mg.worstState === 'OPEN');
    serverGroups.push({ serverId, models: modelGroups, hasOpenCircuit });
  }

  // Sort: open circuits first, then by total failures
  return serverGroups.sort((a, b) => {
    if (a.hasOpenCircuit && !b.hasOpenCircuit) return -1;
    if (!a.hasOpenCircuit && b.hasOpenCircuit) return 1;
    const aFailures = a.models.reduce(
      (sum, mg) => sum + mg.endpointBreakers.reduce((s, b) => s + b.failureCount, 0),
      0
    );
    const bFailures = b.models.reduce(
      (sum, mg) => sum + mg.endpointBreakers.reduce((s, b) => s + b.failureCount, 0),
      0
    );
    return bFailures - aFailures;
  });
};

// ==========================================
// Sub-components
// ==========================================

interface EndpointChipProps {
  endpoint: ProbeEndpoint;
}

const EndpointChip = memo<EndpointChipProps>(({ endpoint }) => (
  <span
    className={`px-2 py-0.5 rounded text-xs font-medium border ${ENDPOINT_COLORS[endpoint]}`}
    title={endpoint}
  >
    {ENDPOINT_LABELS[endpoint]}
  </span>
));

EndpointChip.displayName = 'EndpointChip';

interface EndpointCardProps {
  breaker: CircuitBreakerInfo;
  onReset: () => void;
  onForceOpen: () => void;
  onForceClose: () => void;
  isPending: boolean;
}

const EndpointCard = memo<EndpointCardProps>(
  ({ breaker, onReset, onForceOpen, onForceClose, isPending }) => {
    const stateColors = {
      OPEN: 'border-red-500/50 bg-red-500/10',
      'HALF-OPEN': 'border-yellow-500/50 bg-yellow-500/10',
      CLOSED: 'border-gray-600/30 bg-gray-700/30',
      UNKNOWN: 'border-gray-600/30 bg-gray-700/30',
    };
    const stateTextColors = {
      OPEN: 'text-red-400',
      'HALF-OPEN': 'text-yellow-400',
      CLOSED: 'text-green-400',
      UNKNOWN: 'text-gray-400',
    };
    const stateIcon =
      breaker.uiState === 'OPEN' ? (
        <ShieldAlert className="w-4 h-4 text-red-500" />
      ) : breaker.uiState === 'HALF-OPEN' ? (
        <ShieldQuestion className="w-4 h-4 text-yellow-500" />
      ) : (
        <ShieldCheck className="w-4 h-4 text-green-500" />
      );

    return (
      <div className={`rounded-lg border p-3 ${stateColors[breaker.uiState]}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {stateIcon}
            <EndpointChip endpoint={breaker.endpoint!} />
            <span className={`text-xs font-medium ${stateTextColors[breaker.uiState]}`}>
              {breaker.uiState}
            </span>
            <span className="text-gray-500 text-xs">{breaker.failureCount} failures</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onForceOpen}
              disabled={isPending || breaker.uiState === 'OPEN'}
              title="Force Open"
              className="p-1 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-30"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onForceClose}
              disabled={isPending || breaker.uiState === 'CLOSED'}
              title="Force Close"
              className="p-1 text-text-muted hover:text-green-400 hover:bg-green-500/10 rounded transition-colors disabled:opacity-30"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onReset}
              disabled={isPending}
              title="Reset"
              className="p-1 text-text-muted hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-30"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPending ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    );
  }
);

EndpointCard.displayName = 'EndpointCard';

interface ModelRowProps {
  modelGroup: ModelGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onResetAll: () => void;
  onResetEndpoint: (endpoint: ProbeEndpoint) => void;
  onForceOpenEndpoint: (endpoint: ProbeEndpoint) => void;
  onForceCloseEndpoint: (endpoint: ProbeEndpoint) => void;
  isPending: boolean;
}

const ModelRow = memo<ModelRowProps>(
  ({
    modelGroup,
    isExpanded,
    onToggle,
    onResetAll,
    onResetEndpoint,
    onForceOpenEndpoint,
    onForceCloseEndpoint,
    isPending,
  }) => {
    const worstColors = {
      OPEN: 'bg-red-500/20 text-red-400 border-red-500/50',
      'HALF-OPEN': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
      CLOSED: 'bg-green-500/20 text-green-400 border-green-500/50',
      UNKNOWN: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
    };
    return (
      <div className="border-b border-surface-border last:border-b-0">
        {/* Model header row */}
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-700/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-text-muted" />
            )}
            <span className="text-text-base font-medium">{modelGroup.model}</span>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium border ${worstColors[modelGroup.worstState]}`}
            >
              {modelGroup.worstState}
            </span>
            {modelGroup.divergentCount > 0 && (
              <span className="text-xs text-text-muted">{modelGroup.divergentCount} divergent</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {modelGroup.endpointBreakers.length} endpoint
              {modelGroup.endpointBreakers.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={e => {
                e.stopPropagation();
                onResetAll();
              }}
              disabled={isPending}
              title="Reset all endpoints"
              className="p-1.5 text-text-muted hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-30"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </button>

        {/* Expanded: per-endpoint cards */}
        {isExpanded && (
          <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {modelGroup.endpointBreakers
              .sort((a, b) => getStatePriority(b.uiState) - getStatePriority(a.uiState))
              .map(breaker => (
                <EndpointCard
                  key={breaker.endpoint}
                  breaker={breaker}
                  onReset={() => onResetEndpoint(breaker.endpoint!)}
                  onForceOpen={() => onForceOpenEndpoint(breaker.endpoint!)}
                  onForceClose={() => onForceCloseEndpoint(breaker.endpoint!)}
                  isPending={isPending}
                />
              ))}
          </div>
        )}
      </div>
    );
  }
);

ModelRow.displayName = 'ModelRow';

interface ServerCardProps {
  serverGroup: ServerGroup;
  expandedServers: Set<string>;
  onToggleServer: (serverId: string) => void;
  onToggleModel: (serverId: string, model: string) => void;
  onResetAll: (serverId: string, model: string) => void;
  onResetEndpoint: (serverId: string, model: string, endpoint: ProbeEndpoint) => void;
  onForceOpenEndpoint: (serverId: string, model: string, endpoint: ProbeEndpoint) => void;
  onForceCloseEndpoint: (serverId: string, model: string, endpoint: ProbeEndpoint) => void;
  isPending: boolean;
}

const ServerCard = memo<ServerCardProps>(
  ({
    serverGroup,
    expandedServers,
    onToggleServer,
    onToggleModel,
    onResetAll,
    onResetEndpoint,
    onForceOpenEndpoint,
    onForceCloseEndpoint,
    isPending,
  }) => {
    const isExpanded = expandedServers.has(serverGroup.serverId);
    const totalEndpoints = serverGroup.models.reduce(
      (sum, mg) => sum + mg.endpointBreakers.length,
      0
    );
    const totalFailures = serverGroup.models.reduce(
      (sum, mg) => sum + mg.endpointBreakers.reduce((s, b) => s + b.failureCount, 0),
      0
    );

    return (
      <div
        className={`bg-surface rounded-xl border overflow-hidden ${
          serverGroup.hasOpenCircuit
            ? 'border-red-500/50 shadow-lg shadow-red-500/5'
            : 'border-surface-border'
        }`}
      >
        {/* Server header */}
        <button
          onClick={() => onToggleServer(serverGroup.serverId)}
          className="w-full flex items-center justify-between p-6 hover:bg-gray-700 transition-colors"
        >
          <div className="flex items-center gap-4">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-text-muted" />
            ) : (
              <ChevronRight className="w-5 h-5 text-text-muted" />
            )}
            <Server className="w-6 h-6 text-blue-400" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-text-base font-mono">
                  {serverGroup.serverId}
                </h3>
                {serverGroup.hasOpenCircuit && (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/50">
                    HAS OPEN CIRCUIT
                  </span>
                )}
              </div>
              <p className="text-text-muted text-sm">
                {serverGroup.models.length} model(s), {totalEndpoints} endpoint(s)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div className="text-right">
              <span className="text-gray-500 block text-xs">Total Failures</span>
              <span className="text-text-base font-mono">{totalFailures}</span>
            </div>
            <div className="text-right">
              <span className="text-gray-500 block text-xs">Models</span>
              <span className="text-text-base font-mono">{serverGroup.models.length}</span>
            </div>
          </div>
        </button>

        {/* Expanded: model rows */}
        {isExpanded && (
          <div>
            {serverGroup.models
              .sort((a, b) => getStatePriority(b.worstState) - getStatePriority(a.worstState))
              .map(modelGroup => (
                <ModelRow
                  key={modelGroup.model}
                  modelGroup={modelGroup}
                  isExpanded={expandedServers.has(`${serverGroup.serverId}:${modelGroup.model}`)}
                  onToggle={() => onToggleModel(serverGroup.serverId, modelGroup.model)}
                  onResetAll={() => onResetAll(serverGroup.serverId, modelGroup.model)}
                  onResetEndpoint={ep =>
                    onResetEndpoint(serverGroup.serverId, modelGroup.model, ep)
                  }
                  onForceOpenEndpoint={ep =>
                    onForceOpenEndpoint(serverGroup.serverId, modelGroup.model, ep)
                  }
                  onForceCloseEndpoint={ep =>
                    onForceCloseEndpoint(serverGroup.serverId, modelGroup.model, ep)
                  }
                  isPending={isPending}
                />
              ))}
          </div>
        )}
      </div>
    );
  }
);

ServerCard.displayName = 'ServerCard';

// ==========================================
// Main Page Component
// ==========================================

export const CircuitBreakers = memo(() => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'breakers' | 'bans'>('breakers');
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [pendingResetAll, setPendingResetAll] = useState<{
    serverId: string;
    model: string;
  } | null>(null);
  const [pendingResetEndpoint, setPendingResetEndpoint] = useState<{
    serverId: string;
    model: string;
    endpoint: ProbeEndpoint;
  } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['circuitBreakers'],
    queryFn: getCircuitBreakers,
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });

  const { data: bansData, isLoading: bansLoading } = useQuery({
    queryKey: ['bans'],
    queryFn: getBans,
    refetchInterval: 10000,
    placeholderData: keepPreviousData,
  });

  const allBreakers = safeArray<CircuitBreakerInfo>(data?.circuitBreakers);

  const {
    searchQuery: breakerSearch,
    setSearchQuery: setBreakerSearch,
    filters: breakerFilters,
    handleFilter: handleBreakerFilter,
    processedData: filteredBreakers,
  } = useDataTable({
    data: allBreakers,
    searchKeys: ['serverId', 'model'],
    filterFn: (item, key, value) => {
      if (key === 'state') return item.state === value;
      return true;
    },
  });

  const serverGroups = useMemo(() => groupByServer(filteredBreakers), [filteredBreakers]);

  // Reset all 7 endpoints for (serverId, model)
  const resetAllMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model: string }) =>
      resetCircuitBreaker(serverId, model),
    onSuccess: (_data, vars) => {
      toastSuccess(`Reset all endpoints for ${vars.serverId}:${vars.model}`);
      queryClient.invalidateQueries({ queryKey: ['circuitBreakers'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to reset circuit breaker');
    },
  });

  // Reset single endpoint
  const resetEndpointMutation = useMutation({
    mutationFn: ({
      serverId,
      model,
      endpoint,
    }: {
      serverId: string;
      model: string;
      endpoint: ProbeEndpoint;
    }) => resetBreakerForEndpoint(serverId, model, endpoint),
    onSuccess: () => {
      toastSuccess('Endpoint circuit breaker reset');
      queryClient.invalidateQueries({ queryKey: ['circuitBreakers'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to reset endpoint');
    },
  });

  // Force open single endpoint
  const forceOpenEndpointMutation = useMutation({
    mutationFn: ({
      serverId,
      model,
      endpoint,
    }: {
      serverId: string;
      model: string;
      endpoint: ProbeEndpoint;
    }) => forceOpenForEndpoint(serverId, model, endpoint),
    onSuccess: () => {
      toastSuccess('Endpoint circuit breaker force-opened');
      queryClient.invalidateQueries({ queryKey: ['circuitBreakers'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to force-open endpoint');
    },
  });

  // Force close single endpoint
  const forceCloseEndpointMutation = useMutation({
    mutationFn: ({
      serverId,
      model,
      endpoint,
    }: {
      serverId: string;
      model: string;
      endpoint: ProbeEndpoint;
    }) => forceCloseForEndpoint(serverId, model, endpoint),
    onSuccess: () => {
      toastSuccess('Endpoint circuit breaker force-closed');
      queryClient.invalidateQueries({ queryKey: ['circuitBreakers'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to force-close endpoint');
    },
  });

  const isPending =
    resetAllMutation.isPending ||
    resetEndpointMutation.isPending ||
    forceOpenEndpointMutation.isPending ||
    forceCloseEndpointMutation.isPending;

  const toggleServer = (serverId: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  };

  const toggleModel = (serverId: string, model: string) => {
    const key = `${serverId}:${model}`;
    setExpandedServers(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-base">Circuit Breakers</h2>
          <p className="text-text-muted">
            Monitor circuit breaker status and banned server:model pairs
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex bg-surface rounded-lg p-1 border border-surface-border">
          <button
            onClick={() => setActiveTab('breakers')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'breakers'
                ? 'bg-primary text-text-base'
                : 'text-text-muted hover:text-text-base'
            }`}
          >
            <Shield className="w-4 h-4" />
            Circuit Breakers
          </button>
          <button
            onClick={() => setActiveTab('bans')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'bans'
                ? 'bg-primary text-text-base'
                : 'text-text-muted hover:text-text-base'
            }`}
          >
            <Ban className="w-4 h-4" />
            Bans
            {bansData && bansData.length > 0 && (
              <span className="bg-red-500 text-text-base text-xs px-1.5 py-0.5 rounded-full">
                {bansData.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'breakers' ? (
        <>
          <DataToolbar
            searchQuery={breakerSearch}
            onSearchChange={setBreakerSearch}
            searchPlaceholder="Search breakers..."
            filterOptions={[
              {
                key: 'state',
                label: 'State',
                options: [
                  { label: 'Open', value: 'OPEN' },
                  { label: 'Half-Open', value: 'HALF-OPEN' },
                  { label: 'Closed', value: 'CLOSED' },
                ],
              },
            ]}
            filters={breakerFilters}
            onFilterChange={handleBreakerFilter}
          >
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-text-base rounded-lg transition-colors text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </DataToolbar>

          <CircuitBreakersSummary breakers={allBreakers} />

          <div className="space-y-4">
            {serverGroups.length === 0 ? (
              <CircuitBreakersEmptyState />
            ) : (
              serverGroups.map(server => (
                <ServerCard
                  key={server.serverId}
                  serverGroup={server}
                  expandedServers={expandedServers}
                  onToggleServer={toggleServer}
                  onToggleModel={toggleModel}
                  onResetAll={(serverId, model) => setPendingResetAll({ serverId, model })}
                  onResetEndpoint={(serverId, model, endpoint) =>
                    setPendingResetEndpoint({ serverId, model, endpoint })
                  }
                  onForceOpenEndpoint={(serverId, model, endpoint) =>
                    forceOpenEndpointMutation.mutate({ serverId, model, endpoint })
                  }
                  onForceCloseEndpoint={(serverId, model, endpoint) =>
                    forceCloseEndpointMutation.mutate({ serverId, model, endpoint })
                  }
                  isPending={isPending}
                />
              ))
            )}
          </div>

          <CircuitBreakerBehaviorInfo />
        </>
      ) : (
        <BansTab bansData={bansData} bansLoading={bansLoading} />
      )}

      {/* Reset all confirmation */}
      {pendingResetAll && (
        <ConfirmationModal
          isOpen={!!pendingResetAll}
          onClose={() => setPendingResetAll(null)}
          onConfirm={() => {
            if (pendingResetAll) {
              resetAllMutation.mutate(
                { serverId: pendingResetAll.serverId, model: pendingResetAll.model },
                {
                  onSuccess: () => setPendingResetAll(null),
                  onError: () => setPendingResetAll(null),
                }
              );
            }
          }}
          title="Reset All Endpoints?"
          message={`This will reset all 7 endpoints for ${pendingResetAll?.serverId}:${pendingResetAll?.model}.`}
          consequences={[
            'All 7 endpoint circuit breakers will be reset to CLOSED',
            'Requests will immediately be allowed again',
            'Failure counts will be cleared',
          ]}
          confirmLabel="Reset All"
          isPending={resetAllMutation.isPending}
        />
      )}

      {/* Reset single endpoint confirmation */}
      {pendingResetEndpoint && (
        <ConfirmationModal
          isOpen={!!pendingResetEndpoint}
          onClose={() => setPendingResetEndpoint(null)}
          onConfirm={() => {
            if (pendingResetEndpoint) {
              resetEndpointMutation.mutate(
                {
                  serverId: pendingResetEndpoint.serverId,
                  model: pendingResetEndpoint.model,
                  endpoint: pendingResetEndpoint.endpoint,
                },
                {
                  onSuccess: () => setPendingResetEndpoint(null),
                  onError: () => setPendingResetEndpoint(null),
                }
              );
            }
          }}
          title="Reset Endpoint?"
          message={`Reset circuit breaker for ${pendingResetEndpoint?.endpoint} on ${pendingResetEndpoint?.serverId}:${pendingResetEndpoint?.model}?`}
          consequences={[
            'Endpoint circuit breaker will be reset to CLOSED',
            'Failure counts will be cleared',
          ]}
          confirmLabel="Reset"
          isPending={resetEndpointMutation.isPending}
        />
      )}
    </div>
  );
});

CircuitBreakers.displayName = 'CircuitBreakers';
