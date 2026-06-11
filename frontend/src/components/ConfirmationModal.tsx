import { AlertTriangle, Loader2 } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isPending?: boolean;
  consequences?: string[];
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isPending = false,
  consequences,
}: ConfirmationModalProps) {
  const handleConfirm = () => {
    if (isPending) return;
    onConfirm();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm" variant="danger">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mb-4">
          <AlertTriangle className="h-6 w-6 text-red-600" />
        </div>
        <p className="text-gray-400 mb-6">{message}</p>
        {consequences && consequences.length > 0 && (
          <ul className="mt-4 text-left text-sm text-yellow-300 space-y-1">
            {consequences.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1">⚠️</span>
                {c}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface hover:bg-surface-hover text-text-base rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className={`px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors
              ${isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
