import { memo } from 'react';
import { Database } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import type { StorageConfig } from '../../../types';
import { ConfigSection, Toggle } from '../components';
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
    temporal: {
      enabled: true,
      minConfidence: 0.3,
      maxAdjustment: 2.0,
      shadowMode: false,
      modelFallbackConfidence: 0.6,
      serverFallbackConfidence: 0.4,
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <NumberInput
              label="Profiles"
              value={storage.retention?.profiles ?? 14}
              onChange={value => {
                onUpdateField('storage', 'retention', {
                  ...storage.retention,
                  profiles: value,
                });
              }}
              min={1}
              description="Trailing days for temporal profiles"
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
            <NumberInput
              label="Rollup Deadline Minutes"
              value={storage.performance?.rollupDeadlineMinutes ?? 10}
              onChange={value => {
                onUpdateField('storage', 'performance', {
                  ...storage.performance,
                  rollupDeadlineMinutes: value,
                });
              }}
              min={1}
              suffix="min"
              description="Minutes past hour before rollup runs"
            />
            <NumberInput
              label="Profile Rebuild Interval"
              value={storage.performance?.profileRebuildIntervalMs ?? 86400000}
              onChange={value => {
                onUpdateField('storage', 'performance', {
                  ...storage.performance,
                  profileRebuildIntervalMs: value,
                });
              }}
              min={60000}
              step={60000}
              suffix="ms"
              description="Ms between daily profile rebuilds"
            />
            <NumberInput
              label="Retention Check Interval"
              value={storage.performance?.retentionCheckIntervalMs ?? 3600000}
              onChange={value => {
                onUpdateField('storage', 'performance', {
                  ...storage.performance,
                  retentionCheckIntervalMs: value,
                });
              }}
              min={60000}
              step={60000}
              suffix="ms"
              description="Ms between retention pruning runs"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Temporal</h4>
          <div className="space-y-4">
            <Toggle
              label="Temporal Scoring"
              checked={storage.temporal?.enabled ?? true}
              onChange={value => {
                onUpdateField('storage', 'temporal', {
                  ...storage.temporal,
                  enabled: value,
                });
              }}
              description="Enable temporal scoring adjustments in load balancer"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Min Confidence"
                value={storage.temporal?.minConfidence ?? 0.3}
                onChange={value => {
                  onUpdateField('storage', 'temporal', {
                    ...storage.temporal,
                    minConfidence: value,
                  });
                }}
                min={0}
                max={1}
                step={0.05}
                description="Minimum confidence for temporal adjustment"
              />
              <NumberInput
                label="Max Adjustment"
                value={storage.temporal?.maxAdjustment ?? 2.0}
                onChange={value => {
                  onUpdateField('storage', 'temporal', {
                    ...storage.temporal,
                    maxAdjustment: value,
                  });
                }}
                min={1}
                max={10}
                step={0.1}
                description="Maximum latency multiplier from temporal scoring"
              />
              <NumberInput
                label="Model Fallback Confidence"
                value={storage.temporal?.modelFallbackConfidence ?? 0.6}
                onChange={value => {
                  onUpdateField('storage', 'temporal', {
                    ...storage.temporal,
                    modelFallbackConfidence: value,
                  });
                }}
                min={0}
                max={1}
                step={0.05}
                description="Confidence multiplier for model-wide fallback"
              />
              <NumberInput
                label="Server Fallback Confidence"
                value={storage.temporal?.serverFallbackConfidence ?? 0.4}
                onChange={value => {
                  onUpdateField('storage', 'temporal', {
                    ...storage.temporal,
                    serverFallbackConfidence: value,
                  });
                }}
                min={0}
                max={1}
                step={0.05}
                description="Confidence multiplier for server-wide fallback"
              />
            </div>
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

StorageTab.displayName = 'StorageTab';
