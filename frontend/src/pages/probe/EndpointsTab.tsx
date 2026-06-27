import { useState, useMemo, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
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
import { getServers, listServerModels } from '../../api';
import type { AIServer } from '../../api/types';

interface ServerModel {
  model: string;
  status: 'loaded' | 'loading' | 'not_loaded';
  size?: number;
}

interface EndpointInfo {
  endpoint: string;
  available: boolean;
  latency?: number;
}

interface ModelEndpointData {
  serverId: string;
  model: string;
  endpoints: EndpointInfo[];
  available: boolean;
  status: 'healthy' | 'degraded' | 'down';
}

export const EndpointsTab = memo(() => {
  const [searchQuery, setSearchQuery] = useState('');
  const [serverFilter, setServerFilter] = useState('');

  const { data: servers, isLoading: serversLoading } = useQuery<AIServer[]>({
    queryKey: ['servers'],
    queryFn: getServers,
  });

  const serverList = useMemo(() => servers || [], [servers]);

  const serverModelData = useQuery({
    queryKey: ['serverModels', serverFilter],
    queryFn: async () => {
      const targetServers = serverFilter
        ? serverList.filter(s => s.id === serverFilter)
        : serverList;
      const results: ModelEndpointData[] = [];

      for (const server of targetServers) {
        try {
          const modelsResponse = await listServerModels(server.id);
          const models: ServerModel[] = modelsResponse.models || [];

          for (const modelInfo of models) {
            const endpoints: EndpointInfo[] = [
              { endpoint: '/api/generate', available: server.supportsOllama ?? false },
              { endpoint: '/api/chat', available: server.supportsOllama ?? false },
              { endpoint: '/v1/chat/completions', available: server.supportsV1 ?? false },
              { endpoint: '/v1/completions', available: server.supportsV1 ?? false },
              { endpoint: '/v1/embeddings', available: server.supportsV1 ?? false },
              { endpoint: '/v1/messages', available: server.supportsAnthropic ?? false },
            ];

            const availableCount = endpoints.filter(e => e.available).length;
            const isAvailable = modelInfo.status === 'loaded' && availableCount > 0;

            results.push({
              serverId: server.id,
              model: modelInfo.model,
              endpoints,
              available: isAvailable,
              status: isAvailable ? 'healthy' : availableCount > 0 ? 'degraded' : 'down',
            });
          }
        } catch {
          void 0;
        }
      }

      return results;
    },
    enabled: serverList.length > 0,
  });

  const endpointData = useMemo(() => serverModelData.data || [], [serverModelData.data]);
  const serverIds = useMemo(() => serverList.map(s => s.id), [serverList]);

  const filteredData = useMemo(() => {
    return endpointData.filter(item => {
      const matchesSearch =
        searchQuery === '' ||
        item.serverId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.model.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesServer = serverFilter === '' || item.serverId === serverFilter;

      return matchesSearch && matchesServer;
    });
  }, [endpointData, searchQuery, serverFilter]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle className="w-3 h-3 mr-1" />
            Healthy
          </Badge>
        );
      case 'degraded':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Degraded
          </Badge>
        );
      case 'down':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <XCircle className="w-3 h-3 mr-1" />
            Down
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
  ];

  if (serversLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (serverList.length === 0) {
    return (
      <EmptyState
        type="no-servers"
        title="No servers found"
        message="Add servers to see endpoint availability"
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
              <TableHead>Server ID</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Endpoints</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.map((item, index) => (
              <TableRow key={`${item.serverId}-${item.model}-${index}`}>
                <TableCell className="font-mono text-sm">{item.serverId}</TableCell>
                <TableCell className="font-medium">{item.model}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.endpoints.map(ep => (
                      <Badge
                        key={ep.endpoint}
                        variant="outline"
                        className={`text-xs ${
                          ep.available
                            ? 'border-green-500/30 text-green-400'
                            : 'border-gray-600 text-gray-500'
                        }`}
                      >
                        {ep.endpoint.split('/').pop()}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{getStatusBadge(item.status)}</TableCell>
                <TableCell>
                  <span
                    className="text-xs text-text-subtle"
                    title="Soft revoke will be available in a future release"
                  >
                    —
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredData.length === 0 && (
          <div className="p-8 text-center text-text-muted">
            No endpoint data matches your filters
          </div>
        )}
      </div>

      <div className="text-sm text-text-muted">Showing {filteredData.length} endpoint entries</div>
    </div>
  );
});

export default EndpointsTab;
