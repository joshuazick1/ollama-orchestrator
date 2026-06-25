import { memo, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, ShieldAlert, ShieldX, RefreshCw, AlertTriangle } from 'lucide-react';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/Button';
import { DataToolbar } from '../components/DataToolbar';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { EmptyState } from '../components/EmptyState';
import { Card } from '../components/Card';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useQuarantineList, useUnquarantineMutation, useGhostStats } from '../hooks/useHoneypot';
import { toastSuccess, toastError } from '../utils/toast';
import type { QuarantineEntry } from '../api';

const getReasonColor = (reason: QuarantineEntry['reason']) => {
  if (reason === 'honeypot-flagged') return 'bg-red-500/10 text-red-400 border-red-500/20';
  if (reason === 'manual') return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
};

const getReasonIcon = (reason: QuarantineEntry['reason']) => {
  if (reason === 'honeypot-flagged') return <ShieldX className="w-3 h-3" />;
  if (reason === 'manual') return <Lock className="w-3 h-3" />;
  return <AlertTriangle className="w-3 h-3" />;
};

const getReasonLabel = (reason: QuarantineEntry['reason']) => {
  if (reason === 'honeypot-flagged') return 'Auto (Honeypot)';
  if (reason === 'manual') return 'Manual';
  return 'Auto (Low Confidence)';
};

export const Quarantine = memo(() => {
  const queryClient = useQueryClient();
  const [reasonFilter, setReasonFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pendingUnquarantine, setPendingUnquarantine] = useState<QuarantineEntry | null>(null);

  useLiveUpdates({
    invalidateQueries: [['quarantine-list']],
  });

  const { data: quarantineData, isLoading: quarantineLoading } = useQuarantineList();
  const { data: ghostData } = useGhostStats();

  const unquarantineMutation = useUnquarantineMutation();

  const quarantined = useMemo(() => quarantineData?.quarantined || [], [quarantineData]);

  const filteredQuarantined = useMemo(() => {
    let result = quarantined;
    if (reasonFilter) {
      result = result.filter(s => s.reason === reasonFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        s => s.serverId.toLowerCase().includes(q) || s.reason.toLowerCase().includes(q)
      );
    }
    return result;
  }, [quarantined, reasonFilter, searchQuery]);

  const isLoading = quarantineLoading;

  const autoFlagged = quarantined.filter(s => s.reason === 'honeypot-flagged').length;
  const manualQuarantined = quarantined.filter(s => s.reason === 'manual').length;
  const recovering = quarantined.filter(s => s.consecutiveCleanCycles > 0).length;

  const handleUnquarantine = () => {
    if (!pendingUnquarantine) return;
    unquarantineMutation.mutate(pendingUnquarantine.serverId, {
      onSuccess: () => {
        toastSuccess(`Server ${pendingUnquarantine.serverId} unquarantined`);
        setPendingUnquarantine(null);
      },
      onError: error => {
        toastError(error instanceof Error ? error.message : 'Failed to unquarantine server');
        setPendingUnquarantine(null);
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-text-base mb-2">Quarantine Management</h2>
          <p className="text-text-muted">Managing quarantined servers...</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-xl p-6 border border-surface-border animate-pulse"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="h-4 bg-surface rounded w-24 mb-2" />
                  <div className="h-8 bg-surface rounded w-16 mb-1" />
                  <div className="h-3 bg-surface rounded w-32" />
                </div>
                <div className="w-12 h-12 bg-surface rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-text-base mb-2">Quarantine Management</h2>
        <p className="text-text-muted">
          Servers isolated from normal inference due to suspicious behavior
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Quarantined"
          value={quarantined.length}
          icon={Lock}
          color="text-orange-400"
        />
        <StatCard
          title="Auto-Flagged"
          value={autoFlagged}
          icon={ShieldAlert}
          color="text-red-400"
        />
        <StatCard title="Manual" value={manualQuarantined} icon={Lock} color="text-blue-400" />
        <StatCard
          title="Recovering"
          value={recovering}
          icon={RefreshCw}
          color="text-green-400"
          subtext={`Ghost: ${ghostData?.ghostServers ?? 0}`}
        />
      </div>

      <DataToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by server ID or reason..."
        filterOptions={[
          {
            key: 'reason',
            label: 'Reason',
            options: [
              { label: 'Honeypot Flagged', value: 'honeypot-flagged' },
              { label: 'Manual', value: 'manual' },
              { label: 'Low Confidence', value: 'auto-low-confidence' },
            ],
          },
        ]}
        filters={{ reason: reasonFilter }}
        onFilterChange={(key, value) => {
          if (key === 'reason') setReasonFilter(value);
        }}
      >
        <Button
          variant="secondary"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['quarantine-list'] })}
          className="flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </DataToolbar>

      {filteredQuarantined.length === 0 ? (
        <EmptyState
          type="empty"
          title="No quarantined servers"
          message="Servers that are flagged as honeypots or manually quarantined will appear here."
        />
      ) : (
        <div className="space-y-4">
          {filteredQuarantined.map(server => (
            <Card key={server.serverId} className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-text-base font-medium">
                      {server.serverId.length > 20
                        ? `${server.serverId.substring(0, 20)}...`
                        : server.serverId}
                    </span>
                    <Badge
                      className={`${getReasonColor(server.reason)} border flex items-center gap-1 w-fit`}
                    >
                      {getReasonIcon(server.reason)}
                      {getReasonLabel(server.reason)}
                    </Badge>
                    {server.isManual && (
                      <Badge variant="outline" className="text-text-muted border-text-muted/20">
                        Manual
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-text-muted">
                    <span>
                      Quarantined{' '}
                      {server.quarantinedAt
                        ? new Date(server.quarantinedAt).toLocaleString()
                        : 'Unknown'}
                    </span>
                    <span>Clean cycles: {server.consecutiveCleanCycles}/3</span>
                  </div>
                </div>

                <div className="w-full lg:w-48">
                  <div className="flex justify-between text-xs mb-1 text-text-muted">
                    <span>Recovery Progress</span>
                    <span>{server.consecutiveCleanCycles}/3</span>
                  </div>
                  <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      // eslint-disable-next-line no-restricted-syntax
                      style={{ width: `${(server.consecutiveCleanCycles / 3) * 100}%` }}
                    />
                  </div>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPendingUnquarantine(server)}
                  className="flex items-center gap-1"
                >
                  <LockOpen className="w-4 h-4" />
                  Unquarantine
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {pendingUnquarantine && (
        <ConfirmationModal
          isOpen={!!pendingUnquarantine}
          onClose={() => setPendingUnquarantine(null)}
          onConfirm={handleUnquarantine}
          title="Unquarantine Server?"
          message={`This will restore ${pendingUnquarantine.serverId} to normal inference traffic.`}
          confirmLabel="Unquarantine"
          isPending={unquarantineMutation.isPending}
          consequences={[
            'Server will be eligible for normal inference traffic',
            'If server is still suspicious, it may be re-quarantined automatically',
            'Manual quarantines require human review to re-quarantine',
          ]}
        />
      )}
    </div>
  );
});
