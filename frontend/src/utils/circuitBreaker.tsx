import type { ReactNode } from 'react';
import { Shield, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';

export type CircuitBreakerState = 'OPEN' | 'CLOSED' | 'HALF-OPEN' | 'UNKNOWN';

export const getCircuitBreakerStateColor = (state: string): string => {
  switch (state) {
    case 'OPEN':
      return 'text-red-400 bg-red-400/10 border-red-400/20';
    case 'HALF-OPEN':
      return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
    case 'CLOSED':
      return 'text-green-400 bg-green-400/10 border-green-400/20';
    default:
      return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
  }
};

export const getCircuitBreakerBadgeColor = (state: string): string => {
  switch (state) {
    case 'OPEN':
      return 'bg-red-500/20 text-red-400 border-red-500/50';
    case 'HALF-OPEN':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
    case 'CLOSED':
      return 'bg-green-500/20 text-green-400 border-green-500/50';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
  }
};

export const getCircuitBreakerStateIcon = (state: string): ReactNode => {
  switch (state) {
    case 'OPEN':
      return <ShieldAlert className="w-6 h-6 text-red-500" />;
    case 'CLOSED':
      return <ShieldCheck className="w-6 h-6 text-green-500" />;
    case 'HALF-OPEN':
      return <ShieldQuestion className="w-6 h-6 text-yellow-500" />;
    default:
      return <Shield className="w-6 h-6 text-gray-500" />;
  }
};

export const getCircuitBreakerStateLabel = (state: string): string => {
  switch (state) {
    case 'OPEN':
      return 'Open';
    case 'CLOSED':
      return 'Closed';
    case 'HALF-OPEN':
      return 'Half-Open';
    default:
      return 'Unknown';
  }
};

export const getStatePriority = (state: string): number => {
  switch (state) {
    case 'OPEN':
      return 0;
    case 'HALF-OPEN':
      return 1;
    case 'CLOSED':
      return 2;
    default:
      return 3;
  }
};

export const sortByStatePriority = <T extends { state: string }>(items: T[]): T[] => {
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
