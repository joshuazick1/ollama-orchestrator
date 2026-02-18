import type { LucideIcon } from 'lucide-react';

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
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg animate-pulse">
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
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg hover:border-gray-600 transition-colors">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-gray-400 text-sm font-medium">{title}</p>
          <h3 className="text-3xl font-bold mt-2 text-white">{value}</h3>
          {subtext && <p className="text-gray-500 text-sm mt-1">{subtext}</p>}
          {trend && (
            <div
              className={`text-sm mt-2 flex items-center gap-1 ${
                trend.direction === 'up'
                  ? 'text-green-400'
                  : trend.direction === 'down'
                    ? 'text-red-400'
                    : 'text-gray-400'
              }`}
            >
              {trend.direction === 'up' && <span>↑</span>}
              {trend.direction === 'down' && <span>↓</span>}
              {trend.value > 0 && `${trend.value}%`}
            </div>
          )}
        </div>
        <div className={`p-3 rounded-lg bg-opacity-20 ${color.replace('text-', 'bg-')} ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
};

export default StatCard;
