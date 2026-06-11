import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getServers,
  addServer,
  removeServer,
  drainServer,
  undrainServer,
  setServerMaintenance,
  getMetrics,
} from '../api';
import { Modal } from '../components/Modal';
import { ModelManagerModal } from '../components/ModelManagerModal';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { DataToolbar } from '../components/DataToolbar';
import { Button } from '../components/Button';
import { Badge } from '../components/Badge';
import { useDataTable } from '../hooks/useDataTable';
import { validateForm, addServerSchema } from '../validations';
import { encodeUrlParam } from '../utils/security';
import {
  Plus,
  Trash2,
  Server as ServerIcon,
  Power,
  PowerOff,
  Wrench,
  Download,
  CheckCircle,
  XCircle,
  Wifi,
} from 'lucide-react';
import type { AIServer } from '../types';
import { toastSuccess, toastError } from '../utils/toast';
import { compareVersions } from '../utils/formatting';
import { SkeletonServerCard } from '../components/skeletons';
import { useModelPulls } from '../hooks/useModelPulls';

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
  const { data: servers, isLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
    refetchInterval: 5000,
  });
  const { isServerPulling, getServerPulls } = useModelPulls();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerConcurrency, setNewServerConcurrency] = useState<number | ''>('');
  const [newServerApiKey, setNewServerApiKey] = useState('');
  const [apiKeyConfirmed, setApiKeyConfirmed] = useState(false);
  const [newServerType, setNewServerType] = useState<'ollama' | 'openai' | 'auto'>('auto');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [newServerV1Models, setNewServerV1Models] = useState('');
  const [newServerForceOllama, setNewServerForceOllama] = useState(false);
  const [newServerForceV1, setNewServerForceV1] = useState(false);
  const [newServerForceAnthropic, setNewServerForceAnthropic] = useState(false);
  const [newServerAnthropicPathOverride, setNewServerAnthropicPathOverride] = useState('');
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);

  // Provider selector state
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>('ollama');
  const [testConnectionStatus, setTestConnectionStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle');
  const [testConnectionMessage, setTestConnectionMessage] = useState('');

  // View options
  const [groupConfig, setGroupConfig] = useState<'none' | 'version' | 'healthy'>('none');

  const [modelManagerServer, setModelManagerServer] = useState<AIServer | null>(null);
  const [serverToDelete, setServerToDelete] = useState<AIServer | null>(null);

  const { data: metricsData } = useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
    refetchInterval: 10000,
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

  const addMutation = useMutation({
    mutationFn: addServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      toastSuccess('Server added successfully');
      setIsAddModalOpen(false);
      setNewServerUrl('');
      setNewServerConcurrency('');
      setNewServerApiKey('');
      setApiKeyConfirmed(false);
      setNewServerType('ollama');
      setShowAdvancedOptions(false);
      setNewServerV1Models('');
      setNewServerForceOllama(false);
      setNewServerForceV1(false);
      setNewServerForceAnthropic(false);
      setNewServerAnthropicPathOverride('');
      setValidationErrors({});
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

  const drainMutation = useMutation({
    mutationFn: drainServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['in-flight'] });
      toastSuccess('Server drained');
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to drain server');
    },
  });

  const undrainMutation = useMutation({
    mutationFn: undrainServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['in-flight'] });
      toastSuccess('Server undrained');
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to undrain server');
    },
  });

  const maintenanceMutation = useMutation({
    mutationFn: ({ serverId, enabled }: { serverId: string; enabled: boolean }) =>
      setServerMaintenance(serverId, enabled),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      toastSuccess(
        `Server ${variables.enabled ? 'in maintenance mode' : 'maintenance mode disabled'}`
      );
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to set maintenance mode');
    },
  });

  const handleAddServer = (e: React.FormEvent) => {
    e.preventDefault();

    const formData = {
      url: newServerUrl,
      maxConcurrency: newServerConcurrency === '' ? undefined : newServerConcurrency,
      apiKey: newServerApiKey || undefined,
      v1Models: newServerV1Models || undefined,
      forceOllama: newServerForceOllama || undefined,
      forceV1: newServerForceV1 || undefined,
      forceAnthropic: newServerForceAnthropic || undefined,
      anthropicPathOverride: newServerAnthropicPathOverride || undefined,
    };

    const validation = validateForm(addServerSchema, formData);

    if (!validation.success) {
      setValidationErrors(validation.errors || {});
      return;
    }

    // Clear any previous errors
    setValidationErrors({});

    // Generate id from URL using a safer method
    const id = btoa(encodeUrlParam(newServerUrl)).replace(/[^a-zA-Z0-9]/g, '');
    addMutation.mutate({
      id,
      url: newServerUrl,
      type: newServerType,
      maxConcurrency: newServerConcurrency === '' ? undefined : newServerConcurrency,
      apiKey: newServerApiKey || undefined,
      v1Models: newServerV1Models || undefined,
      forceOllama: newServerForceOllama || undefined,
      forceV1: newServerForceV1 || undefined,
      forceAnthropic: newServerForceAnthropic || undefined,
      anthropicPathOverride: newServerAnthropicPathOverride || undefined,
    });
  };

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
      <div>
        <h2 className="text-2xl font-bold text-text-base">Servers</h2>
        <p className="text-text-muted">Manage your AI inference nodes</p>
      </div>

      <DataToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortConfig={sortConfig}
        onSortChange={handleSort}
        sortOptions={[
          { key: 'url', label: 'URL' },
          { key: 'healthy', label: 'Health' },
          { key: 'lastResponseTime', label: 'Response Time' },
          { key: 'modelCount', label: 'Model Count' },
          { key: 'version', label: 'Version' },
        ]}
        filterOptions={[
          {
            key: 'status',
            label: 'Status',
            options: [
              { label: 'Healthy', value: 'healthy' },
              { label: 'Unhealthy', value: 'unhealthy' },
            ],
          },
          {
            key: 'support',
            label: 'Support',
            options: [
              { label: 'Ollama', value: 'ollama' },
              { label: 'OpenAI', value: 'openai' },
            ],
          },
        ]}
        filters={filters}
        onFilterChange={handleFilter}
      >
        {/* Grouping Control */}
        <div className="flex items-center space-x-2 bg-gray-950 rounded-lg px-3 py-1.5 border border-gray-800">
          <span className="text-gray-500 text-xs font-medium">Group:</span>
          <select
            value={groupConfig}
            onChange={e => setGroupConfig(e.target.value as 'none' | 'version' | 'healthy')}
            className="bg-transparent text-gray-300 text-sm outline-none cursor-pointer hover:text-text-base transition-colors"
          >
            <option value="none" className="bg-surface-raised">
              None
            </option>
            <option value="version" className="bg-surface-raised">
              Version
            </option>
            <option value="healthy" className="bg-surface-raised">
              Health
            </option>
          </select>
        </div>

        <Button onClick={() => setIsAddModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          <span>Add Server</span>
        </Button>
      </DataToolbar>

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
                <div
                  key={server.id}
                  className={`bg-surface rounded-xl border border-surface-border transition-all duration-200 overflow-hidden ${
                    expandedServerId === server.id
                      ? 'ring-2 ring-blue-500/50'
                      : 'hover:border-gray-600'
                  }`}
                >
                  <div
                    className="p-6 cursor-pointer"
                    onClick={() =>
                      setExpandedServerId(expandedServerId === server.id ? null : server.id)
                    }
                  >
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div className="flex items-center space-x-4">
                        <Badge variant={server.healthy ? 'success' : 'danger'} size="md">
                          <ServerIcon className="w-6 h-6" />
                        </Badge>
                        <div>
                          <h3 className="font-semibold text-text-base text-lg">{server.url}</h3>
                          <div className="flex items-center space-x-2 text-sm text-gray-500">
                            <span className="font-mono">{server.id.substring(0, 8)}</span>
                            <span>•</span>
                            <span>{server.models.length} Models</span>
                            <span>•</span>
                            <span>{server.version || 'v?'}</span>
                          </div>
                          <div className="flex items-center space-x-2 mt-1">
                            {server.type && (
                              <Badge
                                variant={
                                  server.type === 'openai'
                                    ? 'success'
                                    : server.type === 'auto'
                                      ? 'info'
                                      : 'neutral'
                                }
                                size="sm"
                              >
                                {server.type === 'openai'
                                  ? 'OpenAI'
                                  : server.type === 'auto'
                                    ? 'Auto'
                                    : 'Ollama'}
                              </Badge>
                            )}
                            {server.supportsOllama !== false && server.type !== 'openai' && (
                              <Badge variant="neutral" size="sm">
                                Ollama
                              </Badge>
                            )}
                            {server.supportsV1 && (
                              <Badge variant="warning" size="sm">
                                OpenAI
                              </Badge>
                            )}
                            {server.supportsAnthropic && (
                              <Badge variant="info" size="sm">
                                Anthropic
                              </Badge>
                            )}
                            {server.apiKey && (
                              <span className="text-xs" title="API Key configured">
                                🔑
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-6 w-full md:w-auto justify-between md:justify-end">
                        <div className="text-right">
                          <div className="text-sm text-text-muted">Response Time</div>
                          <div
                            className={`font-mono ${server.lastResponseTime > 1000 ? 'text-yellow-400' : 'text-text-base'}`}
                          >
                            {server.lastResponseTime > 0 ? `${server.lastResponseTime}ms` : '-'}
                          </div>
                        </div>

                        <Badge variant={server.healthy ? 'success' : 'danger'} size="sm">
                          {server.healthy ? 'Healthy' : 'Unhealthy'}
                        </Badge>

                        {isServerPulling(server.id) && (
                          <Badge variant="info" size="sm">
                            <Download className="w-3 h-3 mr-1 animate-bounce" />
                            <span>
                              Pulling (
                              {
                                getServerPulls(server.id).filter(op => op.status === 'downloading')
                                  .length
                              }
                              )
                            </span>
                          </Badge>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={e => {
                            e.stopPropagation();
                            setServerToDelete(server);
                          }}
                          title="Remove Server"
                        >
                          <Trash2 className="w-5 h-5" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {expandedServerId === server.id && (
                    <div className="px-6 pb-6 pt-0 border-t border-surface-border/50 mt-4 bg-surface/50">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
                        {/* Server Details */}
                        <div className="space-y-4">
                          <h4 className="text-sm font-medium text-text-muted uppercase tracking-wider">
                            Server Details
                          </h4>
                          <div className="space-y-2">
                            <div className="flex justify-between p-3 bg-surface-raised/50 rounded-lg">
                              <span className="text-text-muted">Ollama Version</span>
                              <span className="text-text-base font-mono">
                                {server.version || 'Unknown'}
                              </span>
                            </div>
                            <div className="flex justify-between p-3 bg-surface-raised/50 rounded-lg">
                              <span className="text-text-muted">Concurrency Limit</span>
                              <span className="text-text-base font-mono">
                                {server.maxConcurrency || 4}
                              </span>
                            </div>
                            <div className="flex justify-between p-3 bg-surface-raised/50 rounded-lg">
                              <span className="text-text-muted">API Key</span>
                              <span className="text-text-base font-mono">
                                {server.apiKey ? '***REDACTED***' : 'Not set'}
                              </span>
                            </div>
                          </div>

                          {/* VRAM Usage */}
                          {server.hardware &&
                            server.hardware.totalVram != null &&
                            server.hardware.totalVram > 0 && (
                              <div className="p-3 bg-surface-raised/50 rounded-lg">
                                <div className="flex justify-between text-sm mb-2">
                                  <span className="text-text-muted">VRAM Usage</span>
                                  <span className="text-text-base font-mono">
                                    {((server.hardware.usedVram ?? 0) / 1024).toFixed(1)} /{' '}
                                    {(server.hardware.totalVram / 1024).toFixed(1)} GB
                                  </span>
                                </div>
                                <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${
                                      (server.hardware.usedVram ?? 0) / server.hardware.totalVram >
                                      0.9
                                        ? 'bg-red-500'
                                        : (server.hardware.usedVram ?? 0) /
                                              server.hardware.totalVram >
                                            0.7
                                          ? 'bg-yellow-500'
                                          : 'bg-blue-500'
                                    }`}
                                    style={{
                                      width: `${Math.min(100, ((server.hardware.usedVram ?? 0) / server.hardware.totalVram) * 100)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            )}

                          {/* Model Metrics Aggregate */}
                          {metricsData?.servers?.[server.id] &&
                            (() => {
                              const srvMetrics = metricsData.servers[server.id];
                              const modelEntries = Object.entries(srvMetrics.models || {});
                              const avgTps =
                                modelEntries.length > 0
                                  ? modelEntries.reduce(
                                      (sum, [, m]) => sum + (m.avgTokensPerSecond ?? 0),
                                      0
                                    ) / modelEntries.length
                                  : null;
                              const totalColdStarts = modelEntries.reduce(
                                (sum, [, m]) => sum + (m.coldStartCount ?? 0),
                                0
                              );
                              const avgNetOverhead =
                                modelEntries.filter(([, m]) => m.avgNetworkOverheadMs != null)
                                  .length > 0
                                  ? modelEntries
                                      .filter(([, m]) => m.avgNetworkOverheadMs != null)
                                      .reduce(
                                        (sum, [, m]) => sum + (m.avgNetworkOverheadMs ?? 0),
                                        0
                                      ) /
                                    modelEntries.filter(([, m]) => m.avgNetworkOverheadMs != null)
                                      .length
                                  : null;
                              if (
                                avgTps === null &&
                                totalColdStarts === 0 &&
                                avgNetOverhead === null
                              )
                                return null;
                              return (
                                <div>
                                  <h4 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-2">
                                    Performance
                                  </h4>
                                  <div className="space-y-2">
                                    {avgTps !== null && (
                                      <div className="flex justify-between p-3 bg-surface-raised/50 rounded-lg">
                                        <span className="text-text-muted">Avg Token Speed</span>
                                        <span className="text-text-base font-mono">
                                          {avgTps.toFixed(1)} tok/s
                                        </span>
                                      </div>
                                    )}
                                    {totalColdStarts > 0 && (
                                      <div className="flex justify-between p-3 bg-surface-raised/50 rounded-lg">
                                        <span className="text-text-muted">Cold Starts</span>
                                        <span className="text-yellow-400 font-mono">
                                          {totalColdStarts}
                                        </span>
                                      </div>
                                    )}
                                    {avgNetOverhead !== null && (
                                      <div className="flex justify-between p-3 bg-surface-raised/50 rounded-lg">
                                        <span className="text-text-muted">Network Overhead</span>
                                        <span className="text-text-base font-mono">
                                          {avgNetOverhead.toFixed(1)}ms
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                          {/* Endpoint Probes */}
                          {server.probedEndpoints && (
                            <div>
                              <h4 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-2">
                                Endpoint Probes
                              </h4>
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  { key: 'ollama_chat', label: '/api/chat' },
                                  { key: 'ollama_generate', label: '/api/generate' },
                                  { key: 'ollama_embeddings', label: '/api/embeddings' },
                                  { key: 'openai_chat', label: '/v1/chat/completions' },
                                  { key: 'openai_completions', label: '/v1/completions' },
                                  { key: 'openai_embeddings', label: '/v1/embeddings' },
                                  { key: 'anthropic_messages', label: '/v1/messages' },
                                ].map(({ key, label }) => (
                                  <div
                                    key={key}
                                    className="flex items-center space-x-2 p-2 bg-surface-raised/50 rounded-lg"
                                  >
                                    {server.probedEndpoints?.[
                                      key as keyof typeof server.probedEndpoints
                                    ] ? (
                                      <CheckCircle className="w-4 h-4 text-green-500" />
                                    ) : (
                                      <XCircle className="w-4 h-4 text-red-500" />
                                    )}
                                    <span className="text-xs text-text-base font-mono">
                                      {label}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="pt-4">
                            <h4 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">
                              Actions
                            </h4>
                            <div className="space-y-3">
                              <div className="flex space-x-3">
                                {server.supportsOllama !== false && (
                                  <Button
                                    variant="secondary"
                                    className="flex-1"
                                    onClick={e => {
                                      e.stopPropagation();
                                      setModelManagerServer(server);
                                    }}
                                  >
                                    Manage Models
                                  </Button>
                                )}
                                <Button
                                  variant="danger"
                                  className="flex-1"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setServerToDelete(server);
                                  }}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  <span>Remove</span>
                                </Button>
                              </div>

                              {/* Server Maintenance Actions */}
                              <div className="border-t border-surface-border/50 pt-3">
                                <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                                  Maintenance
                                </h5>
                                <div className="flex space-x-2">
                                  <Button
                                    variant="secondary"
                                    className="flex-1"
                                    disabled={drainMutation.isPending}
                                    onClick={e => {
                                      e.stopPropagation();
                                      drainMutation.mutate(server.id);
                                    }}
                                  >
                                    <Power className="w-4 h-4 mr-2" />
                                    <span>Drain</span>
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    className="flex-1"
                                    disabled={undrainMutation.isPending}
                                    onClick={e => {
                                      e.stopPropagation();
                                      undrainMutation.mutate(server.id);
                                    }}
                                  >
                                    <PowerOff className="w-4 h-4 mr-2" />
                                    <span>Undrain</span>
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    className="flex-1"
                                    disabled={maintenanceMutation.isPending}
                                    onClick={e => {
                                      e.stopPropagation();
                                      maintenanceMutation.mutate({
                                        serverId: server.id,
                                        enabled: true,
                                      });
                                    }}
                                  >
                                    <Wrench className="w-4 h-4 mr-2" />
                                    <span>Maintain</span>
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Models List */}
                        <div>
                          <h4 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4 flex justify-between items-center">
                            <span>Installed Models ({server.models.length})</span>
                          </h4>
                          <div className="bg-surface-raised/50 rounded-lg border border-surface-border/50 max-h-[300px] overflow-y-auto">
                            {server.models.length > 0 ? (
                              <div className="divide-y divide-gray-700/50">
                                {server.models.map(model => (
                                  <div
                                    key={model}
                                    className="p-3 hover:bg-surface/50 transition-colors flex justify-between items-center"
                                  >
                                    <span className="text-sm text-gray-200">{model}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="p-8 text-center text-gray-500">
                                No models found on this server
                              </div>
                            )}
                          </div>
                        </div>

                        {/* V1 Models Section */}
                        <div>
                          <h4 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-4">
                            <span>
                              V1 Models (
                              {(server.v1Models?.length ?? 0) +
                                (server.discoveredV1Models?.length ?? 0)}
                              )
                            </span>
                          </h4>
                          {(server.v1Models?.length ?? 0) > 0 && (
                            <div className="mb-3">
                              <span className="text-xs font-medium text-blue-400 uppercase tracking-wider">
                                Manual:
                              </span>
                              <div className="bg-surface-raised/50 rounded-lg border border-surface-border/50 max-h-[100px] overflow-y-auto mt-1">
                                <div className="divide-y divide-gray-700/50">
                                  {server.v1Models?.map(model => (
                                    <div
                                      key={model}
                                      className="p-2 hover:bg-surface/50 transition-colors"
                                    >
                                      <span className="text-sm text-gray-200">{model}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                          {(server.discoveredV1Models?.length ?? 0) > 0 && (
                            <div>
                              <span className="text-xs font-medium text-green-400 uppercase tracking-wider">
                                Discovered:
                              </span>
                              <div className="bg-surface-raised/50 rounded-lg border border-surface-border/50 max-h-[100px] overflow-y-auto mt-1">
                                <div className="divide-y divide-gray-700/50">
                                  {server.discoveredV1Models?.map(model => (
                                    <div
                                      key={model}
                                      className="p-2 hover:bg-surface/50 transition-colors"
                                    >
                                      <span className="text-sm text-gray-200">{model}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                          {(server.v1Models?.length ?? 0) === 0 &&
                            (server.discoveredV1Models?.length ?? 0) === 0 && (
                              <div className="p-4 text-center text-gray-500 bg-surface-raised/50 rounded-lg border border-surface-border/50">
                                No V1 models configured
                              </div>
                            )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add New Server"
      >
        <form onSubmit={handleAddServer} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Provider</label>
            <select
              value={selectedProvider}
              onChange={e => {
                const provider = e.target.value as ProviderType;
                setSelectedProvider(provider);
                if (provider !== 'custom') {
                  setNewServerUrl(PROVIDER_CONFIG[provider].baseUrl);
                }
              }}
              className="w-full bg-surface-raised border border-surface-border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500"
            >
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="azure">Azure OpenAI</option>
              <option value="bedrock">AWS Bedrock</option>
              <option value="minimax">MiniMax</option>
              <option value="custom">Custom</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">{PROVIDER_CONFIG[selectedProvider].hint}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Server URL</label>
            <input
              type="text"
              value={newServerUrl}
              onChange={e => setNewServerUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className={`w-full bg-surface-raised border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500 ${
                validationErrors.url ? 'border-red-500' : 'border-surface-border'
              }`}
            />
            {validationErrors.url && (
              <p className="mt-1 text-sm text-red-400">{validationErrors.url}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Server Type</label>
            <select
              value={newServerType}
              onChange={e => setNewServerType(e.target.value as 'ollama' | 'openai' | 'auto')}
              className="w-full bg-surface-raised border border-surface-border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500"
            >
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI-compatible</option>
              <option value="auto">Auto-detect</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Auto-detect probes both Ollama and OpenAI endpoints
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Max Concurrency (optional)
            </label>
            <input
              type="number"
              value={newServerConcurrency}
              onChange={e =>
                setNewServerConcurrency(e.target.value === '' ? '' : parseInt(e.target.value))
              }
              placeholder="4"
              min="1"
              max="100"
              className={`w-full bg-surface-raised border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500 ${
                validationErrors.maxConcurrency ? 'border-red-500' : 'border-surface-border'
              }`}
            />
            {validationErrors.maxConcurrency && (
              <p className="mt-1 text-sm text-red-400">{validationErrors.maxConcurrency}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              API Key (optional)
            </label>
            <input
              type="password"
              value={newServerApiKey}
              onChange={e => setNewServerApiKey(e.target.value)}
              placeholder="env:MY_API_KEY or sk-..."
              className={`w-full bg-surface-raised border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500 ${
                validationErrors.apiKey ? 'border-red-500' : 'border-surface-border'
              }`}
            />
            {validationErrors.apiKey && (
              <p className="mt-1 text-sm text-red-400">{validationErrors.apiKey}</p>
            )}
            {newServerApiKey && !newServerApiKey.startsWith('env:') && (
              <>
                <p className="mt-1 text-sm text-yellow-400">
                  Warning: Plain text API keys are stored unencrypted. Use &quot;env:VAR_NAME&quot;
                  to reference environment variables instead.
                </p>
                <label className="mt-2 flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={apiKeyConfirmed}
                    onChange={e => setApiKeyConfirmed(e.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm text-gray-300">
                    I understand the security risk of storing plain text API keys
                  </span>
                </label>
                <p className="mt-1 text-xs text-gray-500">
                  Use &quot;env:VAR_NAME&quot; to reference environment variables
                </p>
              </>
            )}
          </div>

          {/* Advanced Options Collapsible Section */}
          <div className="border-t border-surface-border pt-4">
            <button
              type="button"
              onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
              className="flex items-center justify-between w-full text-left text-sm font-medium text-gray-300 hover:text-text-base transition-colors"
            >
              <span>Advanced Options</span>
              <svg
                className={`w-4 h-4 transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {showAdvancedOptions && (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    V1 Models (optional)
                  </label>
                  <input
                    type="text"
                    value={newServerV1Models}
                    onChange={e => setNewServerV1Models(e.target.value)}
                    placeholder="MiniMax-M2.7, MiniMax-M2.5, ..."
                    className="w-full bg-surface-raised border border-surface-border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Comma-separated list of V1-compatible models
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newServerForceOllama}
                      onChange={e => setNewServerForceOllama(e.target.checked)}
                      className="w-4 h-4 rounded border-surface-border bg-surface-raised text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className="text-sm font-medium text-gray-300">Force Ollama support</span>
                  </label>

                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newServerForceV1}
                      onChange={e => setNewServerForceV1(e.target.checked)}
                      className="w-4 h-4 rounded border-surface-border bg-surface-raised text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className="text-sm font-medium text-gray-300">Force OpenAI support</span>
                  </label>

                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newServerForceAnthropic}
                      onChange={e => setNewServerForceAnthropic(e.target.checked)}
                      className="w-4 h-4 rounded border-surface-border bg-surface-raised text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className="text-sm font-medium text-gray-300">
                      Force Anthropic support
                    </span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Anthropic Path Override (optional)
                  </label>
                  <input
                    type="text"
                    value={newServerAnthropicPathOverride}
                    onChange={e => setNewServerAnthropicPathOverride(e.target.value)}
                    placeholder="/anthropic/v1/messages"
                    className="w-full bg-surface-raised border border-surface-border rounded-lg px-4 py-2 text-text-base focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                if (!newServerUrl) {
                  setTestConnectionStatus('error');
                  setTestConnectionMessage('Please enter a server URL first');
                  return;
                }
                setTestConnectionStatus('testing');
                setTestConnectionMessage('');
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 5000);
                  const response = await fetch(newServerUrl, {
                    method: 'HEAD',
                    signal: controller.signal,
                  });
                  clearTimeout(timeoutId);
                  if (response.ok || response.status === 401) {
                    setTestConnectionStatus('success');
                    setTestConnectionMessage('Connection successful!');
                  } else {
                    setTestConnectionStatus('error');
                    setTestConnectionMessage(`Server responded with status ${response.status}`);
                  }
                } catch (err) {
                  setTestConnectionStatus('error');
                  setTestConnectionMessage(
                    err instanceof Error ? err.message : 'Connection failed'
                  );
                }
              }}
              disabled={testConnectionStatus === 'testing'}
            >
              <Wifi className="w-4 h-4 mr-2" />
              {testConnectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={addMutation.isPending}
              disabled={!apiKeyConfirmed || addMutation.isPending}
            >
              {addMutation.isPending ? 'Adding...' : 'Add Server'}
            </Button>
          </div>
          {testConnectionStatus !== 'idle' && testConnectionMessage && (
            <div
              className={`mt-2 p-3 rounded-lg text-sm ${
                testConnectionStatus === 'success'
                  ? 'bg-green-900/30 text-green-400 border border-green-800'
                  : 'bg-red-900/30 text-red-400 border border-red-800'
              }`}
            >
              {testConnectionStatus === 'success' && (
                <CheckCircle className="w-4 h-4 inline mr-2" />
              )}
              {testConnectionStatus === 'error' && <XCircle className="w-4 h-4 inline mr-2" />}
              {testConnectionMessage}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!serverToDelete}
        onClose={() => setServerToDelete(null)}
        onConfirm={() => serverToDelete && removeMutation.mutate(serverToDelete.id)}
        title="Remove Server"
        message={`Are you sure you want to remove ${serverToDelete?.url || 'this server'}? This action cannot be undone.`}
        confirmLabel="Remove"
      />

      {/* Model Manager Modal */}
      <ModelManagerModal
        isOpen={!!modelManagerServer}
        onClose={() => setModelManagerServer(null)}
        server={modelManagerServer}
      />
    </div>
  );
};
