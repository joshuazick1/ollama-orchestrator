import { memo } from 'react';
import { Heart } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';
import { Toggle } from '../components/Toggle';

interface HealthCheckTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const HealthCheckTab = memo<HealthCheckTabProps>(({ config, onUpdateField }) => {
  const hc = config.healthCheck || {
    enabled: true,
    intervalMs: 30000,
    timeoutMs: 5000,
    maxConcurrentChecks: 10,
    failureThreshold: 3,
    recoveryIntervalMs: 60000,
  };

  return (
    <ConfigSection
      title="Health Check"
      icon={Heart}
      description="Server health monitoring and recovery settings"
    >
      <div className="space-y-6">
        <div>
          <Toggle
            label="Enabled"
            description="Enable periodic health checks on servers"
            checked={hc.enabled ?? true}
            onChange={value => onUpdateField('healthCheck', 'enabled', value)}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Timing</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Interval"
              value={hc.intervalMs ?? 30000}
              onChange={value => onUpdateField('healthCheck', 'intervalMs', value)}
              min={1000}
              step={5000}
              suffix="ms"
              description="Time between health checks"
            />
            <NumberInput
              label="Timeout"
              value={hc.timeoutMs ?? 5000}
              onChange={value => onUpdateField('healthCheck', 'timeoutMs', value)}
              min={1000}
              step={500}
              suffix="ms"
              description="Max wait for a health check response"
            />
            <NumberInput
              label="Recovery Interval"
              value={hc.recoveryIntervalMs ?? 60000}
              onChange={value => onUpdateField('healthCheck', 'recoveryIntervalMs', value)}
              min={1000}
              step={5000}
              suffix="ms"
              description="Time before retrying a failed server"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Thresholds</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Max Concurrent Checks"
              value={hc.maxConcurrentChecks ?? 10}
              onChange={value => onUpdateField('healthCheck', 'maxConcurrentChecks', value)}
              min={1}
              max={100}
              description="Maximum simultaneous health checks"
            />
            <NumberInput
              label="Retry Attempts"
              value={hc.retryAttempts ?? 2}
              onChange={value => onUpdateField('healthCheck', 'retryAttempts', value)}
              min={0}
              max={10}
              description="Number of retries per server"
            />
            <NumberInput
              label="Retry Delay"
              value={hc.retryDelayMs ?? 1000}
              onChange={value => onUpdateField('healthCheck', 'retryDelayMs', value)}
              min={100}
              step={100}
              suffix="ms"
              description="Delay between retries"
            />
            <NumberInput
              label="Backoff Multiplier"
              value={hc.backoffMultiplier ?? 1.5}
              onChange={value => onUpdateField('healthCheck', 'backoffMultiplier', value)}
              min={1}
              max={10}
              step={0.1}
              description="Exponential backoff multiplier"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

HealthCheckTab.displayName = 'HealthCheckTab';
