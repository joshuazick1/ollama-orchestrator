import { memo } from 'react';
import { Save, RefreshCw, Download, Upload } from 'lucide-react';

interface SettingsHeaderProps {
  hasChanges: boolean;
  onSave: () => void;
  onReload: () => void;
  onExport: () => void;
  updateMutationIsPending: boolean;
  exportMutationIsPending: boolean;
  reloadMutationIsPending: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export const SettingsHeader = memo<SettingsHeaderProps>(
  ({
    hasChanges,
    onSave,
    onReload,
    onExport,
    updateMutationIsPending,
    exportMutationIsPending,
    reloadMutationIsPending,
    fileInputRef,
    onFileUpload,
  }) => {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-base">Settings</h2>
          <p className="text-text-muted mt-1">Configure orchestrator behavior and features</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={onExport}
            disabled={exportMutationIsPending}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-surface-raised text-text-base rounded-lg transition-colors disabled:opacity-50"
          >
            <Download className={`w-4 h-4 ${exportMutationIsPending ? 'animate-spin' : ''}`} />
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
            onChange={onFileUpload}
            accept=".json"
            className="hidden"
          />
          <button
            onClick={onReload}
            disabled={reloadMutationIsPending}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-surface-raised text-text-base rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${reloadMutationIsPending ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
          <button
            onClick={onSave}
            disabled={!hasChanges || updateMutationIsPending}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-text-base rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>Save</span>
          </button>
        </div>
      </div>
    );
  }
);

SettingsHeader.displayName = 'SettingsHeader';
