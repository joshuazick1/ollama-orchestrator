import { memo } from 'react';
import { Zap } from 'lucide-react';
import { z } from 'zod';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';

const maxSizeSchema = z.number().int().min(1).max(10000);
const timeoutSchema = z.number().int().min(1000);
const priorityBoostIntervalSchema = z.number().int().min(1000);
const priorityBoostAmountSchema = z.number().int().min(1);
const maxPrioritySchema = z.number().int().min(1);

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
          validationSchema={maxSizeSchema}
          description="Maximum queue size per server"
        />
        <NumberInput
          label="Timeout"
          value={queue.timeout}
          onChange={value => onUpdateField('queue', 'timeout', value)}
          min={1000}
          step={1000}
          suffix="ms"
          validationSchema={timeoutSchema}
          description="Queue request timeout"
        />
        <NumberInput
          label="Priority Boost Interval"
          value={queue.priorityBoostInterval}
          onChange={value => onUpdateField('queue', 'priorityBoostInterval', value)}
          min={1000}
          step={1000}
          suffix="ms"
          validationSchema={priorityBoostIntervalSchema}
          description="How often to boost priority"
        />
        <NumberInput
          label="Priority Boost Amount"
          value={queue.priorityBoostAmount}
          onChange={value => onUpdateField('queue', 'priorityBoostAmount', value)}
          min={1}
          validationSchema={priorityBoostAmountSchema}
          description="How much to boost priority"
        />
        <NumberInput
          label="Max Priority"
          value={queue.maxPriority}
          onChange={value => onUpdateField('queue', 'maxPriority', value)}
          min={1}
          validationSchema={maxPrioritySchema}
          description="Maximum priority level"
        />
      </div>
    </ConfigSection>
  );
});

QueueTab.displayName = 'QueueTab';
