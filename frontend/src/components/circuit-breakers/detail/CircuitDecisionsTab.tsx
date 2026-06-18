// Extracted from CircuitDetailModal.tsx - CircuitDecisionsTab component (History tab)
import { useState, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Shield, CheckCircle, XCircle } from 'lucide-react';
import { getServerRequestHistory, getDecisionHistory } from '../../../api';
import { formatTimeAgo } from '../../../utils/formatting';
import { z } from 'zod';

const requestEventSchema = z.object({
  id: z.string(),
  timestamp: z.number().optional(),
  model: z.string(),
  endpoint: z.string().optional(),
  streaming: z.boolean().optional(),
  duration: z.number().optional(),
  success: z.boolean(),
  tokensGenerated: z.number().optional(),
  tokensPrompt: z.number().optional(),
  errorType: z.string().optional(),
  ttft: z.number().optional(),
  streamingDuration: z.number().optional(),
  queueWaitTime: z.number().optional(),
});

const requestHistoryApiResponseSchema = z.object({
  success: z.boolean(),
  serverId: z.string(),
  model: z.string().nullable(),
  count: z.number(),
  requests: z.array(requestEventSchema),
});

const decisionEventSchema = z.object({
  timestamp: z.number(),
  model: z.string(),
  selectedServerId: z.string(),
  algorithm: z.string(),
  candidates: z.unknown(),
  selectionReason: z.string().optional(),
});

const decisionHistoryApiResponseSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  events: z.array(decisionEventSchema),
});

interface RequestHistoryItem {
  id: string;
  endpoint?: string;
  timestamp?: number;
  startTime?: number;
  duration?: number;
  success: boolean;
  tokensGenerated?: number;
  error?: string;
  chunkCount?: number;
}

interface DecisionHistoryItem {
  id: string;
  timestamp: number;
  serverId: string;
  model: string;
  decision: string;
  reason?: string;
  selected?: boolean;
  algorithm?: string;
  score?: number;
}

interface CircuitDecisionsTabProps {
  serverId: string;
  model: string;
}

export const CircuitDecisionsTab = memo<CircuitDecisionsTabProps>(({ serverId, model }) => {
  const [timeRange, setTimeRange] = useState(24);

  const { data: requestHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['request-history', serverId, model, timeRange],
    queryFn: async () => {
      const data = await getServerRequestHistory(serverId, { limit: 20 });
      const parsed = requestHistoryApiResponseSchema.safeParse(data);
      if (!parsed.success) {
        return undefined;
      }
      return { requests: parsed.data.requests } as { requests: RequestHistoryItem[] } | undefined;
    },
    refetchInterval: 30000,
  });

  const { data: decisions, isLoading: decisionsLoading } = useQuery({
    queryKey: ['decisions', serverId, model, timeRange],
    queryFn: async () => {
      const data = await getDecisionHistory({ serverId, model, limit: 20, hours: timeRange });
      const parsed = decisionHistoryApiResponseSchema.safeParse(data);
      if (!parsed.success) {
        return undefined;
      }
      return {
        decisions: parsed.data.events.map(event => ({
          id: `${event.selectedServerId}-${event.timestamp}`,
          timestamp: event.timestamp,
          serverId: event.selectedServerId,
          model: event.model,
          decision: event.selectionReason || event.algorithm,
          reason: event.selectionReason,
          algorithm: event.algorithm,
          selected: true,
        })),
      } as { decisions: DecisionHistoryItem[] } | undefined;
    },
    refetchInterval: 30000,
  });

  const requests = requestHistory?.requests || [];
  const decisionList = decisions?.decisions || [];

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Time Range:</span>
        {[1, 6, 24, 72].map(hours => (
          <button
            key={hours}
            onClick={() => setTimeRange(hours)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              timeRange === hours
                ? 'bg-blue-600 text-text-base'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {hours}h
          </button>
        ))}
      </div>

      {/* Recent Requests */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <History className="w-5 h-5 text-blue-400" />
          Recent Requests
        </h3>
        {historyLoading ? (
          <div className="text-gray-500">Loading...</div>
        ) : requests.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {requests.slice(0, 10).map((req, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-surface rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {req.success ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <div>
                    <div className="text-sm text-text-base">{req.endpoint || 'generate'}</div>
                    <div className="text-xs text-gray-500">
                      {req.duration ? `${req.duration}ms` : 'N/A'}
                      {req.chunkCount !== undefined && ` • ${req.chunkCount} chunks`}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {req.startTime ? formatTimeAgo(req.startTime) : 'N/A'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-sm">No requests in this time range</div>
        )}
      </div>

      {/* Load Balancer Decisions */}
      <div className="bg-surface-raised rounded-lg p-4">
        <h3 className="text-lg font-semibold text-text-base mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-400" />
          Load Balancer Decisions
        </h3>
        {decisionsLoading ? (
          <div className="text-gray-500">Loading...</div>
        ) : decisionList.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {decisionList.slice(0, 10).map((decision, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-surface rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {decision.selected ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <div>
                    <div className="text-sm text-text-base">{decision.algorithm || 'default'}</div>
                    <div className="text-xs text-gray-500">
                      Score: {decision.score?.toFixed(1) || 'N/A'}
                      {decision.reason && ` • ${decision.reason}`}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {decision.timestamp ? formatTimeAgo(decision.timestamp) : 'N/A'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-sm">No decisions in this time range</div>
        )}
      </div>
    </div>
  );
});

CircuitDecisionsTab.displayName = 'CircuitDecisionsTab';
