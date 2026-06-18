import { useState, useEffect, lazy, Suspense, memo, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, RefreshCw, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Card } from '../components/Card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/Button';
import { toastSuccess, toastError } from '../utils/toast';
import { formatTimeAgo } from '../utils/formatting';
import { getAllModelsStatus, triggerHealthCheck } from '../api';

const CapabilityTab = lazy(() => import('./probe/CapabilityTab'));
const EndpointsTab = lazy(() => import('./probe/EndpointsTab'));
const WalTab = lazy(() => import('./probe/WalTab'));

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

export const Probe = memo(() => {
  const queryClient = useQueryClient();
  const [lastProbeTime, setLastProbeTime] = useState<number | null>(null);
  const [nextProbeCountdown, setNextProbeCountdown] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<'capability' | 'endpoints' | 'wal'>('capability');

  const { data: modelsStatusData, isLoading: modelsLoading } = useQuery<ModelsStatusResponse>({
    queryKey: ['allModelsStatus'],
    queryFn: getAllModelsStatus,
    refetchInterval: 30000,
  });

  const triggerProbeMutation = useMutation({
    mutationFn: triggerHealthCheck,
    onSuccess: () => {
      toastSuccess('Capability probe triggered', 'Health check started');
      setLastProbeTime(Date.now());
      setNextProbeCountdown(30);
      queryClient.invalidateQueries({ queryKey: ['allModelsStatus'] });
    },
    onError: (error: Error) => {
      toastError('Failed to trigger probe', error.message);
    },
  });

  const models = useMemo(() => modelsStatusData?.models || [], [modelsStatusData?.models]);
  const confirmedCount = models.filter(m => m.status === 'confirmed').length;
  const revokedCount = models.filter(m => m.status === 'revoked').length;
  const rateLimitedCount = models.filter(m => m.status === 'rate_limited').length;

  useEffect(() => {
    const interval = setInterval(() => {
      setNextProbeCountdown(prev => {
        if (prev <= 1) {
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleTriggerProbe = () => {
    triggerProbeMutation.mutate();
  };

  const computedLastProbeTime = useMemo(() => {
    if (models.length === 0) return lastProbeTime;
    const latestProbe = models.reduce((latest, m) => {
      if (m.lastProbeAt && m.lastProbeAt > latest) {
        return m.lastProbeAt;
      }
      return latest;
    }, 0);
    return latestProbe > 0 ? latestProbe : lastProbeTime;
  }, [models, lastProbeTime]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-text-base tracking-tight">Capability Probe</h2>
          <p className="text-text-muted mt-1">
            Monitor server model capabilities and endpoint availability
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-text-muted">
            <Clock className="w-4 h-4" />
            <span className="text-sm">
              Last probe: {computedLastProbeTime ? formatTimeAgo(computedLastProbeTime) : 'Never'}
            </span>
          </div>

          <Badge variant="outline" className="text-text-muted">
            Next in: {nextProbeCountdown}s
          </Badge>

          <Button
            variant="primary"
            size="sm"
            onClick={handleTriggerProbe}
            disabled={triggerProbeMutation.isPending}
            className="gap-2"
          >
            {triggerProbeMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Activity className="w-4 h-4" />
            )}
            Trigger Probe
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-green-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Confirmed</p>
              <h3 className="text-3xl font-bold mt-2 text-green-400">
                {modelsLoading ? '-' : confirmedCount}
              </h3>
              <p className="text-text-subtle text-sm mt-1">capabilities verified</p>
            </div>
            <div className="p-3 rounded-lg bg-green-500/20">
              <CheckCircle className="w-6 h-6 text-green-400" />
            </div>
          </div>
        </Card>

        <Card className="border-red-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Revoked</p>
              <h3 className="text-3xl font-bold mt-2 text-red-400">
                {modelsLoading ? '-' : revokedCount}
              </h3>
              <p className="text-text-subtle text-sm mt-1">capabilities removed</p>
            </div>
            <div className="p-3 rounded-lg bg-red-500/20">
              <XCircle className="w-6 h-6 text-red-400" />
            </div>
          </div>
        </Card>

        <Card className="border-yellow-500/30">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-text-muted text-sm font-medium">Rate Limited</p>
              <h3 className="text-3xl font-bold mt-2 text-yellow-400">
                {modelsLoading ? '-' : rateLimitedCount}
              </h3>
              <p className="text-text-subtle text-sm mt-1">temporary restrictions</p>
            </div>
            <div className="p-3 rounded-lg bg-yellow-500/20">
              <AlertTriangle className="w-6 h-6 text-yellow-400" />
            </div>
          </div>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="capability">Capability</TabsTrigger>
          <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
          <TabsTrigger value="wal">WAL</TabsTrigger>
        </TabsList>

        <TabsContent value="capability" className="mt-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <CapabilityTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="endpoints" className="mt-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <EndpointsTab />
          </Suspense>
        </TabsContent>

        <TabsContent value="wal" className="mt-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <WalTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
});

export default Probe;
