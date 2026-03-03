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
import { validateForm, addServerSchema } from '../validations';
import { encodeUrlParam } from '../utils/security';
import { Plus, Trash2, Server as ServerIcon, Power, PowerOff, Wrench } from 'lucide-react';
import type { AIServer } from '../types';
import { toastSuccess, toastError } from '../utils/toast';

export const Servers = () => {
  const queryClient = useQueryClient();
  const { data: servers, isLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
    refetchInterval: 5000,
  });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerConcurrency, setNewServerConcurrency] = useState<number | ''>('');
  const [newServerApiKey, setNewServerApiKey] = useState('');
  const [newServerType, setNewServerType] = useState<'ollama' | 'openai' | 'auto'>('ollama');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: keyof AIServer | 'modelCount';
    direction: 'asc' | 'desc';
  }>({ key: 'url', direction: 'asc' });
  const [groupConfig, setGroupConfig] = useState<'none' | 'version' | 'healthy'>('none');
  const [modelManagerServer, setModelManagerServer] = useState<AIServer | null>(null);
  const [serverToDelete, setServerToDelete] = useState<AIServer | null>(null);

  const { data: metricsData } = useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
    refetchInterval: 10000,
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
      setNewServerType('ollama');
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
    });
  };

  const handleSort = (key: keyof AIServer | 'modelCount') => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sortedServers = useMemo(() => {
    return [...(servers || [])].sort((a: AIServer, b: AIServer) => {
      const direction = sortConfig.direction === 'asc' ? 1 : -1;

      if (sortConfig.key === 'modelCount') {
        return (a.models.length - b.models.length) * direction;
      }

      // Handle specific fields
      const aValue = a[sortConfig.key as keyof AIServer];
      const bValue = b[sortConfig.key as keyof AIServer];

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return aValue.localeCompare(bValue) * direction;
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * direction;
      }

      // Boolean or others
      return ((aValue ? 1 : 0) - (bValue ? 1 : 0)) * direction;
    });
  }, [servers, sortConfig]);

  const groupedServers = useMemo(() => {
    if (groupConfig === 'none') return { 'All Servers': sortedServers };

    return sortedServers.reduce(
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
  }, [sortedServers, groupConfig]);

  if (isLoading) return <div className="text-white">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Servers</h2>
          <p className="text-gray-400">Manage your AI inference nodes</p>
        </div>
        <div className="flex flex-wrap gap-4">
          {/* Grouping Control */}
          <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-1 border border-gray-700">
            <span className="text-gray-500 text-xs pl-2">Group:</span>
            <select
              value={groupConfig}
              onChange={e => setGroupConfig(e.target.value as 'none' | 'version' | 'healthy')}
              className="bg-transparent text-white text-sm outline-none px-2 py-1"
            >
              <option value="none">None</option>
              <option value="version">Version</option>
              <option value="healthy">Health</option>
            </select>
          </div>

          {/* Sorting Control */}
          <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-1 border border-gray-700">
            <span className="text-gray-500 text-xs pl-2">Sort:</span>
            <select
              value={sortConfig.key}
              onChange={e => handleSort(e.target.value as keyof AIServer | 'modelCount')}
              className="bg-transparent text-white text-sm outline-none px-2 py-1"
            >
              <option value="url">URL</option>
              <option value="healthy">Health</option>
              <option value="lastResponseTime">Response Time</option>
              <option value="modelCount">Model Count</option>
              <option value="version">Version</option>
            </select>
            <button
              onClick={() =>
                setSortConfig(c => ({ ...c, direction: c.direction === 'asc' ? 'desc' : 'asc' }))
              }
              className="text-gray-400 hover:text-white px-2"
            >
              {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </button>
          </div>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span>Add Server</span>
          </button>
        </div>
      </div>

      <div className="space-y-8">
        {Object.entries(groupedServers).map(([group, groupServers]) => (
          <div key={group} className="space-y-4">
            {groupConfig !== 'none' && (
              <h3 className="text-lg font-medium text-gray-400 border-b border-gray-700/50 pb-2">
                {group} <span className="text-sm text-gray-500 ml-2">({groupServers.length})</span>
              </h3>
            )}

            <div className="grid grid-cols-1 gap-6">
              {groupServers.map((server: AIServer) => (
                <div
                  key={server.id}
                  className={`bg-gray-800 rounded-xl border border-gray-700 transition-all duration-200 overflow-hidden ${
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
                        <div
                          className={`p-2 rounded-lg ${server.healthy ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
                        >
                          <ServerIcon className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-white text-lg">{server.url}</h3>
                          <div className="flex items-center space-x-2 text-sm text-gray-500">
                            <span className="font-mono">{server.id.substring(0, 8)}</span>
                            <span>•</span>
                            <span>{server.models.length} Models</span>
                            <span>•</span>
                            <span>{server.version || 'v?'}</span>
                          </div>
                          <div className="flex items-center space-x-2 mt-1">
                            {server.type && (
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  server.type === 'openai'
                                    ? 'bg-green-500/20 text-green-400'
                                    : server.type === 'auto'
                                      ? 'bg-blue-500/20 text-blue-400'
                                      : 'bg-purple-500/20 text-purple-400'
                                }`}
                              >
                                {server.type === 'openai'
                                  ? 'OpenAI'
                                  : server.type === 'auto'
                                    ? 'Auto'
                                    : 'Ollama'}
                              </span>
                            )}
                            {server.supportsOllama !== false && server.type !== 'openai' && (
                              <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">
                                Ollama
                              </span>
                            )}
                            {server.supportsV1 && (
                              <span className="px-2 py-0.5 rounded text-xs bg-orange-500/20 text-orange-400">
                                OpenAI
                              </span>
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
                          <div className="text-sm text-gray-400">Response Time</div>
                          <div
                            className={`font-mono ${server.lastResponseTime > 1000 ? 'text-yellow-400' : 'text-white'}`}
                          >
                            {server.lastResponseTime > 0 ? `${server.lastResponseTime}ms` : '-'}
                          </div>
                        </div>

                        <div
                          className={`px-3 py-1 rounded-full text-xs font-medium ${server.healthy ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}
                        >
                          {server.healthy ? 'Healthy' : 'Unhealthy'}
                        </div>

                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setServerToDelete(server);
                          }}
                          className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          title="Remove Server"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {expandedServerId === server.id && (
                    <div className="px-6 pb-6 pt-0 border-t border-gray-700/50 mt-4 bg-gray-800/50">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
                        {/* Server Details */}
                        <div className="space-y-4">
                          <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                            Server Details
                          </h4>
                          <div className="space-y-2">
                            <div className="flex justify-between p-3 bg-gray-900/50 rounded-lg">
                              <span className="text-gray-400">Ollama Version</span>
                              <span className="text-white font-mono">
                                {server.version || 'Unknown'}
                              </span>
                            </div>
                            <div className="flex justify-between p-3 bg-gray-900/50 rounded-lg">
                              <span className="text-gray-400">Concurrency Limit</span>
                              <span className="text-white font-mono">
                                {server.maxConcurrency || 4}
                              </span>
                            </div>
                            <div className="flex justify-between p-3 bg-gray-900/50 rounded-lg">
                              <span className="text-gray-400">API Key</span>
                              <span className="text-white font-mono">
                                {server.apiKey ? '***REDACTED***' : 'Not set'}
                              </span>
                            </div>
                          </div>

                          {/* VRAM Usage */}
                          {server.hardware &&
                            server.hardware.totalVram != null &&
                            server.hardware.totalVram > 0 && (
                              <div className="p-3 bg-gray-900/50 rounded-lg">
                                <div className="flex justify-between text-sm mb-2">
                                  <span className="text-gray-400">VRAM Usage</span>
                                  <span className="text-white font-mono">
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
                                  <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">
                                    Performance
                                  </h4>
                                  <div className="space-y-2">
                                    {avgTps !== null && (
                                      <div className="flex justify-between p-3 bg-gray-900/50 rounded-lg">
                                        <span className="text-gray-400">Avg Token Speed</span>
                                        <span className="text-white font-mono">
                                          {avgTps.toFixed(1)} tok/s
                                        </span>
                                      </div>
                                    )}
                                    {totalColdStarts > 0 && (
                                      <div className="flex justify-between p-3 bg-gray-900/50 rounded-lg">
                                        <span className="text-gray-400">Cold Starts</span>
                                        <span className="text-yellow-400 font-mono">
                                          {totalColdStarts}
                                        </span>
                                      </div>
                                    )}
                                    {avgNetOverhead !== null && (
                                      <div className="flex justify-between p-3 bg-gray-900/50 rounded-lg">
                                        <span className="text-gray-400">Network Overhead</span>
                                        <span className="text-white font-mono">
                                          {avgNetOverhead.toFixed(1)}ms
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                          <div className="pt-4">
                            <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                              Actions
                            </h4>
                            <div className="space-y-3">
                              <div className="flex space-x-3">
                                {server.supportsOllama !== false && (
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      setModelManagerServer(server);
                                    }}
                                    className="flex-1 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 py-2 rounded-lg text-sm transition-colors border border-blue-600/20"
                                  >
                                    Manage Models
                                  </button>
                                )}
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    setServerToDelete(server);
                                  }}
                                  className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 py-2 rounded-lg text-sm transition-colors border border-red-500/20 flex items-center justify-center space-x-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  <span>Remove</span>
                                </button>
                              </div>

                              {/* Server Maintenance Actions */}
                              <div className="border-t border-gray-700/50 pt-3">
                                <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                                  Maintenance
                                </h5>
                                <div className="flex space-x-2">
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      drainMutation.mutate(server.id);
                                    }}
                                    disabled={drainMutation.isPending}
                                    className="flex-1 bg-yellow-600/10 hover:bg-yellow-600/20 text-yellow-400 py-2 rounded-lg text-sm transition-colors border border-yellow-600/20 flex items-center justify-center space-x-2 disabled:opacity-50"
                                  >
                                    <Power className="w-4 h-4" />
                                    <span>Drain</span>
                                  </button>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      undrainMutation.mutate(server.id);
                                    }}
                                    disabled={undrainMutation.isPending}
                                    className="flex-1 bg-green-600/10 hover:bg-green-600/20 text-green-400 py-2 rounded-lg text-sm transition-colors border border-green-600/20 flex items-center justify-center space-x-2 disabled:opacity-50"
                                  >
                                    <PowerOff className="w-4 h-4" />
                                    <span>Undrain</span>
                                  </button>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      maintenanceMutation.mutate({
                                        serverId: server.id,
                                        enabled: true,
                                      });
                                    }}
                                    disabled={maintenanceMutation.isPending}
                                    className="flex-1 bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 py-2 rounded-lg text-sm transition-colors border border-purple-600/20 flex items-center justify-center space-x-2 disabled:opacity-50"
                                  >
                                    <Wrench className="w-4 h-4" />
                                    <span>Maintain</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Models List */}
                        <div>
                          <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4 flex justify-between items-center">
                            <span>Installed Models ({server.models.length})</span>
                          </h4>
                          <div className="bg-gray-900/50 rounded-lg border border-gray-700/50 max-h-[300px] overflow-y-auto">
                            {server.models.length > 0 ? (
                              <div className="divide-y divide-gray-700/50">
                                {server.models.map(model => (
                                  <div
                                    key={model}
                                    className="p-3 hover:bg-gray-800/50 transition-colors flex justify-between items-center"
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
            <label className="block text-sm font-medium text-gray-300 mb-1">Server URL</label>
            <input
              type="text"
              value={newServerUrl}
              onChange={e => setNewServerUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className={`w-full bg-gray-900 border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 ${
                validationErrors.url ? 'border-red-500' : 'border-gray-700'
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
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
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
              className={`w-full bg-gray-900 border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 ${
                validationErrors.maxConcurrency ? 'border-red-500' : 'border-gray-700'
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
              className={`w-full bg-gray-900 border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 ${
                validationErrors.apiKey ? 'border-red-500' : 'border-gray-700'
              }`}
            />
            {validationErrors.apiKey && (
              <p className="mt-1 text-sm text-red-400">{validationErrors.apiKey}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Use "env:VAR_NAME" to reference environment variables
            </p>
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={() => {
                setIsAddModalOpen(false);
                setValidationErrors({});
              }}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {addMutation.isPending ? 'Adding...' : 'Add Server'}
            </button>
          </div>
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
