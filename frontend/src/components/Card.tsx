import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import {
  Card as UiCard,
  CardHeader as UiCardHeader,
  CardContent as UiCardContent,
  CardFooter as UiCardFooter,
  CardTitle,
  CardDescription,
} from './ui/card';

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
  default: 'bg-surface border border-surface-border',
  elevated: 'bg-surface border border-surface-border shadow-lg',
  bordered: 'bg-surface border-2 border-surface-border',
  interactive:
    'bg-surface border border-surface-border hover:border-surface-border hover:shadow-lg transition-all cursor-pointer',
};

export const Card = ({
  children,
  className,
  variant = 'default',
  padding = 'md',
  onClick,
}: CardProps) => {
  return (
    <UiCard
      className={cn(
        variantStyles[variant],
        paddingMap[padding],
        onClick && 'text-left cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {children}
    </UiCard>
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
  <UiCardHeader className={cn('flex items-start justify-between mb-4', className)}>
    <div className="flex items-center gap-3">
      {icon && <div className="text-text-muted">{icon}</div>}
      <div>
        <CardTitle className="text-lg font-semibold text-white">{title}</CardTitle>
        {subtitle && (
          <CardDescription className="text-sm text-text-muted">{subtitle}</CardDescription>
        )}
      </div>
    </div>
    {action && <div>{action}</div>}
  </UiCardHeader>
);

interface CardContentProps {
  children: ReactNode;
  className?: string;
}

export const CardContent = ({ children, className }: CardContentProps) => (
  <UiCardContent className={className}>{children}</UiCardContent>
);

interface CardFooterProps {
  children: ReactNode;
  className?: string;
}

export const CardFooter = ({ children, className }: CardFooterProps) => (
  <UiCardFooter className={cn('mt-4 pt-4 border-t border-surface-border', className)}>
    {children}
  </UiCardFooter>
);

export default Card;
