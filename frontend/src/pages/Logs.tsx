import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getLogs, clearLogs } from '../api';
import { Trash2, RefreshCw, FileText } from 'lucide-react';
import { toastSuccess, toastError } from '../utils/toast';
import { SkeletonTable } from '../components/skeletons';
import { ErrorState } from '../components/EmptyState';
import { DataToolbar } from '../components/DataToolbar';
import { useDataTable } from '../hooks/useDataTable';

export const Logs = () => {
  const queryClient = useQueryClient();
  const {
    data: logs,
    isLoading,
    error,
    refetch,
  } = useQuery({ queryKey: ['logs'], queryFn: getLogs });

  const clearMutation = useMutation({
    mutationFn: clearLogs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logs'] });
      toastSuccess('Logs cleared successfully');
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to clear logs');
    },
  });

  const logEntries = useMemo(() => {
    if (!logs) return [];

    // Normalize string logs (split by newline)
    if (typeof logs === 'string') {
      return logs
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map((line, i) => ({ id: i, content: line }));
    }

    // Normalize array logs (handle strings or objects)
    if (Array.isArray(logs)) {
      return logs.map((log, i) => ({
        id: i,
        content: typeof log === 'string' ? log : JSON.stringify(log),
      }));
    }

    // Fallback
    return [{ id: 0, content: JSON.stringify(logs) }];
  }, [logs]);

  const {
    searchQuery,
    setSearchQuery,
    processedData: filteredLogs,
  } = useDataTable({
    data: logEntries,
    searchKeys: ['content'],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-white">System Logs</h2>
            <p className="text-gray-400">View and manage application logs</p>
          </div>
        </div>
        <SkeletonTable rows={10} columns={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-white">System Logs</h2>
            <p className="text-gray-400">View and manage application logs</p>
          </div>
        </div>
        <ErrorState
          title="Failed to load logs"
          message={error instanceof Error ? error.message : 'An error occurred while loading logs'}
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">System Logs</h2>
        <p className="text-gray-400">View and manage application logs</p>
      </div>

      <DataToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search logs..."
      >
        <button
          onClick={() => refetch()}
          className="flex items-center space-x-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
        <button
          onClick={() => clearMutation.mutate()}
          className="flex items-center space-x-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
        >
          <Trash2 className="w-4 h-4" />
          <span>Clear Logs</span>
        </button>
      </DataToolbar>

      <div className="bg-gray-950 rounded-xl border border-gray-800 font-mono text-sm h-[600px] overflow-auto flex flex-col">
        {filteredLogs.length > 0 ? (
          <div className="divide-y divide-gray-800/50">
            {filteredLogs.map(entry => (
              <div
                key={entry.id}
                className="py-2 px-4 hover:bg-gray-900/50 text-gray-300 break-all whitespace-pre-wrap"
              >
                {entry.content}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <FileText className="w-12 h-12 mb-3 opacity-20" />
            <p>No logs found matching your search.</p>
          </div>
        )}
      </div>
    </div>
  );
};
