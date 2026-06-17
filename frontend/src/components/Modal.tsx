import React, { useEffect, useRef } from 'react';
import { createFocusTrap } from 'focus-trap';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  variant?: 'default' | 'danger';
  footer?: React.ReactNode;
  closeOnOverlayClick?: boolean;
  showCloseButton?: boolean;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[90vw]',
};

const variantClasses = {
  default: 'border-gray-700',
  danger: 'border-red-500/50',
};

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  className,
  size = 'md',
  variant = 'default',
  footer,
  closeOnOverlayClick = true,
  showCloseButton = true,
}: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let focusTrap: ReturnType<typeof createFocusTrap> | null = null;
    let savedScrollX = 0;
    let savedScrollY = 0;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen && modalRef.current) {
      savedScrollX = window.scrollX;
      savedScrollY = window.scrollY;

      focusTrap = createFocusTrap(modalRef.current, {
        initialFocus: modalRef.current,
        escapeDeactivates: true,
        clickOutsideDeactivates: false,
      });
      focusTrap.activate();
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';

      window.scrollTo(savedScrollX, savedScrollY);
    }

    return () => {
      if (focusTrap) {
        focusTrap.deactivate();
      }
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
      window.scrollTo(savedScrollX, savedScrollY);
    };
  }, [isOpen, onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        className={cn(
          'bg-surface rounded-xl border shadow-2xl w-full',
          sizeClasses[size],
          variantClasses[variant],
          className
        )}
        ref={modalRef}
        onClick={handleOverlayClick}
      >
        <DialogHeader className="flex justify-between items-center p-4 border-b border-gray-700">
          <DialogTitle className="text-xl font-semibold text-white">{title}</DialogTitle>
          {showCloseButton && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-1 rounded-md hover:bg-gray-700"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </DialogHeader>
        <div className="p-6 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && (
          <DialogFooter className="flex justify-end gap-3 p-4 border-t border-surface-border bg-surface rounded-b-xl">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default Modal;
