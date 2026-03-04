import { Search, ArrowUp, ArrowDown } from 'lucide-react';
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

  children?: React.ReactNode; // For extra actions like "Add Button"
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
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 bg-gray-900/50 p-4 rounded-xl border border-gray-800">
      {/* Search */}
      <div className="relative w-full md:w-64">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 w-4 h-4" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
        {/* Filters */}
        {filterOptions.map(filter => (
          <div
            key={filter.key}
            className="flex items-center space-x-2 bg-gray-950 rounded-lg px-3 py-1.5 border border-gray-800"
          >
            <span className="text-gray-500 text-xs font-medium">{filter.label}:</span>
            <select
              value={filters[filter.key] || ''}
              onChange={e => onFilterChange?.(filter.key, e.target.value)}
              className="bg-transparent text-gray-300 text-sm outline-none cursor-pointer hover:text-white transition-colors"
            >
              <option value="" className="bg-gray-900">
                All
              </option>
              {filter.options.map(opt => (
                <option key={opt.value} value={opt.value} className="bg-gray-900">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}

        {/* Sorting */}
        {sortOptions.length > 0 && onSortChange && (
          <div className="flex items-center bg-gray-950 rounded-lg border border-gray-800 overflow-hidden">
            <div className="px-3 py-1.5 border-r border-gray-800 flex items-center space-x-2">
              <span className="text-gray-500 text-xs font-medium">Sort:</span>
              <select
                value={sortConfig?.key || sortOptions[0].key}
                onChange={e => onSortChange(e.target.value)}
                className="bg-transparent text-gray-300 text-sm outline-none cursor-pointer hover:text-white transition-colors appearance-none pr-4"
              >
                {sortOptions.map(opt => (
                  <option key={opt.key} value={opt.key} className="bg-gray-900">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => onSortChange(sortConfig?.key || sortOptions[0].key)}
              className="px-2 py-1.5 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
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

        {/* Extra Actions */}
        {children}
      </div>
    </div>
  );
}
