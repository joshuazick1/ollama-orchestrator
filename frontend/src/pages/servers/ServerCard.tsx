// Extracted from Servers.tsx - ServerCard component
import { memo } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ServerActionsMenu } from './ServerActionsMenu';
import { Server as ServerIcon, Trash2, Download, CheckCircle, XCircle } from 'lucide-react';
import type { AIServer, MetricsExport } from '../../types';

interface ServerCardProps {
  server: AIServer;
  metricsData?: MetricsExport;
  expandedServerId: string | null;
  setExpandedServerId: (id: string | null) => void;
  isServerPulling: (serverId: string) => boolean;
  getServerPulls: (serverId: string) => { status: string }[];
  setModelManagerServer: (server: AIServer | null) => void;
  setServerToDelete: (server: AIServer | null) => void;
}

export const ServerCard = memo(function ServerCard({
  server,
  metricsData,
  expandedServerId,
  setExpandedServerId,
  isServerPulling,
  getServerPulls,
  setModelManagerServer,
  setServerToDelete,
}: ServerCardProps) {
  return (
    <div
      className={`bg-surface rounded-xl border border-surface-border transition-all duration-200 overflow-hidden ${
        expandedServerId === server.id ? 'ring-2 ring-blue-500/50' : 'hover:border-gray-600'
      }`}
    >
      <div
        className="p-6 cursor-pointer"
        onClick={() => setExpandedServerId(expandedServerId === server.id ? null : server.id)}
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
                  {getServerPulls(server.id).filter(op => op.status === 'downloading').length})
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
              aria-label="Remove Server"
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
                  <span className="text-text-base font-mono">{server.version || 'Unknown'}</span>
                </div>
                <div className="flex justify-between p-3 bg-surface-raised/50 rounded-lg">
                  <span className="text-text-muted">Concurrency Limit</span>
                  <span className="text-text-base font-mono">{server.maxConcurrency || 4}</span>
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
                        className={`h-full rounded-full transition-all duration-500 w-[${Math.min(100, ((server.hardware.usedVram ?? 0) / server.hardware.totalVram) * 100)}%] ${
                          (server.hardware.usedVram ?? 0) / server.hardware.totalVram > 0.9
                            ? 'bg-red-500'
                            : (server.hardware.usedVram ?? 0) / server.hardware.totalVram > 0.7
                              ? 'bg-yellow-500'
                              : 'bg-blue-500'
                        }`}
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
                      ? modelEntries.reduce((sum, [, m]) => sum + (m.avgTokensPerSecond ?? 0), 0) /
                        modelEntries.length
                      : null;
                  const totalColdStarts = modelEntries.reduce(
                    (sum, [, m]) => sum + (m.coldStartCount ?? 0),
                    0
                  );
                  const avgNetOverhead =
                    modelEntries.filter(([, m]) => m.avgNetworkOverheadMs != null).length > 0
                      ? modelEntries
                          .filter(([, m]) => m.avgNetworkOverheadMs != null)
                          .reduce((sum, [, m]) => sum + (m.avgNetworkOverheadMs ?? 0), 0)
                      : null;
                  if (avgTps === null && totalColdStarts === 0 && avgNetOverhead === null)
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
                            <span className="text-yellow-400 font-mono">{totalColdStarts}</span>
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
                        {server.probedEndpoints?.[key as keyof typeof server.probedEndpoints] ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        <span className="text-xs text-text-base font-mono">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4">
                <h4 className="text-sm font-medium text-text-muted uppercase tracking-wider mb-3">
                  Actions
                </h4>
                <ServerActionsMenu
                  server={server}
                  onManageModels={setModelManagerServer}
                  onDelete={setServerToDelete}
                />
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
                  {(server.v1Models?.length ?? 0) + (server.discoveredV1Models?.length ?? 0)})
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
                        <div key={model} className="p-2 hover:bg-surface/50 transition-colors">
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
                        <div key={model} className="p-2 hover:bg-surface/50 transition-colors">
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
  );
});
