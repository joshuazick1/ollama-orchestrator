import { useState, useCallback, useRef, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConfig,
  updateConfig,
  saveConfig,
  reloadConfig,
  exportConfig,
  importConfig,
  type OrchestratorConfig,
  type ConfigExport,
} from '../../api';
import { toastSuccess, toastError } from '../../utils/toast';
import { UsersTab } from './UsersTab';
import { QueueTab } from './tabs/QueueTab';
import { RateLimitTab } from './tabs/RateLimitTab';
import { LoadBalancerTab } from './tabs/LoadBalancerTab';
import { SecurityTab } from './tabs/SecurityTab';
import { LoggingTab } from './tabs/LoggingTab';
import {
  Save,
  RefreshCw,
  Settings2,
  Server,
  Shield,
  BarChart3,
  Zap,
  Activity,
  AlertCircle,
  Users,
  Download,
  Upload,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ConfigSection } from './components';
import { NumberInput, TextInput } from './components';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const Settings = memo(() => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editedConfig, setEditedConfig] = useState<Partial<OrchestratorConfig> | null>(null);
  const [activeTab, setActiveTab] = useState('general');
  const [importPreview, setImportPreview] = useState<{
    show: boolean;
    config: Partial<OrchestratorConfig> | null;
    mode: 'merge' | 'replace';
    validationErrors: string[];
  }>({ show: false, config: null, mode: 'merge', validationErrors: [] });

  const { data: config, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
  });

  const updateMutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      toastSuccess('Configuration updated successfully');
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to update configuration');
    },
  });

  const saveToFileMutation = useMutation({
    mutationFn: saveConfig,
    onSuccess: () => toastSuccess('Configuration saved to file'),
    onError: error =>
      toastError(error instanceof Error ? error.message : 'Failed to save configuration to file'),
  });

  const reloadMutation = useMutation({
    mutationFn: reloadConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setEditedConfig(null);
    },
  });

  const exportMutation = useMutation({
    mutationFn: exportConfig,
    onSuccess: (data: ConfigExport) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orchestrator-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toastSuccess('Configuration exported successfully');
    },
    onError: error =>
      toastError(error instanceof Error ? error.message : 'Failed to export configuration'),
  });

  const importMutation = useMutation({
    mutationFn: ({ cfg, mode }: { cfg: Partial<OrchestratorConfig>; mode: 'merge' | 'replace' }) =>
      importConfig(cfg, mode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setImportPreview({ show: false, config: null, mode: 'merge', validationErrors: [] });
      toastSuccess('Configuration imported successfully');
    },
    onError: error =>
      toastError(error instanceof Error ? error.message : 'Failed to import configuration'),
  });

  const updateField = useCallback(
    <K extends keyof OrchestratorConfig>(
      section: K,
      field: keyof OrchestratorConfig[K] | null,
      value: unknown
    ) => {
      setEditedConfig(prev => {
        const base = prev || config || {};
        if (field === null) {
          return { ...base, [section]: value };
        } else {
          const rawSection = base[section];
          const sectionData = isPlainObject(rawSection) ? rawSection : {};
          return { ...base, [section]: { ...sectionData, [field]: value } };
        }
      });
    },
    [config]
  );

  const handleSave = () => {
    if (editedConfig) updateMutation.mutate(editedConfig);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (!json.config || typeof json.config !== 'object') {
          toastError('Invalid config file: missing config object');
          return;
        }
        setImportPreview({
          show: true,
          config: json.config as Partial<OrchestratorConfig>,
          mode: 'merge',
          validationErrors: [],
        });
      } catch {
        toastError('Invalid JSON file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
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

  const currentConfig = (editedConfig || config) as OrchestratorConfig;

  const tabs = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'queue', label: 'Queue', icon: Zap },
    { id: 'loadbalancer', label: 'Load Balancer', icon: Activity },
    { id: 'ratelimit', label: 'Rate Limit', icon: Shield },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'logging', label: 'Logging', icon: BarChart3 },
    { id: 'users', label: 'Users', icon: Users },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-base">Settings</h2>
          <p className="text-text-muted mt-1">Configure orchestrator behavior and features</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-surface-raised text-text-base rounded-lg transition-colors disabled:opacity-50"
          >
            <Download className={`w-4 h-4 ${exportMutation.isPending ? 'animate-spin' : ''}`} />
            <span>Download</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-surface-raised text-text-base rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span>Upload</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".json"
            className="hidden"
          />
          <button
            onClick={() => reloadMutation.mutate()}
            disabled={reloadMutation.isPending}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-surface-raised text-text-base rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${reloadMutation.isPending ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-text-base rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Import Preview */}
      {importPreview.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto border border-surface-border">
            <h3 className="text-xl font-semibold text-text-base mb-4">Import Configuration</h3>
            <div className="mb-4">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importPreview.mode === 'merge'}
                  onChange={() => setImportPreview(prev => ({ ...prev, mode: 'merge' }))}
                  className="text-blue-500"
                />
                <span className="text-gray-300">Merge with existing</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer ml-4">
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importPreview.mode === 'replace'}
                  onChange={() => setImportPreview(prev => ({ ...prev, mode: 'replace' }))}
                  className="text-blue-500"
                />
                <span className="text-gray-300">Replace entire config</span>
              </label>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() =>
                  setImportPreview({
                    show: false,
                    config: null,
                    mode: 'merge',
                    validationErrors: [],
                  })
                }
                className="px-4 py-2 bg-gray-700 hover:bg-surface-raised text-text-base rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  importPreview.config &&
                  importMutation.mutate({ cfg: importPreview.config, mode: importPreview.mode })
                }
                disabled={importMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-text-base rounded-lg transition-colors disabled:opacity-50"
              >
                {importMutation.isPending ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex border-b border-surface-border">
          {tabs.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex items-center space-x-2 px-4 py-3 text-sm font-medium border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-400 text-text-muted hover:text-gray-300"
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general">
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
            <TextInput
              label="Log Level"
              value={currentConfig.logLevel ?? 'info'}
              onChange={value => updateField('logLevel', null, value)}
              description="Logging verbosity level"
            />
          </ConfigSection>
        </TabsContent>

        <TabsContent value="queue">
          <QueueTab config={currentConfig} onUpdateField={updateField} />
        </TabsContent>

        <TabsContent value="loadbalancer">
          <LoadBalancerTab config={currentConfig} onUpdateField={updateField} />
        </TabsContent>

        <TabsContent value="ratelimit">
          <RateLimitTab config={currentConfig} onUpdateField={updateField} />
        </TabsContent>

        <TabsContent value="security">
          <SecurityTab config={currentConfig} onUpdateField={updateField} />
        </TabsContent>

        <TabsContent value="logging">
          <LoggingTab config={currentConfig} onUpdateField={updateField} />
        </TabsContent>

        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="flex justify-between items-center pt-6 border-t border-surface-border">
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
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-surface-raised text-text-base rounded-lg transition-colors disabled:opacity-50"
          >
            <Server className="w-4 h-4" />
            <span>Save to File</span>
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
            className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-text-base rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>Apply Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
});

export default Settings;
