import { useState, useCallback, useRef, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConfig, type OrchestratorConfig } from '../../api';
import { toastError } from '../../utils/toast';
import { SettingsHeader } from './components/SettingsHeader';
import { SettingsTabsContent } from './components/SettingsTabsContent';
import { SettingsFooter } from './components/SettingsFooter';
import { ImportPreviewModal } from './components/ImportPreviewModal';
import { useSettingsMutations } from './hooks/useSettingsMutations';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { RefreshCw, Settings2, Shield, BarChart3, Zap, Activity, Users } from 'lucide-react';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const Settings = memo(() => {
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

  const { updateMutation, saveToFileMutation, reloadMutation, exportMutation, importMutation } =
    useSettingsMutations({
      onReloadSuccess: () => setEditedConfig(null),
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
        <span>Failed to load configuration</span>
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
      <SettingsHeader
        hasChanges={hasChanges}
        onSave={handleSave}
        onReload={() => reloadMutation.mutate()}
        onExport={() => exportMutation.mutate()}
        updateMutationIsPending={updateMutation.isPending}
        exportMutationIsPending={exportMutation.isPending}
        reloadMutationIsPending={reloadMutation.isPending}
        fileInputRef={fileInputRef}
        onFileUpload={handleFileChange}
      />

      <ImportPreviewModal
        show={importPreview.show}
        mode={importPreview.mode}
        config={importPreview.config}
        isPending={importMutation.isPending}
        onModeChange={mode => setImportPreview(prev => ({ ...prev, mode }))}
        onCancel={() =>
          setImportPreview({ show: false, config: null, mode: 'merge', validationErrors: [] })
        }
        onImport={() =>
          importPreview.config &&
          importMutation.mutate({ cfg: importPreview.config, mode: importPreview.mode })
        }
      />

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

        <SettingsTabsContent config={currentConfig} updateField={updateField} />
      </Tabs>

      <SettingsFooter
        hasChanges={hasChanges}
        onSaveToFile={() => saveToFileMutation.mutate()}
        onApplyChanges={handleSave}
        saveToFileMutationIsPending={saveToFileMutation.isPending}
        updateMutationIsPending={updateMutation.isPending}
      />
    </div>
  );
});

export default Settings;
