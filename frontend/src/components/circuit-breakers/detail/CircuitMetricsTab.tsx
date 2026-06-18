// Extracted from CircuitDetailModal.tsx - CircuitMetricsTab component (Performance tab)
import { memo } from 'react';

interface MetricsData {
  metrics?: {
    percentiles?: {
      p50?: number;
      p90?: number;
      p95?: number;
      p99?: number;
    };
    derived?: {
      throughput?: number;
      avgTokensPerRequest?: number;
    };
  };
}

interface CircuitMetricsTabProps {
  metricsData?: MetricsData;
}

export const CircuitMetricsTab = memo<CircuitMetricsTabProps>(({ metricsData }) => {
  const percentiles = metricsData?.metrics?.percentiles;
  const derived = metricsData?.metrics?.derived;

  return (
    <div className="space-y-6">
      {/* Latency Breakdown */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4">Latency Distribution</h3>
        <div className="space-y-3">
          {[
            { label: 'p50', value: percentiles?.p50 || 0, color: 'bg-green-500' },
            { label: 'p90', value: percentiles?.p90 || 0, color: 'bg-blue-500' },
            { label: 'p95', value: percentiles?.p95 || 0, color: 'bg-yellow-500' },
            { label: 'p99', value: percentiles?.p99 || 0, color: 'bg-orange-500' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-text-muted text-sm w-12">{item.label}</span>
              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${item.color}`}
                  style={{
                    width: `${Math.min((item.value / (percentiles?.p99 || 1)) * 100, 100)}%`,
                  }}
                />
              </div>
              <span className="text-text-base font-mono w-20 text-right">{item.value}ms</span>
            </div>
          ))}
        </div>
      </div>

      {/* Throughput & Tokens */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-raised rounded-lg p-4">
          <h4 className="text-sm font-medium text-text-muted mb-2">Throughput</h4>
          <div className="text-2xl font-bold text-text-base">
            {derived?.throughput?.toFixed(2) || 0}
          </div>
          <div className="text-sm text-gray-500">requests/minute</div>
        </div>
        <div className="bg-surface-raised rounded-lg p-4">
          <h4 className="text-sm font-medium text-text-muted mb-2">Avg Tokens/Request</h4>
          <div className="text-2xl font-bold text-text-base">
            {derived?.avgTokensPerRequest?.toFixed(0) || 0}
          </div>
          <div className="text-sm text-gray-500">tokens</div>
        </div>
      </div>
    </div>
  );
});

CircuitMetricsTab.displayName = 'CircuitMetricsTab';
