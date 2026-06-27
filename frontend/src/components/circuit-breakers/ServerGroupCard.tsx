import { memo } from 'react';
import { ChevronDown, ChevronRight, Server, Shield } from 'lucide-react';
import type { CircuitBreakerInfo } from '../../api';
import { CircuitBreakerCard } from './CircuitBreakerCard';
import { PROVIDER_BADGE_COLORS, type ProviderBadgeColorKey } from '../../constants/colors';

interface GroupedBreakers {
  serverId: string;
  serverBreaker: CircuitBreakerInfo | null;
  modelBreakers: CircuitBreakerInfo[];
  hasOpenCircuit: boolean;
  totalFailures: number;
  provider?: string;
}

interface ServerGroupCardProps {
  server: GroupedBreakers;
  expandedServers: Set<string>;
  onToggle: (serverId: string) => void;
  onReset: (serverId: string, model?: string) => void;
  onOpen: (serverId: string, model?: string) => void;
  onClose: (serverId: string, model?: string) => void;
  onRecoveryTest: (serverId: string, model: string) => void;
  isPending: boolean;
}

export const ServerGroupCard = memo<ServerGroupCardProps>(
  ({ server, expandedServers, onToggle, onReset, onOpen, onClose, onRecoveryTest, isPending }) => {
    const isExpanded = expandedServers.has(server.serverId);

    return (
      <div
        className={`bg-surface rounded-xl border overflow-hidden ${
          server.hasOpenCircuit
            ? 'border-red-500/50 shadow-lg shadow-red-500/5'
            : 'border-surface-border'
        }`}
      >
        {/* Server Header */}
        <button
          onClick={() => onToggle(server.serverId)}
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
                  {server.serverId}
                </h3>
                {server.provider && (
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium border ${PROVIDER_BADGE_COLORS[server.provider as ProviderBadgeColorKey]?.bg || 'bg-gray-500/20'} ${PROVIDER_BADGE_COLORS[server.provider as ProviderBadgeColorKey]?.text || 'text-gray-400'} ${PROVIDER_BADGE_COLORS[server.provider as ProviderBadgeColorKey]?.border || 'border-gray-500/50'}`}
                  >
                    {server.provider}
                  </span>
                )}
              </div>
              <p className="text-text-muted text-sm">
                {server.modelBreakers.length + (server.serverBreaker ? 1 : 0)} circuit breaker(s)
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
              <span className="text-text-base font-mono">{server.modelBreakers.length}</span>
            </div>
          </div>
        </button>

        {/* Expanded Content */}
        {isExpanded && (
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
                  onReset={() => onReset(server.serverId)}
                  onOpen={() => onOpen(server.serverId)}
                  onClose={() => onClose(server.serverId)}
                  isPending={isPending}
                  provider={server.provider}
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
                      const modelName = breaker.model;
                      return (
                        <CircuitBreakerCard
                          key={`${breaker.serverId}:${breaker.model}`}
                          breaker={breaker}
                          isModel={true}
                          onReset={() => onReset(server.serverId, modelName)}
                          onOpen={() => onOpen(server.serverId, modelName)}
                          onClose={() => onClose(server.serverId, modelName)}
                          onRecoveryTest={() => onRecoveryTest(server.serverId, modelName!)}
                          isPending={isPending}
                          provider={server.provider}
                        />
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

ServerGroupCard.displayName = 'ServerGroupCard';
