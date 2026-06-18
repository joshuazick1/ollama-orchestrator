// Extracted from CircuitDetailModal.tsx - CircuitHistoryTab component (Streaming tab)
import { memo } from 'react';
import { Zap, Radio } from 'lucide-react';
import { formatDuration } from '../../../utils/formatting';

interface StreamingMetrics {
  avgTTFT?: number;
  avgTotalDuration?: number;
  avgStreamingDuration?: number;
  totalTokens?: number;
  avgChunkCount?: number;
  avgChunkSizeBytes?: number;
  maxChunkGapPercentiles?: Percentiles;
  chunkCountPercentiles?: Percentiles;
  ttftPercentiles?: Percentiles;
}

interface Percentiles {
  p50?: number;
  p95?: number;
  p99?: number;
}

interface MetricsData {
  metrics?: {
    historical?: Record<string, { streamingMetrics?: StreamingMetrics }>;
    streamingMetrics?: StreamingMetrics;
  };
}

interface CircuitHistoryTabProps {
  metricsData?: MetricsData;
}

export const CircuitHistoryTab = memo<CircuitHistoryTabProps>(({ metricsData }) => {
  const streaming =
    metricsData?.metrics?.historical?.['5m']?.streamingMetrics ||
    metricsData?.metrics?.streamingMetrics;

  if (!streaming) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <Radio className="w-12 h-12 mb-4 opacity-50" />
        <p>No streaming data available</p>
        <p className="text-sm mt-2">Streaming metrics will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* TTFT Stats */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          Time to First Token
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-gray-500 text-xs">Average</span>
            <div className="font-mono text-xl text-text-base">{streaming.avgTTFT || 0}ms</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p50</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.ttftPercentiles?.p50 || 0}ms
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p95</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.ttftPercentiles?.p95 || 0}ms
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p99</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.ttftPercentiles?.p99 || 0}ms
            </div>
          </div>
        </div>
      </div>

      {/* Chunk Stats */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyan-400" />
          Chunk Statistics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-gray-500 text-xs">Avg Chunks/Request</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.avgChunkCount?.toFixed(1) || 0}
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Avg Chunk Size</span>
            <div className="font-mono text-xl text-text-base">
              {((streaming.avgChunkSizeBytes || 0) / 1024).toFixed(1)}KB
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">p95 Chunk Gap</span>
            <div className="font-mono text-xl text-text-base">
              {streaming.maxChunkGapPercentiles?.p95 || 0}ms
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Avg Duration</span>
            <div className="font-mono text-xl text-text-base">
              {formatDuration(streaming.avgStreamingDuration || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* Chunk Count Distribution */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h4 className="text-sm font-medium text-text-muted mb-2">Chunk Count Distribution</h4>
        <div className="space-y-2">
          {[
            {
              label: 'p50',
              value: streaming.chunkCountPercentiles?.p50 || 0,
              color: 'bg-green-500',
            },
            {
              label: 'p95',
              value: streaming.chunkCountPercentiles?.p95 || 0,
              color: 'bg-blue-500',
            },
            {
              label: 'p99',
              value: streaming.chunkCountPercentiles?.p99 || 0,
              color: 'bg-yellow-500',
            },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="text-text-muted text-sm w-12">{item.label}</span>
              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${item.color}`}
                  style={{
                    width: `${Math.min(
                      (item.value / (streaming.chunkCountPercentiles?.p99 || 1)) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
              <span className="text-text-base font-mono w-16 text-right">{item.value} chunks</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

CircuitHistoryTab.displayName = 'CircuitHistoryTab';
