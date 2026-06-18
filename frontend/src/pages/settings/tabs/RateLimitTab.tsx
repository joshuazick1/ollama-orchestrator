import { memo } from 'react';
import { Shield } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';

interface RateLimitTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const RateLimitTab = memo<RateLimitTabProps>(({ config, onUpdateField }) => {
  const security = config.security || {
    corsOrigins: ['*'],
    rateLimitWindowMs: 900000,
    rateLimitMax: 100,
  };

  return (
    <ConfigSection title="Rate Limit" icon={Shield} description="API rate limiting settings">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NumberInput
          label="Rate Limit Window"
          value={security.rateLimitWindowMs}
          onChange={value => onUpdateField('security', 'rateLimitWindowMs', value)}
          min={1000}
          step={1000}
          suffix="ms"
          description="Time window for rate limiting"
        />
        <NumberInput
          label="Rate Limit Max"
          value={security.rateLimitMax}
          onChange={value => onUpdateField('security', 'rateLimitMax', value)}
          min={1}
          description="Maximum requests per window"
        />
      </div>
    </ConfigSection>
  );
});

RateLimitTab.displayName = 'RateLimitTab';
