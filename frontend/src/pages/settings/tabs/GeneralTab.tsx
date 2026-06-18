import { memo } from 'react';
import { Settings2 } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
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
    </ConfigSection>
  );
});

GeneralTab.displayName = 'GeneralTab';
