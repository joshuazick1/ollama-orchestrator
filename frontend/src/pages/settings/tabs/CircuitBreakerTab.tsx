import { memo } from 'react';
import { Shield } from 'lucide-react';
import { z } from 'zod';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection, Toggle } from '../components';
import { NumberInput } from '../components/NumberInput';

const intMin1 = z.number().int().min(1);
const intMin1000 = z.number().int().min(1000);
const intMin5000Max600000 = z.number().int().min(5000).max(600000);
const intMin1Max20 = z.number().int().min(1).max(20);
const ratio01 = z.number().min(0).max(1);
const intMin1Max10 = z.number().int().min(1).max(10);

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
    activeTestTimeout: 300000,
    maxHalfOpenPerServer: 3,
    errorRateWindow: 60000,
    errorRateThreshold: 0.5,
    adaptiveThresholds: true,
    errorRateSmoothing: 0.3,
    adaptiveThresholdAdjustment: 2,
    nonRetryableRatioThreshold: 0.5,
    transientRatioThreshold: 0.7,
    rateLimitFailureThreshold: 2,
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
              validationSchema={intMin1}
              description="Failures before opening circuit"
            />
            <NumberInput
              label="Max Failure Threshold"
              value={cb.maxFailureThreshold ?? 10}
              onChange={value => onUpdateField('circuitBreaker', 'maxFailureThreshold', value)}
              min={1}
              validationSchema={intMin1}
              description="Maximum adaptive threshold"
            />
            <NumberInput
              label="Min Failure Threshold"
              value={cb.minFailureThreshold ?? 3}
              onChange={value => onUpdateField('circuitBreaker', 'minFailureThreshold', value)}
              min={1}
              validationSchema={intMin1}
              description="Minimum adaptive threshold"
            />
            <NumberInput
              label="Recovery Success Threshold"
              value={cb.recoverySuccessThreshold ?? 3}
              onChange={value => onUpdateField('circuitBreaker', 'recoverySuccessThreshold', value)}
              min={1}
              validationSchema={intMin1}
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
              validationSchema={intMin1000}
              description="Time to stay open before half-open"
            />
            <NumberInput
              label="Half-Open Timeout"
              value={cb.halfOpenTimeout ?? 300000}
              onChange={value => onUpdateField('circuitBreaker', 'halfOpenTimeout', value)}
              min={1000}
              step={1000}
              suffix="ms"
              validationSchema={intMin1000}
              description="Time in half-open before reverting"
            />
            <NumberInput
              label="Active Test Timeout"
              value={cb.activeTestTimeout ?? 300000}
              onChange={value => onUpdateField('circuitBreaker', 'activeTestTimeout', value)}
              min={5000}
              max={600000}
              step={1000}
              suffix="ms"
              validationSchema={intMin5000Max600000}
              description="Timeout for active recovery tests"
            />
            <NumberInput
              label="Max Half-Open Per Server"
              value={cb.maxHalfOpenPerServer ?? 3}
              onChange={value => onUpdateField('circuitBreaker', 'maxHalfOpenPerServer', value)}
              min={1}
              max={20}
              validationSchema={intMin1Max20}
              description="Max half-open requests per server"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Error Rate</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Error Rate Threshold"
              value={(cb.errorRateThreshold ?? 0.5) * 100}
              onChange={value => onUpdateField('circuitBreaker', 'errorRateThreshold', value / 100)}
              min={0}
              max={100}
              step={1}
              suffix="%"
              validationSchema={z.number().min(0).max(100)}
              description="Error rate that triggers open state"
            />
            <NumberInput
              label="Error Rate Window"
              value={cb.errorRateWindow ?? 60000}
              onChange={value => onUpdateField('circuitBreaker', 'errorRateWindow', value)}
              min={1000}
              step={1000}
              suffix="ms"
              validationSchema={intMin1000}
              description="Time window for error rate calculation"
            />
            <NumberInput
              label="Error Rate Smoothing"
              value={cb.errorRateSmoothing ?? 0.3}
              onChange={value => onUpdateField('circuitBreaker', 'errorRateSmoothing', value)}
              min={0}
              max={1}
              step={0.05}
              validationSchema={ratio01}
              description="Smoothing factor for error rate"
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Adaptive Threshold Adjustment"
                value={cb.adaptiveThresholdAdjustment ?? 2}
                onChange={value =>
                  onUpdateField('circuitBreaker', 'adaptiveThresholdAdjustment', value)
                }
                min={1}
                max={10}
                validationSchema={intMin1Max10}
                description="Step size for adaptive threshold adjustment"
              />
              <NumberInput
                label="Non-Retryable Ratio Threshold"
                value={cb.nonRetryableRatioThreshold ?? 0.5}
                onChange={value =>
                  onUpdateField('circuitBreaker', 'nonRetryableRatioThreshold', value)
                }
                min={0}
                max={1}
                step={0.05}
                validationSchema={ratio01}
                description="Non-retryable error ratio threshold"
              />
              <NumberInput
                label="Transient Ratio Threshold"
                value={cb.transientRatioThreshold ?? 0.7}
                onChange={value =>
                  onUpdateField('circuitBreaker', 'transientRatioThreshold', value)
                }
                min={0}
                max={1}
                step={0.05}
                validationSchema={ratio01}
                description="Transient error ratio threshold"
              />
              <NumberInput
                label="Rate Limit Failure Threshold"
                value={cb.rateLimitFailureThreshold ?? 2}
                onChange={value =>
                  onUpdateField('circuitBreaker', 'rateLimitFailureThreshold', value)
                }
                min={1}
                max={20}
                validationSchema={intMin1Max20}
                description="Failures before rate limit triggers"
              />
            </div>
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

CircuitBreakerTab.displayName = 'CircuitBreakerTab';
