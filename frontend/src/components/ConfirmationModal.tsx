import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';
import { Button } from './Button';

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
    <AlertDialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent className="bg-surface border-red-500/50 max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
          </div>
          <AlertDialogTitle className="text-center text-white">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-400 text-center">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>

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

        <AlertDialogFooter className="flex gap-3 justify-center sm:justify-center">
          <AlertDialogCancel asChild>
            <Button variant="secondary" onClick={onClose} disabled={isPending}>
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="danger"
              onClick={handleConfirm}
              disabled={isPending}
              className={cn(isPending && 'opacity-50 cursor-not-allowed')}
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </span>
              ) : (
                confirmLabel
              )}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmationModal;
