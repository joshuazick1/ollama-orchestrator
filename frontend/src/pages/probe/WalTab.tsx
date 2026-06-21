import { useState, useMemo, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/Button';
import { DataToolbar } from '../../components/DataToolbar';
import { EmptyState } from '../../components/EmptyState';
import { getAllServerRecoveryStats, getServers } from '../../api';
import { formatTimeAgo } from '../../utils/formatting';
import type { ServerRecoveryStats } from '../../api/types';
import type { AIServer } from '../../api/types';

interface WalEntry {
  timestamp: number;
  serverId: string;
  model: string;
  fromState: string;
  toState: string;
  reason: string;
}

const ITEMS_PER_PAGE = 20;
const FALLBACK_TIMESTAMP = 0;

export const WalTab = memo(() => {
  const [searchQuery, setSearchQuery] = useState('');
  const [serverFilter, setServerFilter] = useState('');
  const [page, setPage] = useState(0);

  const { data: recoveryStats, isLoading: recoveryLoading } = useQuery<ServerRecoveryStats[]>({
    queryKey: ['allServerRecoveryStats'],
    queryFn: getAllServerRecoveryStats,
    refetchInterval: 30000,
  });

  const { data: servers } = useQuery<AIServer[]>({
    queryKey: ['servers'],
    queryFn: getServers,
  });

  const serverList = useMemo(() => servers || [], [servers]);
  const serverIds = useMemo(() => serverList.map(s => s.id), [serverList]);

  const walEntries = useMemo<WalEntry[]>(() => {
    if (!recoveryStats) return [];

    return recoveryStats.map(stat => {
      let fromState = 'unknown';
      let toState = 'unknown';
      let reason = 'State transition recorded';

      if (stat.failureCount > 0 && stat.successfulRecoveries === 0) {
        fromState = 'healthy';
        toState = 'failing';
        reason = `${stat.failureCount} failures detected`;
      } else if (stat.failureCount > 0 && stat.successfulRecoveries > 0) {
        fromState = 'failing';
        toState = 'recovering';
        reason = `Recovery attempt ${stat.recoveryAttempts}/${stat.successfulRecoveries}`;
      } else if (stat.failureCount === 0 && stat.successfulRecoveries > 0) {
        fromState = 'recovering';
        toState = 'healthy';
        reason = 'Successfully recovered';
      }

      return {
        timestamp: stat.lastFailure || FALLBACK_TIMESTAMP,
        serverId: stat.serverId,
        model: 'N/A',
        fromState,
        toState,
        reason,
      };
    });
  }, [recoveryStats]);

  const filteredEntries = useMemo(() => {
    return walEntries.filter(entry => {
      const matchesSearch =
        searchQuery === '' ||
        entry.serverId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.model.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesServer = serverFilter === '' || entry.serverId === serverFilter;

      return matchesSearch && matchesServer;
    });
  }, [walEntries, searchQuery, serverFilter]);

  const paginatedEntries = useMemo(() => {
    const start = page * ITEMS_PER_PAGE;
    return filteredEntries.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredEntries, page]);

  const totalPages = Math.ceil(filteredEntries.length / ITEMS_PER_PAGE);

  const getStateBadge = (state: string) => {
    switch (state) {
      case 'healthy':
        return <Badge className="bg-green-500/20 text-green-400">Healthy</Badge>;
      case 'failing':
        return <Badge className="bg-red-500/20 text-red-400">Failing</Badge>;
      case 'recovering':
        return <Badge className="bg-yellow-500/20 text-yellow-400">Recovering</Badge>;
      default:
        return <Badge variant="outline">{state}</Badge>;
    }
  };

  const filterOptions = [
    {
      key: 'serverId',
      label: 'Server',
      options: serverIds.map(id => ({ label: id, value: id })),
    },
  ];

  if (recoveryLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (walEntries.length === 0) {
    return (
      <EmptyState
        type="empty"
        title="No WAL entries found"
        message="Probe state transitions will appear here"
      />
    );
  }

  return (
    <div className="space-y-4">
      <DataToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by server or model..."
        filterOptions={filterOptions}
        filters={{ serverId: serverFilter }}
        onFilterChange={(key, value) => {
          if (key === 'serverId') setServerFilter(value);
        }}
      />

      <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Server ID</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Transition</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedEntries.map((entry, index) => (
              <TableRow key={`${entry.serverId}-${entry.timestamp}-${index}`}>
                <TableCell className="text-text-muted">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    {formatTimeAgo(entry.timestamp)}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">{entry.serverId}</TableCell>
                <TableCell className="text-text-muted">{entry.model}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getStateBadge(entry.fromState)}
                    <ArrowRight className="w-4 h-4 text-text-muted" />
                    {getStateBadge(entry.toState)}
                  </div>
                </TableCell>
                <TableCell className="text-text-muted text-sm">{entry.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredEntries.length === 0 && (
          <div className="p-8 text-center text-text-muted">No WAL entries match your filters</div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-text-muted">
            Showing {page * ITEMS_PER_PAGE + 1} to{' '}
            {Math.min((page + 1) * ITEMS_PER_PAGE, filteredEntries.length)} of{' '}
            {filteredEntries.length} entries
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-text-muted">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

export default WalTab;
