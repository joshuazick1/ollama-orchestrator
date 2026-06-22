import { useState, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gauge, RefreshCw, X, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import {
  runPerfProbe,
  cancelPerfProbe,
  getPerfProbeStatus,
  getRecentPerfProbeTasks,
  type RecentPerfProbeTask,
} from '../api/perf-probe';
import { toastSuccess, toastError } from '../utils/toast';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { SkeletonTable } from '../components/skeletons';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { colors } from '../constants/colors';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

function TaskStatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
    {
      variant: 'default' | 'secondary' | 'destructive' | 'outline';
      icon: React.ReactNode;
      label: string;
    }
  > = {
    pending: { variant: 'outline', icon: <Clock className="w-3 h-3" />, label: 'Pending' },
    running: {
      variant: 'default',
      icon: <RefreshCw className="w-3 h-3 animate-spin" />,
      label: 'Running',
    },
    completed: {
      variant: 'default',
      icon: <CheckCircle2 className="w-3 h-3" />,
      label: 'Completed',
    },
    failed: { variant: 'destructive', icon: <XCircle className="w-3 h-3" />, label: 'Failed' },
    cancelled: { variant: 'secondary', icon: <XCircle className="w-3 h-3" />, label: 'Cancelled' },
  };
  const config = variants[status] ?? {
    variant: 'outline' as const,
    icon: <AlertCircle className="w-3 h-3" />,
    label: status,
  };
  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      {config.icon}
      {config.label}
    </Badge>
  );
}

function RecentTaskRow({ task }: { task: RecentPerfProbeTask }) {
  const durationMs = task.durationMs ?? (task.completedAt ? task.completedAt - task.startedAt : 0);
  return (
    <div className="flex items-center justify-between py-3 px-4 border-b border-surface-border last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-text-muted">{task.taskId.slice(0, 12)}</span>
        <TaskStatusBadge status={task.status} />
      </div>
      <div className="flex items-center gap-4 text-sm text-text-muted">
        <span>{task.totalProbes} probes</span>
        <span>{formatDuration(durationMs)}</span>
      </div>
    </div>
  );
}

export const PerfProbe = memo(() => {
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const recentTasksQuery = useQuery({
    queryKey: ['perfProbeRecent'],
    queryFn: () => getRecentPerfProbeTasks(5),
    refetchInterval: 10000,
  });

  const activeTaskQuery = useQuery({
    queryKey: ['perfProbeStatus', activeTaskId],
    queryFn: () => (activeTaskId ? getPerfProbeStatus(activeTaskId) : null),
    enabled: !!activeTaskId,
    refetchInterval: activeTaskId ? 2000 : false,
  });

  const runMutation = useMutation({
    mutationFn: runPerfProbe,
    onSuccess: data => {
      toastSuccess('Performance probe started');
      setActiveTaskId(data.taskId);
      setShowConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['perfProbeRecent'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to start performance probe');
      setShowConfirm(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelPerfProbe,
    onSuccess: () => {
      toastSuccess('Performance probe cancelled');
      setActiveTaskId(null);
      queryClient.invalidateQueries({ queryKey: ['perfProbeRecent'] });
    },
    onError: error => {
      toastError(error instanceof Error ? error.message : 'Failed to cancel performance probe');
    },
  });

  const isRunning =
    activeTaskQuery.data?.status === 'running' || activeTaskQuery.data?.status === 'pending';
  const progress = activeTaskQuery.data
    ? {
        total: activeTaskQuery.data.totalProbes ?? 0,
        completed: activeTaskQuery.data.completedProbes ?? 0,
        percent: activeTaskQuery.data.totalProbes
          ? Math.round(
              (activeTaskQuery.data.completedProbes / activeTaskQuery.data.totalProbes) * 100
            )
          : 0,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-base flex items-center gap-2">
            <Gauge className="w-6 h-6" />
            Performance Probe
          </h2>
          <p className="text-text-muted">
            Trigger a one-time performance probe across the fleet to refresh the load
            balancer&apos;s metrics.
          </p>
        </div>
        <Button
          onClick={() => setShowConfirm(true)}
          disabled={runMutation.isPending}
          className={colors.primary}
        >
          {runMutation.isPending ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Gauge className="w-4 h-4 mr-2" />
              Run Probe Now
            </>
          )}
        </Button>
      </div>

      {activeTaskId && activeTaskQuery.data && (
        <Card className="border-surface-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-text-base text-lg flex items-center justify-between">
              <span className="flex items-center gap-2">
                <RefreshCw className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
                Active Task
              </span>
              <TaskStatusBadge status={activeTaskQuery.data.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-text-muted block">Task ID</span>
                <span className="font-mono text-text-base">{activeTaskQuery.data.taskId}</span>
              </div>
              <div>
                <span className="text-text-muted block">Status</span>
                <span className="text-text-base capitalize">{activeTaskQuery.data.status}</span>
              </div>
              <div>
                <span className="text-text-muted block">Progress</span>
                <span className="text-text-base">
                  {progress
                    ? `${progress.completed} / ${progress.total} (${progress.percent}%)`
                    : '—'}
                </span>
              </div>
              <div>
                <span className="text-text-muted block">Started</span>
                <span className="text-text-base">
                  {formatTimestamp(activeTaskQuery.data.startedAt)}
                </span>
              </div>
            </div>

            {progress && progress.total > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-text-muted">
                  <span>Progress</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-primary transition-all duration-300 w-[${progress.percent}%]`}
                  />
                </div>
              </div>
            )}

            {isRunning && (
              <div className="flex justify-end">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => cancelMutation.mutate(activeTaskId)}
                  disabled={cancelMutation.isPending}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
            )}

            {(activeTaskQuery.data.status === 'completed' ||
              activeTaskQuery.data.status === 'failed' ||
              activeTaskQuery.data.status === 'cancelled') && (
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setActiveTaskId(null);
                    queryClient.invalidateQueries({ queryKey: ['perfProbeRecent'] });
                  }}
                >
                  Dismiss
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="text-lg font-semibold text-text-base mb-3">Recent Tasks</h3>
        {recentTasksQuery.isLoading ? (
          <SkeletonTable rows={5} columns={3} />
        ) : recentTasksQuery.isError ? (
          <div
            className={`p-4 rounded-lg border border-surface-border bg-surface ${colors.textMuted}`}
          >
            Failed to load recent tasks
          </div>
        ) : recentTasksQuery.data && recentTasksQuery.data.length > 0 ? (
          <Card className="border-surface-border">
            <CardContent className="p-0">
              {recentTasksQuery.data.map(task => (
                <RecentTaskRow key={task.taskId} task={task} />
              ))}
            </CardContent>
          </Card>
        ) : (
          <div
            className={`p-8 rounded-lg border border-surface-border bg-surface text-center ${colors.textMuted}`}
          >
            No recent performance probe tasks
          </div>
        )}
      </div>

      {showConfirm && (
        <ConfirmationModal
          isOpen={showConfirm}
          onClose={() => setShowConfirm(false)}
          onConfirm={() => runMutation.mutate({})}
          title="Run Performance Probe?"
          message="This will send test requests to all available servers and models in your fleet to measure latency and throughput."
          confirmLabel="Run Probe"
          cancelLabel="Cancel"
          isPending={runMutation.isPending}
          consequences={[
            'Test requests will be sent to every server:model combination',
            'Metrics will be collected for latency, TTFT, and throughput',
            'Load balancer scores will be updated based on results',
            'This may temporarily increase load on your fleet',
          ]}
        />
      )}
    </div>
  );
});

export default PerfProbe;
