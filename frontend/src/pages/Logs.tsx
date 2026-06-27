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
import { logLevelColors } from '../constants/colors';
import { useVirtualizer } from '@tanstack/react-virtual';

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const LEVEL_COLORS: Record<LogLevel, string> = {
  ERROR: logLevelColors.error,
  WARN: logLevelColors.warn,
  INFO: logLevelColors.info,
  DEBUG: logLevelColors.debug,
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

const getLogBgClass = (level: LogLevel): string => {
  switch (level) {
    case 'ERROR':
      return 'bg-red-500/[0.15]';
    case 'WARN':
      return 'bg-yellow-500/[0.12]';
    default:
      return '';
  }
};

const getLogLevelButtonClass = (level: LogLevel, isSelected: boolean): string => {
  const color = LEVEL_COLORS[level];
  const bgClass = isSelected ? `bg-[${color}]` : 'bg-transparent';
  return `${bgClass} border border-[${color}] ${isSelected ? '' : 'opacity-50'}`;
};

const getLogLevel = (content: string): LogLevel => {
  if (
    content.includes('ERROR') ||
    content.includes('[E]') ||
    content.toLowerCase().includes('error')
  )
    return 'ERROR';
  if (content.includes('WARN') || content.includes('[W]')) return 'WARN';
  if (content.includes('DEBUG') || content.includes('[D]')) return 'DEBUG';
  return 'INFO';
};

export const Logs = () => {
  const queryClient = useQueryClient();
  const [levelFilter, setLevelFilter] = useState<Set<LogLevel>>(
    new Set(['ERROR', 'WARN', 'INFO', 'DEBUG'])
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

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
    onError: error => toastError(error instanceof Error ? error.message : 'Failed to clear logs'),
  });

  const logEntries = useMemo(() => {
    if (!logs) return [];
    if (typeof logs === 'string') {
      return logs
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map((line, i) => ({ id: i, content: line, level: getLogLevel(line) }));
    }
    return safeArray(logs).map((log, i) => {
      const content = typeof log === 'string' ? log : JSON.stringify(log);
      return { id: i, content, level: getLogLevel(content) };
    });
  }, [logs]);

  const filteredLogs = useMemo(
    () => logEntries.filter(entry => levelFilter.has(entry.level)),
    [logEntries, levelFilter]
  );

  const { searchQuery, setSearchQuery } = useDataTable({
    data: filteredLogs,
    searchKeys: ['content'],
  });

  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => logContainerRef.current,
    estimateSize: () => 40,
    overscan: 10,
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
              className={`px-2 py-1 text-xs rounded ${getLogLevelButtonClass(level, levelFilter.has(level))}`}
            >
              {level}
            </button>
          ))}
        </div>
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium ${autoScroll ? 'bg-blue-600 hover:bg-blue-700 text-text-base' : 'bg-gray-700 hover:bg-gray-600 text-text-base'}`}
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
        className="bg-gray-950 rounded-xl border border-gray-800 font-mono text-sm h-[600px] overflow-auto"
      >
        {filteredLogs.length > 0 ? (
          <div ref={parentRef} className={`relative w-full h-[${rowVirtualizer.getTotalSize()}px]`}>
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const entry = filteredLogs[virtualRow.index];
              return (
                <div
                  key={entry.id}
                  className={`absolute top-0 left-0 w-full py-2 px-4 hover:bg-surface-raised/50 break-all whitespace-pre-wrap ${getLogTextColor(entry.level)} ${getLogBgClass(entry.level)}`}
                >
                  {entry.content}
                </div>
              );
            })}
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
