import { memo } from 'react';
import { Zap } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';

interface QueueTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const QueueTab = memo<QueueTabProps>(({ config, onUpdateField }) => {
  const queue = config.queue || {
    maxSize: 100,
    timeout: 300000,
    priorityBoostInterval: 60000,
    priorityBoostAmount: 1,
    maxPriority: 10,
  };

  return (
    <ConfigSection title="Queue" icon={Zap} description="Request queue settings">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NumberInput
          label="Max Size"
          value={queue.maxSize}
          onChange={value => onUpdateField('queue', 'maxSize', value)}
          min={1}
          description="Maximum queue size per server"
        />
        <NumberInput
          label="Timeout"
          value={queue.timeout}
          onChange={value => onUpdateField('queue', 'timeout', value)}
          min={1000}
          step={1000}
          suffix="ms"
          description="Queue request timeout"
        />
        <NumberInput
          label="Priority Boost Interval"
          value={queue.priorityBoostInterval}
          onChange={value => onUpdateField('queue', 'priorityBoostInterval', value)}
          min={0}
          step={1000}
          suffix="ms"
          description="How often to boost priority"
        />
        <NumberInput
          label="Priority Boost Amount"
          value={queue.priorityBoostAmount}
          onChange={value => onUpdateField('queue', 'priorityBoostAmount', value)}
          min={1}
          description="How much to boost priority"
        />
        <NumberInput
          label="Max Priority"
          value={queue.maxPriority}
          onChange={value => onUpdateField('queue', 'maxPriority', value)}
          min={1}
          description="Maximum priority level"
        />
      </div>
    </ConfigSection>
  );
});

QueueTab.displayName = 'QueueTab';
