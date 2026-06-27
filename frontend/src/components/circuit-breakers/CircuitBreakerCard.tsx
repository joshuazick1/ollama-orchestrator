// Extracted from CircuitBreakers.tsx - CircuitBreakerCard component
import { memo } from 'react';
import { Clock, RefreshCw, ShieldAlert, ShieldCheck, RotateCcw, Play } from 'lucide-react';
import { formatTimeAgo, formatTimeUntil } from '../../utils/formatting';
import {
  getCircuitBreakerStateColor,
  getCircuitBreakerStateIcon,
} from '../../utils/circuitBreaker';
import type { CircuitBreakerInfo } from '../../api';
import { PROVIDER_BADGE_COLORS, type ProviderBadgeColorKey } from '../../constants/colors';

interface CircuitBreakerCardProps {
  breaker: CircuitBreakerInfo;
  isModel?: boolean;
  onReset?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  onRecoveryTest?: () => void;
  isPending?: boolean;
  provider?: string;
}

export const CircuitBreakerCard = memo<CircuitBreakerCardProps>(
  ({ breaker, isModel = false, onReset, onOpen, onClose, onRecoveryTest, isPending, provider }) => {
    const modelName = isModel ? breaker.model : undefined;

    return (
      <div
        className={`rounded-lg border p-4 ${
          breaker.state === 'OPEN'
            ? 'bg-red-500/10 border-red-500/30'
            : breaker.state === 'HALF-OPEN'
              ? 'bg-yellow-500/10 border-yellow-500/30'
              : 'bg-gray-700/30 border-gray-600/30'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {getCircuitBreakerStateIcon(breaker.state)}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-text-base font-medium">
                  {isModel ? modelName : 'Server Level'}
                </span>
                {provider && (
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium border ${PROVIDER_BADGE_COLORS[provider as ProviderBadgeColorKey]?.bg || 'bg-gray-500/20'} ${PROVIDER_BADGE_COLORS[provider as ProviderBadgeColorKey]?.text || 'text-gray-400'} ${PROVIDER_BADGE_COLORS[provider as ProviderBadgeColorKey]?.border || 'border-gray-500/50'}`}
                  >
                    {provider}
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium border ${getCircuitBreakerStateColor(breaker.state)}`}
                >
                  {breaker.state}
                </span>
                {breaker.modelType && (
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${breaker.modelType === 'embedding' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}
                  >
                    {breaker.modelType}
                  </span>
                )}
              </div>
              {isModel && <p className="text-gray-500 text-xs mt-0.5">Model-specific circuit</p>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {breaker.state === 'OPEN' && (
              <div className="flex items-center gap-2 text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg text-sm mr-2">
                <Clock className="w-4 h-4" />
                <span className="font-medium">Retry in {formatTimeUntil(breaker.nextRetryAt)}</span>
              </div>
            )}

            {/* Control Buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={onOpen}
                disabled={isPending || breaker.state === 'OPEN'}
                title="Force Open (block requests)"
                aria-label="Force Open"
                className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ShieldAlert className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                disabled={isPending || breaker.state === 'CLOSED'}
                title="Force Close (allow requests)"
                aria-label="Force Close"
                className="p-1.5 text-text-muted hover:text-green-400 hover:bg-green-500/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ShieldCheck className="w-4 h-4" />
              </button>
              <button
                onClick={onReset}
                disabled={isPending}
                title="Reset"
                aria-label="Reset"
                className="p-1.5 text-text-muted hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <RotateCcw className={`w-4 h-4 ${isPending ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onRecoveryTest}
                disabled={isPending}
                title="Run Recovery Test"
                aria-label="Run Recovery Test"
                className="p-1.5 text-text-muted hover:text-green-400 hover:bg-green-500/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div>
            <span className="text-gray-500 text-xs block">Failures</span>
            <span className="text-text-base font-mono">{breaker.failureCount}</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Successes</span>
            <span className="text-text-base font-mono">{breaker.successCount}</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Total Requests</span>
            <span className="text-text-base font-mono">{breaker.totalRequestCount}</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Blocked</span>
            <span
              className={`font-mono ${breaker.blockedRequestCount > 0 ? 'text-red-400' : 'text-green-400'}`}
            >
              {breaker.blockedRequestCount}
            </span>
          </div>
        </div>

        {/* Success Rate Calculation */}
        {breaker.totalRequestCount > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-600/30">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">
                Allowed: {breaker.successCount + breaker.failureCount} / {breaker.totalRequestCount}{' '}
                (
                {(
                  ((breaker.successCount + breaker.failureCount) / breaker.totalRequestCount) *
                  100
                ).toFixed(1)}
                %)
              </span>
              <span className="text-gray-500">
                Blocked: {breaker.blockedRequestCount} / {breaker.totalRequestCount} (
                {((breaker.blockedRequestCount / breaker.totalRequestCount) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden flex">
              <div
                className={`h-full bg-green-500 w-[${breaker.totalRequestCount > 0 ? (breaker.successCount / breaker.totalRequestCount) * 100 : 0}%]`}
                title={`Success: ${breaker.successCount}`}
              />
              <div
                className={`h-full bg-red-500 w-[${breaker.totalRequestCount > 0 ? (breaker.failureCount / breaker.totalRequestCount) * 100 : 0}%]`}
                title={`Failed: ${breaker.failureCount}`}
              />
              <div
                className={`h-full bg-orange-500 w-[${breaker.totalRequestCount > 0 ? (breaker.blockedRequestCount / breaker.totalRequestCount) * 100 : 0}%]`}
                title={`Blocked: ${breaker.blockedRequestCount}`}
              />
            </div>
            <div className="mt-1 flex text-xs text-gray-500">
              <span className="text-green-400">{breaker.successCount} passed</span>
              <span className="mx-2">|</span>
              <span className="text-red-400">{breaker.failureCount} failed</span>
              {breaker.blockedRequestCount > 0 && (
                <>
                  <span className="mx-2">|</span>
                  <span className="text-orange-400">{breaker.blockedRequestCount} blocked</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Error Rate and Consecutive Successes */}
        <div className="mt-3 pt-3 border-t border-gray-600/30 grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-500 text-xs block">Error Rate</span>
            <span
              className={`font-mono ${breaker.errorRate > 0.5 ? 'text-red-400' : 'text-green-400'}`}
            >
              {(breaker.errorRate * 100).toFixed(1)}%
            </span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Consecutive OK</span>
            <span className="text-text-base font-mono">{breaker.consecutiveSuccesses}</span>
          </div>
        </div>

        {/* Error Breakdown */}
        {breaker.errorCounts && Object.values(breaker.errorCounts).some(count => count > 0) && (
          <div className="mt-3 pt-3 border-t border-gray-600/30">
            <div className="flex flex-wrap gap-2">
              {Object.entries(breaker.errorCounts).map(([type, count]) => {
                if (count === 0) return null;
                return (
                  <span
                    key={type}
                    className={`px-2 py-0.5 rounded text-xs ${
                      type === 'permanent'
                        ? 'bg-red-500/20 text-red-400'
                        : type === 'non-retryable'
                          ? 'bg-orange-500/20 text-orange-400'
                          : type === 'transient'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-gray-500/20 text-text-muted'
                    }`}
                  >
                    {type}: {count}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Last Failure Reason */}
        {breaker.lastFailureReason && (
          <div className="mt-3 pt-3 border-t border-gray-600/30">
            <span className="text-gray-500 text-xs block mb-1">Last Failure Reason</span>
            <span className="text-red-400 text-xs font-mono break-all">
              {breaker.lastFailureReason}
            </span>
          </div>
        )}

        {/* Recovery Testing Info (for half-open state) */}
        {breaker.state === 'HALF-OPEN' && (
          <div className="mt-3 pt-3 border-t border-gray-600/30">
            <div className="flex items-center gap-2 text-yellow-400 text-xs">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span className="font-medium">Recovery Testing</span>
              {breaker.halfOpenAttempts !== undefined && breaker.halfOpenAttempts > 0 && (
                <span className="text-yellow-400/70">({breaker.halfOpenAttempts} attempts)</span>
              )}
            </div>
            {breaker.halfOpenStartedAt && breaker.halfOpenStartedAt > 0 && (
              <span className="text-gray-500 text-xs block mt-1">
                Started {formatTimeAgo(breaker.halfOpenStartedAt)}
              </span>
            )}
          </div>
        )}

        {/* Timestamps */}
        <div className="mt-3 pt-3 border-t border-gray-600/30 flex gap-4 text-xs text-gray-500">
          {breaker.lastFailure > 0 && (
            <span>Last failure: {formatTimeAgo(breaker.lastFailure)}</span>
          )}
          {breaker.lastSuccess > 0 && (
            <span>Last success: {formatTimeAgo(breaker.lastSuccess)}</span>
          )}
        </div>
      </div>
    );
  }
);

CircuitBreakerCard.displayName = 'CircuitBreakerCard';
