import { memo } from 'react';
import { Shield } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection, Toggle } from '../components';
import { NumberInput } from '../components/NumberInput';
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
    rateLimitWindowMs: 60000,
    rateLimitMax: 100,
    authMustBeEnabled: false,
  };

  const corsString = Array.isArray(security.corsOrigins)
    ? security.corsOrigins.join(', ')
    : security.corsOrigins || '*';

  return (
    <ConfigSection title="Security" icon={Shield} description="Security and API key settings">
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Rate Limiting</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Rate Limit Window"
              value={security.rateLimitWindowMs ?? 60000}
              onChange={value => onUpdateField('security', 'rateLimitWindowMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Time window for rate limiting"
            />
            <NumberInput
              label="Rate Limit Max"
              value={security.rateLimitMax ?? 100}
              onChange={value => onUpdateField('security', 'rateLimitMax', value)}
              min={1}
              description="Maximum requests per window"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">CORS</h4>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">CORS Origins</label>
            <p className="text-xs text-gray-500 mb-2">
              Comma-separated list of allowed CORS origins
            </p>
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
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Authentication</h4>
          <div className="space-y-4">
            <Toggle
              label="Auth Must Be Enabled"
              checked={security.authMustBeEnabled ?? false}
              onChange={value => onUpdateField('security', 'authMustBeEnabled', value)}
              description="Require authentication for API access"
            />
            <TextInput
              label="API Key Header"
              value={security.apiKeyHeader || 'X-API-Key'}
              onChange={value => onUpdateField('security', 'apiKeyHeader', value)}
              description="Header name for API key authentication"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Admin API Keys</h4>
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
      </div>
    </ConfigSection>
  );
});

SecurityTab.displayName = 'SecurityTab';
