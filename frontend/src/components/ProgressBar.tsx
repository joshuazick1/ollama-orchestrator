import { cn } from '../lib/utils';

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'yellow';
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}

const COLOR_CLASSES = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
} as const;

const SIZE_CLASSES = {
  sm: 'h-1',
  md: 'h-2',
} as const;

export const ProgressBar = ({
  value,
  max = 100,
  color = 'blue',
  size = 'md',
  className,
  ariaLabel,
}: ProgressBarProps) => {
  const percentage = (value / max) * 100;
  const clamped = Math.min(100, Math.max(0, percentage));

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className={cn('h-2 bg-surface-raised rounded-full overflow-hidden', className)}
      // eslint-disable-next-line no-restricted-syntax
      style={{ '--progress': `${clamped}%` } as React.CSSProperties}
    >
      <div
        className={cn(
          'h-full rounded-full transition-all',
          COLOR_CLASSES[color],
          SIZE_CLASSES[size]
        )}
        // eslint-disable-next-line no-restricted-syntax
        style={{ width: 'var(--progress)' } as React.CSSProperties}
      />
    </div>
  );
};

export default ProgressBar;
