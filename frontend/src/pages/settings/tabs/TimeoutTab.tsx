import { memo } from 'react';
import { Clock } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';

interface TimeoutTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const TimeoutTab = memo<TimeoutTabProps>(({ config, onUpdateField }) => {
  const timeout = config.timeout || {
    defaultTimeoutMs: 120000,
    minTimeoutMs: 15000,
    maxTimeoutMs: 600000,
    recoveryTestMultiplier: 3,
    normalRequestMultiplier: 2,
    decayRatePerMs: 1.67e-7,
    stallThresholdMultiplier: 1.5,
    stallThresholdCapMs: 120000,
  };

  return (
    <ConfigSection
      title="Timeout"
      icon={Clock}
      description="Request timeout configuration and decay settings"
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Timeout Bounds</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Default Timeout"
              value={timeout.defaultTimeoutMs ?? 120000}
              onChange={value => onUpdateField('timeout', 'defaultTimeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Default timeout for new server:model pairs (2 min)"
            />
            <NumberInput
              label="Minimum Timeout"
              value={timeout.minTimeoutMs ?? 15000}
              onChange={value => onUpdateField('timeout', 'minTimeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Minimum allowed timeout (15 sec)"
            />
            <NumberInput
              label="Maximum Timeout"
              value={timeout.maxTimeoutMs ?? 600000}
              onChange={value => onUpdateField('timeout', 'maxTimeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Maximum allowed timeout (10 min)"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Multipliers</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Recovery Test Multiplier"
              value={timeout.recoveryTestMultiplier ?? 3}
              onChange={value => onUpdateField('timeout', 'recoveryTestMultiplier', value)}
              min={1}
              step={0.5}
              description="Timeout multiplier for recovery tests"
            />
            <NumberInput
              label="Normal Request Multiplier"
              value={timeout.normalRequestMultiplier ?? 2}
              onChange={value => onUpdateField('timeout', 'normalRequestMultiplier', value)}
              min={1}
              step={0.5}
              description="Timeout multiplier for normal requests"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Decay</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Decay Rate Per Ms"
              value={timeout.decayRatePerMs ?? 1.67e-7}
              onChange={value => onUpdateField('timeout', 'decayRatePerMs', value)}
              min={0}
              max={1}
              step={0.0000001}
              description="Decay rate toward base timeout"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Stall Detection</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Stall Threshold Multiplier"
              value={timeout.stallThresholdMultiplier ?? 1.5}
              onChange={value => onUpdateField('timeout', 'stallThresholdMultiplier', value)}
              min={1}
              max={5}
              step={0.1}
              description="Multiplier for stall detection threshold"
            />
            <NumberInput
              label="Stall Threshold Cap"
              value={timeout.stallThresholdCapMs ?? 120000}
              onChange={value => onUpdateField('timeout', 'stallThresholdCapMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Maximum stall detection threshold (2 min cap)"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

TimeoutTab.displayName = 'TimeoutTab';
