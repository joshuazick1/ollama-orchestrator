import { memo } from 'react';
import { Waves } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection, Toggle } from '../components';
import { NumberInput } from '../components/NumberInput';

interface StreamingTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const StreamingTab = memo<StreamingTabProps>(({ config, onUpdateField }) => {
  const streaming = config.streaming || {
    enabled: true,
    maxConcurrentStreams: 100,
    timeoutMs: 300000,
    bufferSize: 1024,
    ttftWeight: 0.6,
    durationWeight: 0.4,
    activityTimeoutMs: 60000,
    stallThresholdMs: 300000,
    stallCheckIntervalMs: 10000,
    maxHandoffAttempts: 2,
  };

  return (
    <ConfigSection
      title="Streaming"
      icon={Waves}
      description="Streaming request configuration and behavior"
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">General</h4>
          <div className="space-y-4">
            <Toggle
              label="Enable Streaming"
              checked={streaming.enabled ?? true}
              onChange={value => onUpdateField('streaming', 'enabled', value)}
              description="Enable streaming responses"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Concurrency</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Max Concurrent Streams"
              value={streaming.maxConcurrentStreams ?? 100}
              onChange={value => onUpdateField('streaming', 'maxConcurrentStreams', value)}
              min={1}
              description="Maximum concurrent streaming requests"
            />
            <NumberInput
              label="Timeout"
              value={streaming.timeoutMs ?? 300000}
              onChange={value => onUpdateField('streaming', 'timeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Stream timeout (5 minutes default)"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Buffer & Performance</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Buffer Size"
              value={streaming.bufferSize ?? 1024}
              onChange={value => onUpdateField('streaming', 'bufferSize', value)}
              min={1}
              suffix="bytes"
              description="Stream buffer size"
            />
            <NumberInput
              label="Activity Timeout"
              value={streaming.activityTimeoutMs ?? 60000}
              onChange={value => onUpdateField('streaming', 'activityTimeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Timeout between chunks"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Scoring Weights</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="TTFT Weight"
              value={(streaming.ttftWeight ?? 0.6) * 100}
              onChange={value => onUpdateField('streaming', 'ttftWeight', value / 100)}
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for time-to-first-token"
            />
            <NumberInput
              label="Duration Weight"
              value={(streaming.durationWeight ?? 0.4) * 100}
              onChange={value => onUpdateField('streaming', 'durationWeight', value / 100)}
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for total duration"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Stall Detection</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Stall Threshold"
              value={streaming.stallThresholdMs ?? 300000}
              onChange={value => onUpdateField('streaming', 'stallThresholdMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Mark stream as stalled after this duration"
            />
            <NumberInput
              label="Stall Check Interval"
              value={streaming.stallCheckIntervalMs ?? 10000}
              onChange={value => onUpdateField('streaming', 'stallCheckIntervalMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="How often to check for stalls"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Failover</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Max Handoff Attempts"
              value={streaming.maxHandoffAttempts ?? 2}
              onChange={value => onUpdateField('streaming', 'maxHandoffAttempts', value)}
              min={0}
              max={10}
              description="Maximum failover attempts"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

StreamingTab.displayName = 'StreamingTab';
