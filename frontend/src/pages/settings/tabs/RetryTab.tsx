import { memo } from 'react';
import { RotateCcw } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';

interface RetryTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

const RETRYABLE_CODES = [502, 503, 504];

export const RetryTab = memo<RetryTabProps>(({ config, onUpdateField }) => {
  const retry = config.retry || {
    maxRetriesPerServer: 2,
    retryDelayMs: 500,
    backoffMultiplier: 2,
    maxRetryDelayMs: 5000,
    retryableStatusCodes: [503, 502, 504],
  };

  const handleCodeToggle = (code: number, checked: boolean) => {
    const currentCodes = retry.retryableStatusCodes || [];
    const newCodes = checked ? [...currentCodes, code] : currentCodes.filter(c => c !== code);
    onUpdateField('retry', 'retryableStatusCodes', newCodes);
  };

  const isCodeSelected = (code: number) => retry.retryableStatusCodes?.includes(code) ?? false;

  return (
    <ConfigSection
      title="Retry"
      icon={RotateCcw}
      description="Retry behavior and fallback settings"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NumberInput
            label="Max Retries Per Server"
            value={retry.maxRetriesPerServer ?? 2}
            onChange={value => onUpdateField('retry', 'maxRetriesPerServer', value)}
            min={0}
            max={10}
            description="Maximum retry attempts per server"
          />
          <NumberInput
            label="Retry Delay"
            value={retry.retryDelayMs ?? 500}
            onChange={value => onUpdateField('retry', 'retryDelayMs', value)}
            min={100}
            step={100}
            suffix="ms"
            description="Initial delay between retries"
          />
          <NumberInput
            label="Backoff Multiplier"
            value={retry.backoffMultiplier ?? 2}
            onChange={value => onUpdateField('retry', 'backoffMultiplier', value)}
            min={1}
            max={5}
            step={0.1}
            description="Multiplier for exponential backoff"
          />
          <NumberInput
            label="Max Retry Delay"
            value={retry.maxRetryDelayMs ?? 5000}
            onChange={value => onUpdateField('retry', 'maxRetryDelayMs', value)}
            min={100}
            step={100}
            suffix="ms"
            description="Maximum delay cap between retries"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Retryable Status Codes
          </label>
          <p className="text-xs text-gray-500 mb-3">HTTP status codes that trigger a retry</p>
          <div className="flex flex-wrap gap-4">
            {RETRYABLE_CODES.map(code => (
              <label key={code} className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isCodeSelected(code)}
                  onChange={e => handleCodeToggle(code, e.target.checked)}
                  className="w-4 h-4 rounded border-surface-border bg-surface-raised text-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-0"
                />
                <span className="text-sm text-gray-300">{code}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

RetryTab.displayName = 'RetryTab';
