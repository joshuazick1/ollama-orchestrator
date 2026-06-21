import { memo } from 'react';
import { Settings2 } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection, Toggle } from '../components';
import { NumberInput } from '../components/NumberInput';
import { TextInput } from '../components/TextInput';

interface GeneralTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const GeneralTab = memo<GeneralTabProps>(({ config, onUpdateField }) => {
  return (
    <ConfigSection title="General" icon={Settings2} description="Basic orchestrator settings">
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberInput
            label="Port"
            value={config.port ?? 5100}
            onChange={value => onUpdateField('port', null, value)}
            min={1}
            max={65535}
            description="Server port number"
          />
          <TextInput
            label="Host"
            value={config.host ?? '0.0.0.0'}
            onChange={value => onUpdateField('host', null, value)}
            description="Server host address"
          />
        </div>
        <TextInput
          label="Log Level"
          value={config.logLevel ?? 'info'}
          onChange={value => onUpdateField('logLevel', null, value)}
          description="Logging verbosity level"
        />
        <NumberInput
          label="Inference Timeout"
          value={config.inferenceTimeoutMs ?? 90000}
          onChange={value => onUpdateField('inferenceTimeoutMs', null, value)}
          min={1000}
          step={1000}
          suffix="ms"
          description="Total request timeout for failover budget"
        />

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Feature Toggles</h4>
          <div className="space-y-4">
            <Toggle
              label="Enable Queue"
              checked={config.enableQueue ?? true}
              onChange={value => onUpdateField('enableQueue', null, value)}
              description="Enable request queuing"
            />
            <Toggle
              label="Enable Circuit Breaker"
              checked={config.enableCircuitBreaker ?? true}
              onChange={value => onUpdateField('enableCircuitBreaker', null, value)}
              description="Enable circuit breaker protection"
            />
            <Toggle
              label="Enable Metrics"
              checked={config.enableMetrics ?? true}
              onChange={value => onUpdateField('enableMetrics', null, value)}
              description="Enable metrics collection"
            />
            <Toggle
              label="Enable Streaming"
              checked={config.enableStreaming ?? true}
              onChange={value => onUpdateField('enableStreaming', null, value)}
              description="Enable streaming responses"
            />
            <Toggle
              label="Enable Persistence"
              checked={config.enablePersistence ?? true}
              onChange={value => onUpdateField('enablePersistence', null, value)}
              description="Enable data persistence"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

GeneralTab.displayName = 'GeneralTab';
