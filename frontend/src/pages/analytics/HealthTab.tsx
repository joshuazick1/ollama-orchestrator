import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react';
import { getCircuitBreakerStateColor } from '../../utils/circuitBreaker';
import type { CircuitBreakerInfo } from '../../api';

interface HealthTabProps {
  errorAnalysis?: {
    totalErrors?: number;
    trend?: 'increasing' | 'decreasing' | 'stable';
    byType?: Record<string, number>;
  };
  circuitBreakers?: CircuitBreakerInfo[];
}

export const HealthTab = ({ errorAnalysis, circuitBreakers }: HealthTabProps) => {
  const openBreakers = circuitBreakers?.filter(b => b.state === 'OPEN').length ?? 0;
  const halfOpenBreakers = circuitBreakers?.filter(b => b.state === 'HALF-OPEN').length ?? 0;
  const closedBreakers = circuitBreakers?.filter(b => b.state === 'CLOSED').length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Error Analysis */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Error Analysis
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700/50">
              <p className="text-gray-400 text-sm">Total Errors</p>
              <p className="text-2xl font-bold text-white mt-1">
                {errorAnalysis?.totalErrors || 0}
              </p>
            </div>
            <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700/50">
              <p className="text-gray-400 text-sm">Error Trend</p>
              <div className="flex items-center gap-2 mt-1">
                {errorAnalysis?.trend === 'increasing' && (
                  <TrendingUp className="w-5 h-5 text-red-400" />
                )}
                {errorAnalysis?.trend === 'decreasing' && (
                  <TrendingDown className="w-5 h-5 text-green-400" />
                )}
                {errorAnalysis?.trend === 'stable' && <Minus className="w-5 h-5 text-yellow-400" />}
                <span
                  className={`capitalize font-medium ${
                    errorAnalysis?.trend === 'increasing'
                      ? 'text-red-400'
                      : errorAnalysis?.trend === 'decreasing'
                        ? 'text-green-400'
                        : 'text-yellow-400'
                  }`}
                >
                  {errorAnalysis?.trend}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-300">Errors by Type</h4>
            {errorAnalysis?.byType && Object.entries(errorAnalysis.byType).length > 0 ? (
              Object.entries(errorAnalysis.byType).map(([type, count]) => (
                <div
                  key={type}
                  className="flex justify-between items-center bg-gray-700/20 p-3 rounded hover:bg-gray-700/30 transition-colors"
                >
                  <span className="text-gray-300 capitalize text-sm">
                    {type.replace(/_/g, ' ')}
                  </span>
                  <span className="font-mono text-white bg-gray-700 px-2 py-0.5 rounded text-xs">
                    {count as number}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center text-gray-500 py-4">
                No errors recorded in this period
              </div>
            )}
          </div>
        </div>

        {/* Circuit Breaker Status */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            Circuit Breaker Status
          </h3>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-3 bg-red-500/10 rounded-lg border border-red-500/20">
              <div className="text-2xl font-bold text-red-400">{openBreakers}</div>
              <div className="text-xs text-red-300/70 uppercase font-medium mt-1">Open</div>
            </div>
            <div className="text-center p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
              <div className="text-2xl font-bold text-yellow-400">{halfOpenBreakers}</div>
              <div className="text-xs text-yellow-300/70 uppercase font-medium mt-1">Half-Open</div>
            </div>
            <div className="text-center p-3 bg-green-500/10 rounded-lg border border-green-500/20">
              <div className="text-2xl font-bold text-green-400">{closedBreakers}</div>
              <div className="text-xs text-green-300/70 uppercase font-medium mt-1">Closed</div>
            </div>
          </div>

          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
            {circuitBreakers?.length === 0 ? (
              <div className="text-center text-gray-500 py-4">No circuit breakers active</div>
            ) : (
              circuitBreakers
                ?.sort((a, b) => {
                  const stateOrder = { OPEN: 0, 'HALF-OPEN': 1, CLOSED: 2 };
                  return stateOrder[a.state] - stateOrder[b.state];
                })
                .map((breaker, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded border flex justify-between items-center ${getCircuitBreakerStateColor(breaker.state)}`}
                  >
                    <div className="flex flex-col">
                      <span className="font-mono text-sm font-medium text-white">
                        {breaker.serverId}
                      </span>
                      <span className="text-xs opacity-70 mt-0.5">
                        Failures: {breaker.failureCount} | Success: {breaker.successCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {breaker.state === 'OPEN' && <ShieldAlert className="w-4 h-4" />}
                      {breaker.state === 'HALF-OPEN' && <ShieldQuestion className="w-4 h-4" />}
                      {breaker.state === 'CLOSED' && <ShieldCheck className="w-4 h-4" />}
                      <span className="text-xs font-bold uppercase">{breaker.state}</span>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
