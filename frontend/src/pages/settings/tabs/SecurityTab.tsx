import { memo } from 'react';
import { Shield } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection } from '../components';
import { TextInput } from '../components/TextInput';

interface SecurityTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const SecurityTab = memo<SecurityTabProps>(({ config, onUpdateField }) => {
  const security = config.security || {
    corsOrigins: ['*'],
    rateLimitWindowMs: 900000,
    rateLimitMax: 100,
  };

  const corsString = Array.isArray(security.corsOrigins)
    ? security.corsOrigins.join(', ')
    : security.corsOrigins || '*';

  return (
    <ConfigSection title="Security" icon={Shield} description="Security and API key settings">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">CORS Origins</label>
          <p className="text-xs text-gray-500 mb-2">Comma-separated list of allowed CORS origins</p>
          <input
            type="text"
            value={corsString}
            onChange={e =>
              onUpdateField(
                'security',
                'corsOrigins',
                e.target.value.split(',').map(s => s.trim())
              )
            }
            className="flex-1 bg-surface-raised border border-surface-border rounded-lg px-3 py-2 text-text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 w-full"
            placeholder="* or https://example.com"
          />
        </div>

        <TextInput
          label="API Key Header"
          value={security.apiKeyHeader || 'X-API-Key'}
          onChange={value => onUpdateField('security', 'apiKeyHeader', value)}
          description="Header name for API key authentication"
        />

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Admin API Keys</label>
          <p className="text-xs text-gray-500 mb-2">Comma-separated admin API keys</p>
          <input
            type="text"
            value={security.adminApiKeys?.join(', ') || ''}
            onChange={e =>
              onUpdateField(
                'security',
                'adminApiKeys',
                e.target.value
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean)
              )
            }
            className="flex-1 bg-surface-raised border border-surface-border rounded-lg px-3 py-2 text-text-base focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 w-full"
            placeholder="admin-key-1, admin-key-2"
          />
        </div>
      </div>
    </ConfigSection>
  );
});

SecurityTab.displayName = 'SecurityTab';
