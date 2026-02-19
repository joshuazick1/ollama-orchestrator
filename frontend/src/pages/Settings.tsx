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
  Tag,
  Clock,
  Cpu,
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
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
        checked ? 'bg-blue-600' : 'bg-gray-600'
      }`}
      role="switch"
      aria-checked={checked}
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
  error?: string;
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
  error,
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
        className={`flex-1 bg-gray-900 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 transition-all ${
          error
            ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500'
            : 'border-gray-600 focus:ring-blue-500/50 focus:border-blue-500'
        }`}
        aria-invalid={!!error}
      />
      {suffix && <span className="text-gray-400 text-sm">{suffix}</span>}
    </div>
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);

interface SelectInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  description?: string;
  error?: string;
}

const SelectInput = ({ label, value, onChange, options, description, error }: SelectInputProps) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full bg-gray-900 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 transition-all ${
        error
          ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500'
          : 'border-gray-600 focus:ring-blue-500/50 focus:border-blue-500'
      }`}
      aria-invalid={!!error}
    >
      {options.map(option => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  placeholder?: string;
  error?: string;
}

const TextInput = ({ label, value, onChange, description, placeholder, error }: TextInputProps) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-gray-900 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 transition-all ${
        error
          ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500'
          : 'border-gray-600 focus:ring-blue-500/50 focus:border-blue-500'
      }`}
      aria-invalid={!!error}
    />
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
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
    { id: 'healthcheck', label: 'Health Check', icon: Activity },
    { id: 'tags', label: 'Tags', icon: Tag },
    { id: 'retry', label: 'Retry', icon: RefreshCw },
    { id: 'cooldown', label: 'Cooldown', icon: Clock },
    { id: 'modelmanager', label: 'Model Manager', icon: Cpu },
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
            <div>
              <h4 className="text-sm font-medium text-gray-300 mb-3">Persistence</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextInput
                  label="Persistence Path"
                  value={currentConfig.persistencePath ?? './data'}
                  onChange={value => updateField('persistencePath', null, value)}
                  description="Directory for persisted data"
                  placeholder="./data"
                />
                <NumberInput
                  label="Config Reload Interval"
                  value={currentConfig.configReloadIntervalMs ?? 0}
                  onChange={value => updateField('configReloadIntervalMs', null, value)}
                  min={0}
                  step={5000}
                  suffix="ms"
                  description="Auto-reload config interval (0 to disable)"
                />
              </div>
            </div>
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
              <NumberInput
                label="Max Priority"
                value={currentConfig.queue?.maxPriority ?? 100}
                onChange={value => updateField('queue', 'maxPriority', value)}
                min={1}
                description="Maximum priority value for queued requests"
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
                  <NumberInput
                    label="Latency Penalty"
                    value={(currentConfig.loadBalancer?.thresholds?.latencyPenalty ?? 0.5) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'thresholds', {
                        ...currentConfig.loadBalancer?.thresholds,
                        latencyPenalty: value / 100,
                      })
                    }
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    description="Score multiplier for high latency"
                  />
                  <NumberInput
                    label="Error Penalty"
                    value={(currentConfig.loadBalancer?.thresholds?.errorPenalty ?? 0.3) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'thresholds', {
                        ...currentConfig.loadBalancer?.thresholds,
                        errorPenalty: value / 100,
                      })
                    }
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    description="Score multiplier for errors"
                  />
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-3">Latency Blending</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <NumberInput
                    label="Recent Latency Weight"
                    value={(currentConfig.loadBalancer?.latencyBlendRecent ?? 0.6) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'latencyBlendRecent', value / 100)
                    }
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    description="Weight for recent response time"
                  />
                  <NumberInput
                    label="Historical Latency Weight"
                    value={(currentConfig.loadBalancer?.latencyBlendHistorical ?? 0.4) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'latencyBlendHistorical', value / 100)
                    }
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    description="Weight for P95 latency"
                  />
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-3">Load Factor</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <NumberInput
                    label="Load Factor Multiplier"
                    value={(currentConfig.loadBalancer?.loadFactorMultiplier ?? 0.5) * 100}
                    onChange={value =>
                      updateField('loadBalancer', 'loadFactorMultiplier', value / 100)
                    }
                    min={0}
                    max={200}
                    step={5}
                    suffix="%"
                    description="How much current load affects effective latency"
                  />
                  <NumberInput
                    label="Default Latency"
                    value={currentConfig.loadBalancer?.defaultLatencyMs ?? 1000}
                    onChange={value => updateField('loadBalancer', 'defaultLatencyMs', value)}
                    min={100}
                    step={100}
                    suffix="ms"
                    description="Default latency when no data available"
                  />
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-3">Default Max Concurrency</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <NumberInput
                    label="Default Max Concurrency"
                    value={currentConfig.loadBalancer?.defaultMaxConcurrency ?? 4}
                    onChange={value => updateField('loadBalancer', 'defaultMaxConcurrency', value)}
                    min={1}
                    max={100}
                    description="Default max concurrency for servers"
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
              <NumberInput
                label="Half-Open Max Requests"
                value={currentConfig.circuitBreaker?.halfOpenMaxRequests ?? 5}
                onChange={value => updateField('circuitBreaker', 'halfOpenMaxRequests', value)}
                min={1}
                description="Test requests allowed in half-open state"
              />
              <NumberInput
                label="Error Rate Window"
                value={currentConfig.circuitBreaker?.errorRateWindow ?? 60000}
                onChange={value => updateField('circuitBreaker', 'errorRateWindow', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Time window for error rate calculation"
              />
              <NumberInput
                label="Error Rate Threshold"
                value={(currentConfig.circuitBreaker?.errorRateThreshold ?? 0.5) * 100}
                onChange={value => updateField('circuitBreaker', 'errorRateThreshold', value / 100)}
                min={0}
                max={100}
                step={5}
                suffix="%"
                description="Error rate that triggers open state"
              />
              <NumberInput
                label="Error Rate Smoothing"
                value={(currentConfig.circuitBreaker?.errorRateSmoothing ?? 0.3) * 100}
                onChange={value => updateField('circuitBreaker', 'errorRateSmoothing', value / 100)}
                min={0}
                max={100}
                step={5}
                suffix="%"
                description="Smoothing factor for error rate"
              />
              <NumberInput
                label="Adaptive Threshold Adjustment"
                value={currentConfig.circuitBreaker?.adaptiveThresholdAdjustment ?? 2}
                onChange={value =>
                  updateField('circuitBreaker', 'adaptiveThresholdAdjustment', value)
                }
                min={1}
                max={10}
                description="Amount to adjust threshold by"
              />
              <NumberInput
                label="Non-Retryable Ratio Threshold"
                value={(currentConfig.circuitBreaker?.nonRetryableRatioThreshold ?? 0.5) * 100}
                onChange={value =>
                  updateField('circuitBreaker', 'nonRetryableRatioThreshold', value / 100)
                }
                min={0}
                max={100}
                step={5}
                suffix="%"
                description="Ratio above which to lower threshold"
              />
              <NumberInput
                label="Transient Ratio Threshold"
                value={(currentConfig.circuitBreaker?.transientRatioThreshold ?? 0.7) * 100}
                onChange={value =>
                  updateField('circuitBreaker', 'transientRatioThreshold', value / 100)
                }
                min={0}
                max={100}
                step={5}
                suffix="%"
                description="Ratio above which to raise threshold"
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
            <TextInput
              label="API Key Header"
              value={currentConfig.security?.apiKeyHeader ?? ''}
              onChange={value => updateField('security', 'apiKeyHeader', value)}
              description="Custom header name for API key authentication"
              placeholder="X-API-Key"
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
            <div>
              <h4 className="text-sm font-medium text-gray-300 mb-3">Decay Settings</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Toggle
                  label="Decay Enabled"
                  checked={currentConfig.metrics?.decay?.enabled ?? true}
                  onChange={checked =>
                    updateField('metrics', 'decay', {
                      ...currentConfig.metrics?.decay,
                      enabled: checked,
                    })
                  }
                  description="Enable metrics decay for stale data"
                />
                <NumberInput
                  label="Decay Half-Life"
                  value={currentConfig.metrics?.decay?.halfLifeMs ?? 300000}
                  onChange={value =>
                    updateField('metrics', 'decay', {
                      ...currentConfig.metrics?.decay,
                      halfLifeMs: value,
                    })
                  }
                  min={1000}
                  step={1000}
                  suffix="ms"
                  description="Time for metrics to decay by half"
                />
                <NumberInput
                  label="Min Decay Factor"
                  value={(currentConfig.metrics?.decay?.minDecayFactor ?? 0.1) * 100}
                  onChange={value =>
                    updateField('metrics', 'decay', {
                      ...currentConfig.metrics?.decay,
                      minDecayFactor: value / 100,
                    })
                  }
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  description="Minimum decay factor floor"
                />
                <NumberInput
                  label="Stale Threshold"
                  value={currentConfig.metrics?.decay?.staleThresholdMs ?? 120000}
                  onChange={value =>
                    updateField('metrics', 'decay', {
                      ...currentConfig.metrics?.decay,
                      staleThresholdMs: value,
                    })
                  }
                  min={1000}
                  step={1000}
                  suffix="ms"
                  description="Time after which metrics are considered stale"
                />
              </div>
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
              <NumberInput
                label="TTFT Weight"
                value={(currentConfig.streaming?.ttftWeight ?? 0.6) * 100}
                onChange={value => updateField('streaming', 'ttftWeight', value / 100)}
                min={0}
                max={100}
                step={5}
                suffix="%"
                description="Weight for time-to-first-token"
              />
              <NumberInput
                label="Duration Weight"
                value={(currentConfig.streaming?.durationWeight ?? 0.4) * 100}
                onChange={value => updateField('streaming', 'durationWeight', value / 100)}
                min={0}
                max={100}
                step={5}
                suffix="%"
                description="Weight for total duration"
              />
            </div>
          </ConfigSection>
        )}

        {/* Health Check Settings */}
        {activeTab === 'healthcheck' && (
          <ConfigSection
            title="Health Check"
            icon={Activity}
            description="Server health monitoring settings"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Toggle
                label="Health Check Enabled"
                checked={currentConfig.healthCheck?.enabled ?? true}
                onChange={checked => updateField('healthCheck', 'enabled', checked)}
                description="Enable periodic health checks"
              />
              <NumberInput
                label="Check Interval"
                value={currentConfig.healthCheck?.intervalMs ?? 30000}
                onChange={value => updateField('healthCheck', 'intervalMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Time between health checks"
              />
              <NumberInput
                label="Check Timeout"
                value={currentConfig.healthCheck?.timeoutMs ?? 5000}
                onChange={value => updateField('healthCheck', 'timeoutMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Timeout for each health check"
              />
              <NumberInput
                label="Max Concurrent Checks"
                value={currentConfig.healthCheck?.maxConcurrentChecks ?? 10}
                onChange={value => updateField('healthCheck', 'maxConcurrentChecks', value)}
                min={1}
                description="Maximum parallel health checks"
              />
              <NumberInput
                label="Retry Attempts"
                value={currentConfig.healthCheck?.retryAttempts ?? 2}
                onChange={value => updateField('healthCheck', 'retryAttempts', value)}
                min={0}
                description="Retries before marking unhealthy"
              />
              <NumberInput
                label="Retry Delay"
                value={currentConfig.healthCheck?.retryDelayMs ?? 1000}
                onChange={value => updateField('healthCheck', 'retryDelayMs', value)}
                min={100}
                step={100}
                suffix="ms"
                description="Delay between retries"
              />
              <NumberInput
                label="Recovery Interval"
                value={currentConfig.healthCheck?.recoveryIntervalMs ?? 60000}
                onChange={value => updateField('healthCheck', 'recoveryIntervalMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Time before retrying failed server"
              />
              <NumberInput
                label="Failure Threshold"
                value={currentConfig.healthCheck?.failureThreshold ?? 3}
                onChange={value => updateField('healthCheck', 'failureThreshold', value)}
                min={1}
                description="Failures before marking unhealthy"
              />
              <NumberInput
                label="Success Threshold"
                value={currentConfig.healthCheck?.successThreshold ?? 2}
                onChange={value => updateField('healthCheck', 'successThreshold', value)}
                min={1}
                description="Successes before marking healthy"
              />
              <NumberInput
                label="Backoff Multiplier"
                value={currentConfig.healthCheck?.backoffMultiplier ?? 1.5}
                onChange={value => updateField('healthCheck', 'backoffMultiplier', value)}
                min={1}
                step={0.1}
                description="Exponential backoff multiplier"
              />
            </div>
          </ConfigSection>
        )}

        {/* Tags Settings */}
        {activeTab === 'tags' && (
          <ConfigSection title="Tags" icon={Tag} description="Tags aggregation settings">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Cache TTL"
                value={currentConfig.tags?.cacheTtlMs ?? 30000}
                onChange={value => updateField('tags', 'cacheTtlMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="How long to cache tags list"
              />
              <NumberInput
                label="Max Concurrent Requests"
                value={currentConfig.tags?.maxConcurrentRequests ?? 10}
                onChange={value => updateField('tags', 'maxConcurrentRequests', value)}
                min={1}
                description="Parallel requests for tags"
              />
              <NumberInput
                label="Batch Delay"
                value={currentConfig.tags?.batchDelayMs ?? 50}
                onChange={value => updateField('tags', 'batchDelayMs', value)}
                min={0}
                suffix="ms"
                description="Delay between batch requests"
              />
              <NumberInput
                label="Request Timeout"
                value={currentConfig.tags?.requestTimeoutMs ?? 5000}
                onChange={value => updateField('tags', 'requestTimeoutMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Timeout for tags request"
              />
            </div>
          </ConfigSection>
        )}

        {/* Retry Settings */}
        {activeTab === 'retry' && (
          <ConfigSection title="Retry" icon={RefreshCw} description="Request retry settings">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Max Retries Per Server"
                value={currentConfig.retry?.maxRetriesPerServer ?? 2}
                onChange={value => updateField('retry', 'maxRetriesPerServer', value)}
                min={0}
                description="Maximum retries on same server"
              />
              <NumberInput
                label="Retry Delay"
                value={currentConfig.retry?.retryDelayMs ?? 500}
                onChange={value => updateField('retry', 'retryDelayMs', value)}
                min={100}
                suffix="ms"
                description="Base delay between retries"
              />
              <NumberInput
                label="Backoff Multiplier"
                value={currentConfig.retry?.backoffMultiplier ?? 2}
                onChange={value => updateField('retry', 'backoffMultiplier', value)}
                min={1}
                step={0.1}
                description="Exponential backoff multiplier"
              />
              <NumberInput
                label="Max Retry Delay"
                value={currentConfig.retry?.maxRetryDelayMs ?? 5000}
                onChange={value => updateField('retry', 'maxRetryDelayMs', value)}
                min={100}
                suffix="ms"
                description="Maximum delay between retries"
              />
            </div>
          </ConfigSection>
        )}

        {/* Cooldown Settings */}
        {activeTab === 'cooldown' && (
          <ConfigSection title="Cooldown" icon={Clock} description="Failure cooldown settings">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Failure Cooldown"
                value={currentConfig.cooldown?.failureCooldownMs ?? 120000}
                onChange={value => updateField('cooldown', 'failureCooldownMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Time to wait after failure before retry"
              />
              <NumberInput
                label="Default Max Concurrency"
                value={currentConfig.cooldown?.defaultMaxConcurrency ?? 4}
                onChange={value => updateField('cooldown', 'defaultMaxConcurrency', value)}
                min={1}
                max={100}
                description="Default max concurrency for servers"
              />
            </div>
          </ConfigSection>
        )}

        {/* Model Manager Settings */}
        {activeTab === 'modelmanager' && (
          <ConfigSection
            title="Model Manager"
            icon={Cpu}
            description="Model loading and management settings"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Max Retries"
                value={currentConfig.modelManager?.maxRetries ?? 3}
                onChange={value => updateField('modelManager', 'maxRetries', value)}
                min={0}
                description="Maximum retry attempts for model operations"
              />
              <NumberInput
                label="Retry Delay Base"
                value={currentConfig.modelManager?.retryDelayBaseMs ?? 1000}
                onChange={value => updateField('modelManager', 'retryDelayBaseMs', value)}
                min={100}
                suffix="ms"
                description="Base delay for model operation retries"
              />
              <NumberInput
                label="Warmup Timeout"
                value={currentConfig.modelManager?.warmupTimeoutMs ?? 60000}
                onChange={value => updateField('modelManager', 'warmupTimeoutMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Timeout for model warmup"
              />
              <NumberInput
                label="Idle Threshold"
                value={currentConfig.modelManager?.idleThresholdMs ?? 1800000}
                onChange={value => updateField('modelManager', 'idleThresholdMs', value)}
                min={1000}
                step={1000}
                suffix="ms"
                description="Time before unloading idle model"
              />
              <NumberInput
                label="Memory Safety Margin"
                value={(currentConfig.modelManager?.memorySafetyMargin ?? 1.2) * 100}
                onChange={value => updateField('modelManager', 'memorySafetyMargin', value / 100)}
                min={100}
                step={5}
                suffix="%"
                description="Safety margin for memory calculations"
              />
              <NumberInput
                label="GB Per Billion Params"
                value={currentConfig.modelManager?.gbPerBillionParams ?? 0.75}
                onChange={value => updateField('modelManager', 'gbPerBillionParams', value)}
                min={0.1}
                step={0.05}
                description="GB needed per billion model parameters"
              />
              <NumberInput
                label="Default Model Size (GB)"
                value={currentConfig.modelManager?.defaultModelSizeGb ?? 5}
                onChange={value => updateField('modelManager', 'defaultModelSizeGb', value)}
                min={0.1}
                step={0.5}
                description="Default size for unknown models"
              />
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-300 mb-3">Load Time Estimates (ms)</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <NumberInput
                  label="Tiny"
                  value={currentConfig.modelManager?.loadTimeEstimates?.tiny ?? 3000}
                  onChange={value =>
                    updateField('modelManager', 'loadTimeEstimates', {
                      ...currentConfig.modelManager?.loadTimeEstimates,
                      tiny: value,
                    })
                  }
                  min={1000}
                  suffix="ms"
                />
                <NumberInput
                  label="Small"
                  value={currentConfig.modelManager?.loadTimeEstimates?.small ?? 5000}
                  onChange={value =>
                    updateField('modelManager', 'loadTimeEstimates', {
                      ...currentConfig.modelManager?.loadTimeEstimates,
                      small: value,
                    })
                  }
                  min={1000}
                  suffix="ms"
                />
                <NumberInput
                  label="Medium"
                  value={currentConfig.modelManager?.loadTimeEstimates?.medium ?? 10000}
                  onChange={value =>
                    updateField('modelManager', 'loadTimeEstimates', {
                      ...currentConfig.modelManager?.loadTimeEstimates,
                      medium: value,
                    })
                  }
                  min={1000}
                  suffix="ms"
                />
                <NumberInput
                  label="Large"
                  value={currentConfig.modelManager?.loadTimeEstimates?.large ?? 20000}
                  onChange={value =>
                    updateField('modelManager', 'loadTimeEstimates', {
                      ...currentConfig.modelManager?.loadTimeEstimates,
                      large: value,
                    })
                  }
                  min={1000}
                  suffix="ms"
                />
                <NumberInput
                  label="XL"
                  value={currentConfig.modelManager?.loadTimeEstimates?.xl ?? 40000}
                  onChange={value =>
                    updateField('modelManager', 'loadTimeEstimates', {
                      ...currentConfig.modelManager?.loadTimeEstimates,
                      xl: value,
                    })
                  }
                  min={1000}
                  suffix="ms"
                />
                <NumberInput
                  label="XXL"
                  value={currentConfig.modelManager?.loadTimeEstimates?.xxl ?? 80000}
                  onChange={value =>
                    updateField('modelManager', 'loadTimeEstimates', {
                      ...currentConfig.modelManager?.loadTimeEstimates,
                      xxl: value,
                    })
                  }
                  min={1000}
                  suffix="ms"
                />
              </div>
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
