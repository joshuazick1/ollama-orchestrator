import { memo } from 'react';
import { Boxes } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';

interface ModelManagerTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const ModelManagerTab = memo<ModelManagerTabProps>(({ config, onUpdateField }) => {
  const modelManager = config.modelManager || {
    maxRetries: 3,
    retryDelayBaseMs: 1000,
    warmupTimeoutMs: 60000,
    idleThresholdMs: 1800000,
    memorySafetyMargin: 1.2,
    gbPerBillionParams: 0.75,
    defaultModelSizeGb: 5,
    loadTimeEstimates: {
      tiny: 3000,
      small: 5000,
      medium: 10000,
      large: 20000,
      xl: 40000,
      xxl: 80000,
    },
    contextLimitTtlMs: 86400000,
  };

  return (
    <ConfigSection
      title="Model Manager"
      icon={Boxes}
      description="Model loading, warmup, and memory management"
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Retry & Timing</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Max Retries"
              value={modelManager.maxRetries ?? 3}
              onChange={value => onUpdateField('modelManager', 'maxRetries', value)}
              min={0}
              description="Maximum retry attempts for model operations"
            />
            <NumberInput
              label="Retry Delay Base"
              value={modelManager.retryDelayBaseMs ?? 1000}
              onChange={value => onUpdateField('modelManager', 'retryDelayBaseMs', value)}
              min={100}
              step={100}
              suffix="ms"
              description="Base delay between retries"
            />
            <NumberInput
              label="Warmup Timeout"
              value={modelManager.warmupTimeoutMs ?? 60000}
              onChange={value => onUpdateField('modelManager', 'warmupTimeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Timeout for model warmup"
            />
            <NumberInput
              label="Idle Threshold"
              value={modelManager.idleThresholdMs ?? 1800000}
              onChange={value => onUpdateField('modelManager', 'idleThresholdMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Idle time before model is unloaded (30 min default)"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Memory</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Memory Safety Margin"
              value={modelManager.memorySafetyMargin ?? 1.2}
              onChange={value => onUpdateField('modelManager', 'memorySafetyMargin', value)}
              min={1}
              max={3}
              step={0.1}
              description="Safety margin for memory calculations"
            />
            <NumberInput
              label="GB Per Billion Params"
              value={modelManager.gbPerBillionParams ?? 0.75}
              onChange={value => onUpdateField('modelManager', 'gbPerBillionParams', value)}
              min={0.1}
              step={0.1}
              suffix="GB"
              description="Memory per billion model parameters"
            />
            <NumberInput
              label="Default Model Size"
              value={modelManager.defaultModelSizeGb ?? 5}
              onChange={value => onUpdateField('modelManager', 'defaultModelSizeGb', value)}
              min={0.1}
              step={0.5}
              suffix="GB"
              description="Default model size when unknown"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Load Time Estimates</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Tiny Model"
              value={modelManager.loadTimeEstimates?.tiny ?? 3000}
              onChange={value =>
                onUpdateField('modelManager', 'loadTimeEstimates', {
                  ...modelManager.loadTimeEstimates,
                  tiny: value,
                })
              }
              min={1000}
              step={1000}
              suffix="ms"
              description="Estimated load time for tiny models"
            />
            <NumberInput
              label="Small Model"
              value={modelManager.loadTimeEstimates?.small ?? 5000}
              onChange={value =>
                onUpdateField('modelManager', 'loadTimeEstimates', {
                  ...modelManager.loadTimeEstimates,
                  small: value,
                })
              }
              min={1000}
              step={1000}
              suffix="ms"
              description="Estimated load time for small models"
            />
            <NumberInput
              label="Medium Model"
              value={modelManager.loadTimeEstimates?.medium ?? 10000}
              onChange={value =>
                onUpdateField('modelManager', 'loadTimeEstimates', {
                  ...modelManager.loadTimeEstimates,
                  medium: value,
                })
              }
              min={1000}
              step={1000}
              suffix="ms"
              description="Estimated load time for medium models"
            />
            <NumberInput
              label="Large Model"
              value={modelManager.loadTimeEstimates?.large ?? 20000}
              onChange={value =>
                onUpdateField('modelManager', 'loadTimeEstimates', {
                  ...modelManager.loadTimeEstimates,
                  large: value,
                })
              }
              min={1000}
              step={1000}
              suffix="ms"
              description="Estimated load time for large models"
            />
            <NumberInput
              label="XL Model"
              value={modelManager.loadTimeEstimates?.xl ?? 40000}
              onChange={value =>
                onUpdateField('modelManager', 'loadTimeEstimates', {
                  ...modelManager.loadTimeEstimates,
                  xl: value,
                })
              }
              min={1000}
              step={1000}
              suffix="ms"
              description="Estimated load time for XL models"
            />
            <NumberInput
              label="XXL Model"
              value={modelManager.loadTimeEstimates?.xxl ?? 80000}
              onChange={value =>
                onUpdateField('modelManager', 'loadTimeEstimates', {
                  ...modelManager.loadTimeEstimates,
                  xxl: value,
                })
              }
              min={1000}
              step={1000}
              suffix="ms"
              description="Estimated load time for XXL models"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Context</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Context Limit TTL"
              value={modelManager.contextLimitTtlMs ?? 86400000}
              onChange={value => onUpdateField('modelManager', 'contextLimitTtlMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="TTL for context limit tracking (24h default)"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

ModelManagerTab.displayName = 'ModelManagerTab';
