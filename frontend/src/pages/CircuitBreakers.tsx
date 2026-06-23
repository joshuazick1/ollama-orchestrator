import { useState, useMemo, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCircuitBreakers,
  resetCircuitBreaker,
  forceOpenCircuitBreaker,
  forceCloseCircuitBreaker,
  getBans,
  triggerRecoveryTest,
  type CircuitBreakerInfo,
} from '../api';
import { Shield, RefreshCw, Ban } from 'lucide-react';
import { toastSuccess, toastError } from '../utils/toast';
import { safeArray } from '../utils/safeArray';
import { DataToolbar } from '../components/DataToolbar';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { useDataTable } from '../hooks/useDataTable';
import { BansTab } from '../components/circuit-breakers/BansTab';
import {
  CircuitBreakersSummary,
  CircuitBreakersEmptyState,
  CircuitBreakerBehaviorInfo,
  ServerGroupCard,
} from '../components/circuit-breakers';

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
  provider?: string;
}

const groupBreakersByServer = (breakers: CircuitBreakerInfo[]): GroupedBreakers[] => {
  const groups = new Map<string, GroupedBreakers>();

  for (const breaker of breakers) {
    const lastColonIndex = breaker.serverId.lastIndexOf(':');
    const serverId =
      lastColonIndex === -1 ? breaker.serverId : breaker.serverId.substring(0, lastColonIndex);
    const model =
      lastColonIndex === -1 ? undefined : breaker.serverId.substring(lastColonIndex + 1);

    if (!groups.has(serverId)) {
      groups.set(serverId, {
        serverId,
        serverBreaker: null,
        modelBreakers: [],
        hasOpenCircuit: false,
        totalFailures: 0,
        provider: 'ollama',
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
  const [pendingRecoveryTest, setPendingRecoveryTest] = useState<{
    serverId: string;
    model: string;
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
  const breakers = safeArray<CircuitBreakerInfo>(data?.circuitBreakers);

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

  const recoveryTestMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model: string }) =>
      triggerRecoveryTest(serverId, model),
    onSuccess: (_data, vars) => {
      toastSuccess(`Recovery test triggered for ${vars.model} on ${vars.serverId}`);
      queryClient.invalidateQueries({ queryKey: ['circuitBreakers'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : `Failed to trigger recovery test`);
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

  const isPending =
    resetMutation.isPending ||
    openMutation.isPending ||
    closeMutation.isPending ||
    recoveryTestMutation.isPending;

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

          <CircuitBreakersSummary breakers={breakers} />

          <div className="space-y-4">
            {groupedServers.length === 0 ? (
              <CircuitBreakersEmptyState />
            ) : (
              groupedServers.map(server => (
                <ServerGroupCard
                  key={server.serverId}
                  server={server}
                  expandedServers={expandedServers}
                  onToggle={toggleServer}
                  onReset={(serverId, model) => resetMutation.mutate({ serverId, model })}
                  onOpen={(serverId, model) => setPendingForceOpen({ serverId, model })}
                  onClose={(serverId, model) => closeMutation.mutate({ serverId, model })}
                  onRecoveryTest={(serverId, model) => setPendingRecoveryTest({ serverId, model })}
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

      {pendingRecoveryTest && (
        <ConfirmationModal
          isOpen={!!pendingRecoveryTest}
          onClose={() => setPendingRecoveryTest(null)}
          onConfirm={() => {
            if (pendingRecoveryTest) {
              recoveryTestMutation.mutate(
                { serverId: pendingRecoveryTest.serverId, model: pendingRecoveryTest.model },
                {
                  onSuccess: () => {
                    toastSuccess('Recovery test triggered successfully');
                    setPendingRecoveryTest(null);
                  },
                  onError: error => {
                    toastError(
                      error instanceof Error ? error.message : 'Failed to trigger recovery test'
                    );
                    setPendingRecoveryTest(null);
                  },
                }
              );
            }
          }}
          title="Run Recovery Test?"
          message={`This will send a test request to ${pendingRecoveryTest?.model} on ${pendingRecoveryTest?.serverId} to check if the circuit can recover.`}
          consequences={[
            'A test request will be sent to the server',
            'The circuit breaker state will be updated based on the result',
            'If successful, the circuit may transition to half-open or closed state',
          ]}
          confirmLabel="Run Test"
          isPending={recoveryTestMutation.isPending}
        />
      )}
    </div>
  );
});
