import { memo } from 'react';
import { TestTube } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';

interface RecoveryTestTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const RecoveryTestTab = memo<RecoveryTestTabProps>(({ config, onUpdateField }) => {
  const recoveryTest = config.recoveryTest || {
    serverCooldownMs: 10000,
    maxWaitForInFlightMs: 5000,
    modelTestTimeoutMs: 120000,
    tagsTestTimeoutMs: 5000,
    testPromptTokens: 256,
  };

  return (
    <ConfigSection
      title="Recovery Test"
      icon={TestTube}
      description="Recovery testing configuration for server health validation"
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Timing</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Server Cooldown"
              value={recoveryTest.serverCooldownMs ?? 10000}
              onChange={value => onUpdateField('recoveryTest', 'serverCooldownMs', value)}
              min={0}
              step={1000}
              suffix="ms"
              description="Minimum ms between recovery tests"
            />
            <NumberInput
              label="Max Wait For In-Flight"
              value={recoveryTest.maxWaitForInFlightMs ?? 5000}
              onChange={value => onUpdateField('recoveryTest', 'maxWaitForInFlightMs', value)}
              min={0}
              step={1000}
              suffix="ms"
              description="Max wait for in-flight requests to clear"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Timeouts</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Model Test Timeout"
              value={recoveryTest.modelTestTimeoutMs ?? 120000}
              onChange={value => onUpdateField('recoveryTest', 'modelTestTimeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Timeout for model-level inference tests"
            />
            <NumberInput
              label="Tags Test Timeout"
              value={recoveryTest.tagsTestTimeoutMs ?? 5000}
              onChange={value => onUpdateField('recoveryTest', 'tagsTestTimeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Timeout for /api/tags recovery tests"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Test Parameters</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Test Prompt Tokens"
              value={recoveryTest.testPromptTokens ?? 256}
              onChange={value => onUpdateField('recoveryTest', 'testPromptTokens', value)}
              min={1}
              description="Number of tokens in active test prompts"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

RecoveryTestTab.displayName = 'RecoveryTestTab';
