import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getConfig, updateConfig, saveConfig, reloadConfig, type OrchestratorConfig } from '../api';
import {
  Save,
  RefreshCw,
  Settings2,
  Server,
  Shield,
  BarChart3,
  Zap,
  Database,
  Activity,
  Check,
  AlertCircle,
} from 'lucide-react';

interface ConfigSectionProps {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  description?: string;
}

const ConfigSection = ({ title, icon: Icon, children, description }: ConfigSectionProps) => (
  <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
    <div className="flex items-center space-x-3 mb-4">
      <div className="p-2 bg-blue-600/20 rounded-lg">
        <Icon className="w-5 h-5 text-blue-400" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {description && <p className="text-sm text-gray-400">{description}</p>}
      </div>
    </div>
    <div className="space-y-4">{children}</div>
  </div>
);

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

const Toggle = ({ label, checked, onChange, description }: ToggleProps) => (
  <div className="flex items-center justify-between">
    <div>
      <label className="text-sm font-medium text-gray-300">{label}</label>
      {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
    </div>
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  </div>
);

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  suffix?: string;
}

const NumberInput = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  description,
  suffix,
}: NumberInputProps) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <div className="flex items-center space-x-2">
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {suffix && <span className="text-gray-400 text-sm">{suffix}</span>}
    </div>
  </div>
);

interface SelectInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  description?: string;
}

const SelectInput = ({ label, value, onChange, options, description }: SelectInputProps) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map(option => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  </div>
);

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  placeholder?: string;
}

const TextInput = ({ label, value, onChange, description, placeholder }: TextInputProps) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
);

export const Settings = () => {
  const queryClient = useQueryClient();
  const [editedConfig, setEditedConfig] = useState<Partial<OrchestratorConfig> | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  const { data: config, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
  });

  const updateMutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const saveToFileMutation = useMutation({
    mutationFn: saveConfig,
    onSuccess: () => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const reloadMutation = useMutation({
    mutationFn: reloadConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setEditedConfig(null);
    },
  });

  const updateField = <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => {
    setEditedConfig(prev => {
      const base = prev || config || {};
      if (field === null) {
        // Top-level field
        return { ...base, [section]: value };
      } else {
        // Nested field
        const sectionData = (base[section] as unknown as Record<string, unknown>) || {};
        return {
          ...base,
          [section]: { ...sectionData, [field]: value },
        };
      }
    });
  };

  const handleSave = () => {
    if (editedConfig) {
      updateMutation.mutate(editedConfig);
    }
  };

  const hasChanges = editedConfig !== null && Object.keys(editedConfig).length > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        <AlertCircle className="w-8 h-8 mr-2" />
        Failed to load configuration
      </div>
    );
  }

  // Safe cast because we checked !config above
  const currentConfig = (editedConfig || config) as OrchestratorConfig;

  const tabs = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'features', label: 'Features', icon: Zap },
    { id: 'queue', label: 'Queue', icon: Database },
    { id: 'loadbalancer', label: 'Load Balancer', icon: Activity },
    { id: 'circuitbreaker', label: 'Circuit Breaker', icon: Shield },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'metrics', label: 'Metrics', icon: BarChart3 },
    { id: 'streaming', label: 'Streaming', icon: Zap },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Settings</h2>
          <p className="text-gray-400 mt-1">Configure orchestrator behavior and features</p>
        </div>
        <div className="flex items-center space-x-3">
          {saveSuccess && (
            <span className="flex items-center text-green-400 text-sm">
              <Check className="w-4 h-4 mr-1" />
              Saved successfully
            </span>
          )}
          <button
            onClick={() => reloadMutation.mutate()}
            disabled={reloadMutation.isPending}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${reloadMutation.isPending ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>Save Changes</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-700">
        <nav className="flex space-x-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* General Settings */}
        {activeTab === 'general' && (
          <ConfigSection title="General" icon={Settings2} description="Basic orchestrator settings">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Port"
                value={currentConfig.port ?? 5100}
                onChange={value => updateField('port', null, value)}
                min={1}
                max={65535}
                description="Server port number"
              />
              <TextInput
                label="Host"
                value={currentConfig.host ?? '0.0.0.0'}
                onChange={value => updateField('host', null, value)}
                description="Server host address"
              />
            </div>
            <SelectInput
              label="Log Level"
              value={currentConfig.logLevel ?? 'info'}
              onChange={value => updateField('logLevel', null, value)}
              options={['debug', 'info', 'warn', 'error']}
              description="Logging verbosity level"
            />
          </ConfigSection>
        )}

        {/* Feature Toggles */}
        {activeTab === 'features' && (
          <ConfigSection
            title="Feature Toggles"
            icon={Zap}
            description="Enable or disable core features"
          >
            <Toggle
              label="Enable Queue"
              checked={currentConfig.enableQueue ?? true}
              onChange={checked => updateField('enableQueue', null, checked)}
              description="Queue requests when servers are busy"
            />
            <Toggle
              label="Enable Circuit Breaker"
              checked={currentConfig.enableCircuitBreaker ?? true}
              onChange={checked => updateField('enableCircuitBreaker', null, checked)}
              description="Automatically disable unhealthy servers"
            />
            <Toggle
              label="Enable Metrics"
              checked={currentConfig.enableMetrics ?? true}
              onChange={checked => updateField('enableMetrics', null, checked)}
              description="Collect and store performance metrics"
            />
            <Toggle
              label="Enable Streaming"
              checked={currentConfig.enableStreaming ?? true}
              onChange={checked => updateField('enableStreaming', null, checked)}
              description="Support streaming responses"
            />
            <Toggle
              label="Enable Persistence"
              checked={currentConfig.enablePersistence ?? true}
              onChange={checked => updateField('enablePersistence', null, checked)}
              description="Save state to disk for recovery"
            />
          </ConfigSection>
        )}

        {/* Queue Settings */}
        {activeTab === 'queue' && (
          <ConfigSection
            title="Queue Configuration"
            icon={Database}
            description="Request queue settings"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Max Queue Size"
                value={currentConfig.queue?.maxSize ?? 1000}
                onChange={value => updateField('queue', 'maxSize', value)}
                min={1}
                description="Maximum number of queued requests"
              />
              <NumberInput
                label="Queue Timeout"
                value={currentConfig.queue?.timeout ?? 300000}
                onChange={value => updateField('queue', 'timeout', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Maximum time a request can wait in queue"
              />
              <NumberInput
                label="Priority Boost Interval"
                value={currentConfig.queue?.priorityBoostInterval ?? 30000}
                onChange={value => updateField('queue', 'priorityBoostInterval', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="How often to boost waiting request priority"
              />
              <NumberInput
                label="Priority Boost Amount"
                value={currentConfig.queue?.priorityBoostAmount ?? 5}
                onChange={value => updateField('queue', 'priorityBoostAmount', value)}
                min={1}
                description="Priority increase per boost interval"
              />
            </div>
          </ConfigSection>
        )}

        {/* Load Balancer Settings */}
        {activeTab === 'loadbalancer' && (
          <ConfigSection
            title="Load Balancer"
            icon={Activity}
            description="Traffic distribution settings"
          >
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-3">Algorithm Weights</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <NumberInput
                    label="Latency Weight"
                    value={(currentConfig.loadBalancer?.weights?.latency ?? 0.35) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'weights', {
                        ...currentConfig.loadBalancer?.weights,
                        latency: value / 100,
                      })
                    }
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    description="Weight given to server response time"
                  />
                  <NumberInput
                    label="Success Rate Weight"
                    value={(currentConfig.loadBalancer?.weights?.successRate ?? 0.3) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'weights', {
                        ...currentConfig.loadBalancer?.weights,
                        successRate: value / 100,
                      })
                    }
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    description="Weight given to server reliability"
                  />
                  <NumberInput
                    label="Load Weight"
                    value={(currentConfig.loadBalancer?.weights?.load ?? 0.2) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'weights', {
                        ...currentConfig.loadBalancer?.weights,
                        load: value / 100,
                      })
                    }
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    description="Weight given to current server load"
                  />
                  <NumberInput
                    label="Capacity Weight"
                    value={(currentConfig.loadBalancer?.weights?.capacity ?? 0.15) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'weights', {
                        ...currentConfig.loadBalancer?.weights,
                        capacity: value / 100,
                      })
                    }
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    description="Weight given to remaining capacity"
                  />
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-3">Thresholds</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <NumberInput
                    label="Max P95 Latency"
                    value={currentConfig.loadBalancer?.thresholds?.maxP95Latency ?? 5000}
                    onChange={value =>
                      updateField('loadBalancer', 'thresholds', {
                        ...currentConfig.loadBalancer?.thresholds,
                        maxP95Latency: value,
                      })
                    }
                    min={100}
                    step={100}
                    suffix="ms"
                    description="Maximum acceptable P95 latency"
                  />
                  <NumberInput
                    label="Min Success Rate"
                    value={(currentConfig.loadBalancer?.thresholds?.minSuccessRate ?? 0.95) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'thresholds', {
                        ...currentConfig.loadBalancer?.thresholds,
                        minSuccessRate: value / 100,
                      })
                    }
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    description="Minimum acceptable success rate"
                  />
                </div>
              </div>
            </div>
          </ConfigSection>
        )}

        {/* Circuit Breaker Settings */}
        {activeTab === 'circuitbreaker' && (
          <ConfigSection
            title="Circuit Breaker"
            icon={Shield}
            description="Failure detection settings"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Toggle
                label="Adaptive Thresholds"
                checked={currentConfig.circuitBreaker?.adaptiveThresholds ?? true}
                onChange={checked => updateField('circuitBreaker', 'adaptiveThresholds', checked)}
                description="Automatically adjust thresholds based on performance"
              />
              <NumberInput
                label="Base Failure Threshold"
                value={currentConfig.circuitBreaker?.baseFailureThreshold ?? 5}
                onChange={value => updateField('circuitBreaker', 'baseFailureThreshold', value)}
                min={1}
                description="Failures before opening circuit"
              />
              <NumberInput
                label="Max Failure Threshold"
                value={currentConfig.circuitBreaker?.maxFailureThreshold ?? 10}
                onChange={value => updateField('circuitBreaker', 'maxFailureThreshold', value)}
                min={1}
                description="Maximum allowed failure threshold"
              />
              <NumberInput
                label="Min Failure Threshold"
                value={currentConfig.circuitBreaker?.minFailureThreshold ?? 3}
                onChange={value => updateField('circuitBreaker', 'minFailureThreshold', value)}
                min={1}
                description="Minimum failure threshold"
              />
              <NumberInput
                label="Open Timeout"
                value={currentConfig.circuitBreaker?.openTimeout ?? 30000}
                onChange={value => updateField('circuitBreaker', 'openTimeout', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Time before attempting recovery"
              />
              <NumberInput
                label="Half-Open Timeout"
                value={currentConfig.circuitBreaker?.halfOpenTimeout ?? 60000}
                onChange={value => updateField('circuitBreaker', 'halfOpenTimeout', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Time in half-open state"
              />
              <NumberInput
                label="Recovery Success Threshold"
                value={currentConfig.circuitBreaker?.recoverySuccessThreshold ?? 3}
                onChange={value => updateField('circuitBreaker', 'recoverySuccessThreshold', value)}
                min={1}
                description="Successes needed to close circuit"
              />
            </div>
          </ConfigSection>
        )}

        {/* Security Settings */}
        {activeTab === 'security' && (
          <ConfigSection title="Security" icon={Shield} description="Access control settings">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Rate Limit Window"
                value={currentConfig.security?.rateLimitWindowMs ?? 60000}
                onChange={value => updateField('security', 'rateLimitWindowMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Time window for rate limiting"
              />
              <NumberInput
                label="Rate Limit Max"
                value={currentConfig.security?.rateLimitMax ?? 100}
                onChange={value => updateField('security', 'rateLimitMax', value)}
                min={1}
                description="Maximum requests per window"
              />
            </div>
            <TextInput
              label="CORS Origins"
              value={(currentConfig.security?.corsOrigins ?? ['*']).join(', ')}
              onChange={value =>
                updateField(
                  'security',
                  'corsOrigins',
                  value.split(',').map(s => s.trim())
                )
              }
              description="Comma-separated list of allowed origins"
              placeholder="* or https://example.com, https://app.com"
            />
          </ConfigSection>
        )}

        {/* Metrics Settings */}
        {activeTab === 'metrics' && (
          <ConfigSection
            title="Metrics"
            icon={BarChart3}
            description="Monitoring and observability"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Toggle
                label="Metrics Enabled"
                checked={currentConfig.metrics?.enabled ?? true}
                onChange={checked => updateField('metrics', 'enabled', checked)}
                description="Collect performance metrics"
              />
              <Toggle
                label="Prometheus Enabled"
                checked={currentConfig.metrics?.prometheusEnabled ?? true}
                onChange={checked => updateField('metrics', 'prometheusEnabled', checked)}
                description="Export metrics in Prometheus format"
              />
              <NumberInput
                label="Prometheus Port"
                value={currentConfig.metrics?.prometheusPort ?? 9090}
                onChange={value => updateField('metrics', 'prometheusPort', value)}
                min={1}
                max={65535}
                description="Port for Prometheus metrics endpoint"
              />
              <NumberInput
                label="History Window"
                value={currentConfig.metrics?.historyWindowMinutes ?? 60}
                onChange={value => updateField('metrics', 'historyWindowMinutes', value)}
                min={1}
                suffix="min"
                description="How long to retain metrics history"
              />
            </div>
          </ConfigSection>
        )}

        {/* Streaming Settings */}
        {activeTab === 'streaming' && (
          <ConfigSection title="Streaming" icon={Zap} description="Streaming response settings">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Toggle
                label="Streaming Enabled"
                checked={currentConfig.streaming?.enabled ?? true}
                onChange={checked => updateField('streaming', 'enabled', checked)}
                description="Allow streaming responses"
              />
              <NumberInput
                label="Max Concurrent Streams"
                value={currentConfig.streaming?.maxConcurrentStreams ?? 100}
                onChange={value => updateField('streaming', 'maxConcurrentStreams', value)}
                min={1}
                description="Maximum simultaneous streams"
              />
              <NumberInput
                label="Stream Timeout"
                value={currentConfig.streaming?.timeoutMs ?? 300000}
                onChange={value => updateField('streaming', 'timeoutMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Maximum stream duration"
              />
              <NumberInput
                label="Buffer Size"
                value={currentConfig.streaming?.bufferSize ?? 1024}
                onChange={value => updateField('streaming', 'bufferSize', value)}
                min={1}
                description="Stream buffer size in bytes"
              />
            </div>
          </ConfigSection>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex justify-between items-center pt-6 border-t border-gray-700">
        <div className="text-sm text-gray-500">
          {hasChanges ? (
            <span className="text-yellow-400">You have unsaved changes</span>
          ) : (
            <span>All changes saved</span>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => saveToFileMutation.mutate()}
            disabled={saveToFileMutation.isPending}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <Server className="w-4 h-4" />
            <span>Save to File</span>
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
            className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>Apply Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
