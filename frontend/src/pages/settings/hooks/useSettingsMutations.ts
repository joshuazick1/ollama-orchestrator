import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  updateConfig,
  saveConfig,
  reloadConfig,
  exportConfig,
  importConfig,
  type OrchestratorConfig,
  type ConfigExport,
} from '../../../api';
import { toastSuccess, toastError } from '../../../utils/toast';

interface UseSettingsMutationsProps {
  onReloadSuccess?: () => void;
  onImportSuccess?: () => void;
}

export const useSettingsMutations = ({
  onReloadSuccess,
  onImportSuccess,
}: UseSettingsMutationsProps = {}) => {
  const queryClient = useQueryClient();

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
      onReloadSuccess?.();
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
      onImportSuccess?.();
      toastSuccess('Configuration imported successfully');
    },
    onError: error =>
      toastError(error instanceof Error ? error.message : 'Failed to import configuration'),
  });

  return {
    updateMutation,
    saveToFileMutation,
    reloadMutation,
    exportMutation,
    importMutation,
  };
};
