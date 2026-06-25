import { memo, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldAlert, ShieldCheck, ShieldX, Lock, RefreshCw } from 'lucide-react';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/Button';
import { DataToolbar } from '../components/DataToolbar';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { EmptyState } from '../components/EmptyState';
import { Card } from '../components/Card';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useHoneypotStats, useHoneypotSummary, useQuarantineMutation } from '../hooks/useHoneypot';
import { toastSuccess, toastError } from '../utils/toast';
import type { HoneypotServerResult } from '../api';

const getVerdictColor = (verdict: HoneypotServerResult['verdict']) => {
  if (verdict === 'clean') return 'bg-green-500/10 text-green-400 border-green-500/20';
  if (verdict === 'suspicious') return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
  return 'bg-red-500/10 text-red-400 border-red-500/20';
};

const getVerdictIcon = (verdict: HoneypotServerResult['verdict']) => {
  if (verdict === 'clean') return <ShieldCheck className="w-3 h-3" />;
  if (verdict === 'suspicious') return <ShieldAlert className="w-3 h-3" />;
  return <ShieldX className="w-3 h-3" />;
};

const TierBreakdownCard = memo(
  ({
    stats,
  }: {
    stats: { avgTier1Score: number; avgTier2Score: number; avgTier3Score: number };
  }) => (
    <Card className="flex-1 min-w-[200px]">
      <h4 className="text-sm font-medium text-text-muted mb-3">Tier Score Averages</h4>
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-muted">Tier 1 (App+Infra)</span>
            <span className="text-text-base font-medium">{stats.avgTier1Score}</span>
          </div>
          <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              // eslint-disable-next-line no-restricted-syntax
              style={{ width: `${Math.min(100, stats.avgTier1Score)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-muted">Tier 2 (Deep Infra)</span>
            <span className="text-text-base font-medium">{stats.avgTier2Score}</span>
          </div>
          <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all"
              // eslint-disable-next-line no-restricted-syntax
              style={{ width: `${Math.min(100, stats.avgTier2Score)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-muted">Tier 3 (External)</span>
            <span className="text-text-base font-medium">{stats.avgTier3Score}</span>
          </div>
          <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-all"
              // eslint-disable-next-line no-restricted-syntax
              style={{ width: `${Math.min(100, stats.avgTier3Score)}%` }}
            />
          </div>
        </div>
      </div>
    </Card>
  )
);

export const Honeypot = memo(() => {
  const queryClient = useQueryClient();
  const [verdictFilter, setVerdictFilter] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pendingQuarantine, setPendingQuarantine] = useState<HoneypotServerResult | null>(null);

  useLiveUpdates({
    invalidateQueries: [['honeypot-stats'], ['honeypot-summary']],
  });

  const { data: statsData, isLoading: statsLoading } = useHoneypotStats();
  const { data: summaryData, isLoading: summaryLoading } = useHoneypotSummary();

  const quarantineMutation = useQuarantineMutation();

  const servers = useMemo(() => statsData?.results || [], [statsData]);

  const filteredServers = useMemo(() => {
    let result = servers;
    if (verdictFilter) {
      result = result.filter(s => s.verdict === verdictFilter);
    }
    if (tierFilter === '1') {
      result = result.filter(s => s.tier1Score !== undefined && s.tier1Score >= 30);
    } else if (tierFilter === '2') {
      result = result.filter(s => s.tier2Score !== undefined && s.tier2Score >= 30);
    } else if (tierFilter === '3') {
      result = result.filter(s => s.tier3Score !== undefined && s.tier3Score >= 30);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        s => s.serverId.toLowerCase().includes(q) || s.url.toLowerCase().includes(q)
      );
    }
    return result;
  }, [servers, verdictFilter, tierFilter, searchQuery]);

  const summary = summaryData;
  const isLoading = statsLoading || summaryLoading;

  const handleQuarantine = () => {
    if (!pendingQuarantine) return;
    quarantineMutation.mutate(
      { serverId: pendingQuarantine.serverId, reason: 'manual' },
      {
        onSuccess: () => {
          toastSuccess(`Server ${pendingQuarantine.serverId} quarantined`);
          setPendingQuarantine(null);
        },
        onError: error => {
          toastError(error instanceof Error ? error.message : 'Failed to quarantine server');
          setPendingQuarantine(null);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-text-base mb-2">Honeypot Detection</h2>
          <p className="text-text-muted">Scanning servers for honeypot signatures...</p>
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

  const totalScored = summary?.scored ?? 0;
  const quarantinedCount = summary?.quarantined ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-text-base mb-2">Honeypot Detection</h2>
        <p className="text-text-muted">
          Identify servers exhibiting suspicious behavior consistent with honeypot traps
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Scored"
          value={totalScored}
          icon={Shield}
          color="text-blue-400"
          subtext={`Avg score: ${summary?.avgCompositeScore ?? 0}`}
        />
        <StatCard
          title="Clean"
          value={summary?.clean ?? 0}
          icon={ShieldCheck}
          color="text-green-400"
        />
        <StatCard
          title="Suspicious"
          value={summary?.suspicious ?? 0}
          icon={ShieldAlert}
          color="text-yellow-400"
        />
        <StatCard
          title="Flagged"
          value={summary?.flagged ?? 0}
          icon={ShieldX}
          color="text-red-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <StatCard
          title="Quarantined"
          value={quarantinedCount}
          icon={Lock}
          color="text-orange-400"
        />
        <StatCard
          title="Currently Suspicious"
          value={summary?.suspicious ?? 0}
          icon={ShieldAlert}
          color="text-yellow-400"
        />
        {summary && (
          <TierBreakdownCard
            stats={{
              avgTier1Score: summary.avgTier1Score,
              avgTier2Score: summary.avgTier2Score,
              avgTier3Score: summary.avgTier3Score,
            }}
          />
        )}
      </div>

      <DataToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by server ID or URL..."
        filterOptions={[
          {
            key: 'verdict',
            label: 'Verdict',
            options: [
              { label: 'Clean', value: 'clean' },
              { label: 'Suspicious', value: 'suspicious' },
              { label: 'Flagged', value: 'flagged' },
            ],
          },
          {
            key: 'tier',
            label: 'Tier Signal',
            options: [
              { label: 'Tier 1', value: '1' },
              { label: 'Tier 2', value: '2' },
              { label: 'Tier 3', value: '3' },
            ],
          },
        ]}
        filters={{ verdict: verdictFilter, tier: tierFilter }}
        onFilterChange={(key, value) => {
          if (key === 'verdict') setVerdictFilter(value);
          if (key === 'tier') setTierFilter(value);
        }}
      >
        <Button
          variant="secondary"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['honeypot-stats'] })}
          className="flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </DataToolbar>

      {filteredServers.length === 0 ? (
        <EmptyState
          type="empty"
          title="No servers scored yet"
          message="Servers will appear here once honeypot probes have been executed."
        />
      ) : (
        <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted">
                    Server ID
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted">URL</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted">
                    Tier 1
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted">
                    Tier 2
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted">
                    Tier 3
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted">
                    Composite
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted">
                    Verdict
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-muted">
                    Last Probed
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {filteredServers.map(server => (
                  <tr
                    key={server.serverId}
                    className="hover:bg-surface-raised/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-mono text-text-base">
                      {server.serverId.length > 16
                        ? `${server.serverId.substring(0, 16)}...`
                        : server.serverId}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {server.url.length > 24 ? `${server.url.substring(0, 24)}...` : server.url}
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <span
                        className={
                          server.tier1Score !== undefined && server.tier1Score >= 30
                            ? 'text-red-400'
                            : 'text-text-base'
                        }
                      >
                        {server.tier1Score ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <span
                        className={
                          server.tier2Score !== undefined && server.tier2Score >= 30
                            ? 'text-red-400'
                            : 'text-text-base'
                        }
                      >
                        {server.tier2Score ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <span
                        className={
                          server.tier3Score !== undefined && server.tier3Score >= 30
                            ? 'text-red-400'
                            : 'text-text-base'
                        }
                      >
                        {server.tier3Score ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      {server.compositeScore}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        className={`${getVerdictColor(server.verdict)} border flex items-center gap-1 w-fit`}
                      >
                        {getVerdictIcon(server.verdict)}
                        {server.verdict}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {server.lastProbed ? new Date(server.lastProbed).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPendingQuarantine(server)}
                        className="flex items-center gap-1"
                      >
                        <Lock className="w-3 h-3" />
                        Quarantine
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pendingQuarantine && (
        <ConfirmationModal
          isOpen={!!pendingQuarantine}
          onClose={() => setPendingQuarantine(null)}
          onConfirm={handleQuarantine}
          title="Quarantine Server?"
          message={`This will move ${pendingQuarantine.serverId} to the quarantine pool. It will only receive traffic when no healthy servers are available.`}
          confirmLabel="Quarantine"
          isPending={quarantineMutation.isPending}
          consequences={[
            'Server will be isolated from normal inference traffic',
            'Server may still receive traffic as a last resort',
            'You can unquarantine at any time',
          ]}
        />
      )}
    </div>
  );
});
