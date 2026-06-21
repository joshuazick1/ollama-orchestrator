import { memo } from 'react';
import { Sliders } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection, Toggle } from '../components';
import { NumberInput } from '../components/NumberInput';
import { TextInput } from '../components/TextInput';

interface AdvancedTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const AdvancedTab = memo<AdvancedTabProps>(({ config, onUpdateField }) => {
  const errorAggregator = config.errorAggregator || {
    enabled: true,
    rateLimitThreshold: 5,
    timeWindowMs: 10000,
    clusterBackoffMs: 30000,
  };

  const adaptiveWeightTuner = config.adaptiveWeightTuner || {
    enabled: true,
  };

  const recoveryBackoff = config.recoveryBackoff || {
    modelCapability: [30000, 30000],
    modelFile: [60000, 300000, 600000],
    permanent: [300000, 600000, 1200000, 2400000, 3600000],
    standard: [30000, 60000, 120000, 240000, 480000, 900000, 1800000, 1800000],
  };

  const debug = config.debug || {
    streamProgress: false,
  };

  const anthropic = config.anthropic || {
    enabled: true,
    supportedFeatures: [],
  };

  return (
    <ConfigSection title="Advanced" icon={Sliders} description="Advanced configuration options">
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Error Aggregator</h4>
          <div className="space-y-4">
            <Toggle
              label="Enable Error Aggregator"
              checked={errorAggregator.enabled ?? true}
              onChange={value => onUpdateField('errorAggregator', 'enabled', value)}
              description="Enable error aggregation and rate limiting"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <NumberInput
              label="Rate Limit Threshold"
              value={errorAggregator.rateLimitThreshold ?? 5}
              onChange={value => onUpdateField('errorAggregator', 'rateLimitThreshold', value)}
              min={2}
              description="Minimum errors before rate limiting"
            />
            <NumberInput
              label="Time Window"
              value={errorAggregator.timeWindowMs ?? 10000}
              onChange={value => onUpdateField('errorAggregator', 'timeWindowMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Time window for error aggregation"
            />
            <NumberInput
              label="Cluster Backoff"
              value={errorAggregator.clusterBackoffMs ?? 30000}
              onChange={value => onUpdateField('errorAggregator', 'clusterBackoffMs', value)}
              min={0}
              step={1000}
              suffix="ms"
              description="Backoff time for cluster-level errors"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Adaptive Weight Tuner</h4>
          <div className="space-y-4">
            <Toggle
              label="Enable Adaptive Weight Tuner"
              checked={adaptiveWeightTuner.enabled ?? true}
              onChange={value => onUpdateField('adaptiveWeightTuner', 'enabled', value)}
              description="Enable automatic weight tuning for load balancer"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Recovery Backoff</h4>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Model Capability Delays
              </label>
              <p className="text-xs text-gray-500 mb-2">Comma-separated delay values (ms)</p>
              <TextInput
                label=""
                value={(recoveryBackoff.modelCapability || []).join(', ')}
                onChange={value => {
                  const parsed = value
                    .split(',')
                    .map(s => parseInt(s.trim(), 10))
                    .filter(n => !isNaN(n) && n >= 0);
                  onUpdateField('recoveryBackoff', 'modelCapability', parsed);
                }}
                placeholder="30000, 30000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Model File Delays
              </label>
              <p className="text-xs text-gray-500 mb-2">Comma-separated delay values (ms)</p>
              <TextInput
                label=""
                value={(recoveryBackoff.modelFile || []).join(', ')}
                onChange={value => {
                  const parsed = value
                    .split(',')
                    .map(s => parseInt(s.trim(), 10))
                    .filter(n => !isNaN(n) && n >= 0);
                  onUpdateField('recoveryBackoff', 'modelFile', parsed);
                }}
                placeholder="60000, 300000, 600000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Permanent Error Delays
              </label>
              <p className="text-xs text-gray-500 mb-2">Comma-separated delay values (ms)</p>
              <TextInput
                label=""
                value={(recoveryBackoff.permanent || []).join(', ')}
                onChange={value => {
                  const parsed = value
                    .split(',')
                    .map(s => parseInt(s.trim(), 10))
                    .filter(n => !isNaN(n) && n >= 0);
                  onUpdateField('recoveryBackoff', 'permanent', parsed);
                }}
                placeholder="300000, 600000, 1200000, 2400000, 3600000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Standard Delays
              </label>
              <p className="text-xs text-gray-500 mb-2">Comma-separated delay values (ms)</p>
              <TextInput
                label=""
                value={(recoveryBackoff.standard || []).join(', ')}
                onChange={value => {
                  const parsed = value
                    .split(',')
                    .map(s => parseInt(s.trim(), 10))
                    .filter(n => !isNaN(n) && n >= 0);
                  onUpdateField('recoveryBackoff', 'standard', parsed);
                }}
                placeholder="30000, 60000, 120000, 240000, 480000, 900000, 1800000, 1800000"
              />
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Debug</h4>
          <div className="space-y-4">
            <Toggle
              label="Stream Progress"
              checked={debug.streamProgress ?? false}
              onChange={value => onUpdateField('debug', 'streamProgress', value)}
              description="Enable stream progress logging"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Anthropic</h4>
          <div className="space-y-4">
            <Toggle
              label="Enable Anthropic"
              checked={anthropic.enabled ?? true}
              onChange={value => onUpdateField('anthropic', 'enabled', value)}
              description="Enable Anthropic API compatibility"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <TextInput
              label="API Key"
              value={anthropic.apiKey ?? ''}
              onChange={value => onUpdateField('anthropic', 'apiKey', value)}
              placeholder="sk-ant-..."
              description="Anthropic API key (optional)"
            />
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Supported Features
            </label>
            <p className="text-xs text-gray-500 mb-2">Comma-separated feature flags</p>
            <TextInput
              label=""
              value={(anthropic.supportedFeatures || []).join(', ')}
              onChange={value => {
                const parsed = value
                  .split(',')
                  .map(s => s.trim())
                  .filter(s => s.length > 0);
                onUpdateField('anthropic', 'supportedFeatures', parsed);
              }}
              placeholder="feature1, feature2"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

AdvancedTab.displayName = 'AdvancedTab';
