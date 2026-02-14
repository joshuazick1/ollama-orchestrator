import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getLogs, clearLogs } from '../api';
import { Trash2, RefreshCw } from 'lucide-react';

export const Logs = () => {
  const queryClient = useQueryClient();
  const { data: logs, isLoading, refetch } = useQuery({ queryKey: ['logs'], queryFn: getLogs });

  const clearMutation = useMutation({
    mutationFn: clearLogs,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logs'] });
    },
  });

  if (isLoading) return <div className="text-white">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">System Logs</h2>
          <p className="text-gray-400">View and manage application logs</p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => refetch()}
            className="flex items-center space-x-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => clearMutation.mutate()}
            className="flex items-center space-x-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Trash2 className="w-5 h-5" />
            <span>Clear Logs</span>
          </button>
        </div>
      </div>

      <div className="bg-gray-950 rounded-xl border border-gray-800 p-4 font-mono text-sm h-[600px] overflow-auto">
        {logs ? (
          <pre className="whitespace-pre-wrap text-gray-300">
            {typeof logs === 'string' ? logs : JSON.stringify(logs, null, 2)}
          </pre>
        ) : (
          <p className="text-gray-500 italic">No logs available.</p>
        )}
      </div>
    </div>
  );
};
