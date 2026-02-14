import { useQuery } from '@tanstack/react-query';
import { getModelMap, getServers } from '../api';
import { Server, Box, Layers, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { AIServer } from '../types';
import { useState } from 'react';

type SortKey = 'name' | 'replicas';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

const SortIcon = ({ columnKey, sortConfig }: { columnKey: SortKey; sortConfig: SortConfig }) => {
  if (sortConfig.key !== columnKey) return <ArrowUpDown className="w-4 h-4 text-gray-600" />;
  return sortConfig.direction === 'asc' ? (
    <ArrowUp className="w-4 h-4 text-blue-400" />
  ) : (
    <ArrowDown className="w-4 h-4 text-blue-400" />
  );
};

export const Models = () => {
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: 'name',
    direction: 'asc',
  });

  const { data: modelMap, isLoading: mapLoading } = useQuery({
    queryKey: ['modelMap'],
    queryFn: getModelMap,
  });
  const { data: servers, isLoading: serversLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: getServers,
  });

  if (mapLoading || serversLoading) return <div className="text-white">Loading...</div>;

  const rawModels = Object.keys(modelMap || {});

  const handleSort = (key: SortKey) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortedModels = () => {
    return [...rawModels].sort((a, b) => {
      if (sortConfig.key === 'name') {
        return sortConfig.direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
      } else {
        const countA = (modelMap?.[a] || []).length;
        const countB = (modelMap?.[b] || []).length;
        return sortConfig.direction === 'asc' ? countA - countB : countB - countA;
      }
    });
  };

  const models = getSortedModels();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">Models</h2>
          <p className="text-gray-400">Available models and their distribution</p>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-900 text-gray-400 uppercase text-xs font-semibold">
            <tr>
              <th
                className="px-6 py-4 cursor-pointer hover:text-white transition-colors group"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center space-x-2">
                  <span>Model Name</span>
                  <SortIcon columnKey="name" sortConfig={sortConfig} />
                </div>
              </th>
              <th
                className="px-6 py-4 cursor-pointer hover:text-white transition-colors group"
                onClick={() => handleSort('replicas')}
              >
                <div className="flex items-center space-x-2">
                  <span>Available Replicas</span>
                  <SortIcon columnKey="replicas" sortConfig={sortConfig} />
                </div>
              </th>
              <th className="px-6 py-4">Servers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {models.map(model => {
              const serverIds = modelMap[model] || [];
              const modelServers = servers?.filter((s: AIServer) => serverIds.includes(s.id)) || [];

              return (
                <tr key={model} className="hover:bg-gray-750 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                        <Box className="w-5 h-5" />
                      </div>
                      <span className="font-medium text-white">{model}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${modelServers.length > 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}
                      >
                        {modelServers.length} Nodes
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      {modelServers.map((server: AIServer) => (
                        <div
                          key={server.id}
                          className="flex items-center space-x-1 text-xs bg-gray-700 px-2 py-1 rounded text-gray-300"
                        >
                          <Server className="w-3 h-3" />
                          <span title={server.url}>{server.url}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {models.length === 0 && (
              <tr>
                <td colSpan={3} className="px-6 py-12 text-center text-gray-500">
                  <Layers className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No models detected across connected servers.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
