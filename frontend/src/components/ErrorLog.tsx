import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getErrors, getServers } from '../api';
import { AlertCircle, RefreshCw, ArrowUpDown } from 'lucide-react';
import { useDataTable } from '../hooks/useDataTable';
import { DataToolbar } from '../components/DataToolbar';
import { SkeletonTable } from './skeletons';
import { ErrorState } from './EmptyState';

type ErrorType = 'retryable' | 'non_retryable' | 'transient' | 'rate_limited' | 'permanent';

const ERROR_TYPES: ErrorType[] = ['retryable', 'non_retryable', 'transient', 'rate_limited', 'permanent'];

const getErrorTypeColor = (errorType: string): string => {
  switch (errorType) {
    case 'permanent':
      return 'bg-red-500/20 text-red-400';
    case 'non_retryable':
      return 'bg-orange-500/20 text-orange-400';
    case 'retryable':
      return 'bg-yellow-500/20 text-yellow-400';
    case 'transient':
      return 'bg-blue-500/20 text-blue-400';
    case 'rate_limited':
      return 'bg-purple-500/20 text-purple-400';
    default:
      return 'bg-gray-500/20 text-text-muted';
  }
};

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

interface ErrorLogProps {
  className?: string;
}

export const ErrorLog = ({ className }: ErrorLogProps) => {
  const [serverFilter, setServerFilter] = useState<string>('');
  const [circuitFilter, setCircuitFilter] = useState<string>('');
  const [startTimeFilter, setStartTimeFilter] = useState<string>('');
  const [endTimeFilter, setEndTimeFilter] = useState<string>('');
  const [errorTypeFilter, setErrorTypeFilter] = useState<ErrorType | ''>('');

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (serverFilter) params.append('serverId', serverFilter);
    if (circuitFilter) params.append('circuitId', circuitFilter);
    if (startTimeFilter) params.append('startTime', startTimeFilter);
    if (endTimeFilter) params.append('endTime', endTimeFilter);
    if (errorTypeFilter) params.append('errorType', errorTypeFilter);
    return params.toString();
  };

  const { data: errors, isLoading, error, refetch } = useQuery({
    queryKey: ['errors', serverFilter, circuitFilter, startTimeFilter, endTimeFilter, errorTypeFilter],
    queryFn: () => getErrors(buildQueryParams() ? `?${buildQueryParams()}` : ''),
    refetchInterval: 10000,
  });

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
    staleTime: 30000,
  });

  const {
    searchQuery,
    setSearchQuery,
    sortConfig,
    handleSort,
    processedData: filteredErrors,
  } = useDataTable({
    data: errors || [],
    searchKeys: ['errorMessage', 'serverId', 'circuitId', 'errorType'],
    initialSort: { key: 'timestamp', direction: 'desc' },
  });

  if (isLoading) {
    return (
      <div className={className}>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-text-base">Error Log</h2>
          <p className="text-text-muted">View recent error events from the orchestrator</p>
        </div>
        <SkeletonTable rows={10} columns={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-text-base">Error Log</h2>
          <p className="text-text-muted">View recent error events from the orchestrator</p>
        </div>
        <ErrorState
          title="Failed to load errors"
          message={error instanceof Error ? error.message : 'An error occurred while loading errors'}
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );
  }

  const serverOptions = servers?.map(s => ({ value: s.id, label: s.url })) || [];

  return (
    <div className={className}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text-base">Error Log</h2>
        <p className="text-text-muted">View recent error events from the orchestrator</p>
      </div>

      <DataToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search errors..."
        sortConfig={sortConfig}
        onSortChange={handleSort}
        sortOptions={[
          { key: 'timestamp', label: 'Timestamp' },
          { key: 'serverId', label: 'Server ID' },
          { key: 'circuitId', label: 'Circuit ID' },
          { key: 'errorType', label: 'Error Type' },
        ]}
      >
        <select
          value={serverFilter}
          onChange={e => {
            setServerFilter(e.target.value);
            setCircuitFilter('');
          }}
          className="bg-surface text-text-base px-3 py-2 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
        >
          <option value="">All Servers</option>
          {serverOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          value={circuitFilter}
          onChange={e => setCircuitFilter(e.target.value)}
          disabled={!serverFilter}
          className="bg-surface text-text-base px-3 py-2 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">All Circuits</option>
          {serverFilter && servers?.find(s => s.id === serverFilter)?.models.map(model => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>

        <input
          type="datetime-local"
          value={startTimeFilter}
          onChange={e => setStartTimeFilter(e.target.value)}
          className="bg-surface text-text-base px-3 py-2 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
        />

        <input
          type="datetime-local"
          value={endTimeFilter}
          onChange={e => setEndTimeFilter(e.target.value)}
          className="bg-surface text-text-base px-3 py-2 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
        />

        <select
          value={errorTypeFilter}
          onChange={e => setErrorTypeFilter(e.target.value as ErrorType | '')}
          className="bg-surface text-text-base px-3 py-2 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
        >
          <option value="">All Error Types</option>
          {ERROR_TYPES.map(type => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>

        <button
          onClick={() => refetch()}
          className="flex items-center space-x-2 bg-surface hover:bg-gray-600 text-text-base px-4 py-2 rounded-lg transition-colors text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </DataToolbar>

      <div className="bg-surface-raised rounded-xl border border-surface-border overflow-hidden">
        {filteredErrors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900 border-b border-surface-border">
                <tr>
                  <th
                    className="text-left text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3 cursor-pointer hover:text-text-base transition-colors"
                    onClick={() => handleSort('timestamp')}
                  >
                    <div className="flex items-center gap-2">
                      Timestamp
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className="text-left text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3 cursor-pointer hover:text-text-base transition-colors"
                    onClick={() => handleSort('serverId')}
                  >
                    <div className="flex items-center gap-2">
                      Server ID
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className="text-left text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3 cursor-pointer hover:text-text-base transition-colors"
                    onClick={() => handleSort('circuitId')}
                  >
                    <div className="flex items-center gap-2">
                      Circuit ID
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th
                    className="text-left text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3 cursor-pointer hover:text-text-base transition-colors"
                    onClick={() => handleSort('errorType')}
                  >
                    <div className="flex items-center gap-2">
                      Error Type
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </th>
                  <th className="text-left text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3">
                    Error Message
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {filteredErrors.map((err, index) => (
                  <tr key={`${err.id}-${index}`} className="hover:bg-surface transition-colors">
                    <td className="px-6 py-4 text-sm text-text-base font-mono whitespace-nowrap">
                      {formatTimestamp(err.timestamp)}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-base font-mono">
                      {err.serverId}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-base font-mono">
                      {err.circuitId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${getErrorTypeColor(err.errorType)}`}
                      >
                        {err.errorType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-text-base max-w-md truncate" title={err.errorMessage}>
                      {err.errorMessage}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-text-subtle">
            <AlertCircle className="w-12 h-12 mb-4 opacity-20" />
            <p>No errors found matching your search.</p>
            {searchQuery && (
              <p className="text-sm mt-2">Try adjusting your search query</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ErrorLog;