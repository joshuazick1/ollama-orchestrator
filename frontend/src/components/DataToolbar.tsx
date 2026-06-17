import { Search, ArrowUp, ArrowDown } from 'lucide-react';
import { Input } from './ui/input';
import type { SortDirection } from '../hooks/useDataTable';

export interface FilterOption {
  key: string;
  label: string;
  options: { label: string; value: string }[];
}

export interface SortOption {
  key: string;
  label: string;
}

interface DataToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;

  sortOptions?: SortOption[];
  sortConfig?: { key: string; direction: SortDirection } | null;
  onSortChange?: (key: string) => void;

  filterOptions?: FilterOption[];
  filters?: Record<string, string>;
  onFilterChange?: (key: string, value: string) => void;

  children?: React.ReactNode;
}

export function DataToolbar({
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search...',
  sortOptions = [],
  sortConfig,
  onSortChange,
  filterOptions = [],
  filters = {},
  onFilterChange,
  children,
}: DataToolbarProps) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 bg-surface-raised/50 p-4 rounded-xl border border-surface-border">
      <div className="relative w-full md:w-64">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted w-4 h-4" />
        <Input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full bg-surface border border-surface-border rounded-lg pl-10 pr-4 py-2 text-sm text-text-base placeholder:text-gray-600"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
        {filterOptions.map(filter => (
          <div
            key={filter.key}
            className="flex items-center space-x-2 bg-surface rounded-lg px-3 py-1.5 border border-surface-border"
          >
            <span className="text-text-muted text-xs font-medium">{filter.label}:</span>
            <select
              value={filters[filter.key] || ''}
              onChange={e => onFilterChange?.(filter.key, e.target.value)}
              className="bg-transparent text-text-base text-sm outline-none cursor-pointer hover:text-white transition-colors"
            >
              <option value="" className="bg-surface-raised">
                All
              </option>
              {filter.options.map(opt => (
                <option key={opt.value} value={opt.value} className="bg-surface-raised">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}

        {sortOptions.length > 0 && onSortChange && (
          <div className="flex items-center bg-surface rounded-lg border border-surface-border overflow-hidden">
            <div className="px-3 py-1.5 border-r border-surface-border flex items-center space-x-2">
              <span className="text-text-muted text-xs font-medium">Sort:</span>
              <select
                value={sortConfig?.key || sortOptions[0].key}
                onChange={e => onSortChange(e.target.value)}
                className="bg-transparent text-text-base text-sm outline-none cursor-pointer hover:text-white transition-colors appearance-none pr-4"
              >
                {sortOptions.map(opt => (
                  <option key={opt.key} value={opt.key} className="bg-surface-raised">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => onSortChange(sortConfig?.key || sortOptions[0].key)}
              className="px-2 py-1.5 text-gray-400 hover:text-white hover:bg-surface-raised transition-colors"
              title={sortConfig?.direction === 'asc' ? 'Sort Ascending' : 'Sort Descending'}
            >
              {sortConfig?.direction === 'asc' ? (
                <ArrowUp className="w-4 h-4" />
              ) : (
                <ArrowDown className="w-4 h-4" />
              )}
            </button>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

export default DataToolbar;
