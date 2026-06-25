import { apiClient } from './client';
import { ApiError } from './errors';

async function apiCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return (await call()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError('Unexpected error occurred', undefined, error);
  }
}

export interface HoneypotServerResult {
  serverId: string;
  url: string;
  schemaScore: number;
  coldStartScore: number;
  watermarkScore: number;
  compositeScore: number;
  verdict: 'clean' | 'suspicious' | 'flagged';
  evidence: Record<string, unknown>;
  lastProbed: string;
  tier1Score?: number;
  tier2Score?: number;
  tier3Score?: number;
  headerScore?: number;
  entropyScore?: number;
  tlsScore?: number;
  ipAsnScore?: number;
  callbackScore?: number;
}

export interface HoneypotSummary {
  enabled: boolean;
  totalServers: number;
  scored: number;
  clean: number;
  suspicious: number;
  flagged: number;
  quarantined: number;
  tier1Signals: number;
  tier2Signals: number;
  tier3Signals: number;
  avgTier1Score: number;
  avgTier2Score: number;
  avgTier3Score: number;
  avgCompositeScore: number;
}

export interface HoneypotStatsResponse {
  enabled: boolean;
  intervalMs: number;
  summary: {
    totalServers: number;
    scored: number;
    clean: number;
    suspicious: number;
    flagged: number;
    tier1Signals: number;
    tier2Signals: number;
    tier3Signals: number;
  };
  tier1Probes: string[];
  tier2Probes: string[];
  tier3Probes: string[];
  results: HoneypotServerResult[];
}

export interface TopFlaggedResponse {
  results: HoneypotServerResult[];
  count: number;
}

export interface QuarantineEntry {
  serverId: string;
  quarantinedAt: number;
  reason: 'honeypot-flagged' | 'manual' | 'auto-low-confidence';
  evidence: Record<string, unknown> | null;
  expiresAt: number | null;
  consecutiveCleanCycles: number;
  isManual: boolean;
}

export interface QuarantineListResponse {
  quarantined: QuarantineEntry[];
  count: number;
}

export interface GhostStats {
  totalServers: number;
  ghostServers: number;
  ghostPercentage: number;
  lastCycleAt: string;
  cycleIntervalMs: number;
}

export const getHoneypotStats = async (): Promise<HoneypotStatsResponse> => {
  return apiCall(async () => {
    const response = await apiClient.get('/honeypot-stats');
    return response.data;
  });
};

export const getHoneypotSummary = async (): Promise<HoneypotSummary> => {
  return apiCall(async () => {
    const response = await apiClient.get('/honeypot-stats/summary');
    return response.data;
  });
};

export const getTopFlagged = async (
  limit = 10,
  tier?: '1' | '2' | '3'
): Promise<TopFlaggedResponse> => {
  return apiCall(async () => {
    const params: Record<string, string | number> = { limit };
    if (tier) params.tier = tier;
    const response = await apiClient.get('/honeypot-stats/top', { params });
    return response.data;
  });
};

export const getQuarantineList = async (): Promise<QuarantineListResponse> => {
  return apiCall(async () => {
    const response = await apiClient.get('/quarantine');
    return response.data;
  });
};

export const quarantineServer = async (
  serverId: string,
  reason: string,
  evidence?: Record<string, unknown>
): Promise<{ success: boolean; serverId: string }> => {
  return apiCall(async () => {
    const response = await apiClient.post(`/quarantine/${encodeURIComponent(serverId)}`, {
      reason,
      evidence: evidence ?? null,
    });
    return response.data;
  });
};

export const unquarantineServer = async (
  serverId: string
): Promise<{ success: boolean; serverId: string }> => {
  return apiCall(async () => {
    const response = await apiClient.delete(`/quarantine/${encodeURIComponent(serverId)}`);
    return response.data;
  });
};

export const getGhostStats = async (): Promise<GhostStats> => {
  return apiCall(async () => {
    const response = await apiClient.get('/servers/ghost-stats');
    return response.data;
  });
};
