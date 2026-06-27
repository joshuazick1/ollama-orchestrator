import { memo } from 'react';
import { Save, Server } from 'lucide-react';

interface SettingsFooterProps {
  hasChanges: boolean;
  onSaveToFile: () => void;
  onApplyChanges: () => void;
  saveToFileMutationIsPending: boolean;
  updateMutationIsPending: boolean;
}

export const SettingsFooter = memo<SettingsFooterProps>(
  ({
    hasChanges,
    onSaveToFile,
    onApplyChanges,
    saveToFileMutationIsPending,
    updateMutationIsPending,
  }) => {
    return (
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
            onClick={onSaveToFile}
            disabled={saveToFileMutationIsPending}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-surface-raised text-text-base rounded-lg transition-colors disabled:opacity-50"
          >
            <Server className="w-4 h-4" />
            <span>Save to File</span>
          </button>
          <button
            onClick={onApplyChanges}
            disabled={!hasChanges || updateMutationIsPending}
            className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-text-base rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>Apply Changes</span>
          </button>
        </div>
      </div>
    );
  }
);

SettingsFooter.displayName = 'SettingsFooter';
