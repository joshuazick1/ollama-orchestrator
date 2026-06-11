import { useMemo, useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getLogs, clearLogs } from '../api';
import { Trash2, RefreshCw, FileText, ArrowDown, ArrowUp } from 'lucide-react';
import { toastSuccess, toastError } from '../utils/toast';
import { safeArray } from '../utils/safeArray';
import { SkeletonTable } from '../components/skeletons';
import { ErrorState } from '../components/EmptyState';
import { DataToolbar } from '../components/DataToolbar';
import { useDataTable } from '../hooks/useDataTable';

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const LEVEL_COLORS = {
  ERROR: '#F2495C',
  WARN: '#FF9830',
  INFO: '#5794F2',
  DEBUG: '#73BF69',
};

const getLogStyle = (level: LogLevel): React.CSSProperties => {
  switch (level) {
    case 'ERROR':
      return { backgroundColor: 'rgba(242,73,92,0.15)' };
    case 'WARN':
      return { backgroundColor: 'rgba(255,152,48,0.12)' };
    default:
      return {};
  }
};

const getLogTextColor = (level: LogLevel): string => {
  switch (level) {
    case 'ERROR':
      return 'text-red-400';
    case 'WARN':
      return 'text-yellow-400';
    case 'INFO':
      return 'text-blue-400';
    case 'DEBUG':
      return 'text-green-400';
    default:
      return 'text-gray-300';
  }
};

const getLogLevel = (content: string): LogLevel => {
  if (
    content.includes('ERROR') ||
    content.includes('[E]') ||
    content.toLowerCase().includes('error')
  ) {
    return 'ERROR';
  }
  if (content.includes('WARN') || content.includes('[W]')) {
    return 'WARN';
  }
  if (content.includes('DEBUG') || content.includes('[D]')) {
    return 'DEBUG';
  }
  return 'INFO';
};

export const Logs = () => {
  const queryClient = useQueryClient();
  const [levelFilter, setLevelFilter] = useState<Set<LogLevel>>(
    new Set(['ERROR', 'WARN', 'INFO', 'DEBUG'])
  );
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
    } else {
      entries = safeArray(logs).map((log, i) => {
        const content = typeof log === 'string' ? log : JSON.stringify(log);
        return { id: i, content, level: getLogLevel(content) };
      });
    }

    return entries;
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logEntries.filter(entry => levelFilter.has(entry.level));
  }, [logEntries, levelFilter]);

  const { searchQuery, setSearchQuery } = useDataTable({
    data: filteredLogs,
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
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Level:</span>
          {(['ERROR', 'WARN', 'INFO', 'DEBUG'] as const).map(level => (
            <button
              key={level}
              onClick={() => {
                const newFilter = new Set(levelFilter);
                if (newFilter.has(level)) {
                  newFilter.delete(level);
                } else {
                  newFilter.add(level);
                }
                setLevelFilter(newFilter);
              }}
              className={`px-2 py-1 text-xs rounded ${
                levelFilter.has(level) ? 'bg-opacity-100' : 'bg-opacity-30 opacity-50'
              }`}
              style={{
                backgroundColor: levelFilter.has(level) ? LEVEL_COLORS[level] : 'transparent',
                borderColor: LEVEL_COLORS[level],
                borderWidth: 1,
              }}
            >
              {level}
            </button>
          ))}
        </div>
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
                className={`py-2 px-4 hover:bg-surface-raised/50 break-all whitespace-pre-wrap ${getLogTextColor(entry.level)}`}
                style={getLogStyle(entry.level)}
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
