import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

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
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleOverlayClick}
    >
      <div
        ref={modalRef}
        className={clsx(
          'bg-gray-800 rounded-xl border shadow-2xl w-full animate-in zoom-in-95 duration-200',
          sizeClasses[size],
          variantClasses[variant],
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <h3 id="modal-title" className="text-xl font-semibold text-white">
            {title}
          </h3>
          {showCloseButton && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-1 rounded-md hover:bg-gray-700"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="p-6 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 p-4 border-t border-gray-700 bg-gray-800/50 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
