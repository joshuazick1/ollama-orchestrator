import type { ReactNode } from 'react';
import clsx from 'clsx';

type CardVariant = 'default' | 'elevated' | 'bordered' | 'interactive';
type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: CardVariant;
  padding?: CardPadding;
  onClick?: () => void;
}

const paddingMap: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const variantStyles: Record<CardVariant, string> = {
  default: 'bg-gray-800 border border-gray-700',
  elevated: 'bg-gray-800 border border-gray-700 shadow-lg',
  bordered: 'bg-gray-800 border-2 border-gray-600',
  interactive:
    'bg-gray-800 border border-gray-700 hover:border-gray-500 hover:shadow-lg transition-all cursor-pointer',
};

export const Card = ({
  children,
  className,
  variant = 'default',
  padding = 'md',
  onClick,
}: CardProps) => {
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      className={clsx(
        'rounded-xl',
        variantStyles[variant],
        paddingMap[padding],
        onClick && 'text-left w-full',
        className
      )}
      onClick={onClick}
    >
      {children}
    </Component>
  );
};

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export const CardHeader = ({ title, subtitle, action, icon, className }: CardHeaderProps) => (
  <div className={clsx('flex items-start justify-between mb-4', className)}>
    <div className="flex items-center gap-3">
      {icon && <div className="text-gray-400">{icon}</div>}
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
      </div>
    </div>
    {action && <div>{action}</div>}
  </div>
);

interface CardContentProps {
  children: ReactNode;
  className?: string;
}

export const CardContent = ({ children, className }: CardContentProps) => (
  <div className={className}>{children}</div>
);

interface CardFooterProps {
  children: ReactNode;
  className?: string;
}

export const CardFooter = ({ children, className }: CardFooterProps) => (
  <div className={clsx('mt-4 pt-4 border-t border-gray-700', className)}>{children}</div>
);

export default Card;
