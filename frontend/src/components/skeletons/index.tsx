import { clsx } from 'clsx';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton = ({ className, style }: SkeletonProps) => (
  <div className={clsx('bg-gray-700/50 rounded animate-shimmer', className)} style={style} />
);

export const SkeletonText = ({ lines = 3 }: { lines?: number }) => (
  <div className="space-y-2">
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className={clsx('h-4', i === lines - 1 ? 'w-3/4' : 'w-full')} />
    ))}
  </div>
);

export const SkeletonCard = () => (
  <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Skeleton className="w-12 h-12 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-8 w-16 rounded-full" />
    </div>
  </div>
);

export const SkeletonStatCard = () => (
  <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
    <div className="flex justify-between items-start">
      <div className="flex-1">
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-8 w-16 mb-1" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="w-12 h-12 rounded-lg" />
    </div>
  </div>
);

export const SkeletonTable = ({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) => (
  <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
    <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
      <div className="flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
    </div>
    <div className="divide-y divide-gray-700">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="px-6 py-4 flex gap-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              className={clsx(
                'h-4 flex-1',
                colIndex === 0 && 'w-1/4',
                colIndex === columns - 1 && 'w-16'
              )}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const SkeletonServerCard = () => (
  <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="w-12 h-12 rounded-lg" />
          <div>
            <Skeleton className="h-5 w-48 mb-2" />
            <div className="flex gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-5 w-12 ml-auto" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="w-10 h-10 rounded-lg" />
        </div>
      </div>
    </div>
  </div>
);

export const SkeletonModelRow = () => (
  <div className="flex items-center justify-between p-4 border-b border-gray-700">
    <div className="flex items-center gap-4">
      <Skeleton className="w-10 h-10 rounded-lg" />
      <Skeleton className="h-5 w-32" />
    </div>
    <div className="flex items-center gap-4">
      <Skeleton className="h-6 w-16 rounded-full" />
      <Skeleton className="h-8 w-48 rounded-md" />
    </div>
  </div>
);

export const SkeletonChart = ({ height = 300 }: { height?: number }) => (
  <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
    <Skeleton className="h-6 w-48 mb-6" />
    <Skeleton className="w-full rounded" style={{ height }} />
  </div>
);

export const SkeletonQueueItem = () => (
  <div className="flex items-center justify-between p-4 border-b border-gray-700">
    <div className="flex items-center gap-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-5 w-20" />
    </div>
    <div className="flex items-center gap-4">
      <Skeleton className="h-6 w-12 rounded-full" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-20" />
    </div>
  </div>
);

export const SkeletonCircuitBreaker = () => (
  <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-4">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div>
          <Skeleton className="h-5 w-32 mb-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="h-6 w-20 rounded-full" />
    </div>
    <div className="grid grid-cols-4 gap-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  </div>
);

export const SkeletonSettingsForm = () => (
  <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-6">
    <div className="flex items-center gap-4 mb-6">
      <Skeleton className="w-10 h-10 rounded-lg" />
      <div>
        <Skeleton className="h-5 w-32 mb-1" />
        <Skeleton className="h-4 w-48" />
      </div>
    </div>
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i}>
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-10 w-full" />
      </div>
    ))}
  </div>
);

export const SkeletonTabs = ({ tabs = 5 }: { tabs?: number }) => (
  <div className="flex gap-2 p-1 bg-gray-800 rounded-lg">
    {Array.from({ length: tabs }).map((_, i) => (
      <Skeleton key={i} className="h-10 flex-1 rounded-md" />
    ))}
  </div>
);
