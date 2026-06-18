import { useState, useMemo, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCircuitBreakers,
  resetCircuitBreaker,
  forceOpenCircuitBreaker,
  forceCloseCircuitBreaker,
  getBans,
  type CircuitBreakerInfo,
} from '../api';
import { Shield, RefreshCw, ChevronDown, ChevronRight, Server, Ban } from 'lucide-react';
import { toastSuccess, toastError } from '../utils/toast';
import { safeArray } from '../utils/safeArray';
import { DataToolbar } from '../components/DataToolbar';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { useDataTable } from '../hooks/useDataTable';
import { CircuitBreakerCard } from '../components/circuit-breakers/CircuitBreakerCard';
import { BansTab } from '../components/circuit-breakers/BansTab';

interface CircuitBreakerResponse {
  success: boolean;
  circuitBreakers: CircuitBreakerInfo[];
}

interface GroupedBreakers {
  serverId: string;
  serverBreaker: CircuitBreakerInfo | null;
  modelBreakers: CircuitBreakerInfo[];
  hasOpenCircuit: boolean;
  totalFailures: number;
}

const parseBreakerKey = (breakerKey: string): { serverId: string; model: string | undefined } => {
  const lastColonIndex = breakerKey.lastIndexOf(':');
  if (lastColonIndex === -1) {
    return { serverId: breakerKey, model: undefined };
  }
  return {
    serverId: breakerKey.substring(0, lastColonIndex),
    model: breakerKey.substring(lastColonIndex + 1),
  };
};

const groupBreakersByServer = (breakers: CircuitBreakerInfo[]): GroupedBreakers[] => {
  const groups = new Map<string, GroupedBreakers>();

  for (const breaker of breakers) {
    const { serverId, model } = parseBreakerKey(breaker.serverId);

    if (!groups.has(serverId)) {
      groups.set(serverId, {
        serverId,
        serverBreaker: null,
        modelBreakers: [],
        hasOpenCircuit: false,
        totalFailures: 0,
      });
    }

    const group = groups.get(serverId)!;

    if (model) {
      group.modelBreakers.push(breaker);
    } else {
      group.serverBreaker = breaker;
    }

    if (breaker.state === 'OPEN') {
      group.hasOpenCircuit = true;
    }

    group.totalFailures += breaker.failureCount;
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.hasOpenCircuit && !b.hasOpenCircuit) return -1;
    if (!a.hasOpenCircuit && b.hasOpenCircuit) return 1;
    return b.totalFailures - a.totalFailures;
  });
};

export const CircuitBreakers = memo(() => {
  const queryClient = useQueryClient();
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'breakers' | 'bans'>('breakers');
  const [pendingForceOpen, setPendingForceOpen] = useState<{
    serverId: string;
    model?: string;
  } | null>(null);

  const { data, isLoading, refetch } = useQuery<CircuitBreakerResponse>({
    queryKey: ['circuitBreakers'],
    queryFn: getCircuitBreakers,
    refetchInterval: 5000,
  });

  const { data: bansData, isLoading: bansLoading } = useQuery({
    queryKey: ['bans'],
    queryFn: getBans,
    refetchInterval: 10000,
  });

  const {
    searchQuery: breakerSearch,
    setSearchQuery: setBreakerSearch,
    filters: breakerFilters,
    handleFilter: handleBreakerFilter,
    processedData: filteredBreakers,
  } = useDataTable({
    data: data?.circuitBreakers || [],
    searchKeys: ['serverId'],
    filterFn: (item, key, value) => {
      if (key === 'state') return item.state === value;
      return true;
    },
  });

  const groupedServers = useMemo(() => groupBreakersByServer(filteredBreakers), [filteredBreakers]);

  const resetMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model?: string }) =>
      resetCircuitBreaker(serverId, model),
    onSuccess: (_data, vars) => {
      toastSuccess(`Circuit breaker reset for ${vars.model || vars.serverId}`);
      queryClient.invalidateQueries({ queryKey: ['circuitBreakers'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : `Failed to reset circuit breaker`);
    },
  });

  const openMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model?: string }) =>
      forceOpenCircuitBreaker(serverId, model),
    onSuccess: (_data, vars) => {
      toastSuccess(`Circuit breaker opened for ${vars.model || vars.serverId}`);
      queryClient.invalidateQueries({ queryKey: ['circuitBreakers'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : `Failed to open circuit breaker`);
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model?: string }) =>
      forceCloseCircuitBreaker(serverId, model),
    onSuccess: (_data, vars) => {
      toastSuccess(`Circuit breaker closed for ${vars.model || vars.serverId}`);
      queryClient.invalidateQueries({ queryKey: ['circuitBreakers'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : `Failed to close circuit breaker`);
    },
  });

  const toggleServer = (serverId: string) => {
    setExpandedServers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        newSet.add(serverId);
      }
      return newSet;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const breakers = safeArray<CircuitBreakerInfo>(data?.circuitBreakers);
  const openCount = breakers.filter(b => b.state === 'OPEN').length;
  const halfOpenCount = breakers.filter(b => b.state === 'HALF-OPEN').length;
  const closedCount = breakers.filter(b => b.state === 'CLOSED').length;

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

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface rounded-xl border border-red-500/30 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-text-muted text-sm">Open Circuits</p>
                  <p className="text-3xl font-bold text-red-400">{openCount}</p>
                </div>
                <ShieldAlert className="w-12 h-12 text-red-500/50" />
              </div>
              <p className="text-red-400/70 text-sm mt-2">
                {openCount > 0 ? 'Services are being protected' : 'All circuits closed'}
              </p>
            </div>

            <div className="bg-surface rounded-xl border border-yellow-500/30 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-text-muted text-sm">Half-Open</p>
                  <p className="text-3xl font-bold text-yellow-400">{halfOpenCount}</p>
                </div>
                <ShieldQuestion className="w-12 h-12 text-yellow-500/50" />
              </div>
              <p className="text-yellow-400/70 text-sm mt-2">
                {halfOpenCount > 0 ? 'Testing recovery' : 'No circuits testing'}
              </p>
            </div>

            <div className="bg-surface rounded-xl border border-green-500/30 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-text-muted text-sm">Closed Circuits</p>
                  <p className="text-3xl font-bold text-green-400">{closedCount}</p>
                </div>
                <ShieldCheck className="w-12 h-12 text-green-500/50" />
              </div>
              <p className="text-green-400/70 text-sm mt-2">Operating normally</p>
            </div>
          </div>

          {/* Server Groups */}
          <div className="space-y-4">
            {groupedServers.length === 0 ? (
              <div className="bg-surface rounded-xl border border-surface-border p-12 text-center">
                <Shield className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-text-base mb-2">
                  No Circuit Breakers Active
                </h3>
                <p className="text-text-muted">
                  Circuit breakers will appear here as servers handle requests and failures occur.
                </p>
              </div>
            ) : (
              groupedServers.map(server => (
                <div
                  key={server.serverId}
                  className={`bg-surface rounded-xl border overflow-hidden ${
                    server.hasOpenCircuit
                      ? 'border-red-500/50 shadow-lg shadow-red-500/5'
                      : 'border-surface-border'
                  }`}
                >
                  {/* Server Header */}
                  <button
                    onClick={() => toggleServer(server.serverId)}
                    className="w-full flex items-center justify-between p-6 hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      {expandedServers.has(server.serverId) ? (
                        <ChevronDown className="w-5 h-5 text-text-muted" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-text-muted" />
                      )}
                      <Server className="w-6 h-6 text-blue-400" />
                      <div>
                        <h3 className="text-lg font-semibold text-text-base font-mono">
                          {server.serverId}
                        </h3>
                        <p className="text-text-muted text-sm">
                          {server.modelBreakers.length + (server.serverBreaker ? 1 : 0)} circuit
                          breaker(s)
                        </p>
                      </div>
                      {server.hasOpenCircuit && (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/50">
                          HAS OPEN CIRCUIT
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-right">
                        <span className="text-gray-500 block text-xs">Total Failures</span>
                        <span className="text-text-base font-mono">{server.totalFailures}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-gray-500 block text-xs">Model Circuits</span>
                        <span className="text-text-base font-mono">
                          {server.modelBreakers.length}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Expanded Content */}
                  {expandedServers.has(server.serverId) && (
                    <div className="px-6 pb-6 space-y-4">
                      {/* Server-level breaker */}
                      {server.serverBreaker && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                            <Server className="w-4 h-4" />
                            Server-Level Circuit Breaker
                          </h4>
                          <CircuitBreakerCard
                            breaker={server.serverBreaker}
                            onReset={() => resetMutation.mutate({ serverId: server.serverId })}
                            onOpen={() => setPendingForceOpen({ serverId: server.serverId })}
                            onClose={() => closeMutation.mutate({ serverId: server.serverId })}
                            isPending={
                              resetMutation.isPending ||
                              openMutation.isPending ||
                              closeMutation.isPending
                            }
                          />
                        </div>
                      )}

                      {/* Model-level breakers */}
                      {server.modelBreakers.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                            <Shield className="w-4 h-4" />
                            Model-Level Circuit Breakers
                          </h4>
                          <div className="space-y-3">
                            {server.modelBreakers
                              .sort((a, b) => {
                                const stateOrder = { OPEN: 0, 'HALF-OPEN': 1, CLOSED: 2 };
                                const stateDiff =
                                  stateOrder[a.state as keyof typeof stateOrder] -
                                  stateOrder[b.state as keyof typeof stateOrder];
                                if (stateDiff !== 0) return stateDiff;
                                return b.failureCount - a.failureCount;
                              })
                              .map(breaker => {
                                const modelName = parseBreakerKey(breaker.serverId).model;
                                return (
                                  <CircuitBreakerCard
                                    key={breaker.serverId}
                                    breaker={breaker}
                                    isModel={true}
                                    onReset={() =>
                                      resetMutation.mutate({
                                        serverId: server.serverId,
                                        model: modelName,
                                      })
                                    }
                                    onOpen={() =>
                                      setPendingForceOpen({
                                        serverId: server.serverId,
                                        model: modelName,
                                      })
                                    }
                                    onClose={() =>
                                      closeMutation.mutate({
                                        serverId: server.serverId,
                                        model: modelName,
                                      })
                                    }
                                    isPending={
                                      resetMutation.isPending ||
                                      openMutation.isPending ||
                                      closeMutation.isPending
                                    }
                                  />
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Info Section */}
          <div className="bg-surface rounded-xl border border-surface-border p-6">
            <h3 className="text-lg font-semibold text-text-base mb-4">Circuit Breaker Behavior</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-text-base font-medium mb-2">When does a circuit open?</h4>
                <p className="text-text-muted text-sm">
                  A circuit opens when the failure count exceeds the threshold (default: 5 failures)
                  OR when the error rate exceeds 50% within the monitoring window (1 minute).
                </p>
              </div>
              <div>
                <h4 className="text-text-base font-medium mb-2">
                  When does a server become unhealthy?
                </h4>
                <p className="text-text-muted text-sm">
                  Servers are marked unhealthy after 3 consecutive transient/retryable failures.
                  Permanent errors mark servers unhealthy only if they're server-wide issues (like
                  disk full).
                </p>
              </div>
              <div>
                <h4 className="text-text-base font-medium mb-2">Recovery process</h4>
                <p className="text-text-muted text-sm">
                  After 30 seconds (open timeout), the circuit enters half-open state and allows
                  test requests. If 3 consecutive requests succeed, the circuit closes.
                </p>
              </div>
              <div>
                <h4 className="text-text-base font-medium mb-2">Server vs Model circuits</h4>
                <p className="text-text-muted text-sm">
                  Server-level circuits track overall server health. Model-level circuits track
                  specific models on that server (useful for OOM errors affecting only certain
                  models).
                </p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <BansTab bansData={bansData} bansLoading={bansLoading} />
      )}
      {pendingForceOpen && (
        <ConfirmationModal
          isOpen={!!pendingForceOpen}
          onClose={() => setPendingForceOpen(null)}
          onConfirm={() => {
            if (pendingForceOpen) {
              openMutation.mutate(
                { serverId: pendingForceOpen.serverId, model: pendingForceOpen.model },
                {
                  onSuccess: () => {
                    toastSuccess('Circuit breaker force-opened');
                    setPendingForceOpen(null);
                  },
                  onError: error => {
                    toastError(
                      error instanceof Error
                        ? error.message
                        : 'Failed to force-open circuit breaker'
                    );
                    setPendingForceOpen(null);
                  },
                }
              );
            }
          }}
          title="Force Open Circuit Breaker?"
          message="This will immediately block all requests to this server:model combination."
          consequences={[
            'All new requests will be blocked immediately',
            'Auto-recovery will be disabled',
            'You will need to manually close the circuit to restore traffic',
          ]}
          confirmLabel="Force Open"
          isPending={openMutation.isPending}
        />
      )}
    </div>
  );
});
