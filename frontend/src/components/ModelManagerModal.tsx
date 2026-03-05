import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Trash2,
  Copy,
  RefreshCw,
  Package,
  HardDrive,
  TrendingUp,
  Clock,
  X,
} from 'lucide-react';
import { listServerModels, deleteModelFromServer, getServers, getFleetModelStats } from '../api';
import type { AIServer } from '../types';
import { formatBytes, formatDate } from '../utils/formatting';
import { Modal } from './Modal';
import { useModelPulls, type PullOperation } from '../hooks/useModelPulls';

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

/** Format a short digest for display (first 12 chars) */
function shortDigest(digest?: string): string {
  if (!digest) return '';
  // Remove "sha256:" prefix if present
  const hash = digest.startsWith('sha256:') ? digest.slice(7) : digest;
  return hash.slice(0, 12);
}

/** Progress bar component for a pull operation */
function PullProgress({
  operation,
  onCancel,
  onDismiss,
}: {
  operation: PullOperation;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const isActive = operation.status === 'downloading';
  const isComplete = operation.status === 'complete';
  const isError = operation.status === 'error';

  const elapsed = ((operation.finishedAt || Date.now()) - operation.startedAt) / 1000;
  const minutes = Math.floor(elapsed / 60);
  const seconds = Math.floor(elapsed % 60);
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <div
      className={`p-3 rounded-lg border ${
        isComplete
          ? 'bg-green-500/10 border-green-500/20'
          : isError
            ? 'bg-red-500/10 border-red-500/20'
            : 'bg-blue-500/10 border-blue-500/20'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <span className="text-sm font-medium text-white truncate">{operation.model}</span>
          <span className="text-xs text-gray-400">
            ({operation.type === 'copy' ? 'copy' : 'pull'})
          </span>
        </div>
        <div className="flex items-center space-x-2 ml-2">
          <span className="text-xs text-gray-400">{timeStr}</span>
          {isActive ? (
            <button
              onClick={onCancel}
              className="p-1 text-gray-400 hover:text-red-400 transition-colors"
              title="Cancel pull"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={onDismiss}
              className="p-1 text-gray-400 hover:text-white transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isActive && (
        <div className="w-full bg-gray-700 rounded-full h-2 mb-1.5 overflow-hidden relative">
          {operation.percentage === 0 ? (
            <div className="absolute inset-0 w-full h-full bg-blue-900/30 overflow-hidden rounded-full">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent w-full h-full animate-shimmer-x" />
            </div>
          ) : (
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.max(operation.percentage, 1)}%` }}
            />
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span
          className={`text-xs truncate ${
            isComplete ? 'text-green-400' : isError ? 'text-red-400' : 'text-gray-400'
          }`}
        >
          {isError ? operation.error || 'Failed' : operation.statusText}
          {operation.digest && isActive ? ` (${shortDigest(operation.digest)})` : ''}
        </span>
        {isActive && operation.total && operation.total > 0 && (
          <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">
            {formatBytes(operation.completed)} / {formatBytes(operation.total)}
            {operation.percentage > 0 && ` (${operation.percentage}%)`}
          </span>
        )}
        {isComplete && <span className="text-xs text-green-400 ml-2 whitespace-nowrap">Done</span>}
      </div>
    </div>
  );
}

export const ModelManagerModal = ({ isOpen, onClose, server }: ModelManagerModalProps) => {
  const queryClient = useQueryClient();
  const [newModelName, setNewModelName] = useState('');
  const [selectedSourceServer, setSelectedSourceServer] = useState('');
  const [activeTab, setActiveTab] = useState<'installed' | 'pull'>('installed');

  const { startPull, cancelPull, dismissPull, getServerPulls } = useModelPulls();

  const serverPulls = server ? getServerPulls(server.id) : [];
  const activePulls = serverPulls.filter(op => op.status === 'downloading');
  const finishedPulls = serverPulls.filter(op => op.status !== 'downloading');

  const {
    data: serverModels,
    isLoading: isLoadingModels,
    isFetching: isFetchingModels,
    refetch,
  } = useQuery({
    queryKey: ['server-models', server?.id],
    queryFn: () => (server ? listServerModels(server.id) : null),
    enabled: !!server?.id && isOpen,
    // Refetch more frequently when pulls are active to show newly pulled models
    refetchInterval: activePulls.length > 0 ? 5000 : false,
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

  const deleteMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model: string }) =>
      deleteModelFromServer(serverId, model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-models', server?.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      refetch();
    },
  });

  // When a pull completes, invalidate queries to refresh model lists
  useEffect(() => {
    const completedCount = finishedPulls.filter(op => op.status === 'complete').length;
    if (completedCount > 0) {
      queryClient.invalidateQueries({ queryKey: ['server-models', server?.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    }
  }, [finishedPulls.length, queryClient, server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isOpen) {
      // Reset form state when modal opens — this is intentional initialization, not cascading state
      /* eslint-disable react-hooks/set-state-in-effect */
      setNewModelName('');
      setSelectedSourceServer('');
      setActiveTab('installed');
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isOpen]);

  if (!isOpen || !server) return null;

  const models: ServerModel[] = serverModels?.models || [];
  const installedModelNames = new Set(models.map(m => m.name));
  const otherServers = allServers?.filter((s: AIServer) => s.id !== server.id && s.healthy) || [];

  const handlePull = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModelName.trim()) return;

    startPull(server.id, server.url, newModelName.trim(), selectedSourceServer || undefined);
    setNewModelName('');
    // Switch to installed tab to show progress if on pull tab
    // Actually, keep them on the pull tab so they can see progress and queue more
  };

  const handleDelete = (modelName: string) => {
    deleteMutation.mutate({
      serverId: server.id,
      model: modelName,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Manage Models - ${server.url}`}
      size="xl"
      className="max-h-[90vh]"
    >
      <div className="flex flex-col h-full">
        {/* Tabs */}
        <div className="flex border-b border-gray-700 -mx-6 px-6 mb-6">
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
            className={`flex-1 py-3 px-4 text-sm font-medium transition-colors relative ${
              activeTab === 'pull'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Download className="w-4 h-4 inline mr-2" />
            Pull / Copy Model
            {activePulls.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-blue-500 rounded-full animate-pulse">
                {activePulls.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {activeTab === 'installed' ? (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-medium text-gray-400">
                  Models currently on this server
                </h4>
                <button
                  onClick={() => refetch()}
                  disabled={isLoadingModels || isFetchingModels}
                  className="text-sm text-blue-400 hover:text-blue-300 flex items-center space-x-1 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${isLoadingModels || isFetchingModels ? 'animate-spin' : ''}`}
                  />
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
              {/* Active pull operations */}
              {serverPulls.length > 0 && (
                <div className="mb-6 space-y-2">
                  <h4 className="text-sm font-medium text-gray-400 mb-2">
                    {activePulls.length > 0
                      ? `Active Downloads (${activePulls.length})`
                      : 'Recent Operations'}
                  </h4>
                  {serverPulls.map(op => (
                    <PullProgress
                      key={op.id}
                      operation={op}
                      onCancel={() => cancelPull(op.serverId, op.model)}
                      onDismiss={() => dismissPull(op.serverId, op.model)}
                    />
                  ))}
                </div>
              )}

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
                    Enter the full model name including tag (e.g., llama3.2:latest). You can start
                    multiple pulls simultaneously.
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
                    disabled={!newModelName.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                  >
                    {selectedSourceServer ? (
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
    </Modal>
  );
};
