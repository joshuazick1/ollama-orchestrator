import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getHoneypotStats,
  getHoneypotSummary,
  getTopFlagged,
  getQuarantineList,
  quarantineServer,
  unquarantineServer,
  getGhostStats,
  type HoneypotSummary,
  type HoneypotStatsResponse,
  type TopFlaggedResponse,
  type QuarantineListResponse,
  type GhostStats,
} from '../api';

const REFETCH_INTERVAL = 5000;

export function useHoneypotStats() {
  return useQuery<HoneypotStatsResponse>({
    queryKey: ['honeypot-stats'],
    queryFn: getHoneypotStats,
    refetchInterval: REFETCH_INTERVAL,
  });
}

export function useHoneypotSummary() {
  return useQuery<HoneypotSummary>({
    queryKey: ['honeypot-summary'],
    queryFn: getHoneypotSummary,
    refetchInterval: REFETCH_INTERVAL,
  });
}

export function useTopFlagged(limit = 10, tier?: '1' | '2' | '3') {
  return useQuery<TopFlaggedResponse>({
    queryKey: ['honeypot-top-flagged', limit, tier],
    queryFn: () => getTopFlagged(limit, tier),
    refetchInterval: REFETCH_INTERVAL,
  });
}

export function useQuarantineList() {
  return useQuery<QuarantineListResponse>({
    queryKey: ['quarantine-list'],
    queryFn: getQuarantineList,
    refetchInterval: REFETCH_INTERVAL,
  });
}

export function useGhostStats() {
  return useQuery<GhostStats>({
    queryKey: ['ghost-stats'],
    queryFn: getGhostStats,
    refetchInterval: REFETCH_INTERVAL,
  });
}

export function useQuarantineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverId,
      reason,
      evidence,
    }: {
      serverId: string;
      reason: string;
      evidence?: Record<string, unknown>;
    }) => quarantineServer(serverId, reason, evidence),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quarantine-list'] });
      queryClient.invalidateQueries({ queryKey: ['honeypot-stats'] });
    },
  });
}

export function useUnquarantineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) => unquarantineServer(serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quarantine-list'] });
      queryClient.invalidateQueries({ queryKey: ['honeypot-stats'] });
    },
  });
}
