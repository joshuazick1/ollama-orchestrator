import type { ReactNode } from 'react';
import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';

export type CircuitBreakerState = 'OPEN' | 'CLOSED' | 'HALF-OPEN' | 'UNKNOWN';

interface CircuitBreakerConfig {
  color: string;
  badgeColor: string;
  icon: ReactNode;
  label: string;
  priority: number;
}

const CIRCUIT_BREAKER_CONFIG: Record<CircuitBreakerState, CircuitBreakerConfig> = {
  OPEN: {
    color: 'text-red-400 bg-red-400/10 border-red-400/20',
    badgeColor: 'bg-red-500/20 text-red-400 border-red-500/50',
    icon: <ShieldAlert className="w-6 h-6 text-red-500" />,
    label: 'Open',
    priority: 0,
  },
  CLOSED: {
    color: 'text-green-400 bg-green-400/10 border-green-400/20',
    badgeColor: 'bg-green-500/20 text-green-400 border-green-500/50',
    icon: <ShieldCheck className="w-6 h-6 text-green-500" />,
    label: 'Closed',
    priority: 2,
  },
  'HALF-OPEN': {
    color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
    badgeColor: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
    icon: <ShieldQuestion className="w-6 h-6 text-yellow-500" />,
    label: 'Half-Open',
    priority: 1,
  },
  UNKNOWN: {
    color: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
    badgeColor: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
    icon: <Shield className="w-6 h-6 text-gray-500" />,
    label: 'Unknown',
    priority: 3,
  },
};

export const getCircuitBreakerStateColor = (state: CircuitBreakerState): string => {
  return CIRCUIT_BREAKER_CONFIG[state]?.color ?? CIRCUIT_BREAKER_CONFIG.UNKNOWN.color;
};

export const getCircuitBreakerBadgeColor = (state: CircuitBreakerState): string => {
  return CIRCUIT_BREAKER_CONFIG[state]?.badgeColor ?? CIRCUIT_BREAKER_CONFIG.UNKNOWN.badgeColor;
};

export const getCircuitBreakerStateIcon = (state: CircuitBreakerState): ReactNode => {
  return CIRCUIT_BREAKER_CONFIG[state]?.icon ?? CIRCUIT_BREAKER_CONFIG.UNKNOWN.icon;
};

export const getCircuitBreakerStateLabel = (state: CircuitBreakerState): string => {
  return CIRCUIT_BREAKER_CONFIG[state]?.label ?? CIRCUIT_BREAKER_CONFIG.UNKNOWN.label;
};

export const getStatePriority = (state: CircuitBreakerState): number => {
  return CIRCUIT_BREAKER_CONFIG[state]?.priority ?? CIRCUIT_BREAKER_CONFIG.UNKNOWN.priority;
};

export const sortByStatePriority = <T extends { state: CircuitBreakerState }>(items: T[]): T[] => {
  return [...items].sort((a, b) => getStatePriority(a.state) - getStatePriority(b.state));
};

export const getErrorRateColor = (errorRate: number): string => {
  if (errorRate > 0.5) return 'text-red-400';
  if (errorRate > 0.2) return 'text-yellow-400';
  return 'text-green-400';
};

export const getHealthStatusColor = (healthy: boolean): string => {
  return healthy ? 'text-green-400' : 'text-red-400';
};

export const getHealthStatusBg = (healthy: boolean): string => {
  return healthy ? 'bg-green-500/20' : 'bg-red-500/20';
};
