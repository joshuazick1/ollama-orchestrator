import type { ReactNode } from 'react';
import clsx from 'clsx';

interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  className?: string;
}

const variantClasses = {
  success: 'bg-green-500/20 text-green-400',
  warning: 'bg-yellow-500/20 text-yellow-400',
  danger: 'bg-red-500/20 text-red-400',
  info: 'bg-blue-500/20 text-blue-400',
  neutral: 'bg-gray-500/20 text-gray-400',
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs rounded',
  md: 'px-2.5 py-0.5 text-sm rounded-md',
  lg: 'px-3 py-1 text-base rounded-lg',
};

export const Badge = ({ variant = 'neutral', size = 'md', children, className }: BadgeProps) => {
  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {children}
    </span>
  );
};

export default Badge;