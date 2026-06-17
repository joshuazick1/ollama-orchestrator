import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card } from './Card';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  icon: LucideIcon;
  color: string;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
  loading?: boolean;
}

export const StatCard = ({
  title,
  value,
  subtext,
  icon: Icon,
  color,
  trend,
  loading = false,
}: StatCardProps) => {
  if (loading) {
    return (
      <Card className="animate-pulse">
        <div className="flex justify-between items-start">
          <div>
            <div className="h-4 w-24 bg-gray-700 rounded mb-3" />
            <div className="h-8 w-16 bg-gray-700 rounded mb-2" />
            <div className="h-3 w-20 bg-gray-700 rounded" />
          </div>
          <div className="p-3 rounded-lg bg-gray-700">
            <div className="w-6 h-6 bg-gray-600 rounded" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex justify-between items-start">
        <div>
          <p className="text-text-muted text-sm font-medium">{title}</p>
          <h3 className="text-3xl font-bold mt-2 text-text-base tabular-nums">{value}</h3>
          {subtext && <p className="text-text-subtle text-sm mt-1">{subtext}</p>}
          {trend && (
            <div
              className={cn(
                'text-sm mt-2 flex items-center gap-1',
                trend.direction === 'up'
                  ? 'text-green-400'
                  : trend.direction === 'down'
                    ? 'text-red-400'
                    : 'text-text-muted'
              )}
            >
              {trend.direction === 'up' && <span>↑</span>}
              {trend.direction === 'down' && <span>↓</span>}
              {trend.value > 0 && `${trend.value}%`}
            </div>
          )}
        </div>
        <div className={cn('p-3 rounded-lg bg-opacity-20', color.replace('text-', 'bg-'), color)}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </Card>
  );
};

export default StatCard;
