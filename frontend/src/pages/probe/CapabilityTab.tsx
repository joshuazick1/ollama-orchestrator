import { useState, useMemo, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldX, ShieldAlert } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { DataToolbar } from '../../components/DataToolbar';
import { EmptyState } from '../../components/EmptyState';
import { getAllModelsStatus, getServers } from '../../api';
import { formatTimeAgo } from '../../utils/formatting';
import { safeArray } from '../../utils/safeArray';
import type { AIServer } from '../../api/types';

interface ModelStatus {
  serverId: string;
  model: string;
  status: 'confirmed' | 'revoked' | 'rate_limited';
  lastProbeAt?: number;
  confidence?: number;
  endpoints?: string[];
}

interface ModelsStatusResponse {
  success: boolean;
  models: ModelStatus[];
}

export const CapabilityTab = memo(() => {
  const [searchQuery, setSearchQuery] = useState('');
  const [serverFilter, setServerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: modelsStatusData, isLoading: modelsLoading } = useQuery<ModelsStatusResponse>({
    queryKey: ['allModelsStatus'],
    queryFn: getAllModelsStatus,
    refetchInterval: 30000,
  });

  const { data: serversData } = useQuery<{ servers: AIServer[] }>({
    queryKey: ['servers'],
    queryFn: getServers,
  });

  const servers = useMemo(() => serversData?.servers || [], [serversData?.servers]);
  const serverIds = useMemo(() => servers.map(s => s.id), [servers]);

  const models = useMemo(
    () => safeArray<ModelStatus>(modelsStatusData?.models),
    [modelsStatusData?.models]
  );

  const filteredModels = useMemo(() => {
    return models.filter(m => {
      const matchesSearch =
        searchQuery === '' ||
        m.serverId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.model.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesServer = serverFilter === '' || m.serverId === serverFilter;
      const matchesStatus = statusFilter === '' || m.status === statusFilter;

      return matchesSearch && matchesServer && matchesStatus;
    });
  }, [models, searchQuery, serverFilter, statusFilter]);

  const groupedByServer = useMemo(() => {
    const groups: Record<string, ModelStatus[]> = {};
    for (const model of filteredModels) {
      if (!groups[model.serverId]) {
        groups[model.serverId] = [];
      }
      groups[model.serverId].push(model);
    }
    return groups;
  }, [filteredModels]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <ShieldCheck className="w-3 h-3 mr-1" />
            Confirmed
          </Badge>
        );
      case 'revoked':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <ShieldX className="w-3 h-3 mr-1" />
            Revoked
          </Badge>
        );
      case 'rate_limited':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <ShieldAlert className="w-3 h-3 mr-1" />
            Rate Limited
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filterOptions = [
    {
      key: 'serverId',
      label: 'Server',
      options: serverIds.map(id => ({ label: id, value: id })),
    },
    {
      key: 'status',
      label: 'Status',
      options: [
        { label: 'Confirmed', value: 'confirmed' },
        { label: 'Revoked', value: 'revoked' },
        { label: 'Rate Limited', value: 'rate_limited' },
      ],
    },
  ];

  if (modelsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <EmptyState
        type="empty"
        title="No capabilities found"
        message="Capabilities will appear here when servers are probed"
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
        filters={{ serverId: serverFilter, status: statusFilter }}
        onFilterChange={(key, value) => {
          if (key === 'serverId') setServerFilter(value);
          if (key === 'status') setStatusFilter(value);
        }}
      />

      <div className="bg-surface rounded-xl border border-surface-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Server ID</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Last Probe</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredModels.map((model, index) => (
              <TableRow key={`${model.serverId}-${model.model}-${index}`}>
                <TableCell className="font-mono text-sm">{model.serverId}</TableCell>
                <TableCell className="font-medium">{model.model}</TableCell>
                <TableCell className="text-text-muted">
                  {model.lastProbeAt ? formatTimeAgo(model.lastProbeAt) : 'Never'}
                </TableCell>
                <TableCell>{getStatusBadge(model.status)}</TableCell>
                <TableCell className="text-text-muted">
                  {model.confidence !== undefined ? `${Math.round(model.confidence * 100)}%` : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredModels.length === 0 && (
          <div className="p-8 text-center text-text-muted">No capabilities match your filters</div>
        )}
      </div>

      {Object.entries(groupedByServer).length > 0 && (
        <div className="text-sm text-text-muted">
          Showing {filteredModels.length} capabilities across {Object.keys(groupedByServer).length}{' '}
          servers
        </div>
      )}
    </div>
  );
});

export default CapabilityTab;
