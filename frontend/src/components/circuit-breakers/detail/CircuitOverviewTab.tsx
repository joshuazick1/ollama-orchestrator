// Extracted from CircuitDetailModal.tsx - CircuitOverviewTab component
import { memo } from 'react';
import { Activity, Shield, Zap } from 'lucide-react';
import type { CircuitBreakerInfo } from '../../../api';
import { StatCard } from '../../StatCard';

interface MetricsData {
  metrics?: {
    realtime?: {
      inFlight?: number;
      queued?: number;
    };
    percentiles?: {
      p50?: number;
      p95?: number;
      p99?: number;
      max?: number;
    };
    derived?: {
      successRate?: number;
      throughput?: number;
      avgTokensPerRequest?: number;
    };
  };
}

interface CircuitOverviewTabProps {
  metricsData?: MetricsData;
  circuitBreaker?: CircuitBreakerInfo;
}

export const CircuitOverviewTab = memo<CircuitOverviewTabProps>(
  ({ metricsData, circuitBreaker }) => {
    const percentiles = metricsData?.metrics?.percentiles;
    const derived = metricsData?.metrics?.derived;

    return (
      <div className="space-y-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="In Flight"
            value={metricsData?.metrics?.realtime?.inFlight || 0}
            subtext="Currently active"
            icon={Activity}
            color="text-blue-400"
          />
          <StatCard
            title="Success Rate"
            value={derived?.successRate ? `${(derived.successRate * 100).toFixed(1)}%` : 'N/A'}
            subtext="Overall"
            icon={Shield}
            color={(derived?.successRate ?? 0) > 0.9 ? 'text-green-400' : 'text-yellow-400'}
          />
          <StatCard
            title="Throughput"
            value={derived?.throughput?.toFixed(1) || '0'}
            subtext="req/min"
            icon={Zap}
            color="text-purple-400"
          />
          <StatCard
            title="Avg Tokens"
            value={derived?.avgTokensPerRequest?.toFixed(0) || '0'}
            subtext="per request"
            icon={Activity}
            color="text-cyan-400"
          />
        </div>

        {/* Circuit Breaker Details */}
        {circuitBreaker && (
          <div className="bg-surface-raised rounded-lg p-4">
            <h3 className="text-lg font-semibold text-text-base mb-4">Circuit Breaker</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <span className="text-gray-500 text-xs">State</span>
                <div
                  className={`font-mono font-medium ${
                    circuitBreaker.state === 'CLOSED'
                      ? 'text-green-400'
                      : circuitBreaker.state === 'HALF-OPEN'
                        ? 'text-yellow-400'
                        : 'text-red-400'
                  }`}
                >
                  {circuitBreaker.state}
                </div>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Failures</span>
                <div className="font-mono font-medium text-red-400">
                  {circuitBreaker.failureCount}
                </div>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Successes</span>
                <div className="font-mono font-medium text-green-400">
                  {circuitBreaker.successCount}
                </div>
              </div>
              <div>
                <span className="text-gray-500 text-xs">Consecutive OK</span>
                <div className="font-mono font-medium text-text-base">
                  {circuitBreaker.consecutiveSuccesses}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Latency Percentiles */}
        <div className="bg-surface-raised rounded-lg p-4">
          <h3 className="text-lg font-semibold text-text-base mb-4">Latency Percentiles</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <span className="text-gray-500 text-xs">p50</span>
              <div className="font-mono text-lg text-text-base">{percentiles?.p50 || 0}ms</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">p95</span>
              <div className="font-mono text-lg text-text-base">{percentiles?.p95 || 0}ms</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">p99</span>
              <div className="font-mono text-lg text-text-base">{percentiles?.p99 || 0}ms</div>
            </div>
            <div>
              <span className="text-gray-500 text-xs">Max</span>
              <div className="font-mono text-lg text-text-base">{percentiles?.max || 0}ms</div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

CircuitOverviewTab.displayName = 'CircuitOverviewTab';
