// Extracted from Servers.tsx - ServerFilters component
import React, { memo } from 'react';
import { Plus } from 'lucide-react';
import { DataToolbar } from '../../components/DataToolbar';
import { Button } from '../../components/Button';

interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

interface ServerFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;
  filters: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
  groupConfig: 'none' | 'version' | 'healthy';
  onGroupChange: (config: 'none' | 'version' | 'healthy') => void;
  onAddServer: () => void;
}

export const ServerFilters = memo(function ServerFilters({
  searchQuery,
  onSearchChange,
  sortConfig,
  onSortChange,
  filters,
  onFilterChange,
  groupConfig,
  onGroupChange,
  onAddServer,
}: ServerFiltersProps) {
  return (
    <DataToolbar
      searchQuery={searchQuery}
      onSearchChange={onSearchChange}
      sortConfig={sortConfig}
      onSortChange={onSortChange}
      sortOptions={[
        { key: 'url', label: 'URL' },
        { key: 'healthy', label: 'Health' },
        { key: 'lastResponseTime', label: 'Response Time' },
        { key: 'modelCount', label: 'Model Count' },
        { key: 'version', label: 'Version' },
      ]}
      filterOptions={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { label: 'Healthy', value: 'healthy' },
            { label: 'Unhealthy', value: 'unhealthy' },
          ],
        },
        {
          key: 'support',
          label: 'Support',
          options: [
            { label: 'Ollama', value: 'ollama' },
            { label: 'OpenAI', value: 'openai' },
          ],
        },
      ]}
      filters={filters}
      onFilterChange={onFilterChange}
    >
      {/* Grouping Control */}
      <div className="flex items-center space-x-2 bg-gray-950 rounded-lg px-3 py-1.5 border border-gray-800">
        <span className="text-gray-500 text-xs font-medium">Group:</span>
        <select
          value={groupConfig}
          onChange={e => onGroupChange(e.target.value as 'none' | 'version' | 'healthy')}
          className="bg-transparent text-gray-300 text-sm outline-none cursor-pointer hover:text-text-base transition-colors"
        >
          <option value="none" className="bg-surface-raised">
            None
          </option>
          <option value="version" className="bg-surface-raised">
            Version
          </option>
          <option value="healthy" className="bg-surface-raised">
            Health
          </option>
        </select>
      </div>

      <Button onClick={onAddServer}>
        <Plus className="w-4 h-4 mr-2" />
        <span>Add Server</span>
      </Button>
    </DataToolbar>
  );
});
