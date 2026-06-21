import { memo } from 'react';
import { Database } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import type { StorageConfig } from '../../../types';
import { ConfigSection } from '../components';
import { NumberInput } from '../components/NumberInput';
import { TextInput } from '../components/TextInput';

interface StorageTabProps {
  config: OrchestratorConfig;
  onUpdateField: (section: string, field: string | null, value: unknown) => void;
}

export const StorageTab = memo<StorageTabProps>(({ config, onUpdateField }) => {
  const storage: StorageConfig = config.storage || {
    dbPath: './data/metrics.db',
    retention: {
      requests: 30,
      decisions: 30,
      rollups: 90,
      profiles: 14,
    },
    performance: {
      batchSize: 100,
      batchFlushIntervalMs: 100,
      rollupDeadlineMinutes: 10,
      profileRebuildIntervalMs: 86400000,
      retentionCheckIntervalMs: 3600000,
    },
  };

  return (
    <ConfigSection
      title="Storage"
      icon={Database}
      description="SQLite database and retention settings"
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Database</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextInput
              label="Database Path"
              value={storage.dbPath ?? './data/metrics.db'}
              onChange={(value: unknown) => {
                onUpdateField('storage', 'dbPath', value);
              }}
              description="Path to the SQLite database file"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Retention (days)</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <NumberInput
              label="Requests"
              value={storage.retention?.requests ?? 30}
              onChange={value => {
                onUpdateField('storage', 'retention', {
                  ...storage.retention,
                  requests: value,
                });
              }}
              min={1}
              description="Days to retain individual request rows"
            />
            <NumberInput
              label="Decisions"
              value={storage.retention?.decisions ?? 30}
              onChange={value => {
                onUpdateField('storage', 'retention', {
                  ...storage.retention,
                  decisions: value,
                });
              }}
              min={1}
              description="Days to retain decision rows"
            />
            <NumberInput
              label="Rollups"
              value={storage.retention?.rollups ?? 90}
              onChange={value => {
                onUpdateField('storage', 'retention', {
                  ...storage.retention,
                  rollups: value,
                });
              }}
              min={1}
              description="Days to retain hourly/daily rollup rows"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Performance</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Batch Size"
              value={storage.performance?.batchSize ?? 100}
              onChange={value => {
                onUpdateField('storage', 'performance', {
                  ...storage.performance,
                  batchSize: value,
                });
              }}
              min={1}
              description="Max requests buffered before forced flush"
            />
            <NumberInput
              label="Batch Flush Interval"
              value={storage.performance?.batchFlushIntervalMs ?? 100}
              onChange={value => {
                onUpdateField('storage', 'performance', {
                  ...storage.performance,
                  batchFlushIntervalMs: value,
                });
              }}
              min={100}
              step={100}
              suffix="ms"
              description="Max ms between forced flushes"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

StorageTab.displayName = 'StorageTab';
