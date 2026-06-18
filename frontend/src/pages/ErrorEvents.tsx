import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getErrors } from '../api';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { formatTimeAgo } from '../utils/formatting';
import { DataToolbar } from '../components/DataToolbar';
import { SkeletonTable } from '../components/skeletons';
import { ErrorState } from '../components/EmptyState';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Button } from '../components/ui/button';
import type { ErrorEvent } from '../api/types';

const TIME_RANGES = [
  { value: '1h', label: 'Last 1 hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

const ERROR_TYPES = [
  { value: 'retryable', label: 'Retryable' },
  { value: 'non_retryable', label: 'Non-Retryable' },
  { value: 'transient', label: 'Transient' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'rate_limited', label: 'Rate Limited' },
];

const PAGE_SIZE = 50;

const getSeverityColor = (severity: ErrorEvent['severity']): string => {
  switch (severity) {
    case 'critical':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'high':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'medium':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'low':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
};

const getErrorTypeColor = (errorType: ErrorEvent['errorType']): string => {
  switch (errorType) {
    case 'retryable':
      return 'bg-yellow-500/20 text-yellow-400';
    case 'non_retryable':
      return 'bg-red-500/20 text-red-400';
    case 'transient':
      return 'bg-blue-500/20 text-blue-400';
    case 'permanent':
      return 'bg-purple-500/20 text-purple-400';
    case 'rate_limited':
      return 'bg-orange-500/20 text-orange-400';
    default:
      return 'bg-gray-500/20 text-gray-400';
  }
};

export const ErrorEvents = () => {
  const [timeRange, setTimeRange] = useState<string>('24h');
  const [selectedErrorTypes, setSelectedErrorTypes] = useState<Set<string>>(new Set());
  const [selectedServers, setSelectedServers] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.append('timeRange', timeRange);
    return `?${params.toString()}`;
  }, [timeRange]);

  const {
    data: errors,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['errors', timeRange],
    queryFn: () => getErrors(queryParams),
  });

  const filteredErrors = useMemo(() => {
    if (!errors) return [];

    let filtered = [...errors];

    if (selectedErrorTypes.size > 0) {
      filtered = filtered.filter(e => selectedErrorTypes.has(e.errorType));
    }

    if (selectedServers.size > 0) {
      filtered = filtered.filter(e => selectedServers.has(e.serverId));
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        e =>
          e.serverId.toLowerCase().includes(query) ||
          e.errorMessage.toLowerCase().includes(query) ||
          e.circuitId.toLowerCase().includes(query) ||
          e.errorType.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [errors, selectedErrorTypes, selectedServers, searchQuery]);

  const paginatedErrors = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredErrors.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredErrors, currentPage]);

  const totalPages = Math.ceil(filteredErrors.length / PAGE_SIZE);

  const uniqueServers = useMemo(() => {
    if (!errors) return [];
    return [...new Set(errors.map(e => e.serverId))].sort();
  }, [errors]);

  const handleExportCSV = () => {
    const headers = [
      'Timestamp',
      'Server ID',
      'Circuit ID',
      'Error Type',
      'Severity',
      'Message',
      'Category',
      'Retryable',
    ];
    const csvRows = [headers.join(',')];

    paginatedErrors.forEach(error => {
      csvRows.push(
        [
          error.timestamp,
          error.serverId,
          error.circuitId,
          error.errorType,
          error.severity,
          `"${error.errorMessage.replace(/"/g, '""')}"`,
          error.category,
          error.retryable.toString(),
        ].join(',')
      );
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-events-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleErrorType = (errorType: string) => {
    setSelectedErrorTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(errorType)) {
        newSet.delete(errorType);
      } else {
        newSet.add(errorType);
      }
      return newSet;
    });
    setCurrentPage(1);
  };

  const toggleServer = (serverId: string) => {
    setSelectedServers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        newSet.add(serverId);
      }
      return newSet;
    });
    setCurrentPage(1);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-text-base">Error Events</h2>
          <p className="text-text-muted">View and analyze error events across the fleet</p>
        </div>
        <SkeletonTable rows={10} columns={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-text-base">Error Events</h2>
          <p className="text-text-muted">View and analyze error events across the fleet</p>
        </div>
        <ErrorState
          title="Failed to load error events"
          message={
            error instanceof Error ? error.message : 'An error occurred while loading error events'
          }
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-text-base">Error Events</h2>
        <p className="text-text-muted">View and analyze error events across the fleet</p>
      </div>

      <DataToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search errors..."
      >
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select time range" />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map(range => (
              <SelectItem key={range.value} value={range.value}>
                {range.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Error Type:</span>
          <div className="flex flex-wrap gap-1">
            {ERROR_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => toggleErrorType(type.value)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  selectedErrorTypes.has(type.value)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {uniqueServers.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Server:</span>
            <Select
              onValueChange={value => {
                toggleServer(value);
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All servers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All servers</SelectItem>
                {uniqueServers.map(server => (
                  <SelectItem key={server} value={server}>
                    {server}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          disabled={filteredErrors.length === 0}
        >
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </DataToolbar>

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-gray-800">
              <TableHead className="text-gray-400">Timestamp</TableHead>
              <TableHead className="text-gray-400">Server ID</TableHead>
              <TableHead className="text-gray-400">Error Type</TableHead>
              <TableHead className="text-gray-400">Message</TableHead>
              <TableHead className="text-gray-400">Circuit ID</TableHead>
              <TableHead className="text-gray-400">Severity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedErrors.length > 0 ? (
              paginatedErrors.map(error => (
                <TableRow key={error.id} className="hover:bg-gray-800/50 border-gray-800">
                  <TableCell className="text-gray-300 text-sm">
                    {formatTimeAgo(new Date(error.timestamp).getTime())}
                  </TableCell>
                  <TableCell className="text-gray-300 text-sm font-mono">
                    {error.serverId}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${getErrorTypeColor(error.errorType)}`}
                    >
                      {error.errorType}
                    </span>
                  </TableCell>
                  <TableCell
                    className="text-gray-300 text-sm max-w-md truncate"
                    title={error.errorMessage}
                  >
                    {error.errorMessage}
                  </TableCell>
                  <TableCell className="text-gray-300 text-sm font-mono">
                    {error.circuitId}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium border ${getSeverityColor(error.severity)}`}
                    >
                      {error.severity}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent border-gray-800">
                <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No error events found matching your filters.</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            Showing {(currentPage - 1) * PAGE_SIZE + 1} to{' '}
            {Math.min(currentPage * PAGE_SIZE, filteredErrors.length)} of {filteredErrors.length}{' '}
            errors
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-gray-400">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ErrorEvents;
