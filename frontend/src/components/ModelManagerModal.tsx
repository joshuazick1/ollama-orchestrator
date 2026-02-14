import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Download,
  Trash2,
  Copy,
  RefreshCw,
  Package,
  HardDrive,
  TrendingUp,
  Clock,
} from 'lucide-react';
import {
  listServerModels,
  pullModelToServer,
  deleteModelFromServer,
  copyModelToServer,
  getServers,
  getFleetModelStats,
} from '../api';
import type { AIServer } from '../types';

interface ModelManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  server: AIServer | null;
}

interface ServerModel {
  name: string;
  modified_at?: string;
  size?: number;
  digest?: string;
}

const formatBytes = (bytes?: number) => {
  if (!bytes) return '-';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
};

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
};

export const ModelManagerModal = ({ isOpen, onClose, server }: ModelManagerModalProps) => {
  const queryClient = useQueryClient();
  const [newModelName, setNewModelName] = useState('');
  const [selectedSourceServer, setSelectedSourceServer] = useState('');
  const [activeTab, setActiveTab] = useState<'installed' | 'pull'>('installed');

  const {
    data: serverModels,
    isLoading: isLoadingModels,
    refetch,
  } = useQuery({
    queryKey: ['server-models', server?.id],
    queryFn: () => (server ? listServerModels(server.id) : null),
    enabled: !!server?.id && isOpen,
  });

  const { data: allServers } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
    enabled: isOpen,
  });

  const { data: fleetStats } = useQuery({
    queryKey: ['fleet-model-stats'],
    queryFn: getFleetModelStats,
    enabled: isOpen,
  });

  const pullMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model: string }) =>
      pullModelToServer(serverId, model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-models', server?.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setNewModelName('');
      refetch();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model: string }) =>
      deleteModelFromServer(serverId, model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-models', server?.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      refetch();
    },
  });

  const copyMutation = useMutation({
    mutationFn: ({
      targetServerId,
      model,
      sourceServerId,
    }: {
      targetServerId: string;
      model: string;
      sourceServerId?: string;
    }) => copyModelToServer(targetServerId, model, sourceServerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-models', server?.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setNewModelName('');
      setSelectedSourceServer('');
      refetch();
    },
  });

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewModelName('');
      setSelectedSourceServer('');
      setActiveTab('installed');
    }
  }, [isOpen]);

  if (!isOpen || !server) return null;

  const models: ServerModel[] = serverModels?.models || [];
  const installedModelNames = new Set(models.map(m => m.name));
  const otherServers = allServers?.filter((s: AIServer) => s.id !== server.id && s.healthy) || [];

  const handlePull = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModelName.trim()) return;

    if (selectedSourceServer) {
      // Copy from another server
      copyMutation.mutate({
        targetServerId: server.id,
        model: newModelName.trim(),
        sourceServerId: selectedSourceServer,
      });
    } else {
      // Pull from registry
      pullMutation.mutate({
        serverId: server.id,
        model: newModelName.trim(),
      });
    }
  };

  const handleDelete = (modelName: string) => {
    deleteMutation.mutate({
      serverId: server.id,
      model: modelName,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <div>
            <h3 className="text-xl font-semibold text-white">Manage Models</h3>
            <p className="text-sm text-gray-400 mt-1">{server.url}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('installed')}
            className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
              activeTab === 'installed'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Package className="w-4 h-4 inline mr-2" />
            Installed Models ({models.length})
          </button>
          <button
            onClick={() => setActiveTab('pull')}
            className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
              activeTab === 'pull'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Download className="w-4 h-4 inline mr-2" />
            Pull / Copy Model
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {activeTab === 'installed' ? (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-medium text-gray-400">
                  Models currently on this server
                </h4>
                <button
                  onClick={() => refetch()}
                  disabled={isLoadingModels}
                  className="text-sm text-blue-400 hover:text-blue-300 flex items-center space-x-1 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingModels ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {isLoadingModels ? (
                <div className="text-center py-8 text-gray-400">Loading models...</div>
              ) : models.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No models installed on this server</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {models.map(model => (
                    <div
                      key={model.name}
                      className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700/50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-white truncate">{model.name}</div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center space-x-4">
                          <span className="flex items-center">
                            <HardDrive className="w-3 h-3 mr-1" />
                            {formatBytes(model.size)}
                          </span>
                          <span>Modified: {formatDate(model.modified_at)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(model.name)}
                        disabled={deleteMutation.isPending}
                        className="ml-4 p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                        title="Delete model"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <form onSubmit={handlePull} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Model Name</label>
                  <input
                    type="text"
                    value={newModelName}
                    onChange={e => setNewModelName(e.target.value)}
                    placeholder="e.g., llama3.2:latest or llama3.2:1b"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Enter the full model name including tag (e.g., llama3.2:latest)
                  </p>
                </div>

                {otherServers.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Copy from Another Server (Optional)
                    </label>
                    <select
                      value={selectedSourceServer}
                      onChange={e => setSelectedSourceServer(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Pull from Ollama Registry (default)</option>
                      {otherServers.map((s: AIServer) => (
                        <option key={s.id} value={s.id}>
                          {s.url} ({s.models.length} models)
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      {selectedSourceServer
                        ? 'Will attempt to copy from selected server (falls back to registry pull)'
                        : 'Will download directly from Ollama registry'}
                    </p>
                  </div>
                )}

                <div className="pt-4">
                  <button
                    type="submit"
                    disabled={
                      !newModelName.trim() || pullMutation.isPending || copyMutation.isPending
                    }
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                  >
                    {pullMutation.isPending || copyMutation.isPending ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Pulling...</span>
                      </>
                    ) : selectedSourceServer ? (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy Model</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Pull Model</span>
                      </>
                    )}
                  </button>
                </div>

                {(pullMutation.isSuccess || copyMutation.isSuccess) && (
                  <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                    Model operation completed successfully!
                  </div>
                )}

                {(pullMutation.isError || copyMutation.isError) && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                    Error:{' '}
                    {(pullMutation.error as Error)?.message ||
                      (copyMutation.error as Error)?.message ||
                      'Failed to pull model'}
                  </div>
                )}
              </form>

              {/* Popular in Fleet - filter out already installed models */}
              {fleetStats?.popularModels && fleetStats.popularModels.length > 0 && (
                <div className="mt-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
                  <div className="flex items-center mb-3">
                    <TrendingUp className="w-4 h-4 text-blue-400 mr-2" />
                    <h5 className="text-sm font-medium text-gray-300">Popular in Fleet</h5>
                    <span className="ml-2 text-xs text-gray-500">
                      ({fleetStats.healthyServers} healthy servers)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fleetStats.popularModels
                      .filter((model: { name: string }) => !installedModelNames.has(model.name))
                      .slice(0, 10)
                      .map((model: { name: string; serverCount: number; percentage: number }) => (
                        <button
                          key={model.name}
                          onClick={() => setNewModelName(model.name)}
                          className="px-3 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded-full transition-colors flex items-center"
                          title={`Installed on ${model.serverCount} servers (${model.percentage}%)`}
                        >
                          {model.name}
                          <span className="ml-1.5 text-blue-400/70">({model.serverCount})</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Recently Added - from other servers only */}
              {otherServers && otherServers.length > 0 && (
                <div className="mt-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
                  <div className="flex items-center mb-3">
                    <Clock className="w-4 h-4 text-green-400 mr-2" />
                    <h5 className="text-sm font-medium text-gray-300">
                      Available on Other Servers
                    </h5>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {otherServers
                      .flatMap((s: AIServer) => s.models.map(m => ({ name: m, server: s.url })))
                      .filter((model: { name: string }) => !installedModelNames.has(model.name))
                      .slice(0, 10)
                      .map((model: { name: string; server: string }) => (
                        <button
                          key={`${model.name}-${model.server}`}
                          onClick={() => setNewModelName(model.name)}
                          className="px-3 py-1 text-xs bg-green-600/20 hover:bg-green-600/30 text-green-300 rounded-full transition-colors"
                          title={`Available on ${model.server}`}
                        >
                          {model.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
