// Extracted from CircuitBreakers.tsx - BansTab component
import { memo } from 'react';
import { Ban, Trash2, RefreshCw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { removeBan, clearAllBans, type BanEntry } from '../../api';
import { toastSuccess, toastError } from '../../utils/toast';
import { formatTimeAgo } from '../../utils/formatting';
import { DataToolbar } from '../DataToolbar';
import { useDataTable } from '../../hooks/useDataTable';

interface BansTabProps {
  bansData?: BanEntry[];
  bansLoading: boolean;
}

export const BansTab = memo(({ bansData, bansLoading }: BansTabProps) => {
  const queryClient = useQueryClient();

  const removeBanMutation = useMutation({
    mutationFn: ({ serverId, model }: { serverId: string; model: string }) =>
      removeBan(serverId, model),
    onSuccess: () => {
      toastSuccess('Ban removed');
      queryClient.invalidateQueries({ queryKey: ['bans'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to remove ban');
    },
  });

  const clearAllBansMutation = useMutation({
    mutationFn: clearAllBans,
    onSuccess: () => {
      toastSuccess('All bans cleared');
      queryClient.invalidateQueries({ queryKey: ['bans'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to clear bans');
    },
  });

  const {
    searchQuery: banSearch,
    setSearchQuery: setBanSearch,
    processedData: filteredBans,
  } = useDataTable({
    data: bansData || [],
    searchKeys: ['serverId', 'model'],
    initialSort: { key: 'bannedAt', direction: 'desc' },
  });

  return (
    <div className="space-y-6">
      <DataToolbar
        searchQuery={banSearch}
        onSearchChange={setBanSearch}
        searchPlaceholder="Search bans..."
      >
        {bansData && bansData.length > 0 && (
          <button
            onClick={() => clearAllBansMutation.mutate()}
            disabled={clearAllBansMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-text-base rounded-lg transition-colors text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Clear All Bans
          </button>
        )}
      </DataToolbar>

      {bansLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : filteredBans && filteredBans.length > 0 ? (
        <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-900">
              <tr>
                <th className="text-left text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Server
                </th>
                <th className="text-left text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Model
                </th>
                <th className="text-left text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Reason
                </th>
                <th className="text-left text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Banned At
                </th>
                <th className="text-right text-text-muted text-xs font-medium uppercase tracking-wider px-6 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredBans.map((ban, idx) => (
                <tr key={`${ban.serverId}-${ban.model}-${idx}`} className="hover:bg-gray-700">
                  <td className="px-6 py-4 text-sm text-text-base font-mono">{ban.serverId}</td>
                  <td className="px-6 py-4 text-sm text-text-base">{ban.model}</td>
                  <td className="px-6 py-4 text-sm text-text-muted">{ban.reason || '-'}</td>
                  <td className="px-6 py-4 text-sm text-text-muted">
                    {formatTimeAgo(ban.bannedAt)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() =>
                        removeBanMutation.mutate({ serverId: ban.serverId, model: ban.model })
                      }
                      disabled={removeBanMutation.isPending}
                      className="text-text-muted hover:text-red-400 transition-colors"
                      title="Remove ban"
                      aria-label="Remove ban"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-surface-border p-12 text-center">
          <Ban className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-text-base mb-2">No Banned Servers</h3>
          <p className="text-text-muted">
            Server:model pairs that exceed failure thresholds will appear here.
          </p>
        </div>
      )}
    </div>
  );
});

BansTab.displayName = 'BansTab';
