import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getServers, removeServer, getMetrics } from '../api';
import { probeServer, getPerfProbeScheduledProbes } from '../api/perf-probe';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { ModelManagerModal } from '../components/ModelManagerModal';
import { useDataTable } from '../hooks/useDataTable';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import type { AIServer } from '../types';
import { toastSuccess, toastError } from '../utils/toast';
import { compareVersions } from '../utils/formatting';
import { SkeletonServerCard } from '../components/skeletons';
import { useModelPulls } from '../hooks/useModelPulls';
import { ServerCard } from './servers/ServerCard';
import { ServerFilters } from './servers/ServerFilters';
import { AddServerModal } from './servers/AddServerModal';
import { Badge } from '../components/ui/badge';

// Provider configuration for auto-fill and hints
export const PROVIDER_CONFIG = {
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434',
    hint: 'Local Ollama server',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'OpenAI API endpoint',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    hint: 'Anthropic API endpoint',
  },
  azure: {
    name: 'Azure OpenAI',
    baseUrl: 'https://{resource}.openai.azure.com/openai/v1',
    hint: 'Azure OpenAI resource endpoint',
  },
  bedrock: {
    name: 'AWS Bedrock',
    baseUrl: 'https://bedrock-runtime.{region}.amazonaws.com',
    hint: 'AWS Bedrock endpoint',
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.io',
    hint: 'MiniMax API endpoint',
  },
  custom: {
    name: 'Custom',
    baseUrl: '',
    hint: 'Enter a custom server URL',
  },
} as const;

export type ProviderType = keyof typeof PROVIDER_CONFIG;

export const Servers = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isLive } = useLiveUpdates({
    invalidateQueries: [['servers'], ['metrics']],
  });
  const { data: servers, isLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
    refetchInterval: 5000,
  });
  const { isServerPulling, getServerPulls } = useModelPulls();
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [groupConfig, setGroupConfig] = useState<'none' | 'version' | 'healthy'>('none');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modelManagerServer, setModelManagerServer] = useState<AIServer | null>(null);
  const [serverToDelete, setServerToDelete] = useState<AIServer | null>(null);
  const [probeConfirmation, setProbeConfirmation] = useState<AIServer | null>(null);

  const { data: metricsData } = useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
    refetchInterval: 10000,
  });

  const { data: scheduledProbesData } = useQuery({
    queryKey: ['perf-probe-scheduled'],
    queryFn: () => getPerfProbeScheduledProbes(),
    refetchInterval: 30000,
  });

  // Enrich data for sorting/filtering
  const enrichedServers = useMemo(() => {
    return (servers || []).map(server => ({
      ...server,
      modelCount: server.models.length,
      status: server.healthy ? 'healthy' : 'unhealthy',
      supportsOllama: server.supportsOllama !== false && server.type !== 'openai',
      supportsOpenAI: server.supportsV1 || server.type === 'openai' || server.type === 'auto',
    }));
  }, [servers]);

  const {
    searchQuery,
    setSearchQuery,
    sortConfig,
    handleSort,
    filters,
    handleFilter,
    processedData: filteredServers,
  } = useDataTable({
    data: enrichedServers,
    initialSort: { key: 'url', direction: 'asc' },
    searchKeys: ['url', 'version', 'type', 'id'],
    filterFn: (item, key, value) => {
      if (key === 'status') return item.status === value;
      if (key === 'support') {
        if (value === 'ollama') return item.supportsOllama;
        if (value === 'openai') return !!item.supportsOpenAI;
        return true;
      }
      return true;
    },
    sortFns: {
      version: (a, b) => compareVersions(a.version || '', b.version || ''),
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      toastSuccess('Server removed');
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to remove server');
    },
  });

  const probeMutation = useMutation({
    mutationFn: ({ serverId }: { serverId: string }) => probeServer(serverId),
    onSuccess: data => {
      toastSuccess('Performance probe started');
      navigate(`/perf-probe?taskId=${encodeURIComponent(data.taskId)}`);
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to start probe');
    },
  });

  const groupedServers = useMemo(() => {
    if (groupConfig === 'none') return { 'All Servers': filteredServers };

    return filteredServers.reduce(
      (acc, server) => {
        let key = 'Unknown';
        if (groupConfig === 'version') {
          key = server.version || 'Unknown';
        } else if (groupConfig === 'healthy') {
          key = server.healthy ? 'Healthy' : 'Unhealthy';
        }

        if (!acc[key]) acc[key] = [];
        acc[key].push(server);
        return acc;
      },
      {} as Record<string, AIServer[]>
    );
  }, [filteredServers, groupConfig]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-text-base">Servers</h2>
            <p className="text-text-muted">Manage your AI inference nodes</p>
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <SkeletonServerCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-base">Servers</h2>
          <p className="text-text-muted">Manage your AI inference nodes</p>
        </div>
        <Badge
          variant={isLive ? 'default' : 'secondary'}
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

      <ServerFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortConfig={sortConfig}
        onSortChange={handleSort}
        filters={filters}
        onFilterChange={handleFilter}
        groupConfig={groupConfig}
        onGroupChange={setGroupConfig}
        onAddServer={() => setIsAddModalOpen(true)}
      />

      <div className="space-y-8">
        {Object.entries(groupedServers).map(([group, groupServers]) => (
          <div key={group} className="space-y-4">
            {groupConfig !== 'none' && (
              <h3 className="text-lg font-medium text-text-muted border-b border-surface-border/50 pb-2">
                {group} <span className="text-sm text-gray-500 ml-2">({groupServers.length})</span>
              </h3>
            )}

            <div className="grid grid-cols-1 gap-6">
              {groupServers.map((server: AIServer) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  metricsData={metricsData}
                  expandedServerId={expandedServerId}
                  setExpandedServerId={setExpandedServerId}
                  isServerPulling={isServerPulling}
                  getServerPulls={getServerPulls}
                  setModelManagerServer={setModelManagerServer}
                  setServerToDelete={setServerToDelete}
                  setProbeConfirmation={setProbeConfirmation}
                  scheduledProbes={scheduledProbesData?.newServerProbes}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <AddServerModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />

      <ConfirmationModal
        isOpen={!!serverToDelete}
        onClose={() => setServerToDelete(null)}
        onConfirm={() => serverToDelete && removeMutation.mutate(serverToDelete.id)}
        title="Remove Server"
        message={`Are you sure you want to remove ${serverToDelete?.url || 'this server'}? This action cannot be undone.`}
        confirmLabel="Remove"
      />

      <ModelManagerModal
        isOpen={!!modelManagerServer}
        onClose={() => setModelManagerServer(null)}
        server={modelManagerServer}
      />

      <ConfirmationModal
        isOpen={!!probeConfirmation}
        onClose={() => setProbeConfirmation(null)}
        onConfirm={() => {
          if (probeConfirmation) {
            probeMutation.mutate({ serverId: probeConfirmation.id });
          }
          setProbeConfirmation(null);
        }}
        title="Probe Server"
        message={`This will run a performance probe against ${probeConfirmation?.url}. It will probe every model on this server and take approximately 30 seconds.`}
        confirmLabel="Start Probe"
        consequences={[
          'All models on this server will be probed',
          'Real network bandwidth will be used',
          'Estimated duration: ~30 seconds',
        ]}
        isPending={probeMutation.isPending}
      />
    </div>
  );
};
