import { memo } from 'react';
import type { OrchestratorConfig } from '../../../api';

interface ImportPreviewModalProps {
  show: boolean;
  mode: 'merge' | 'replace';
  config: Partial<OrchestratorConfig> | null;
  isPending: boolean;
  onModeChange: (mode: 'merge' | 'replace') => void;
  onCancel: () => void;
  onImport: () => void;
}

export const ImportPreviewModal = memo<ImportPreviewModalProps>(
  ({ show, mode, isPending, onModeChange, onCancel, onImport }) => {
    if (!show) return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-surface rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto border border-surface-border">
          <h3 className="text-xl font-semibold text-text-base mb-4">Import Configuration</h3>
          <div className="mb-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="importMode"
                value="merge"
                checked={mode === 'merge'}
                onChange={() => onModeChange('merge')}
                className="text-blue-500"
              />
              <span className="text-gray-300">Merge with existing</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer ml-4">
              <input
                type="radio"
                name="importMode"
                value="replace"
                checked={mode === 'replace'}
                onChange={() => onModeChange('replace')}
                className="text-blue-500"
              />
              <span className="text-gray-300">Replace entire config</span>
            </label>
          </div>
          <div className="flex justify-end space-x-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-700 hover:bg-surface-raised text-text-base rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onImport}
              disabled={isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-text-base rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    );
  }
);

ImportPreviewModal.displayName = 'ImportPreviewModal';
