import { memo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';
import { Toggle } from '../components/Toggle';

interface MetricsTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const MetricsTab = memo<MetricsTabProps>(({ config, onUpdateField }) => {
  const metrics = config.metrics || {
    enabled: true,
    prometheusEnabled: true,
    prometheusPort: 9090,
    historyWindowMinutes: 60,
    decay: {
      enabled: true,
      halfLifeMs: 300000,
      minDecayFactor: 0.1,
      staleThresholdMs: 120000,
    },
  };

  const decay = metrics.decay || {
    enabled: true,
    halfLifeMs: 300000,
    minDecayFactor: 0.1,
    staleThresholdMs: 120000,
  };

  return (
    <ConfigSection
      title="Metrics"
      icon={BarChart3}
      description="Metrics collection, Prometheus export, and decay settings"
    >
      <div className="space-y-6">
        <div>
          <Toggle
            label="Enabled"
            description="Enable metrics collection"
            checked={metrics.enabled ?? true}
            onChange={value => onUpdateField('metrics', 'enabled', value)}
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Prometheus</h4>
          <div className="space-y-4">
            <Toggle
              label="Prometheus Export"
              description="Enable Prometheus metrics endpoint"
              checked={metrics.prometheusEnabled ?? true}
              onChange={value => onUpdateField('metrics', 'prometheusEnabled', value)}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Prometheus Port"
                value={metrics.prometheusPort ?? 9090}
                onChange={value => onUpdateField('metrics', 'prometheusPort', value)}
                min={1024}
                max={65535}
                step={1}
                description="Port for Prometheus scrape endpoint"
              />
              <NumberInput
                label="History Window"
                value={metrics.historyWindowMinutes ?? 60}
                onChange={value => onUpdateField('metrics', 'historyWindowMinutes', value)}
                min={1}
                max={1440}
                step={5}
                suffix="min"
                description="Metrics retention window"
              />
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Decay</h4>
          <div className="space-y-4">
            <Toggle
              label="Decay Enabled"
              description="Apply time-based decay to metrics"
              checked={decay.enabled ?? true}
              onChange={value => onUpdateField('metrics', 'decay', { ...decay, enabled: value })}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Half-life"
                value={decay.halfLifeMs ?? 300000}
                onChange={value =>
                  onUpdateField('metrics', 'decay', { ...decay, halfLifeMs: value })
                }
                min={1000}
                step={10000}
                suffix="ms"
                description="Time for metrics to decay by half"
              />
              <NumberInput
                label="Stale Threshold"
                value={decay.staleThresholdMs ?? 120000}
                onChange={value =>
                  onUpdateField('metrics', 'decay', { ...decay, staleThresholdMs: value })
                }
                min={1000}
                step={10000}
                suffix="ms"
                description="Mark metrics as stale after this duration"
              />
            </div>
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

MetricsTab.displayName = 'MetricsTab';
