import { memo } from 'react';
import { Activity } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';

interface LoadBalancerTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const LoadBalancerTab = memo<LoadBalancerTabProps>(({ config, onUpdateField }) => {
  const lb = config.loadBalancer || {
    weights: { latency: 0.35, successRate: 0.3, load: 0.2, capacity: 0.15 },
    thresholds: {
      maxP95Latency: 5000,
      minSuccessRate: 0.95,
      latencyPenalty: 0.5,
      errorPenalty: 0.3,
    },
    latencyBlendRecent: 0.6,
    latencyBlendHistorical: 0.4,
    loadFactorMultiplier: 0.5,
    defaultLatencyMs: 1000,
    defaultMaxConcurrency: 4,
  };

  return (
    <ConfigSection
      title="Load Balancer"
      icon={Activity}
      description="Traffic distribution and scoring settings"
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Algorithm Weights</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Latency Weight"
              value={(lb.weights?.latency ?? 0.35) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  latency: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for response time"
            />
            <NumberInput
              label="Success Rate Weight"
              value={(lb.weights?.successRate ?? 0.3) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  successRate: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for reliability"
            />
            <NumberInput
              label="Load Weight"
              value={(lb.weights?.load ?? 0.2) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  load: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for current load"
            />
            <NumberInput
              label="Capacity Weight"
              value={(lb.weights?.capacity ?? 0.15) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  capacity: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for remaining capacity"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Thresholds</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Max P95 Latency"
              value={lb.thresholds?.maxP95Latency ?? 5000}
              onChange={value =>
                onUpdateField('loadBalancer', 'thresholds', {
                  ...lb.thresholds,
                  maxP95Latency: value,
                })
              }
              min={100}
              step={100}
              suffix="ms"
              description="Maximum acceptable P95 latency"
            />
            <NumberInput
              label="Min Success Rate"
              value={(lb.thresholds?.minSuccessRate ?? 0.95) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'thresholds', {
                  ...lb.thresholds,
                  minSuccessRate: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Minimum acceptable success rate"
            />
            <NumberInput
              label="Latency Penalty"
              value={(lb.thresholds?.latencyPenalty ?? 0.5) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'thresholds', {
                  ...lb.thresholds,
                  latencyPenalty: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Score multiplier for high latency"
            />
            <NumberInput
              label="Error Penalty"
              value={(lb.thresholds?.errorPenalty ?? 0.3) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'thresholds', {
                  ...lb.thresholds,
                  errorPenalty: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Score multiplier for errors"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Latency Blending</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Recent Latency Weight"
              value={(lb.latencyBlendRecent ?? 0.6) * 100}
              onChange={value => onUpdateField('loadBalancer', 'latencyBlendRecent', value / 100)}
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for recent response time"
            />
            <NumberInput
              label="Historical Latency Weight"
              value={(lb.latencyBlendHistorical ?? 0.4) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'latencyBlendHistorical', value / 100)
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for P95 latency"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Load Factor</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Load Factor Multiplier"
              value={(lb.loadFactorMultiplier ?? 0.5) * 100}
              onChange={value => onUpdateField('loadBalancer', 'loadFactorMultiplier', value / 100)}
              min={0}
              max={200}
              step={5}
              suffix="%"
              description="How load affects effective latency"
            />
            <NumberInput
              label="Default Latency"
              value={lb.defaultLatencyMs ?? 1000}
              onChange={value => onUpdateField('loadBalancer', 'defaultLatencyMs', value)}
              min={100}
              step={100}
              suffix="ms"
              description="Default when no data available"
            />
            <NumberInput
              label="Default Max Concurrency"
              value={lb.defaultMaxConcurrency ?? 4}
              onChange={value => onUpdateField('loadBalancer', 'defaultMaxConcurrency', value)}
              min={1}
              max={100}
              description="Default max concurrency"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

LoadBalancerTab.displayName = 'LoadBalancerTab';
