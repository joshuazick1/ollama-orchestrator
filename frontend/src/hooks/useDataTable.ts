import { useState, useMemo } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortConfig<T> {
  key: keyof T | string; // Allow string for nested keys or computed values
  direction: SortDirection;
}

export interface FilterConfig {
  key: string;
  value: string;
}

interface UseDataTableProps<T> {
  data: T[];
  initialSort?: SortConfig<T>;
  searchKeys?: (keyof T)[]; // Keys to search in
  filterFn?: (item: T, filterKey: string, filterValue: string) => boolean;
  sortFns?: Record<string, (a: T, b: T) => number>;
}

export function useDataTable<T>({
  data,
  initialSort,
  searchKeys = [],
  filterFn,
  sortFns,
}: UseDataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig<T> | null>(initialSort || null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const handleSort = (key: keyof T | string) => {
    setSortConfig(current => {
      if (current?.key === key) {
        return {
          key,
          direction: current.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return { key, direction: 'asc' };
    });
  };

  const handleFilter = (key: string, value: string) => {
    setFilters(prev => {
      if (value === 'all' || value === '') {
        const rest = { ...prev };
        delete rest[key];
        return rest;
      }
      return { ...prev, [key]: value };
    });
  };

  const processedData = useMemo(() => {
    // Defensive: ensure data is always an array before spreading
    let result = Array.isArray(data) ? [...data] : [];

    // 1. Filtering
    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        if (filterFn) {
          result = result.filter(item => filterFn(item, key, value));
        } else {
          // Default strict equality check
          result = result.filter(item => String(item[key as keyof T]) === value);
        }
      }
    });

    // 2. Searching
    if (searchQuery && searchKeys.length > 0) {
      const query = searchQuery.toLowerCase();
      result = result.filter(item =>
        searchKeys.some(key => {
          const val = item[key];
          return val ? String(val).toLowerCase().includes(query) : false;
        })
      );
    }

    // 3. Sorting
    if (sortConfig) {
      result.sort((a, b) => {
        const direction = sortConfig.direction === 'asc' ? 1 : -1;

        if (sortFns && sortFns[String(sortConfig.key)]) {
          return sortFns[String(sortConfig.key)](a, b) * direction;
        }

        const aValue = a[sortConfig.key as keyof T];
        const bValue = b[sortConfig.key as keyof T];

        if (aValue === bValue) return 0;

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return aValue.localeCompare(bValue) * direction;
        }

        return (aValue < bValue ? -1 : 1) * direction;
      });
    }

    return result;
  }, [data, filters, searchQuery, sortConfig, searchKeys, filterFn, sortFns]);

  return {
    searchQuery,
    setSearchQuery,
    sortConfig,
    setSortConfig, // Exposed if needed for direct setting
    handleSort,
    filters,
    handleFilter,
    processedData,
  };
}
