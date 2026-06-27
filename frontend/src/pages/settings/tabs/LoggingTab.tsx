import { memo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { SelectInput } from '../components/SelectInput';

interface LoggingTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const LoggingTab = memo<LoggingTabProps>(({ config, onUpdateField }) => {
  return (
    <ConfigSection title="Logging" icon={BarChart3} description="Logging and metrics configuration">
      <div className="space-y-6">
        <SelectInput
          label="Log Level"
          value={config.logLevel ?? 'info'}
          onChange={value => onUpdateField('logLevel', null, value)}
          options={['debug', 'info', 'warn', 'error']}
          description="Logging verbosity level"
        />

        {config.metrics && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-surface-raised rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-300">Metrics</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {config.metrics.enabled ? 'Enabled' : 'Disabled'}
                  </p>
                </div>
                <div
                  className={`w-3 h-3 rounded-full ${config.metrics.enabled ? 'bg-green-500' : 'bg-red-500'}`}
                />
              </div>
            </div>

            {config.metrics.prometheusEnabled && (
              <div className="bg-surface-raised rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-300">Prometheus Exporter</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Port {config.metrics.prometheusPort || 9090}
                    </p>
                  </div>
                  <div className="text-blue-400 text-sm font-mono">/metrics</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ConfigSection>
  );
});

LoggingTab.displayName = 'LoggingTab';
