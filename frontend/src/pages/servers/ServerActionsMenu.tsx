// Extracted from Servers.tsx - ServerActionsMenu component
import React, { memo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { Trash2, Power, PowerOff, Wrench } from 'lucide-react';
import { drainServer, undrainServer, setServerMaintenance } from '../../api';
import { toastSuccess, toastError } from '../../utils/toast';
import type { AIServer } from '../../types';

interface ServerActionsMenuProps {
  server: AIServer;
  onManageModels: (server: AIServer) => void;
  onDelete: (server: AIServer) => void;
}

export const ServerActionsMenu = memo(function ServerActionsMenu({
  server,
  onManageModels,
  onDelete,
}: ServerActionsMenuProps) {
  const drainMutation = useMutation({
    mutationFn: drainServer,
    onSuccess: () => {
      toastSuccess('Server drained');
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to drain server');
    },
  });

  const undrainMutation = useMutation({
    mutationFn: undrainServer,
    onSuccess: () => {
      toastSuccess('Server undrained');
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to undrain server');
    },
  });

  const maintenanceMutation = useMutation({
    mutationFn: ({ serverId, enabled }: { serverId: string; enabled: boolean }) =>
      setServerMaintenance(serverId, enabled),
    onSuccess: (_data, variables) => {
      toastSuccess(
        `Server ${variables.enabled ? 'in maintenance mode' : 'maintenance mode disabled'}`
      );
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to set maintenance mode');
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex space-x-3">
        {server.supportsOllama !== false && (
          <Button
            variant="secondary"
            className="flex-1"
            onClick={e => {
              e.stopPropagation();
              onManageModels(server);
            }}
          >
            Manage Models
          </Button>
        )}
        <Button
          variant="danger"
          className="flex-1"
          onClick={e => {
            e.stopPropagation();
            onDelete(server);
          }}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          <span>Remove</span>
        </Button>
      </div>

      {/* Server Maintenance Actions */}
      <div className="border-t border-surface-border/50 pt-3">
        <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Maintenance
        </h5>
        <div className="flex space-x-2">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={drainMutation.isPending}
            onClick={e => {
              e.stopPropagation();
              drainMutation.mutate(server.id);
            }}
          >
            <Power className="w-4 h-4 mr-2" />
            <span>Drain</span>
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={undrainMutation.isPending}
            onClick={e => {
              e.stopPropagation();
              undrainMutation.mutate(server.id);
            }}
          >
            <PowerOff className="w-4 h-4 mr-2" />
            <span>Undrain</span>
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={maintenanceMutation.isPending}
            onClick={e => {
              e.stopPropagation();
              maintenanceMutation.mutate({
                serverId: server.id,
                enabled: true,
              });
            }}
          >
            <Wrench className="w-4 h-4 mr-2" />
            <span>Maintain</span>
          </Button>
        </div>
      </div>
    </div>
  );
});
