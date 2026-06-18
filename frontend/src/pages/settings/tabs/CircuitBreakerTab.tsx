import { memo } from 'react';
import { Shield } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection, Toggle } from '../components';
import { NumberInput } from '../components/NumberInput';

interface CircuitBreakerTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const CircuitBreakerTab = memo<CircuitBreakerTabProps>(({ config, onUpdateField }) => {
  const cb = config.circuitBreaker || {
    baseFailureThreshold: 5,
    maxFailureThreshold: 10,
    minFailureThreshold: 3,
    openTimeout: 120000,
    halfOpenTimeout: 300000,
    recoverySuccessThreshold: 3,
    errorRateWindow: 60000,
    errorRateThreshold: 0.3,
    adaptiveThresholds: true,
    errorRateSmoothing: 0.3,
  };

  return (
    <ConfigSection
      title="Circuit Breaker"
      icon={Shield}
      description="Circuit breaker thresholds and adaptive settings"
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Failure Thresholds</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Base Failure Threshold"
              value={cb.baseFailureThreshold ?? 5}
              onChange={value => onUpdateField('circuitBreaker', 'baseFailureThreshold', value)}
              min={1}
              description="Failures before opening circuit"
            />
            <NumberInput
              label="Max Failure Threshold"
              value={cb.maxFailureThreshold ?? 10}
              onChange={value => onUpdateField('circuitBreaker', 'maxFailureThreshold', value)}
              min={1}
              description="Maximum adaptive threshold"
            />
            <NumberInput
              label="Recovery Success Threshold"
              value={cb.recoverySuccessThreshold ?? 3}
              onChange={value => onUpdateField('circuitBreaker', 'recoverySuccessThreshold', value)}
              min={1}
              description="Consecutive successes to close"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Timeouts</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Open Timeout"
              value={cb.openTimeout ?? 120000}
              onChange={value => onUpdateField('circuitBreaker', 'openTimeout', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Time to stay open before half-open"
            />
            <NumberInput
              label="Half-Open Timeout"
              value={cb.halfOpenTimeout ?? 300000}
              onChange={value => onUpdateField('circuitBreaker', 'halfOpenTimeout', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Time in half-open before reverting"
            />
            <NumberInput
              label="Error Rate Window"
              value={cb.errorRateWindow ?? 60000}
              onChange={value => onUpdateField('circuitBreaker', 'errorRateWindow', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Time window for error rate calculation"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Error Rate</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Error Rate Threshold"
              value={(cb.errorRateThreshold ?? 0.3) * 100}
              onChange={value => onUpdateField('circuitBreaker', 'errorRateThreshold', value / 100)}
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Error rate that triggers open state"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Adaptive Settings</h4>
          <div className="space-y-4">
            <Toggle
              label="Adaptive Thresholds"
              checked={cb.adaptiveThresholds ?? true}
              onChange={value => onUpdateField('circuitBreaker', 'adaptiveThresholds', value)}
              description="Dynamically adjust thresholds based on conditions"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

CircuitBreakerTab.displayName = 'CircuitBreakerTab';
