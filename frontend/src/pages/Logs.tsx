import { useMemo, useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getLogs, clearLogs } from '../api';
import { Trash2, RefreshCw, FileText, ArrowDown, ArrowUp } from 'lucide-react';
import { toastSuccess, toastError } from '../utils/toast';
import { SkeletonTable } from '../components/skeletons';
import { ErrorState } from '../components/EmptyState';
import { DataToolbar } from '../components/DataToolbar';
import { useDataTable } from '../hooks/useDataTable';

type LogLevel = 'ALL' | 'ERROR' | 'WARN' | 'INFO';

const getLogLevel = (content: string): LogLevel => {
  if (content.includes('ERROR') || content.includes('[E]') || content.toLowerCase().includes('error')) {
    return 'ERROR';
  }
  if (content.includes('WARN') || content.includes('[W]')) {
    return 'WARN';
  }
  return 'INFO';
};

const getLogLevelColor = (level: LogLevel): string => {
  switch (level) {
    case 'ERROR':
      return 'text-red-400';
    case 'WARN':
      return 'text-yellow-400';
    case 'INFO':
      return 'text-blue-400';
    default:
      return 'text-gray-300';
  }
};

export const Logs = () => {
  const queryClient = useQueryClient();
  const [levelFilter, setLevelFilter] = useState<LogLevel>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

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

    let entries: Array<{ id: number; content: string; level: LogLevel }>;

    if (typeof logs === 'string') {
      entries = logs
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map((line, i) => ({ id: i, content: line, level: getLogLevel(line) }));
    } else if (Array.isArray(logs)) {
      entries = logs.map((log, i) => {
        const content = typeof log === 'string' ? log : JSON.stringify(log);
        return { id: i, content, level: getLogLevel(content) };
      });
    } else {
      entries = [{ id: 0, content: JSON.stringify(logs), level: getLogLevel(JSON.stringify(logs)) }];
    }

    if (levelFilter !== 'ALL') {
      entries = entries.filter(entry => entry.level === levelFilter);
    }

    return entries;
  }, [logs, levelFilter]);

  const {
    searchQuery,
    setSearchQuery,
    processedData: filteredLogs,
  } = useDataTable({
    data: logEntries,
    searchKeys: ['content'],
  });

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-text-base">System Logs</h2>
            <p className="text-text-muted">View and manage application logs</p>
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
            <h2 className="text-2xl font-bold text-text-base">System Logs</h2>
            <p className="text-text-muted">View and manage application logs</p>
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
        <h2 className="text-2xl font-bold text-text-base">System Logs</h2>
        <p className="text-text-muted">View and manage application logs</p>
      </div>

      <DataToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search logs..."
      >
        <select
          value={levelFilter}
          onChange={e => setLevelFilter(e.target.value as LogLevel)}
          className="bg-gray-700 text-text-base px-3 py-2 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
        >
          <option value="ALL">All Levels</option>
          <option value="ERROR">ERROR</option>
          <option value="WARN">WARN</option>
          <option value="INFO">INFO</option>
        </select>
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
            autoScroll
              ? 'bg-blue-600 hover:bg-blue-700 text-text-base'
              : 'bg-gray-700 hover:bg-gray-600 text-text-base'
          }`}
          title={autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled'}
        >
          {autoScroll ? <ArrowDown className="w-4 h-4" /> : <ArrowUp className="w-4 h-4" />}
          <span>{autoScroll ? 'Auto-scroll On' : 'Auto-scroll Off'}</span>
        </button>
        <button
          onClick={() => refetch()}
          className="flex items-center space-x-2 bg-gray-700 hover:bg-gray-600 text-text-base px-4 py-2 rounded-lg transition-colors text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
        <button
          onClick={() => clearMutation.mutate()}
          className="flex items-center space-x-2 bg-red-600 hover:bg-red-700 text-text-base px-4 py-2 rounded-lg transition-colors text-sm font-medium"
        >
          <Trash2 className="w-4 h-4" />
          <span>Clear Logs</span>
        </button>
      </DataToolbar>

      <div
        ref={logContainerRef}
        className="bg-gray-950 rounded-xl border border-gray-800 font-mono text-sm h-[600px] overflow-auto flex flex-col"
      >
        {filteredLogs.length > 0 ? (
          <div className="divide-y divide-gray-800/50">
            {filteredLogs.map(entry => (
              <div
                key={entry.id}
                className={`py-2 px-4 hover:bg-surface-raised/50 break-all whitespace-pre-wrap ${getLogLevelColor(entry.level)}`}
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
